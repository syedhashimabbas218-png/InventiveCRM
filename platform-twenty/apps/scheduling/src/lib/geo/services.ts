import { type Point } from 'src/engine/geo';

// Geocoding and routing sit behind these two functions so another engine (Photon, Valhalla, a hosted service) can
// replace Nominatim or OSRM without touching the scheduling code.
export type GeocodeResult = { label: string; lat: number; lng: number; postcode: string | null };

const USER_AGENT = 'InventiveCRM-Scheduling/1.0';

type NominatimPlace = { display_name: string; lat: string; lon: string; address?: { postcode?: string } };

const toResult = (place: NominatimPlace): GeocodeResult => ({
  label: place.display_name,
  lat: Number(place.lat),
  lng: Number(place.lon),
  postcode: place.address?.postcode ?? null,
});

const geocoderUrl = () => {
  const base = process.env.GEOCODER_URL;
  if (!base) throw new Error('Address search is not configured (GEOCODER_URL).');
  return base.replace(/\/$/, '');
};

export const geocode = async (query: string): Promise<GeocodeResult[]> => {
  const params = new URLSearchParams({ q: query.slice(0, 200), format: 'jsonv2', addressdetails: '1', limit: '5' });
  if (process.env.GEOCODER_COUNTRY_CODES) params.set('countrycodes', process.env.GEOCODER_COUNTRY_CODES);
  const response = await fetch(`${geocoderUrl()}/search?${params}`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Address search failed (${response.status})`);
  return ((await response.json()) as NominatimPlace[]).map(toResult);
};

export const reverseGeocode = async (point: Point): Promise<GeocodeResult | null> => {
  const params = new URLSearchParams({ lat: String(point.lat), lon: String(point.lng), format: 'jsonv2', addressdetails: '1' });
  const response = await fetch(`${geocoderUrl()}/reverse?${params}`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) return null;
  const place = (await response.json()) as NominatimPlace & { error?: string };
  return place.error ? null : toResult(place);
};

export type TravelMatrix = { minutes: (number | null)[][]; km: (number | null)[][] };

// One OSRM table call for every origin and destination pair.
export const travelMatrix = async (origins: Point[], destinations: Point[]): Promise<TravelMatrix> => {
  const base = process.env.ROUTER_URL;
  if (!base) throw new Error('Routing is not configured (ROUTER_URL).');
  const points = [...origins, ...destinations];
  const coordinates = points.map((point) => `${point.lng.toFixed(6)},${point.lat.toFixed(6)}`).join(';');
  const sources = origins.map((_, index) => index).join(';');
  const targets = destinations.map((_, index) => origins.length + index).join(';');
  const response = await fetch(`${base.replace(/\/$/, '')}/table/v1/driving/${coordinates}?sources=${sources}&destinations=${targets}&annotations=duration,distance`, {
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await response.json()) as { code: string; message?: string; durations?: (number | null)[][]; distances?: (number | null)[][] };
  if (!response.ok || data.code !== 'Ok') throw new Error(`Routing failed: ${data.message ?? data.code}`);
  return {
    minutes: (data.durations ?? []).map((row) => row.map((seconds) => (seconds === null ? null : Math.ceil(seconds / 60)))),
    km: (data.distances ?? []).map((row) => row.map((metres) => (metres === null ? null : Math.round(metres / 100) / 10))),
  };
};
