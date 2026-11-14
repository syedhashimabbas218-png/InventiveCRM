import { escapeHtml } from 'src/lib/design';

const STYLE = `:root{--accent:#3e63dd;--text:#333;--muted:#666;--line:#ebebeb;--line-strong:#d6d6d6;--bg:#fcfcfc;--card:#fff;font-family:Inter,-apple-system,"Segoe UI",Roboto,sans-serif}
@media (prefers-color-scheme:dark){:root{--text:#ebebeb;--muted:#b3b3b3;--line:#222;--line-strong:#484848;--bg:#171717;--card:#1b1b1b}}
body{margin:0;background:var(--bg);color:var(--text);font-size:14px;line-height:1.5}main{max-width:520px;margin:48px auto;padding:0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:28px}h1{font-size:18px;margin:0 0 12px}ol{padding-left:20px;color:var(--muted)}
input{font:inherit;width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--line-strong);border-radius:4px;background:var(--card);color:var(--text)}
input:focus{outline:none;border-color:var(--accent)}button{font:inherit;font-weight:500;margin-top:14px;padding:8px 16px;border-radius:4px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer}
button:disabled{opacity:.6;cursor:default}.muted{color:var(--muted);font-size:12px;margin-top:12px}`;

const shell = (title: string, body: string, accent?: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title><style>${STYLE}${accent && /^#[0-9a-f]{6}$/i.test(accent) ? `:root{--accent:${accent}}` : ''}</style></head><body><main><div class="card">${body}</div></main></body></html>`;

// GET never unsubscribes: link scanners open every link in an email, so the person confirms with a button.
export const unsubscribePage = (info: { businessName: string; alreadyDone: boolean; primaryColor: string } | null, action: string) => {
  if (!info) return shell('Link not valid', '<h1>This link is not valid</h1><p>It may be incomplete. Use the unsubscribe link in the latest email you received.</p>');
  const name = escapeHtml(info.businessName);
  if (info.alreadyDone) return shell('Unsubscribed', `<h1>You are unsubscribed</h1><p>You will not get marketing emails from ${name} any more.</p>`, info.primaryColor);
  return shell(
    'Unsubscribe',
    `<h1>Unsubscribe from ${name}</h1><p>You will stop getting marketing messages from ${name}. Emails about things you have booked or bought still reach you.</p>
<form method="post" action="${escapeHtml(action)}" id="form"><button type="submit" id="go">Unsubscribe</button></form><p id="result" role="status"></p>
<script>(function(){var form=document.getElementById('form'),go=document.getElementById('go'),out=document.getElementById('result');form.addEventListener('submit',function(event){event.preventDefault();go.disabled=true;
fetch(form.action,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'List-Unsubscribe=One-Click'}).then(function(r){if(!r.ok)throw new Error();form.style.display='none';out.textContent='Done. You are unsubscribed.'}).catch(function(){go.disabled=false;out.textContent='Something went wrong. Please try again.'})})})();</script>`,
    info.primaryColor,
  );
};

export const connectPage = (callbackUrl: string) =>
  shell(
    'Connect Resend',
    `<h1>Connect Resend</h1><ol><li>Sign in to resend.com and add and verify your sending domain under Domains.</li><li>Open API Keys and choose Create API key. Pick <strong>Full access</strong>: Campaign Studio needs it to read your domains and set up open, click and bounce tracking.</li><li>Copy the key (it starts with re_) and paste it below.</li></ol>
<form id="connect" method="post" action="${escapeHtml(callbackUrl)}" autocomplete="off"><label for="key">API key</label>
<input id="key" name="secretKey" type="password" required minlength="20" maxlength="200" placeholder="re_..." spellcheck="false"><button type="submit" id="go">Connect</button></form><p id="result" role="status"></p>
<p class="muted">The key is checked with Resend and stored encrypted. It is only used to send your campaigns and read their delivery results. You can disconnect it at any time under Settings, Accounts.</p>
<script>
// Twenty's callback always answers {"success":true}, so the page posts in the background and then asks whether
// the key is now connected.
(function(){var form=document.getElementById('connect'),go=document.getElementById('go'),out=document.getElementById('result');
form.addEventListener('submit',function(event){event.preventDefault();go.disabled=true;out.textContent='Checking the key…';
var key=document.getElementById('key').value.trim(),fingerprint='';
crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)).then(function(hash){fingerprint=Array.prototype.map.call(new Uint8Array(hash),function(b){return('0'+b.toString(16)).slice(-2)}).join('').slice(0,16)})
.then(function(){return fetch(form.action,{method:'POST',mode:'no-cors',body:new URLSearchParams({secretKey:key})}).catch(function(){})}).then(function(){
var tries=0;(function poll(){fetch('connect-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fingerprint:fingerprint})}).then(function(r){return r.json()}).then(function(s){
if(s.connected){form.style.display='none';out.textContent='Connected. You can close this page and return to the CRM.'}
else if(++tries<6)setTimeout(poll,1000);else{go.disabled=false;out.textContent='The key was not accepted. Check that you copied the whole key and that it has Full access.'}}).catch(function(){go.disabled=false;out.textContent='Something went wrong. Please try again.'})})()})})})();
</script>`,
  );

export const isTrustedCallback = (callbackUrl: string, serverUrl: string | undefined) => {
  try {
    const callback = new URL(callbackUrl);
    const server = new URL(serverUrl ?? '');
    return callback.origin === server.origin && callback.pathname === '/auth/apps/custom/callback' && Boolean(callback.searchParams.get('state'));
  } catch {
    return false;
  }
};
