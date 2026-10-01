import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = resolve(process.argv[2] ?? '.local/twenty-upstream');
const report = JSON.parse(readFileSync(join(root, 'INVENTIVEWEB-BUILD.json'), 'utf8'));
for (const item of report.files) {
  const actual = createHash('sha256').update(readFileSync(join(root, item.path))).digest('hex');
  assert.equal(actual, item.modifiedSha256, `Modified file drift: ${item.path}`);
}
assert.equal(report.assets?.length, 5, 'Every generated public asset must be recorded');
for (const item of report.assets) {
  assert.equal(createHash('sha256').update(readFileSync(join(root, item.path))).digest('hex'), item.sha256, `Public asset drift: ${item.path}`);
}
const publicRoot = join(root, 'packages/twenty-front/public');
const manifest = JSON.parse(readFileSync(join(publicRoot, 'manifest.json'), 'utf8'));
assert.equal(manifest.name, 'InventiveWeb');
for (const icon of manifest.icons) assert(existsSync(join(publicRoot, icon.src)));
const html = readFileSync(join(root, 'packages/twenty-front/index.html'), 'utf8');
assert(html.includes('<title>InventiveWeb</title>'));
assert(html.includes('type="image/svg+xml"'));
assert(html.includes('/inventiveweb/icon.svg'));
assert(!html.includes('content="Twenty"'));
const source = readFileSync(join(publicRoot, 'inventiveweb/source.html'), 'utf8');
assert(source.includes(report.upstream.commit));
assert(source.includes('complete corresponding source'));
assert.equal(readFileSync(join(publicRoot, 'inventiveweb/LICENSE.txt'), 'utf8'), readFileSync(join(root, 'LICENSE'), 'utf8'));
const emailLogo = readFileSync(join(root, 'packages/twenty-emails/src/components/Logo.tsx'), 'utf8');
assert(!emailLogo.includes('app.twenty.com'));
assert(emailLogo.includes('InventiveWeb logo'));
const help = readFileSync(join(publicRoot, 'inventiveweb/help.html'), 'utf8');
assert(help.includes(report.branding.supportUrl));
assert(!/twenty\.com|twentyhq|twentycrm/.test(help));
console.log(`Verified ${report.files.length} patched source hashes, branding assets, source offer and preserved licence.`);
