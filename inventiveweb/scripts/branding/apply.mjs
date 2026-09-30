import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const upstream = JSON.parse(readFileSync(join(repositoryRoot, 'branding/upstream.json'), 'utf8'));
const root = resolve(process.argv[2] ?? '.local/twenty-upstream');
const development = process.argv.includes('--development');
const brand = JSON.parse(readFileSync(join(repositoryRoot, 'branding/config.json'), 'utf8'));
const envKeys = { appUrl: 'PUBLIC_APP_URL', websiteUrl: 'INVENTIVEWEB_WEBSITE_URL', supportUrl: 'INVENTIVEWEB_SUPPORT_URL', termsUrl: 'INVENTIVEWEB_TERMS_URL', privacyUrl: 'INVENTIVEWEB_PRIVACY_URL', dpaUrl: 'INVENTIVEWEB_DPA_URL', sourceUrl: 'INVENTIVEWEB_SOURCE_URL' };
for (const [key, variable] of Object.entries(envKeys)) {
  brand[key] = process.env[variable] || brand[key];
  if (key === 'sourceUrl' && brand[key].startsWith('/')) brand[key] = new URL(brand[key], brand.appUrl).href;
  const url = new URL(brand[key]);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || (!development && url.hostname.endsWith('.invalid'))) {
    throw new Error(`Set ${variable} to a public HTTPS URL without credentials, query or fragment.`);
  }
  brand[key] = url.href;
}
if (new URL(brand.appUrl).pathname !== '/') throw new Error('PUBLIC_APP_URL must be an origin without a path.');
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (sha !== upstream.commit) throw new Error(`Wrong upstream revision. Expected ${upstream.commit}; found ${sha}.`);
if (existsSync(join(root, 'INVENTIVEWEB-BUILD.json'))) throw new Error('This source is already branded. Use a clean checkout.');

const changes = new Map();
const hash = text => createHash('sha256').update(text).digest('hex');
function change(path, transform) {
  const original = readFileSync(join(root, path), 'utf8');
  const committed = execFileSync('git', ['show', `HEAD:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (original !== committed) throw new Error(`Refusing to overwrite modified upstream file: ${path}`);
  const updated = transform(original);
  if (updated === original) throw new Error(`Branding patch did not change ${path}`);
  changes.set(path, { original, updated });
}
function replaceOnce(text, before, after) {
  if (text.split(before).length !== 2) throw new Error(`Expected exactly one branding anchor: ${before.slice(0, 90)}`);
  return text.replace(before, after);
}
const literal = value => JSON.stringify(value);
const escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const front = 'packages/twenty-front';
const emails = 'packages/twenty-emails/src';

change(`${front}/index.html`, text => text
  .replaceAll('content="Twenty"', `content="${escapeHtml(brand.name)}"`)
  .replace('<title>Twenty</title>', `<title>${escapeHtml(brand.name)}</title>`)
  .replaceAll('A modern open-source CRM', escapeHtml(brand.description))
  .replaceAll('https://raw.githubusercontent.com/twentyhq/twenty/main/docs/static/img/social-card.png', `${brand.appUrl.replace(/\/$/, '')}/inventiveweb/logo.png`)
  .replace('/images/icons/android/android-launchericon-48-48.png', '/inventiveweb/logo.png')
  .replace('/images/icons/ios/192.png', '/inventiveweb/logo.png'));
change(`${front}/public/manifest.json`, text => {
  const manifest = JSON.parse(text);
  manifest.name = brand.name; manifest.short_name = brand.name;
  manifest.icons = [{ src: '/inventiveweb/logo.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' }];
  return JSON.stringify(manifest, null, 2) + '\n';
});
change(`${front}/src/modules/auth/components/Logo.tsx`, text => replaceOnce(text,
  '/images/icons/android/android-launchericon-192-192.png', '/inventiveweb/logo.png'));
change(`${front}/src/modules/ui/navigation/navigation-drawer/constants/DefaultWorkspaceLogo.ts`, text => replaceOnce(text,
  'https://twentyhq.github.io/placeholder-images/workspaces/twenty-logo.png', '/inventiveweb/logo.png'));
change(`${front}/src/modules/onboarding/components/import-contacts/OnboardingImportPreviewSyncBadge.tsx`, text => replaceOnce(text,
  '/images/integrations/twenty-logo.svg', '/inventiveweb/logo.png'));
for (const path of [
  'modules/onboarding/components/OnboardingHeader.tsx',
  'modules/onboarding/components/OnboardingPulsingLogo.tsx',
  'modules/applications/components/AppConnectionHeader.tsx',
]) change(`${front}/src/${path}`, text => replaceOnce(text,
  '/images/integrations/twenty-logo.svg', '/inventiveweb/logo.png'));
for (const [path, before, after] of [
  ['pages/auth/SignInUp.tsx', 'Welcome to Twenty', 'Welcome to InventiveWeb'],
  ['pages/not-found/NotFound.tsx', 'Page Not Found | Twenty', 'Page Not Found | InventiveWeb'],
  ['utils/title-utils.ts', "return 'Twenty';", "return 'InventiveWeb';"],
]) change(`${front}/src/${path}`, text => replaceOnce(text, before, after));
change(`${front}/src/modules/auth/utils/getTwentyWebsiteUrl.ts`, () => `// Modified by InventiveWeb: operator-owned legal destinations.\nconst destinations = { terms: ${literal(brand.termsUrl)}, 'privacy-policy': ${literal(brand.privacyUrl)} };\nexport const getTwentyWebsiteUrl = (_locale: string, page: keyof typeof destinations): string => destinations[page];\n`);
change(`${front}/src/modules/auth/sign-in-up/components/FooterNote.tsx`, text => {
  text = replaceOnce(text, 'By using Twenty, you agree to the', 'By using InventiveWeb, you agree to the');
  text = replaceOnce(text, 'href="https://twenty.com/legal/dpa"', `href={${literal(brand.dpaUrl)}}`);
  text = replaceOnce(text, '</StyledCopyContainer>', `<div><a href="/inventiveweb/source.html" target="_blank" rel="noopener noreferrer">Source &amp; licences</a></div>\n      </StyledCopyContainer>`);
  return replaceOnce(text, '</StyledLinksContainer>', `<StyledSeparator>•</StyledSeparator><a href="/inventiveweb/source.html" target="_blank" rel="noopener noreferrer">Source &amp; licences</a>\n    </StyledLinksContainer>`);
});
change(`${emails}/components/Logo.tsx`, text => replaceOnce(replaceOnce(text,
  'https://app.twenty.com/images/icons/windows11/Square150x150Logo.scale-100.png', `${brand.appUrl.replace(/\/$/, '')}/inventiveweb/logo.png`), 'alt="Twenty logo"', 'alt="InventiveWeb logo"'));
change(`${emails}/components/BaseHead.tsx`, text => replaceOnce(text, '<title>Twenty email</title>', '<title>InventiveWeb email</title>'));
change(`${emails}/components/Footer.tsx`, () => `// Modified by InventiveWeb; original component remains in upstream Git history.\nimport { type I18n } from '@lingui/core';\nimport { Container } from 'react-email';\nimport { Link } from 'src/components/Link';\nimport { ShadowText } from 'src/components/ShadowText';\nexport const Footer = ({ i18n }: { i18n: I18n }) => <Container style={{ marginTop: '12px' }}><ShadowText><Link href={${literal(brand.websiteUrl)}} value={i18n._('Website')} />{' · '}<Link href={${literal(brand.supportUrl)}} value={i18n._('Support')} />{' · '}<Link href={${literal(brand.appUrl.replace(/\/$/, '') + '/inventiveweb/source.html')}} value={i18n._('Source & licences')} /></ShadowText><ShadowText>{${literal(brand.company)}}</ShadowText></Container>;\n`);
change(`${emails}/components/WhatIsTwenty.tsx`, text => replaceOnce(text, 'What is Twenty?', 'What is InventiveWeb?'));
for (const [path, before, after] of [
  ['emails/send-invite-link.email.tsx', 'Join your team on Twenty', 'Join your team on InventiveWeb'],
  ['emails/password-update-notify.email.tsx', 'Connect to Twenty', 'Connect to InventiveWeb'],
]) change(`${emails}/${path}`, text => replaceOnce(text, before, after));
change(`${emails}/emails/send-email-verification-link.email.tsx`, text => text.replaceAll('your Twenty account', 'your InventiveWeb account').replaceAll('account on Twenty!', 'account on InventiveWeb!'));
change('packages/twenty-docker/twenty/entrypoint.sh', () => readFileSync(join(repositoryRoot, 'infrastructure/coolify/entrypoint.sh'), 'utf8'));

// Preflight every transformation before writing anything. Do not rewrite code identifiers,
// Enterprise markers, licence text, migrations or authorization logic.
for (const [path, { updated }] of changes) writeFileSync(join(root, path), updated);
const publicDir = join(root, front, 'public/inventiveweb');
mkdirSync(publicDir, { recursive: true });
copyFileSync(join(repositoryRoot, 'branding/assets/logo.png'), join(publicDir, 'logo.png'));
copyFileSync(join(root, 'LICENSE'), join(publicDir, 'LICENSE.txt'));
writeFileSync(join(publicDir, 'source.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>InventiveWeb — source and licences</title><body style="font:16px/1.6 system-ui;max-width:760px;margin:60px auto;padding:24px"><h1>Source and licences</h1><p>InventiveWeb is an independently operated, modified version of Twenty. It is not affiliated with or endorsed by Twenty.com PBC.</p><p><a href="${escapeHtml(brand.sourceUrl)}">Download or obtain the complete corresponding source for this deployed version</a></p><p><a href="LICENSE.txt">Upstream licence and application exception</a></p><p>Upstream revision: <code>${upstream.commit}</code>. Branding modifications by ${escapeHtml(brand.company)}. Copyright and licence notices remain with the source. This software is provided without warranty as described in its licence.</p></body></html>\n`);
writeFileSync(join(root, 'INVENTIVEWEB-BUILD.json'), JSON.stringify({ upstream, branding: brand, development, files: [...changes].map(([path, { original, updated }]) => ({ path, originalSha256: hash(original), modifiedSha256: hash(updated) })) }, null, 2) + '\n');
console.log(`Applied ${changes.size} reviewed branding changes to Twenty ${upstream.tag}.`);
console.log(development ? 'DEVELOPMENT ONLY: placeholder URLs were allowed.' : 'Public branding URLs validated.');
