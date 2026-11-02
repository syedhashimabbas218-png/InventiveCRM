#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  ANY_TWENTY_PATTERN,
  getLinguiSpans,
  getProtectedReason,
  isEnterpriseFile,
  isInComment,
  isInsideSpans,
  isLoggerLine,
  lineStartOffsets,
  listFiles,
  readUpstreamFile,
} from './rules.mjs';

const SERVER_EMAIL_FILES = [
  'packages/twenty-server/src/engine/core-modules/workspace-invitation/services/workspace-invitation.service.ts',
  'packages/twenty-server/src/engine/core-modules/approved-access-domain/services/approved-access-domain.service.ts',
  'packages/twenty-server/src/engine/core-modules/email-verification/services/email-verification.service.ts',
  'packages/twenty-server/src/engine/core-modules/billing/reminders/services/billing-reminder.service.ts',
];

// mode "all": every occurrence; "code": outside comments and logger calls; "lingui": inside translation macros only.
const SURFACES = [
  { name: 'PWA manifest', mode: 'all', includes: (file) => file === 'packages/twenty-front/public/manifest.json' },
  {
    name: '2FA label',
    mode: 'code',
    includes: (file) =>
      file === 'packages/twenty-server/src/engine/core-modules/two-factor-authentication/two-factor-authentication.service.ts',
  },
  {
    name: 'Emails',
    mode: 'code',
    includes: (file) => file.startsWith('packages/twenty-emails/src/') || SERVER_EMAIL_FILES.includes(file),
  },
  {
    name: 'Rendered pages',
    mode: 'code',
    includes: (file) =>
      file === 'packages/twenty-front/index.html' ||
      file.startsWith('packages/twenty-front/src/') ||
      file.startsWith('packages/twenty-ui/src/') ||
      file === 'packages/twenty-server/src/engine/core-modules/frontend/frontend.service.ts',
  },
  { name: 'Rendered pages (server messages)', mode: 'lingui', includes: (file) => file.startsWith('packages/twenty-server/src/') },
];

// Known occurrences that are not shown to users. Each needs a reason.
const EXCEPTIONS = [
  { pattern: /^packages\/twenty-ui\/src\/icon\//, reason: 'icon dictionary for developers; not imported by twenty-front' },
  { pattern: /^packages\/twenty-front\/src\/pages\/settings\/enterprise\//, reason: "describes Twenty's own Enterprise licence; renaming would misstate who sells it" },
];

const { values: options } = parseArgs({
  options: {
    upstream: { type: 'string' },
    config: { type: 'string', default: join(dirname(new URL(import.meta.url).pathname), 'brand.config.json') },
  },
});

if (!options.upstream) {
  console.error('Usage: node branding/leak-scan.mjs --upstream <dir> [--config <file>]');
  process.exit(2);
}

const upstreamDirectory = resolve(options.upstream);
const config = JSON.parse(readFileSync(options.config, 'utf8'));

// The About text may name Twenty. Its fixed parts (around {placeholders}) are allowed verbatim.
const allowedFragments = (config.aboutText ?? '')
  .split(/\{[a-zA-Z]+\}/)
  .filter((fragment) => /\bTwenty\b/.test(fragment));

const isInsideAllowedFragment = (line, column) =>
  allowedFragments.some((fragment) => {
    for (let start = line.indexOf(fragment); start !== -1; start = line.indexOf(fragment, start + 1)) {
      if (column >= start && column < start + fragment.length) return true;
    }
    return false;
  });

const leaks = [];
const warnings = [];
const excluded = new Map();

for (const file of listFiles(upstreamDirectory)) {
  const surfaces = SURFACES.filter((surface) => surface.includes(file));
  if (surfaces.length === 0) continue;

  const content = readUpstreamFile(upstreamDirectory, file);
  if (!/\bTwenty\b/.test(content)) continue;

  const exclusionReason =
    getProtectedReason(file) ?? EXCEPTIONS.find(({ pattern }) => pattern.test(file))?.reason;
  if (exclusionReason) {
    excluded.set(exclusionReason, (excluded.get(exclusionReason) ?? 0) + 1);
    continue;
  }

  const enterprise = isEnterpriseFile(content);
  const linguiSpans = getLinguiSpans(content);
  const lineOffsets = lineStartOffsets(content);
  const reported = new Set();

  content.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(ANY_TWENTY_PATTERN)) {
      const offset = lineOffsets[index] + match.index;
      const surface = surfaces.find(({ mode }) => {
        if (mode === 'all') return true;
        if (mode === 'lingui') return isInsideSpans(linguiSpans, offset);
        return !isInComment(line, match.index) && !isLoggerLine(line);
      });
      if (!surface || isInsideAllowedFragment(line, match.index)) continue;

      const key = `${index}`;
      if (reported.has(key)) continue;
      reported.add(key);

      const entry = { surface: surface.name, file, line: index + 1, text: line.trim().slice(0, 160) };
      (enterprise ? warnings : leaks).push(entry);
    }
  });
}

const print = (text = '') => console.log(text);

print(`Leak scan of ${upstreamDirectory}`);
print();
for (const [reason, count] of excluded) print(`Excluded: ${count} files (${reason})`);
print();

if (warnings.length > 0) {
  print(`WARNINGS: ${warnings.length} in enterprise-licensed files (cannot be patched)`);
  for (const { surface, file, line, text } of warnings) print(`  [${surface}] ${file}:${line}\n      ${text}`);
  print();
}

const surfaceNames = [...new Set(SURFACES.map(({ name }) => name))];
for (const name of surfaceNames) {
  const surfaceLeaks = leaks.filter((leak) => leak.surface === name);
  print(`${name}: ${surfaceLeaks.length === 0 ? 'clean' : `${surfaceLeaks.length} leaks`}`);
  for (const { file, line, text } of surfaceLeaks) print(`  ${file}:${line}\n      ${text}`);
}
print();
print(leaks.length === 0 ? 'PASS' : `FAIL: ${leaks.length} lines show "Twenty"`);

process.exitCode = leaks.length === 0 ? 0 : 1;
