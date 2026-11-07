// The public booking page: one self-contained document (no build step, no framework) that talks to /booking/api.
const LINE_SEPARATORS = new RegExp('[\\u2028\\u2029]', 'g');
const json = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(LINE_SEPARATORS, (character) => `\\u${character.charCodeAt(0).toString(16)}`);

const STYLE = `
:root{--accent:#3e63dd;--text:#333333;--muted:#666666;--line:#ebebeb;--line-strong:#d6d6d6;--bg:#fcfcfc;--card:#ffffff;--soft:#f1f1f1;--danger:#e5484d;--ok:#30a46c;--radius-sm:4px;--radius-md:8px;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
@media (prefers-color-scheme:dark){:root{--text:#ebebeb;--muted:#b3b3b3;--line:#222222;--line-strong:#484848;--bg:#171717;--card:#1b1b1b;--soft:#1d1d1d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-size:14px;line-height:1.45}
.wrap{max-width:980px;margin:32px auto;padding:0 16px}.embed .wrap{margin:0 auto;padding:8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius-md);display:grid;grid-template-columns:300px 1fr;overflow:hidden}
.side{padding:24px;border-right:1px solid var(--line)}.main{padding:24px;min-height:420px}
h1{font-size:20px;margin:6px 0 10px}h2{font-size:15px;margin:0 0 12px}.muted{color:var(--muted)}.meta{display:flex;gap:8px;align-items:center;margin:6px 0;color:var(--muted)}
.dot{width:10px;height:10px;border-radius:50%;background:var(--accent);display:inline-block}
button,.btn{font:inherit;font-weight:500;border:1px solid var(--line-strong);background:var(--card);color:var(--text);border-radius:var(--radius-sm);padding:7px 12px;cursor:pointer}button:hover:not(:disabled){background:var(--soft)}
button.primary,button.primary:hover:not(:disabled){background:var(--accent);border-color:var(--accent);color:#fff}button:disabled{opacity:.5;cursor:default}
button.link{border:0;background:none;color:var(--accent);padding:0}
input,select,textarea{font:inherit;width:100%;padding:8px 10px;border:1px solid var(--line-strong);border-radius:var(--radius-sm);background:var(--card);color:var(--text)}input:focus,select:focus,textarea:focus{outline:none;border-color:var(--accent)}
label{display:block;margin:12px 0 4px;font-weight:500}.row{display:flex;gap:16px}.row>*{flex:1}
.cal{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center}.cal .h{font-size:12px;color:var(--muted);padding:4px 0}
.cal button{padding:9px 0;border-radius:50%;aspect-ratio:1;border:0}.cal button.on{background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent);font-weight:600}
.cal button.sel{background:var(--accent);color:#fff}.cal button:disabled{background:none;color:var(--muted);opacity:.4}
.times{display:flex;flex-direction:column;gap:8px;max-height:360px;overflow:auto}.times button{border-color:var(--accent);color:var(--accent);font-weight:600}
.split{display:grid;grid-template-columns:1fr 200px;gap:24px}.nav{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.error{color:var(--danger);margin:10px 0}.ok{color:var(--ok)}.list{display:flex;flex-direction:column;gap:8px}
.adv{display:flex;justify-content:space-between;gap:12px;align-items:center;border:1px solid var(--line);border-radius:var(--radius-md);padding:10px 12px;text-align:left;width:100%}
.adv:hover{border-color:var(--accent)}#map{height:300px;border-radius:var(--radius-md);border:1px solid var(--line);margin:10px 0}
.suggest{border:1px solid var(--line);border-radius:var(--radius-sm);margin-top:4px;overflow:hidden}.suggest button{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid var(--line);border-radius:0}
.hp{position:absolute;left:-5000px}.foot{margin-top:12px;font-size:12px;color:var(--muted);text-align:center}
@media (max-width:760px){.card{grid-template-columns:1fr}.side{border-right:0;border-bottom:1px solid var(--line)}.split{grid-template-columns:1fr}}
`;

const SCRIPT = `
(function(){
var C=window.__BOOKING__,API=C.base+'/booking/api',root=document.getElementById('main'),side=document.getElementById('side');
var qs=new URLSearchParams(location.search),embed=qs.get('embed')==='1',parentOrigin=qs.get('parent')||'';
if(embed)document.body.classList.add('embed');
function newKey(){if(crypto.randomUUID)return crypto.randomUUID();var a=new Uint8Array(16);crypto.getRandomValues(a);return Array.prototype.map.call(a,function(b){return('0'+b.toString(16)).slice(-2)}).join('')}
var S={tz:Intl.DateTimeFormat().resolvedOptions().timeZone||'Europe/London',month:null,date:null,slots:[],location:null,advisor:null,page:null,key:newKey()};
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function post(body){return fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json().then(function(j){if(!r.ok){var e=new Error(j.message||'Error');e.code=j.error;throw e}return j})})}
function height(){if(embed&&window.parent!==window)window.parent.postMessage({type:'crm-booking:height',height:document.documentElement.scrollHeight},'*')}
new MutationObserver(height).observe(document.body,{subtree:true,childList:true,attributes:true});window.addEventListener('resize',height);
function fmt(iso,opts){return new Intl.DateTimeFormat('en-GB',Object.assign({timeZone:S.tz},opts)).format(new Date(iso))}
function dayKey(iso){return fmt(iso,{year:'numeric',month:'2-digit',day:'2-digit'}).split('/').reverse().join('-')}
function tzSelect(){var zones=(Intl.supportedValuesOf?Intl.supportedValuesOf('timeZone'):[S.tz,'Europe/London','UTC']);if(zones.indexOf(S.tz)<0)zones.unshift(S.tz);
 return '<label for="tz">Time zone</label><select id="tz">'+zones.map(function(z){return '<option'+(z===S.tz?' selected':'')+'>'+esc(z)+'</option>'}).join('')+'</select>'}
function bindTz(after){var el=document.getElementById('tz');if(el)el.onchange=function(){S.tz=el.value;after()}}
function fail(e){var box=document.getElementById('err');if(box)box.textContent=e.message;else root.insertAdjacentHTML('afterbegin','<p class="error" id="err">'+esc(e.message)+'</p>')}
var FORMAT={VIRTUAL:'Video call',PHONE:'Phone call',IN_PERSON_OFFICE:'In person',AT_CUSTOMER:'We come to you'};
function embedBlocked(domains){if(!embed||!domains)return false;var list=domains.split(',').map(function(d){return d.trim().toLowerCase()}).filter(Boolean);if(!list.length)return false;
 var origin=(location.ancestorOrigins&&location.ancestorOrigins.length?location.ancestorOrigins[0]:'')||(document.referrer?new URL(document.referrer).origin:'')||parentOrigin;
 try{var host=new URL(origin).hostname.toLowerCase();return !list.some(function(d){return host===d||host.slice(-d.length-1)==='.'+d})}catch(e){return true}}

function renderSide(p){var t=p.type;document.documentElement.style.setProperty('--accent',t.color||'#3e63dd');
 side.innerHTML=(t.team?'<div class="muted">'+esc(t.team)+'</div>':'')+'<h1>'+esc(t.name)+'</h1>'+
 '<div class="meta"><span class="dot"></span>'+t.durationMinutes+' minutes</div><div class="meta">'+esc(FORMAT[t.meetingFormat]||'')+(t.conferencing==='GOOGLE_MEET'?' (Google Meet)':t.conferencing==='MICROSOFT_TEAMS'?' (Microsoft Teams)':'')+'</div>'+
 (t.office&&t.office.name?'<div class="meta">'+esc(t.office.name)+(t.office.address?', '+esc(t.office.address):'')+'</div>':'')+
 (t.capacity>1?'<div class="meta">Group session, up to '+t.capacity+' people</div>':'')+
 (S.advisor?'<div class="meta">With '+esc(S.advisor.name)+'</div>':'')+(S.location?'<div class="meta">'+esc(S.location.label)+'</div>':'')+
 (t.description?'<p class="muted">'+esc(t.description).replace(/\\n/g,'<br>')+'</p>':'')}

// ---- location step (map selector)
var leaflet=null;
function loadLeaflet(cb){if(window.L)return cb();var css=document.createElement('link');css.rel='stylesheet';css.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';css.integrity='sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';css.crossOrigin='anonymous';document.head.appendChild(css);
 var s=document.createElement('script');s.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';s.integrity='sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';s.crossOrigin='anonymous';s.onload=cb;s.onerror=function(){cb()};document.head.appendChild(s)}
function locationStep(){var p=S.page;root.innerHTML='<h2>Where should we meet?</h2><p class="muted">Search for your address, or click the map to drop a pin.</p>'+
 '<input id="q" placeholder="Address or postcode" autocomplete="off"><div id="sug"></div>'+(p.map.tileUrl?'<div id="map"></div>':'')+'<div id="adv"></div>';
 var q=document.getElementById('q'),timer=null;
 q.oninput=function(){clearTimeout(timer);var v=q.value.trim();if(v.length<3){document.getElementById('sug').innerHTML='';return}
  timer=setTimeout(function(){post({action:'geocode',query:v}).then(function(r){document.getElementById('sug').innerHTML=r.results.length?'<div class="suggest">'+r.results.map(function(x,i){return '<button data-i="'+i+'">'+esc(x.label)+'</button>'}).join('')+'</div>':'<p class="muted">No matches.</p>';
   Array.prototype.forEach.call(document.querySelectorAll('#sug button'),function(b){b.onclick=function(){var x=r.results[+b.dataset.i];chooseLocation({lat:x.lat,lng:x.lng,label:x.label,postcode:x.postcode})}})}).catch(fail)},350)};
 if(p.map.tileUrl)loadLeaflet(function(){if(!window.L)return;var L=window.L;leaflet=L.map('map').setView([54.0,-2.5],6);L.tileLayer(p.map.tileUrl,{attribution:p.map.attribution,maxZoom:18}).addTo(leaflet);
  leaflet.on('click',function(e){chooseLocation({lat:e.latlng.lat,lng:e.latlng.lng})})});height()}
var layer=null;
function chooseLocation(loc){S.location=loc;document.getElementById('sug').innerHTML='';var box=document.getElementById('adv');box.innerHTML='<p class="muted">Finding advisors near you…</p>';
 post({action:'advisors',slug:C.slug,location:loc}).then(function(r){S.location={lat:r.customer.lat,lng:r.customer.lng,label:r.customer.label,postcode:loc.postcode};renderSide(S.page);
  if(leaflet&&window.L){var L=window.L;if(layer)layer.remove();layer=L.layerGroup().addTo(leaflet);L.circleMarker([r.customer.lat,r.customer.lng],{radius:8,color:'#e5484d'}).addTo(layer).bindPopup('You');
   r.advisors.forEach(function(a){if(a.point&&a.point.lat!=null)L.marker([a.point.lat,a.point.lng]).addTo(layer).bindPopup(esc(a.name)+(a.locationLabel?'<br>'+esc(a.locationLabel):''))});leaflet.setView([r.customer.lat,r.customer.lng],11)}
  if(!r.advisors.length){box.innerHTML='<p class="error">Sorry, nobody covers that location yet. Try another address.</p>';return}
  var choose=S.page.type.locationMode==='CUSTOMER_CHOICE';
  box.innerHTML='<h2 style="margin-top:16px">'+(choose?'Choose an advisor':'Advisors who cover this area')+'</h2>'+(r.routing==='STRAIGHT_LINE'?'<p class="muted">Travel times are estimates: road routing is unavailable right now.</p>':'')+
   '<div class="list">'+r.advisors.map(function(a,i){return '<button class="adv" data-i="'+i+'"'+(!choose&&i>0?' disabled':'')+'><span><strong>'+esc(a.name)+'</strong><br><span class="muted">'+esc(a.locationLabel||'')+'</span></span><span class="muted">'+
    (a.distanceKm!=null?a.distanceKm+' km':'')+(a.travelMinutes!=null?' · '+a.travelMinutes+' min'+(a.routed?'':' (est.)'):'')+(a.earliest?'<br>from '+esc(fmt(a.earliest,{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})):'<br>no times soon')+'</span></button>'}).join('')+'</div>'+
   (choose?'':'<p><button class="primary" id="go">See available times</button></p>');
  Array.prototype.forEach.call(box.querySelectorAll('.adv'),function(b){b.onclick=function(){if(!choose)return;S.advisor=r.advisors[+b.dataset.i];renderSide(S.page);calendarStep()}});
  var go=document.getElementById('go');if(go)go.onclick=calendarStep;height()}).catch(fail)}

function advisorStep(){root.innerHTML='<h2>Choose who you would like to meet</h2><div class="list">'+S.page.advisors.map(function(a,i){return '<button class="adv" data-i="'+i+'"><span><strong>'+esc(a.name)+'</strong><br><span class="muted">'+esc(a.bio||a.locationLabel||'')+'</span></span></button>'}).join('')+'</div>';
 Array.prototype.forEach.call(root.querySelectorAll('.adv'),function(b){b.onclick=function(){S.advisor=S.page.advisors[+b.dataset.i];renderSide(S.page);calendarStep()}})}

// ---- calendar step
function monthStart(d){return new Date(d.getFullYear(),d.getMonth(),1)}
function calendarStep(mode){S.mode=mode||S.mode||'book';if(!S.month)S.month=monthStart(new Date());loadMonth()}
function loadMonth(){root.innerHTML='<p class="muted">Loading available times…</p>';var from=new Date(Math.max(S.month.getTime(),Date.now()-864e5));var days=Math.ceil((new Date(S.month.getFullYear(),S.month.getMonth()+1,1)-from)/864e5)+1;
 var req=S.mode==='reschedule'?{action:'rescheduleSlots',token:C.token,from:from.toISOString(),days:days}:{action:'slots',slug:C.slug,from:from.toISOString(),days:days,advisorId:S.advisor&&S.advisor.id,location:S.location};
 post(req).then(function(r){S.slots=r.slots;drawCalendar()}).catch(function(e){root.innerHTML='';fail(e)})}
function drawCalendar(){var byDay={};S.slots.forEach(function(s){var k=dayKey(s.start);(byDay[k]=byDay[k]||[]).push(s)});
 var m=S.month,first=(new Date(m.getFullYear(),m.getMonth(),1).getDay()+6)%7,count=new Date(m.getFullYear(),m.getMonth()+1,0).getDate();
 var cells=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(function(d){return '<div class="h">'+d+'</div>'}).join('');for(var i=0;i<first;i++)cells+='<div></div>';
 for(var d=1;d<=count;d++){var key=m.getFullYear()+'-'+String(m.getMonth()+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');var has=byDay[key];
  cells+='<button data-k="'+key+'" class="'+(has?'on':'')+(S.date===key?' sel':'')+'"'+(has?'':' disabled')+' aria-label="'+key+(has?', available':'')+'">'+d+'</button>'}
 var label=m.toLocaleDateString('en-GB',{month:'long',year:'numeric'});
 var times=S.date&&byDay[S.date]?byDay[S.date].map(function(s){return '<button data-s="'+s.start+'">'+fmt(s.start,{hour:'2-digit',minute:'2-digit'})+(s.seatsLeft?' · '+s.seatsLeft+' left':'')+'</button>'}).join(''):'<p class="muted">Pick a day.</p>';
 root.innerHTML='<h2>'+(S.mode==='reschedule'?'Pick a new time':'Select a date and time')+'</h2><div class="split"><div><div class="nav"><button id="prev" aria-label="Previous month">‹</button><strong>'+label+'</strong><button id="next" aria-label="Next month">›</button></div><div class="cal">'+cells+'</div>'+tzSelect()+
  (Object.keys(byDay).length?'':'<p class="muted">No times this month.</p>')+'</div><div class="times">'+times+'</div></div>';
 document.getElementById('prev').disabled=m<=monthStart(new Date());document.getElementById('prev').onclick=function(){S.month=new Date(m.getFullYear(),m.getMonth()-1,1);S.date=null;loadMonth()};
 document.getElementById('next').onclick=function(){S.month=new Date(m.getFullYear(),m.getMonth()+1,1);S.date=null;loadMonth()};
 Array.prototype.forEach.call(root.querySelectorAll('.cal button[data-k]'),function(b){b.onclick=function(){S.date=b.dataset.k;drawCalendar()}});
 Array.prototype.forEach.call(root.querySelectorAll('.times button'),function(b){b.onclick=function(){S.mode==='reschedule'?confirmReschedule(b.dataset.s):formStep(b.dataset.s)}});
 bindTz(drawCalendar);height()}

// ---- details step
function formStep(start){var t=S.page.type,pre=S.page.presets||{answers:{}};
 var qs=(t.intakeQuestions||[]).map(function(q){var id='q_'+esc(q.id),req=q.required?' required':'',v=esc((pre.answers||{})[q.id]||'');
  var field=q.type==='textarea'?'<textarea id="'+id+'" rows="3"'+req+'>'+v+'</textarea>':q.type==='select'?'<select id="'+id+'"'+req+'><option value=""></option>'+(q.options||[]).map(function(o){return '<option'+(o===v?' selected':'')+'>'+esc(o)+'</option>'}).join('')+'</select>':'<input id="'+id+'" value="'+v+'"'+req+'>';
  return '<label for="'+id+'">'+esc(q.label)+(q.required?' *':'')+'</label>'+field}).join('');
 root.innerHTML='<h2>Your details</h2><p class="muted">'+esc(fmt(start,{weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}))+' ('+esc(S.tz)+') <button class="link" id="back">change</button></p>'+
  '<form id="f"><div class="row"><div><label for="n">Name *</label><input id="n" required value="'+esc(pre.name||'')+'" autocomplete="name"></div><div><label for="e">Email *</label><input id="e" type="email" required value="'+esc(pre.email||'')+'" autocomplete="email"></div></div>'+
  '<label for="p">Phone'+(t.meetingFormat==='PHONE'?' *':'')+'</label><input id="p" type="tel" autocomplete="tel"'+(t.meetingFormat==='PHONE'?' required':'')+'>'+qs+
  '<div class="hp" aria-hidden="true"><label for="w">Website</label><input id="w" tabindex="-1" autocomplete="off"></div><p id="err" class="error"></p><button class="primary" id="sub">Book</button></form>';
 document.getElementById('back').onclick=function(){drawCalendar()};
 document.getElementById('f').onsubmit=function(ev){ev.preventDefault();var btn=document.getElementById('sub');btn.disabled=true;btn.textContent='Booking…';var answers={};(t.intakeQuestions||[]).forEach(function(q){answers[q.id]=document.getElementById('q_'+q.id).value});
  post({action:'book',slug:C.slug,ticket:C.ticket,start:start,advisorId:S.advisor&&S.advisor.id,location:S.location,answers:answers,website:document.getElementById('w').value,idempotencyKey:S.key,embed:embed,parentOrigin:parentOrigin,
   customer:{name:document.getElementById('n').value,email:document.getElementById('e').value,phone:document.getElementById('p').value,timeZone:S.tz}})
  .then(function(r){done(r)}).catch(function(e){btn.disabled=false;btn.textContent='Book';fail(e);if(e.code==='SLOT_TAKEN'){S.key=newKey();setTimeout(function(){S.date=null;loadMonth()},1800)}})};height()}
function done(r){root.innerHTML='<h2 class="ok">'+(r.status==='PENDING'?'Request sent':'You are booked')+'</h2><p>'+esc(fmt(r.start,{weekday:'long',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}))+' ('+esc(S.tz)+')'+(r.advisorName?' with '+esc(r.advisorName):'')+'</p>'+
 (r.confirmationMessage?'<p>'+esc(r.confirmationMessage)+'</p>':'')+'<p class="muted">A confirmation email with a calendar invitation is on its way.</p><p><a class="btn" href="'+esc(r.manageUrl)+'" target="_top">Reschedule or cancel</a></p>';
 if(embed&&window.parent!==window)window.parent.postMessage({type:'crm-booking:booked'},'*');height()}

// ---- manage page
function manage(){post({action:'manage',token:C.token}).then(function(a){S.tz=a.timeZone||S.tz;S.page={type:{name:a.typeName,durationMinutes:Math.round((new Date(a.end)-new Date(a.start))/6e4),meetingFormat:'',color:'#3e63dd',description:''},map:{}};S.manage=a;
 side.innerHTML='<h1>'+esc(a.typeName)+'</h1>'+(a.advisorName?'<div class="meta">With '+esc(a.advisorName)+'</div>':'')+(a.location?'<div class="meta">'+esc(a.location)+'</div>':'')+(a.meetingUrl?'<div class="meta"><a href="'+esc(a.meetingUrl)+'">Join link</a></div>':'');
 var when=esc(fmt(a.start,{weekday:'long',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}))+' ('+esc(S.tz)+')';
 root.innerHTML='<h2>'+(a.status==='CANCELLED'?'This appointment is cancelled':'Your appointment')+'</h2><p>'+when+'</p>'+
  (a.canReschedule?'<p><button class="primary" id="rs">Reschedule</button></p>':a.status!=='CANCELLED'?'<p class="muted">Online rescheduling closes '+a.rescheduleCutoffHours+' hours before the start.</p>':'')+
  (a.canCancel?'<label for="why">Reason (optional)</label><textarea id="why" rows="2"></textarea><p><button id="cx">Cancel appointment</button></p>':a.status!=='CANCELLED'?'<p class="muted">Online cancellation closes '+a.cancellationCutoffHours+' hours before the start.</p>':'')+'<p id="err" class="error"></p>';
 var rs=document.getElementById('rs');if(rs)rs.onclick=function(){calendarStep('reschedule')};
 var cx=document.getElementById('cx');if(cx)cx.onclick=function(){if(!confirm('Cancel this appointment?'))return;cx.disabled=true;post({action:'cancel',token:C.token,reason:document.getElementById('why').value}).then(manage).catch(fail)};height()}).catch(function(e){root.innerHTML='';fail(e)})}
function confirmReschedule(start){root.innerHTML='<h2>Move your appointment to '+esc(fmt(start,{weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}))+'?</h2><p id="err" class="error"></p><button class="primary" id="ok">Confirm new time</button> <button id="no">Back</button>';
 document.getElementById('no').onclick=drawCalendar;document.getElementById('ok').onclick=function(){this.disabled=true;post({action:'reschedule',token:C.token,start:start}).then(function(){S.mode='book';manage()}).catch(fail)};height()}

// ---- start
if(C.mode==='manage'){manage();return}
post({action:'page',slug:C.slug}).then(function(p){S.page=p;C.ticket=p.ticket;
 if(p.kind==='advisor'){side.innerHTML='<h1>'+esc(p.advisor.name)+'</h1><p class="muted">'+esc(p.advisor.bio||'')+'</p>';
  root.innerHTML='<h2>What would you like to book?</h2><div class="list">'+p.types.map(function(t){return '<a class="adv btn" href="'+C.base+'/book/'+encodeURIComponent(t.slug)+location.search+'"><span><strong>'+esc(t.name)+'</strong><br><span class="muted">'+esc(t.description||'')+'</span></span><span class="muted">'+t.durationMinutes+' min</span></a>'}).join('')+'</div>';height();return}
 if(embedBlocked(p.type.allowedEmbedDomains)){root.innerHTML='<p class="error">This booking page is not available on this website.</p>';return}
 renderSide(p);if(p.type.needsLocation)locationStep();else if(p.advisors&&p.advisors.length)advisorStep();else calendarStep()}).catch(function(e){root.innerHTML='';fail(e)});
})();
`;

export const bookingPage = ({ base, slug, token, mode }: { base: string; slug: string; token: string; mode: 'book' | 'manage' }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Book an appointment</title><style>${STYLE}</style></head>
<body><div class="wrap"><div class="card"><aside class="side" id="side"></aside><main class="main" id="main"><p class="muted">Loading…</p></main></div>
<p class="foot">Scheduling by InventiveCRM</p></div>
<script>window.__BOOKING__=${json({ base, slug, token, mode })};</script><script>${SCRIPT}</script></body></html>`;

// Inline, popup and floating-button embeds. Messages from the frame are only trusted when they come from our origin.
export const embedScript = (base: string) => `(function(){
var BASE=${json(base)},ORIGIN=new URL(BASE).origin,current=document.currentScript;
function src(slug,extra){return BASE+'/book/'+encodeURIComponent(slug)+'?embed=1&parent='+encodeURIComponent(location.origin)+(extra||'')}
function frame(slug,minHeight){var f=document.createElement('iframe');f.src=src(slug);f.title='Booking';f.loading='lazy';f.style.cssText='width:100%;border:0;min-height:'+(minHeight||620)+'px;display:block';f.setAttribute('allow','geolocation');return f}
window.addEventListener('message',function(e){if(e.origin!==ORIGIN||!e.data||typeof e.data.type!=='string')return;
 Array.prototype.forEach.call(document.querySelectorAll('iframe'),function(f){if(f.contentWindow!==e.source)return;
  if(e.data.type==='crm-booking:height'&&typeof e.data.height==='number')f.style.height=Math.min(Math.max(e.data.height,400),2400)+'px';
  if(e.data.type==='crm-booking:booked')f.dispatchEvent(new CustomEvent('crm-booking:booked',{bubbles:true}))})});
function inline(){Array.prototype.forEach.call(document.querySelectorAll('[data-crm-booking]'),function(el){if(el.dataset.crmBookingReady)return;el.dataset.crmBookingReady='1';el.appendChild(frame(el.getAttribute('data-crm-booking'),el.getAttribute('data-min-height')))})}
function popup(slug){var shade=document.createElement('div');shade.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:16px';
 var box=document.createElement('div');box.style.cssText='background:#fff;border-radius:8px;width:100%;max-width:1000px;max-height:92vh;overflow:auto;position:relative';
 var close=document.createElement('button');close.textContent='×';close.setAttribute('aria-label','Close');close.style.cssText='position:absolute;top:6px;right:10px;font-size:24px;border:0;background:none;cursor:pointer;z-index:1';
 close.onclick=function(){shade.remove()};shade.onclick=function(e){if(e.target===shade)shade.remove()};document.addEventListener('keydown',function k(e){if(e.key==='Escape'){shade.remove();document.removeEventListener('keydown',k)}});
 box.appendChild(close);box.appendChild(frame(slug,560));shade.appendChild(box);document.body.appendChild(shade)}
function popups(){Array.prototype.forEach.call(document.querySelectorAll('[data-crm-booking-popup]'),function(el){if(el.dataset.crmBookingReady)return;el.dataset.crmBookingReady='1';el.addEventListener('click',function(e){e.preventDefault();popup(el.getAttribute('data-crm-booking-popup'))})})}
function floating(){var slug=current&&current.getAttribute('data-floating');if(!slug||document.getElementById('crm-booking-float'))return;var b=document.createElement('button');b.id='crm-booking-float';
 b.textContent=current.getAttribute('data-label')||'Book an appointment';b.style.cssText='position:fixed;right:20px;bottom:20px;z-index:2147483645;border:0;border-radius:999px;padding:12px 18px;font:600 14px sans-serif;color:#fff;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.2);background:'+(current.getAttribute('data-color')||'#3e63dd');
 b.onclick=function(){popup(slug)};document.body.appendChild(b)}
function init(){inline();popups();floating()}
window.CrmBooking={open:popup,refresh:init};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();`;
