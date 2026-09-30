import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(
  join(packageRoot, 'apps/inventiveweb/package.json'),
);
const ts = require('typescript');
const root = resolve(process.argv[2]);
const report = JSON.parse(
  readFileSync(join(root, 'INVENTIVEWEB-BUILD.json'), 'utf8'),
);
const diagnostics = [];
let syntaxCount = 0;
for (const { path } of report.files.filter((item) =>
  /\.tsx?$/.test(item.path),
)) {
  syntaxCount++;
  const result = ts.transpileModule(readFileSync(join(root, path), 'utf8'), {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      experimentalDecorators: true,
    },
  });
  for (const diagnostic of result.diagnostics ?? []) {
    if (diagnostic.category === ts.DiagnosticCategory.Error)
      diagnostics.push(
        `${path}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
      );
  }
}
assert.deepEqual(diagnostics, [], 'Patched TypeScript must parse');

// Explicit upstream identity exceptions, never a blanket allowlist by substring.
// These are technical compatibility/provenance or operator-only/licensed surfaces.
const permittedFiles = new Map([
  [
    'packages/twenty-front/src/pages/settings/enterprise/SettingsEnterprise.tsx',
    'Actual Enterprise licence instructions',
  ],
  [
    'packages/twenty-front/src/modules/settings/admin-panel/components/SettingsAdminVersionDisplay.tsx',
    'Operator upstream version lookup',
  ],
  [
    'packages/twenty-front/src/modules/settings/legal/components/SettingsDpaAgreementsTable.tsx',
    'Unused upstream PDF archive component; original document name must remain truthful',
  ],
  [
    'packages/twenty-server/src/engine/core-modules/twenty-config/config-variables.ts',
    'Operator configuration descriptions and licensed vendor endpoint',
  ],
  [
    'packages/twenty-server/src/engine/core-modules/admin-panel/services/admin-panel-version.service.ts',
    'Operator upstream version lookup',
  ],
  [
    'packages/twenty-server/src/engine/core-modules/open-api/utils/computeWebhooks.utils.ts',
    'Signed webhook header compatibility',
  ],
  [
    'packages/twenty-server/src/engine/metadata-modules/webhook/jobs/call-webhook.job.ts',
    'Signed webhook header compatibility',
  ],
  [
    'packages/twenty-server/src/engine/core-modules/application/application-marketplace/constants/marketplace-vetted-applications.constant.ts',
    'Real third-party npm package provenance',
  ],
  [
    'packages/twenty-server/src/engine/core-modules/application/application-marketplace/marketplace.service.ts',
    'Vendor request user-agent compatibility',
  ],
  [
    'packages/twenty-server/src/engine/core-modules/application/application-registration/application-registration-claim.service.ts',
    'Vendor request user-agent compatibility',
  ],
  [
    'packages/twenty-server/src/engine/core-modules/application/application-registration/application-registration.service.ts',
    'Operator log naming the real upstream CLI',
  ],
  [
    'packages/twenty-server/src/engine/workspace-manager/twenty-standard-application/constants/twenty-cli-application-registration.constant.ts',
    'Real SDK CLI identity; not a renamed published package',
  ],
  [
    'packages/twenty-server/src/engine/workspace-manager/workspace-migration/services/workspace-migration-flat-entity-maps.service.ts',
    'Internal migration diagnostic',
  ],
  [
    'packages/twenty-server/src/engine/core-modules/user-session/utils/apply-credentialed-cors.util.ts',
    'Operator CORS diagnostic',
  ],
  [
    'packages/twenty-server/src/engine/workspace-manager/standard-objects-prefill-data/utils/prefill-people.util.ts',
    'Optional example people avatar URLs; not product branding',
  ],
]);
const skip =
  /(?:^|\/)(?:__[^/]+__|locales|generated[^/]*|testing|dev-seeder|migrations|commands|dpa)(?:\/|$)|\.(?:spec|test|stories|d)\.tsx?$/;
const brandPattern =
  /\bTwenty\b|twenty\.com|twentyhq|twentycrm|twenty-help-search/;
const leaks = [];
let scannedCount = 0;
function visitFiles(folder) {
  for (const entry of readdirSync(join(root, folder), {
    withFileTypes: true,
  })) {
    const path = `${folder}/${entry.name}`;
    if (skip.test(path)) continue;
    if (entry.isDirectory()) {
      visitFiles(path);
      continue;
    }
    if (!/\.tsx?$/.test(path) || permittedFiles.has(path)) continue;
    const text = readFileSync(join(root, path), 'utf8');
    scannedCount++;
    if (!brandPattern.test(text)) continue;
    const source = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node) {
      if (
        (ts.isStringLiteralLike(node) ||
          ts.isTemplateHead(node) ||
          ts.isTemplateMiddle(node) ||
          ts.isTemplateTail(node) ||
          ts.isJsxText(node)) &&
        brandPattern.test(node.text)
      ) {
        leaks.push(
          `${path}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}: ${node.text.slice(0, 100)}`,
        );
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
for (const pkg of ['twenty-front', 'twenty-emails', 'twenty-server'])
  visitFiles(`packages/${pkg}/src`);
assert.deepEqual(
  leaks,
  [],
  'Unexpected upstream brand in a runtime string; review rather than widening exceptions',
);

const read = (path) => readFileSync(join(root, path), 'utf8');
assert(
  !read(
    'packages/twenty-front/src/pages/settings/legal/SettingsLegalDpa.tsx',
  ).includes('useQuery'),
);
assert(
  !read(
    'packages/twenty-front/src/pages/settings/legal/SettingsLegalDpaNew.tsx',
  ).includes('generateSignedDpa'),
);
assert(
  !read(
    'packages/twenty-front/src/modules/settings/components/SettingsCustomizeVideoModal.tsx',
  ).includes('vimeo.com'),
);
assert(
  !read(
    'packages/twenty-front/src/modules/settings/mcp-and-apis/constants/McpSetup.ts',
  ).includes('chatgpt.com/apps'),
);
assert(
  !read(
    'packages/twenty-front/src/modules/onboarding/components/import-contacts/OnboardingTrustBadges.tsx',
  ).includes('SOC2'),
);
assert(
  read(
    'packages/twenty-server/src/engine/core-modules/two-factor-authentication/two-factor-authentication.service.ts',
  ).includes('`InventiveWeb${workspaceDisplayName'),
);
for (const path of [
  'packages/twenty-front/src/locales/en.po',
  'packages/twenty-front/src/locales/fr-FR.po',
]) {
  assert(read(path).includes('msgid "Welcome to InventiveWeb"'));
  assert(!read(path).includes('msgid "Welcome to Twenty"'));
}
for (const name of [
  'help.html',
  'source.html',
  'LICENSE.txt',
  'logo.png',
  'icon.svg',
]) {
  assert(
    existsSync(join(root, 'packages/twenty-front/public/inventiveweb', name)),
  );
}
console.log(
  `PASS: ${syntaxCount} patched TS/TSX files parse; ${scannedCount} runtime source files audited; no unexpected vendor branding. Full framework typecheck/browser acceptance remain separate gates.`,
);
