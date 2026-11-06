import { parseServiceArea } from 'src/engine/geo';
import { gql, nodes } from 'src/lib/api';
import { ADVISOR_FIELDS, type AdvisorRecord, advisorPoint } from 'src/lib/records';
import { checkMapTicket } from 'src/lib/tokens';

type Office = { id: string; name: string; streetAddress: string; postcode: string; latitude: number | null; longitude: number | null };

const html = (body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Advisor map</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>html,body{margin:0;height:100%;font-family:Inter,system-ui,sans-serif;font-size:13px;color:#333}#map{position:absolute;inset:0}
.legend{position:absolute;z-index:500;top:10px;right:10px;background:#fff;border-radius:8px;padding:8px 10px;box-shadow:0 1px 4px #0003;max-width:240px}
.legend div{display:flex;align-items:center;gap:6px;margin:2px 0}.dot{width:10px;height:10px;border-radius:5px;display:inline-block}
.empty{padding:24px;color:#666}</style></head><body>${body}</body></html>`;

export const staffMapPage = async (ticket: string) => {
  if (!checkMapTicket(ticket)) return { status: 403, body: html('<p class="empty">This map link has expired. Open the advisor map again from Scheduling.</p>') };
  const data = await gql<{ advisors: { edges: { node: AdvisorRecord }[] }; offices: { edges: { node: Office }[] } }>(
    `{ advisors(filter: { isActive: { eq: true } }, first: 500) { edges { node { ${ADVISOR_FIELDS} } } } offices(first: 200) { edges { node { id name streetAddress postcode latitude longitude } } } }`,
  );
  const advisors = nodes(data.advisors).map((advisor) => ({
    name: advisor.name,
    point: advisorPoint(advisor),
    label: advisor.publicLocationLabel || advisor.office?.name || '',
    radiusKm: advisor.travelsToCustomers ? advisor.serviceRadiusKm : null,
    area: parseServiceArea(advisor.serviceArea),
    territory: advisor.postcodeTerritory || '',
    modes: [advisor.inPerson && 'office', advisor.remote && 'remote', advisor.travelsToCustomers && 'travels'].filter(Boolean),
  }));
  const offices = nodes(data.offices).filter((office) => office.latitude !== null && office.longitude !== null);
  const tileUrl = process.env.MAP_TILE_URL || '';
  if (!tileUrl) return { status: 200, body: html('<p class="empty">Set MAP_TILE_URL in the app settings to show the map.</p>') };
  // JSON is embedded in a script tag, so "<" is escaped to keep advisor names from closing it.
  const payload = JSON.stringify({ advisors, offices, tileUrl, attribution: process.env.MAP_ATTRIBUTION || '© OpenStreetMap contributors' }).replace(/</g, '\\u003c');
  return {
    status: 200,
    body: html(`<div id="map"></div><div class="legend" id="legend"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var D=${payload};var COLORS=['#3e63dd','#30a46c','#6e56cf','#f76b15','#e5484d','#00a2c7','#d6409f','#46a758'];
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
var map=L.map('map');L.tileLayer(D.tileUrl,{attribution:D.attribution,maxZoom:18}).addTo(map);var bounds=[];var legend=[];
D.offices.forEach(function(o){var p=[o.latitude,o.longitude];bounds.push(p);L.circleMarker(p,{radius:9,color:'#333',fillColor:'#fff',fillOpacity:1,weight:3}).addTo(map).bindPopup('<strong>'+esc(o.name)+'</strong><br>'+esc(o.streetAddress)+' '+esc(o.postcode))});
D.advisors.forEach(function(a,i){var color=COLORS[i%COLORS.length];legend.push('<div><span class="dot" style="background:'+color+'"></span>'+esc(a.name)+'</div>');
 if(a.area){var g=L.geoJSON(a.area,{style:{color:color,weight:2,fillOpacity:0.08}}).addTo(map);var b=g.getBounds();bounds.push(b.getNorthWest(),b.getSouthEast())}
 if(!a.point)return;var p=[a.point.lat,a.point.lng];bounds.push(p);
 if(a.radiusKm)L.circle(p,{radius:a.radiusKm*1000,color:color,weight:1,fillOpacity:0.05,dashArray:'4 4'}).addTo(map);
 L.circleMarker(p,{radius:7,color:color,fillColor:color,fillOpacity:0.9}).addTo(map).bindPopup('<strong>'+esc(a.name)+'</strong>'+(a.label?'<br>'+esc(a.label):'')+'<br>'+esc(a.modes.join(', '))+(a.radiusKm?'<br>Travels up to '+a.radiusKm+' km':'')+(a.territory?'<br>Postcodes: '+esc(a.territory):''))});
document.getElementById('legend').innerHTML='<strong>'+D.advisors.length+' advisors, '+D.offices.length+' offices</strong>'+legend.join('');
if(bounds.length)map.fitBounds(bounds,{padding:[30,30],maxZoom:13});else map.setView([54,-2.5],6);
</script>`),
  };
};
