import { getConnection } from 'twenty-sdk/logic-function';

import { keyFingerprint, sealText } from 'src/lib/crypto';
import { chooseNumber, createSubscription, describeError, disableOurSubscriptions, getAccount } from 'src/lib/inventivechat';
import { functionsBaseUrl, loadSettings, saveSettings, webhookSecretContext, workingConnections } from 'src/lib/settings';

export const KEY_PATTERN = /^wa_[A-Za-z0-9_-]{10,200}$/;

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

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

export const eventsUrl = async () => `${await functionsBaseUrl()}/whatsapp/events`;

// Checks the key, replaces this workspace's webhook (an old one is disabled first: InventiveChat allows ten active)
// and keeps the account details. Returns what Twenty stores, or null so an invalid key connects nothing.
export const connectKey = async (key: string) => {
  if (!KEY_PATTERN.test(key)) return null;
  const account = await getAccount(key);
  const settings = await loadSettings();
  const context = { key, tenantId: account.tenantId };
  const url = await eventsUrl();
  const number = chooseNumber(account.numbers, settings?.whatsappAccountId ?? null);
  const problems: string[] = [];
  let webhook: Record<string, string> = {};
  try {
    await disableOurSubscriptions(context, url);
    const subscription = await createSubscription(context, url);
    webhook = { subscriptionId: subscription.id, webhookUrl: url, webhookSecret: sealText(subscription.secret, webhookSecretContext({ tenantId: account.tenantId, subscriptionId: subscription.id })) };
  } catch (error) {
    problems.push(`InventiveChat did not accept this workspace's webhook address (${url}): ${describeError(error)} New messages will not reach the CRM until WhatsApp is connected again.`);
  }
  if (!number) problems.push('This InventiveChat account has several active WhatsApp numbers, or none. Put the id of the one to use (wac_...) in "WhatsApp number id".');
  await saveSettings({
    tenantId: account.tenantId,
    displayName: number?.verifiedName || account.name || null,
    keyFingerprint: keyFingerprint(key),
    ...(number ? { whatsappAccountId: number.id, phoneNumber: number.phone || null } : {}),
    ...webhook,
    webhookProblem: problems.length ? problems.join(' ') : null,
  });
  const label = [number?.verifiedName || account.name || 'InventiveChat', number?.phone].filter(Boolean).join(', ');
  return { externalAccountId: `inventivechat-${keyFingerprint(key)}`, handle: `${label} (key ending ${key.slice(-4)})`.slice(0, 200), accessToken: key };
};

// Stops InventiveChat sending this workspace's events once its last connection goes. Another connection that is
// still working keeps the webhook.
export const disconnectKey = async (connectionId: string) => {
  if ((await workingConnections()).some((connection) => connection.id !== connectionId)) return { disabled: 0 };
  const connection = await getConnection(connectionId).catch(() => null);
  const settings = await loadSettings();
  if (!connection?.accessToken || !settings?.tenantId) return { disabled: 0 };
  const disabled = await disableOurSubscriptions({ key: connection.accessToken, tenantId: settings.tenantId }, settings.webhookUrl || (await eventsUrl()));
  await saveSettings({ subscriptionId: null, webhookSecret: null, webhookProblem: 'WhatsApp is disconnected. An admin can connect InventiveChat again under Settings, Accounts.' });
  return { disabled };
};

export const connectPage = (callbackUrl: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>Connect WhatsApp</title><style>
:root{--accent:#3e63dd;--text:#333;--muted:#666;--line:#ebebeb;--line-strong:#d6d6d6;--bg:#fcfcfc;--card:#fff;font-family:Inter,-apple-system,"Segoe UI",Roboto,sans-serif}
@media (prefers-color-scheme:dark){:root{--text:#ebebeb;--muted:#b3b3b3;--line:#222;--line-strong:#484848;--bg:#171717;--card:#1b1b1b}}
body{margin:0;background:var(--bg);color:var(--text);font-size:14px;line-height:1.5}main{max-width:560px;margin:48px auto;padding:0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:28px}h1{font-size:18px;margin:0 0 12px}ol{padding-left:20px;color:var(--muted)}
input{font:inherit;width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--line-strong);border-radius:4px;background:var(--card);color:var(--text)}
input:focus{outline:none;border-color:var(--accent)}button{font:inherit;font-weight:500;margin-top:14px;padding:8px 16px;border-radius:4px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer}
button:disabled{opacity:.6;cursor:default}.muted{color:var(--muted);font-size:12px;margin-top:12px}</style></head><body><main><div class="card">
<h1>Connect WhatsApp</h1><ol><li>Sign in to InventiveChat and open Settings, API keys.</li><li>Create a system key for InventiveCRM.</li><li>Copy the key (it starts with wa_) and paste it below.</li></ol>
<form id="connect" method="post" action="${escapeHtml(callbackUrl)}" autocomplete="off"><label for="key">API key</label>
<input id="key" name="secretKey" type="password" required minlength="13" maxlength="203" placeholder="wa_..." spellcheck="false">
<button type="submit" id="go">Connect</button></form><p id="result" role="status"></p>
<p class="muted">The key is checked with InventiveChat and stored encrypted. The CRM uses it to send WhatsApp messages and templates, and registers itself to receive new messages. You can disconnect it at any time under Settings, Accounts.</p>
</div></main><script>
// Twenty's callback only answers {"success":true}, so the page posts in the background and then asks this app
// whether the key is now connected.
(function(){var form=document.getElementById('connect'),go=document.getElementById('go'),out=document.getElementById('result');
form.addEventListener('submit',function(event){event.preventDefault();go.disabled=true;out.textContent='Checking the key…';
var key=document.getElementById('key').value.trim(),fingerprint='';
crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)).then(function(hash){fingerprint=Array.prototype.map.call(new Uint8Array(hash),function(b){return('0'+b.toString(16)).slice(-2)}).join('').slice(0,16)})
.then(function(){return fetch(form.action,{method:'POST',mode:'no-cors',body:new URLSearchParams({secretKey:key})}).catch(function(){})}).then(function(){
var tries=0;(function poll(){fetch('connect-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fingerprint:fingerprint})}).then(function(r){return r.json()}).then(function(s){
if(s.connected){form.style.display='none';out.textContent='Connected. You can close this page and return to the CRM.'}
else if(++tries<8)setTimeout(poll,1000);else{go.disabled=false;out.textContent='The key was not accepted. Check that you copied the whole key and that it is a system key.'}}).catch(function(){go.disabled=false;out.textContent='Something went wrong. Please try again.'})})()})})})();
</script></body></html>`;
