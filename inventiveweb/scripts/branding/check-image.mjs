import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// Run inside the built runtime image, without network or the database entrypoint.
const server = '/app/packages/twenty-server';
const front = join(server, 'dist/front');
assert(
  existsSync(join(server, 'dist/main.js')),
  'Compiled server entrypoint missing',
);
const html = readFileSync(join(front, 'index.html'), 'utf8');
assert(
  html.includes('<title>InventiveWeb</title>'),
  'Built page title must be branded',
);
assert(
  html.includes('/inventiveweb/icon.svg'),
  'Built favicon must be branded',
);
assert(
  !html.includes('content="Twenty"'),
  'Upstream metadata leaked into the built page',
);
const manifest = JSON.parse(readFileSync(join(front, 'manifest.json'), 'utf8'));
assert.equal(manifest.name, 'InventiveWeb');
assert.equal(manifest.short_name, 'InventiveWeb');
const archive = join(front, 'inventiveweb/source.tar.gz');
assert(
  statSync(archive).size > 100_000,
  'Corresponding-source archive is missing or empty',
);
const fromArchive = (path) =>
  execFileSync('tar', ['-xOzf', archive, `./${path}`], {
    maxBuffer: 20 * 1024 * 1024,
  });
const report = JSON.parse(fromArchive('INVENTIVEWEB-BUILD.json').toString());
assert.equal(
  report.development,
  false,
  'Runtime image must use production branding validation',
);
assert.equal(
  report.upstream.commit,
  '87339fe7489c3a3c0ea72aad593a2a538357291c',
);
for (const asset of report.assets) {
  const path = asset.path.replace('packages/twenty-front/public/', '');
  const served = readFileSync(join(front, path));
  assert.equal(
    createHash('sha256').update(served).digest('hex'),
    asset.sha256,
    `Built asset drift: ${path}`,
  );
  assert.deepEqual(
    served,
    fromArchive(asset.path),
    `Source offer does not match served asset: ${path}`,
  );
}
assert.deepEqual(
  readFileSync(join(front, 'inventiveweb/LICENSE.txt')),
  fromArchive('LICENSE'),
);
assert(
  fromArchive(
    'inventiveweb-build-tools/apps/inventiveweb/src/application-config.ts',
  ).length > 0,
);
assert(
  fromArchive('inventiveweb-build-tools/scripts/branding/apply.mjs').length > 0,
);
const entrypoint = readFileSync('/app/entrypoint.sh', 'utf8');
assert(entrypoint.includes('set -eu'), 'Migration failure must stop startup');
assert(existsSync(join(front, 'assets')), 'Compiled frontend assets missing');
console.log(
  'PASS: compiled frontend/server, InventiveWeb metadata, five asset hashes, source offer and guarded entrypoint. No database or external provider was contacted.',
);
