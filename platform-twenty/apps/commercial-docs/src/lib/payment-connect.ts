import { type PaymentProvider } from 'src/constants/enums';
import { PAYMENT_CONNECTION_NAMES } from 'src/lib/payments';

export const providerFromConnectionName = (name: string): Exclude<PaymentProvider, 'NONE'> | null =>
  (Object.entries(PAYMENT_CONNECTION_NAMES).find(([, connectionName]) => connectionName === name)?.[0] as Exclude<PaymentProvider, 'NONE'> | undefined) ?? null;

// The connect page only ever posts the key to Twenty's own custom-connection callback, never anywhere else.
export const isTrustedCallback = (callbackUrl: string, serverUrl: string | undefined) => {
  try {
    const callback = new URL(callbackUrl);
    const server = new URL(serverUrl ?? '');
    return callback.origin === server.origin && callback.pathname === '/auth/apps/custom/callback' && Boolean(callback.searchParams.get('state'));
  } catch {
    return false;
  }
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

const GUIDES: Record<Exclude<PaymentProvider, 'NONE'>, { title: string; steps: string[]; placeholder: string }> = {
  STRIPE: {
    title: 'Connect Stripe',
    steps: [
      'In the Stripe Dashboard open Developers, API keys, and choose Create restricted key.',
      'Give it Write access to Payment Links, Prices and Products, and Read access to Checkout Sessions. Leave everything else at None.',
      'Copy the key (it starts with rk_live_) and paste it below. Use an rk_test_ key to try it out first.',
    ],
    placeholder: 'rk_live_...',
  },
  REVOLUT: {
    title: 'Connect Revolut Business',
    steps: [
      'In Revolut Business open the Merchant API settings (APIs, Merchant API).',
      'Copy the Production secret key. Use the Sandbox key to try it out first.',
      'Paste it below.',
    ],
    placeholder: 'sk_...',
  },
};

export const connectPage = (provider: Exclude<PaymentProvider, 'NONE'>, callbackUrl: string) => {
  const guide = GUIDES[provider];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${escapeHtml(guide.title)}</title><style>
:root{--accent:#3e63dd;--text:#333;--muted:#666;--line:#ebebeb;--line-strong:#d6d6d6;--bg:#fcfcfc;--card:#fff;font-family:Inter,-apple-system,"Segoe UI",Roboto,sans-serif}
@media (prefers-color-scheme:dark){:root{--text:#ebebeb;--muted:#b3b3b3;--line:#222;--line-strong:#484848;--bg:#171717;--card:#1b1b1b}}
body{margin:0;background:var(--bg);color:var(--text);font-size:14px;line-height:1.5}main{max-width:560px;margin:48px auto;padding:0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:28px}h1{font-size:18px;margin:0 0 12px}ol{padding-left:20px;color:var(--muted)}
input{font:inherit;width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--line-strong);border-radius:4px;background:var(--card);color:var(--text)}
input:focus{outline:none;border-color:var(--accent)}button{font:inherit;font-weight:500;margin-top:14px;padding:8px 16px;border-radius:4px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer}
.muted{color:var(--muted);font-size:12px;margin-top:12px}</style></head><body><main><div class="card">
<h1>${escapeHtml(guide.title)}</h1><ol>${guide.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
<form id="connect" method="post" action="${escapeHtml(callbackUrl)}" autocomplete="off"><label for="key">Secret key</label>
<input id="key" name="secretKey" type="password" required minlength="20" maxlength="300" placeholder="${escapeHtml(guide.placeholder)}" spellcheck="false">
<button type="submit" id="go">Connect</button></form><p id="result" role="status"></p>
<p class="muted">The key is checked with ${provider === 'STRIPE' ? 'Stripe' : 'Revolut'} and stored encrypted. It is only used to create pay-now links for your invoices and to see when they are paid. You can disconnect it at any time under Settings, Accounts.</p>
</div></main><script>
// Twenty's callback only answers {"success":true}, so the page posts in the background and then asks this app
// whether the account is now connected.
(function(){var form=document.getElementById('connect'),go=document.getElementById('go'),out=document.getElementById('result');
form.addEventListener('submit',function(event){event.preventDefault();go.disabled=true;out.textContent='Checking the key…';
var key=document.getElementById('key').value.trim(),fingerprint='';
crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)).then(function(hash){fingerprint=Array.prototype.map.call(new Uint8Array(hash),function(b){return('0'+b.toString(16)).slice(-2)}).join('').slice(0,16)})
.then(function(){return fetch(form.action,{method:'POST',mode:'no-cors',body:new URLSearchParams({secretKey:key})}).catch(function(){})}).then(function(){
var tries=0;(function poll(){fetch('connect-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:${JSON.stringify(provider)},fingerprint:fingerprint})}).then(function(r){return r.json()}).then(function(s){
if(s.connected){form.style.display='none';out.textContent='Connected. You can close this page and return to the CRM.'}
else if(++tries<6)setTimeout(poll,1000);else{go.disabled=false;out.textContent='The key was not accepted. Check that you copied the whole key and that it has the permissions listed above.'}}).catch(function(){go.disabled=false;out.textContent='Something went wrong. Please try again.'})})()})})})();
</script></body></html>`;
};
