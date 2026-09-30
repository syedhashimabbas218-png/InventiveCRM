import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function writePublicPages({ publicDir, brand, repositoryRoot }) {
  const escape = (value) =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  const style = `:root{color-scheme:light dark;font-family:system-ui,sans-serif;line-height:1.65;background:#f8fafc;color:#172033}body{max-width:880px;margin:0 auto;padding:32px 24px 60px}header{display:flex;align-items:center;gap:20px;border-bottom:1px solid #ccd2dc;padding-bottom:24px}header img{width:88px;height:88px;background:white;border-radius:16px}h1{margin:0;font-size:clamp(24px,5vw,36px)}h2{font-size:21px;margin-top:36px}nav{display:flex;flex-wrap:wrap;gap:16px;margin:24px 0}a{color:#2656c9;text-underline-offset:3px}a:focus-visible{outline:3px solid #2656c9;outline-offset:4px}footer{border-top:1px solid #ccd2dc;margin-top:48px;padding-top:20px;font-size:14px}@media(prefers-color-scheme:dark){:root{background:#111827;color:#e5e7eb}a{color:#a5c4ff}}`;
  writeFileSync(
    join(publicDir, 'help.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>InventiveWeb — workspace guide</title><link rel="icon" href="icon.svg" type="image/svg+xml"><style>${style}</style></head><body>
<header><img src="logo.png" alt="InventiveWeb"><div><h1>Your workspace guide</h1><p>Customers, appointments, and business information in one place.</p></div></header>
<nav aria-label="Guide sections"><a href="#workspace">Workspace</a><a href="#forms">Forms</a><a href="#access">Access</a><a href="${escape(brand.supportUrl)}">Contact support</a></nav>
<main><section id="workspace"><h2>Work with your customer records</h2><p>Use the navigation menu to open people, companies, and the modules enabled for your business. Open a record to view its details. Use search, filters, and saved views to find the information you need.</p><p>Your workspace administrator controls which modules and actions are available to your team.</p></section>
<section id="forms"><h2>Configure your business forms</h2><p>Authorized team members can open the InventiveWeb form builder to choose a form's purpose and configure its fields. Save the draft before publishing. Publishing creates a fixed revision so later edits do not change an already published form.</p><p>For appointment forms, choose the published revision on the linked booking service. Contact support to enable customer booking once your calendar connection and booking setup are ready.</p></section>
<section id="access"><h2>Accounts and permissions</h2><p>Use your profile settings to update your details and authentication settings. Ask your workspace administrator for access if an action is unavailable. Customer records should only be shared with the people who need them.</p></section>
<section><h2>Need a hand?</h2><p><a href="${escape(brand.supportUrl)}">Contact InventiveWeb support</a> for setup, calendar connections, form configuration, or account access.</p></section></main>
<footer>${escape(brand.company)} · <a href="${escape(brand.termsUrl)}">Terms</a> · <a href="${escape(brand.privacyUrl)}">Privacy</a> · <a href="source.html">Source &amp; licences</a></footer></body></html>\n`,
  );
  // Render the original supplied artwork on a white backing. No raster editing or
  // vendor icon remains in the browser's light/dark favicon variants.
  const logo = readFileSync(
    join(repositoryRoot, 'branding/assets/logo.png'),
  ).toString('base64');
  writeFileSync(
    join(publicDir, 'icon.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><title>InventiveWeb</title><rect width="1024" height="1024" rx="160" fill="white"/><image width="1024" height="1024" href="data:image/png;base64,${logo}"/></svg>\n`,
  );
}
