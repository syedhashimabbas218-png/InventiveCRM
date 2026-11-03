export type Point = { lat: number; lng: number };

export const haversineKm = (a: Point, b: Point) => {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
};

type Ring = [number, number][];
export type ServiceArea = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] };

// Ray casting on GeoJSON rings ([lng, lat]); holes are rings after the first.
const insideRing = (point: Point, ring: Ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > point.lat !== yj > point.lat && point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const insidePolygon = (point: Point, rings: Ring[]) => insideRing(point, rings[0]) && !rings.slice(1).some((hole) => insideRing(point, hole));

export const inServiceArea = (point: Point, area: ServiceArea) =>
  area.type === 'Polygon' ? insidePolygon(point, area.coordinates) : area.coordinates.some((polygon) => insidePolygon(point, polygon));

export const parseServiceArea = (value: unknown): ServiceArea | null => {
  const geometry = (value as { type?: string; geometry?: unknown })?.type === 'Feature' ? (value as { geometry: unknown }).geometry : value;
  const candidate = geometry as { type?: string; coordinates?: unknown };
  if ((candidate?.type === 'Polygon' || candidate?.type === 'MultiPolygon') && Array.isArray(candidate.coordinates)) return candidate as ServiceArea;
  return null;
};

// UK territories by postcode: "LS" matches every LS district, "LS6" only that district (not LS60).
export const outwardCode = (postcode: string) => {
  const compact = postcode.toUpperCase().replace(/\s+/g, '');
  const match = /^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})?$/.exec(compact);
  return match ? match[1] : compact;
};

export const postcodeInTerritory = (postcode: string, territory: string[]) => {
  const outward = outwardCode(postcode);
  const area = /^[A-Z]+/.exec(outward)?.[0] ?? '';
  return territory.some((entry) => {
    const rule = entry.toUpperCase().replace(/\s+/g, '');
    return /\d/.test(rule) ? rule === outward : rule === area;
  });
};

export const LOCATION_MODES = ['NONE', 'NEAREST', 'FASTEST', 'WITHIN_RADIUS', 'TERRITORY', 'FIRST_AVAILABLE_NEARBY', 'CUSTOMER_CHOICE', 'GEOGRAPHIC_ROUND_ROBIN'] as const;
export type LocationMode = (typeof LOCATION_MODES)[number];

export type GeoAdvisor = {
  advisorId: string;
  base: Point | null;
  serviceRadiusKm: number | null;
  maxTravelMinutes: number | null;
  serviceArea: ServiceArea | null;
  postcodeTerritory: string[];
};

export type GeoMeasure = { straightKm: number | null; roadKm: number | null; travelMinutes: number | null; routed: boolean };

// Who may serve this customer location. Radius and travel limits only apply when the advisor set them; road figures
// are used when routing answered and straight-line distance is the fallback (marked as such by the caller).
export const geoEligibility = (
  advisor: GeoAdvisor,
  customer: Point,
  customerPostcode: string | null,
  measure: GeoMeasure,
  mode: LocationMode,
): { eligible: boolean; reason: string } => {
  const territoryConfigured = Boolean(advisor.serviceArea) || advisor.postcodeTerritory.length > 0;
  const inTerritory =
    (advisor.serviceArea ? inServiceArea(customer, advisor.serviceArea) : false) ||
    (customerPostcode && advisor.postcodeTerritory.length > 0 ? postcodeInTerritory(customerPostcode, advisor.postcodeTerritory) : false);
  if (mode === 'TERRITORY') return { eligible: inTerritory, reason: inTerritory ? 'inside territory' : territoryConfigured ? 'outside territory' : 'no territory set' };
  if (!advisor.base) return { eligible: false, reason: 'no base location' };
  const distance = measure.roadKm ?? measure.straightKm ?? Infinity;
  if (advisor.serviceRadiusKm && (measure.straightKm ?? Infinity) > advisor.serviceRadiusKm)
    return { eligible: false, reason: `outside ${advisor.serviceRadiusKm} km radius` };
  if (advisor.maxTravelMinutes && measure.travelMinutes !== null && measure.travelMinutes > advisor.maxTravelMinutes)
    return { eligible: false, reason: `more than ${advisor.maxTravelMinutes} minutes away` };
  if (mode === 'WITHIN_RADIUS' && !advisor.serviceRadiusKm && !territoryConfigured) return { eligible: false, reason: 'no service radius set' };
  if (territoryConfigured && !inTerritory && mode !== 'NEAREST' && mode !== 'FASTEST')
    return { eligible: false, reason: 'outside service area' };
  return { eligible: Number.isFinite(distance), reason: 'in range' };
};

export const rankByLocation = <TItem extends { measure: GeoMeasure; earliestStart?: number | null }>(items: TItem[], mode: LocationMode) => {
  const distance = (item: TItem) => item.measure.roadKm ?? item.measure.straightKm ?? Infinity;
  const minutes = (item: TItem) => item.measure.travelMinutes ?? Infinity;
  const earliest = (item: TItem) => item.earliestStart ?? Infinity;
  const sorted = [...items];
  if (mode === 'FASTEST') sorted.sort((a, b) => minutes(a) - minutes(b) || distance(a) - distance(b));
  else if (mode === 'FIRST_AVAILABLE_NEARBY') sorted.sort((a, b) => earliest(a) - earliest(b) || distance(a) - distance(b));
  else sorted.sort((a, b) => distance(a) - distance(b));
  return sorted;
};
