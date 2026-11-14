// Public survey page. Same tokens as the booking pages (Twenty's greys, indigo accent, 4px/8px radii, dark mode).
const STYLE = `
:root{--accent:#3e63dd;--text:#333333;--muted:#666666;--line:#ebebeb;--line-strong:#d6d6d6;--bg:#fcfcfc;--card:#ffffff;--soft:#f1f1f1;--danger:#e5484d;--ok:#30a46c;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
@media (prefers-color-scheme:dark){:root{--text:#ebebeb;--muted:#b3b3b3;--line:#222222;--line-strong:#484848;--bg:#171717;--card:#1b1b1b;--soft:#1d1d1d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-size:15px;line-height:1.5}
main{max-width:560px;margin:40px auto;padding:0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:28px}
h1{font-size:19px;margin:0 0 6px}p{margin:0 0 14px}.muted{color:var(--muted)}
.scale{display:grid;grid-template-columns:repeat(11,1fr);gap:6px;margin:14px 0 4px}
.scale button{font:inherit;font-weight:600;padding:10px 0;border:1px solid var(--line-strong);border-radius:4px;background:var(--card);color:var(--text);cursor:pointer}
.scale button:hover{background:var(--soft)}.scale button[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:#fff}
.ends{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:16px}
textarea{font:inherit;width:100%;min-height:96px;padding:8px 10px;border:1px solid var(--line-strong);border-radius:4px;background:var(--card);color:var(--text);resize:vertical}
textarea:focus{outline:none;border-color:var(--accent)}
.primary{font:inherit;font-weight:500;margin-top:14px;padding:8px 16px;border-radius:4px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer}
.primary:disabled{opacity:.5;cursor:default}.error{color:var(--danger);margin-top:10px}
.review{display:inline-block;margin-top:6px;padding:8px 16px;border-radius:4px;background:var(--accent);color:#fff;text-decoration:none;font-weight:500}
.foot{margin-top:14px;text-align:center;font-size:12px;color:var(--muted)}
@media (max-width:520px){.scale{grid-template-columns:repeat(6,1fr)}}`;

const SCRIPT = `
var C=window.__SURVEY__,S={score:null};
function el(id){return document.getElementById(id)}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return'&#'+c.charCodeAt(0)+';'})}
function post(body){return fetch(C.api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw j;return j})})}
function pick(n){S.score=n;Array.prototype.forEach.call(document.querySelectorAll('.scale button'),function(b){b.setAttribute('aria-pressed',String(Number(b.dataset.score)===n))});el('send').disabled=false}
function render(info){
 var who=info.businessName?esc(info.businessName):'us';
 if(!info.open){el('app').innerHTML='<h1>Thank you</h1><p class="muted">This survey is closed.</p>';return}
 var buttons='';for(var i=0;i<=10;i++)buttons+='<button type="button" data-score="'+i+'" aria-pressed="false" aria-label="Score '+i+'">'+i+'</button>';
 el('app').innerHTML='<h1>'+(info.firstName?'Hello '+esc(info.firstName)+', ':'')+'how did we do?</h1><p class="muted">'+esc(info.question)+'</p>'+
  '<div class="scale" role="group" aria-label="Score from 0 to 10">'+buttons+'</div><div class="ends"><span>Not at all likely</span><span>Extremely likely</span></div>'+
  '<label for="comment" class="muted">Anything you would like to tell '+who+'? (optional)</label><textarea id="comment" maxlength="2000"></textarea>'+
  '<button class="primary" id="send" disabled>Send</button><div class="error" id="err" role="alert"></div>';
 Array.prototype.forEach.call(document.querySelectorAll('.scale button'),function(b){b.onclick=function(){pick(Number(b.dataset.score))}});
 el('comment').value=info.comment||'';
 var pre=Number(new URLSearchParams(location.search).get('score'));
 if(info.score!==null&&info.score!==undefined)pick(info.score);else if(location.search.indexOf('score=')>=0&&pre>=0&&pre<=10)pick(pre);
 el('send').onclick=function(){var b=el('send');b.disabled=true;el('err').textContent='';
  post({action:'answer',token:C.token,score:S.score,comment:el('comment').value}).then(function(r){
   el('app').innerHTML='<h1>Thank you</h1><p class="muted">Your feedback has reached '+who+'.</p>'+(r.reviewUrl?'<p>Would you share your experience on Google? It helps others find '+who+'.</p><a class="review" target="_blank" rel="noopener" href="'+esc(r.reviewUrl)+'">Leave a Google review</a>':'');
  }).catch(function(e){b.disabled=false;el('err').textContent=(e&&e.message)||'Something went wrong. Please try again.'})}
}
post({action:'info',token:C.token}).then(render).catch(function(e){el('app').innerHTML='<h1>Sorry</h1><p class="muted">'+esc((e&&e.message)||'This link is not valid.')+'</p>'});`;

export const surveyPage = ({ base, token }: { base: string; token: string }) => {
  const config = JSON.stringify({ api: `${base}/feedback/api`, token }).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>Your feedback</title><style>${STYLE}</style></head>
<body><main><div class="card" id="app"><p class="muted">Loading…</p></div><div class="foot">Feedback by InventiveCRM</div></main>
<script>window.__SURVEY__=${config};</script><script>${SCRIPT}</script></body></html>`;
};
