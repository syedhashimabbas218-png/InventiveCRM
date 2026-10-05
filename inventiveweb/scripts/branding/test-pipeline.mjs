import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const scripts = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2]);
const execute = (file, args = [], env = process.env) =>
  spawnSync(process.execPath, [join(scripts, file), root, ...args], {
    encoding: 'utf8',
    env,
  });
let result = execute('apply.mjs', ['--development']);
assert.notEqual(result.status, 0);
assert.match(result.stderr, /already branded/);
let count = 1;
for (const name of [
  'PUBLIC_APP_URL',
  'INVENTIVEWEB_SUPPORT_URL',
  'INVENTIVEWEB_TERMS_URL',
  'INVENTIVEWEB_PRIVACY_URL',
  'INVENTIVEWEB_DPA_URL',
]) {
  result = execute('apply.mjs', [], {
    ...process.env,
    PUBLIC_APP_URL: 'https://workspace.example.com',
    INVENTIVEWEB_SUPPORT_URL: 'https://support.example.com',
    INVENTIVEWEB_TERMS_URL: 'https://legal.example.com/terms',
    INVENTIVEWEB_PRIVACY_URL: 'https://legal.example.com/privacy',
    INVENTIVEWEB_DPA_URL: 'https://legal.example.com/dpa',
    [name]: 'https://placeholder.invalid',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(`Set ${name}`));
  count++;
}
// Real negative controls: source and generated-asset drift must break verification.
for (const path of [
  'packages/twenty-front/src/utils/title-utils.ts',
  'packages/twenty-front/public/inventiveweb/help.html',
]) {
  const file = join(root, path);
  const original = readFileSync(file);
  try {
    writeFileSync(
      file,
      Buffer.concat([original, Buffer.from('\n<!-- drift -->\n')]),
    );
    result = execute('verify.mjs');
    assert.notEqual(result.status, 0, `Drift was accepted: ${path}`);
    assert.match(result.stderr, /drift/i);
  } finally {
    writeFileSync(file, original);
  }
  count++;
}
const file = join(root, 'packages/twenty-front/src/utils/title-utils.ts');
const original = readFileSync(file, 'utf8');
try {
  writeFileSync(
    file,
    original.replace("return 'InventiveWeb';", "return 'Twenty';"),
  );
  result = execute('check-source.mjs');
  assert.notEqual(
    result.status,
    0,
    'A reintroduced customer brand leak was accepted',
  );
  assert.match(result.stderr, /Unexpected upstream brand/);
} finally {
  writeFileSync(file, original);
}
count++;
result = execute('verify.mjs');
assert.equal(result.status, 0, result.stderr);
console.log(
  `PASS: ${count} branding guard checks (duplicate application, production URL gates, source/asset drift and brand-leak regression).`,
);
