#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  ANY_TWENTY_PATTERN,
  NAME_PATTERN,
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

// User-visible strings that are not inside a Lingui macro. `contains` narrows to matching lines; omit it for the whole file.
const VISIBLE_TARGETS = [
  { file: 'packages/twenty-front/index.html', contains: '<title>Twenty</title>' },
  { file: 'packages/twenty-front/index.html', contains: 'og:title" content="Twenty"' },
  { file: 'packages/twenty-front/index.html', contains: 'twitter:title" content="Twenty"' },
  { file: 'packages/twenty-front/public/manifest.json', contains: '"name": "Twenty"' },
  { file: 'packages/twenty-front/public/manifest.json', contains: '"short_name": "Twenty"', value: 'shortName' },
  { file: 'packages/twenty-front/src/utils/title-utils.ts', contains: "return 'Twenty';" },
  { file: 'packages/twenty-front/src/modules/activities/timeline-activities/utils/getTimelineActivityAuthorFullName.ts', contains: "return 'Twenty';" },
  { file: 'packages/twenty-front/src/modules/settings/mcp/constants/McpSetup.ts', contains: "displayName: 'Twenty'" },
  { file: 'packages/twenty-server/src/engine/core-modules/two-factor-authentication/two-factor-authentication.service.ts', contains: '`Twenty${workspaceDisplayName' },
  { file: 'packages/twenty-server/src/engine/core-modules/workspace-invitation/services/workspace-invitation.service.ts', contains: '(via Twenty)' },
  { file: 'packages/twenty-server/src/engine/core-modules/approved-access-domain/services/approved-access-domain.service.ts', contains: '(via Twenty)' },
  { file: 'packages/twenty-server/src/engine/core-modules/frontend/frontend.service.ts', contains: 'Unable to load Twenty' },
  { file: 'packages/twenty-server/src/engine/api/mcp/constants/mcp-server-info.const.ts' },
  { file: 'packages/twenty-server/src/engine/api/mcp/utils/build-mcp-server-instructions.util.ts' },
  { file: 'packages/twenty-server/src/engine/core-modules/well-known/utils/build-mcp-server-card.util.ts' },
  // AI prompts and tool descriptions, so assistants name the product the user sees.
  { file: 'packages/twenty-server/src/engine/metadata-modules/ai/ai-chat/constants/chat-system-prompts.const.ts' },
  { file: 'packages/twenty-server/src/engine/metadata-modules/ai/ai-chat/constants/workspace-setup-system-prompt.constant.ts' },
  { file: 'packages/twenty-server/src/engine/metadata-modules/ai/ai-chat/constants/workspace-setup-alternative-system-prompt.constant.ts' },
  { file: 'packages/twenty-server/src/engine/metadata-modules/ai/ai-agent/constants/agent-run-base-system-prompt.const.ts' },
  { file: 'packages/twenty-server/src/engine/metadata-modules/ai/ai-agent-trigger/constants/agent-trigger-base-system-prompt.const.ts' },
  { file: 'packages/twenty-server/src/modules/workflow/workflow-executor/workflow-actions/ai-agent/constants/workflow-base-system-prompt.constant.ts' },
  { file: 'packages/twenty-server/src/modules/workflow/workflow-tools/tools/create-complete-workflow.tool.ts' },
  { file: 'packages/twenty-server/src/engine/core-modules/tool/tools/search-help-center-tool/search-help-center-tool.ts' },
  { file: 'packages/twenty-server/src/engine/core-modules/tool/tools/search-help-center-tool/search-help-center-tool.schema.ts' },
  { file: 'packages/twenty-server/src/engine/core-modules/tool/tools/code-interpreter-tool/twenty-mcp-helper.constant.ts' },
  { file: 'packages/twenty-server/src/engine/metadata-modules/navigation-menu-item/tools/schemas/navigation-menu-item-scope.schema.ts' },
  { file: 'packages/twenty-server/src/engine/metadata-modules/ai/ai-front-component/constants/front-component-ui-instructions.constant.ts' },
  { file: 'packages/twenty-server/src/engine/metadata-modules/ai/ai-front-component/schemas/front-component-draft.schema.ts' },
  { file: 'packages/twenty-server/src/engine/metadata-modules/ai/ai-front-component/tools/get-front-component-ui-docs.tool.ts' },
  { file: 'packages/twenty-server/src/engine/metadata-modules/ai/ai-front-component/utils/validate-front-component-source-or-throw.util.ts' },
  { file: 'packages/twenty-server/src/engine/core-modules/getting-started/constants/getting-started-handover-workflow.constant.ts' },
];

// Imported by the override patches, so brand values stay in brand.config.json.
const GENERATED_BRAND_FILES = [
  'packages/twenty-front/src/modules/brand/constants/BrandConfig.ts',
  'packages/twenty-emails/src/constants/BrandConfig.ts',
];

const URL_TARGETS = [
  { file: 'packages/twenty-front/src/modules/ui/navigation/navigation-drawer/constants/DefaultWorkspaceLogo.ts', find: 'https://twentyhq.github.io/placeholder-images/workspaces/twenty-logo.png' },
  { file: 'packages/twenty-emails/src/constants/DefaultWorkspaceLogo.ts', find: 'https://twentyhq.github.io/placeholder-images/workspaces/twenty-logo.png' },
  { file: 'packages/twenty-emails/src/components/Logo.tsx', find: 'https://app.twenty.com/images/icons/windows11/Square150x150Logo.scale-100.png' },
  { file: 'packages/twenty-emails/src/emails/clean-suspended-workspace.email.tsx', find: 'href="https://app.twenty.com/"', replaceWith: 'href="{websiteUrl}"' },
];

// Strings where "Twenty" names the company or its licensing, not the product.
const AMBIGUOUS_PATHS = [{ pattern: /\/settings\/enterprise\//, reason: 'refers to Twenty licensing' }];

const { values: options } = parseArgs({
  options: {
    upstream: { type: 'string' },
    config: { type: 'string', default: join(dirname(new URL(import.meta.url).pathname), 'brand.config.json') },
    write: { type: 'boolean', default: false },
    report: { type: 'string' },
    version: { type: 'string' },
  },
});

if (!options.upstream) {
  console.error('Usage: node branding/apply.mjs --upstream <dir> [--config <file>] [--write --version <release>] [--report <file.json>]');
  process.exit(2);
}
if (options.write && !options.version) {
  console.error('--write needs --version, the platform-twenty release tag the About text links to');
  process.exit(2);
}

const upstreamDirectory = resolve(options.upstream);
const config = JSON.parse(readFileSync(options.config, 'utf8'));

for (const key of ['productName', 'shortName', 'companyName', 'websiteUrl', 'termsUrl', 'privacyUrl', 'sourceUrl', 'logoUrl', 'aboutText']) {
  if (typeof config[key] !== 'string' || config[key].length === 0) {
    console.error(`brand.config.json: "${key}" is required`);
    process.exit(2);
  }
}
if (/\bTwenty\b/i.test(config.productName) || /\bTwenty\b/i.test(config.shortName)) {
  console.error('brand.config.json: the product name must not contain "Twenty"');
  process.exit(2);
}

const report = {
  mode: options.write ? 'write' : 'dry-run',
  upstreamDirectory,
  productName: config.productName,
  candidateFiles: 0,
  candidateLines: 0,
  candidatesByPackage: {},
  changedFiles: [],
  skippedFiles: [],
  skippedMatches: [],
  ambiguousMatches: [],
  targetsNotFound: [],
  enterpriseFilesTotal: 0,
  overrides: [],
  generatedFiles: [],
};

const packageOf = (file) => file.split('/')[1];
const truncate = (text, length = 160) => (text.length > length ? `${text.slice(0, length)}...` : text);

const targetsFor = (file) => VISIBLE_TARGETS.filter((target) => target.file === file);
const matchedTargets = new Set();

const classify = ({ file, line, column, offset, linguiSpans }) => {
  if (isInComment(line, column)) return { kind: 'skip', reason: 'comment' };
  if (isLoggerLine(line)) return { kind: 'skip', reason: 'logger label' };
  const ambiguous = AMBIGUOUS_PATHS.find(({ pattern }) => pattern.test(file));
  if (ambiguous) return { kind: 'ambiguous', reason: ambiguous.reason };

  const target = targetsFor(file).find((candidate) => !candidate.contains || line.includes(candidate.contains));
  if (target) {
    matchedTargets.add(target);
    return { kind: 'change', reason: 'visible string (target list)', value: config[target.value ?? 'productName'] };
  }
  if (isInsideSpans(linguiSpans, offset))
    return { kind: 'change', reason: 'translation string', value: config.productName };
  return { kind: 'ambiguous', reason: 'string outside a translation macro' };
};

const overridesDirectory = join(dirname(new URL(import.meta.url).pathname), 'overrides');
const patches = existsSync(overridesDirectory)
  ? readdirSync(overridesDirectory).filter((name) => name.endsWith('.patch')).sort()
  : [];

// Patches go first so their context matches pristine upstream. A dry run reverts them afterwards.
const appliedPatches = [];
for (const patch of patches) {
  const patchPath = join(overridesDirectory, patch);
  const touched = execFileSync('git', ['apply', '--numstat', patchPath], { cwd: upstreamDirectory, encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((row) => row.split('\t')[2]);
  const enterpriseTouched = touched.filter(
    (file) => existsSync(join(upstreamDirectory, file)) && isEnterpriseFile(readUpstreamFile(upstreamDirectory, file)),
  );
  if (enterpriseTouched.length > 0) {
    report.overrides.push({ patch, status: 'refused: touches enterprise files', files: enterpriseTouched });
    continue;
  }
  try {
    execFileSync('git', ['apply', patchPath], { cwd: upstreamDirectory, stdio: 'pipe' });
    appliedPatches.push(patchPath);
    report.overrides.push({ patch, status: options.write ? 'applied' : 'applies cleanly', files: touched });
  } catch (error) {
    report.overrides.push({ patch, status: 'does not apply', files: touched, error: String(error.stderr ?? error.message).trim() });
  }
}

const version = options.version ?? '<version>';
const brandConfigSource = `// Generated by platform-twenty/branding/apply.mjs from brand.config.json.
export const BRAND_CONFIG = ${JSON.stringify(
  {
    productName: config.productName,
    companyName: config.companyName,
    websiteUrl: config.websiteUrl,
    termsUrl: config.termsUrl,
    privacyUrl: config.privacyUrl,
    supportEmail: config.supportEmail,
    aboutText: config.aboutText.replaceAll('{sourceUrl}', config.sourceUrl).replaceAll('{version}', version),
  },
  null,
  2,
)} as const;
`;
for (const file of GENERATED_BRAND_FILES) {
  if (options.write) {
    mkdirSync(dirname(join(upstreamDirectory, file)), { recursive: true });
    writeFileSync(join(upstreamDirectory, file), brandConfigSource);
  }
  report.generatedFiles.push(file);
}

try {
  const files = listFiles(upstreamDirectory);

  for (const file of files) {
    const content = readUpstreamFile(upstreamDirectory, file);
    const enterprise = isEnterpriseFile(content);
    if (enterprise) report.enterpriseFilesTotal++;

    const lines = content.split('\n');
    const candidateLineNumbers = lines
      .map((line, index) => (/\bTwenty\b/.test(line) ? index + 1 : null))
      .filter((lineNumber) => lineNumber !== null);

    const urlTargets = URL_TARGETS.filter((target) => target.file === file);
    if (candidateLineNumbers.length === 0 && urlTargets.length === 0) continue;

    if (candidateLineNumbers.length > 0) {
      report.candidateFiles++;
      report.candidateLines += candidateLineNumbers.length;
      const packageCounts = (report.candidatesByPackage[packageOf(file)] ??= { files: 0, lines: 0 });
      packageCounts.files++;
      packageCounts.lines += candidateLineNumbers.length;
    }

    if (enterprise) {
      report.skippedFiles.push({ file, reason: 'enterprise licence (@license Enterprise)', lines: candidateLineNumbers.length });
      continue;
    }
    const protectedReason = getProtectedReason(file);
    if (protectedReason) {
      report.skippedFiles.push({ file, reason: protectedReason, lines: candidateLineNumbers.length });
      continue;
    }

    const linguiSpans = getLinguiSpans(content);
    const lineOffsets = lineStartOffsets(content);
    const replacements = [];
    const changedLineNumbers = new Set();

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      const nameMatches = [...line.matchAll(NAME_PATTERN)];
      const anyMatches = [...line.matchAll(ANY_TWENTY_PATTERN)];

      if (anyMatches.length > nameMatches.length) {
        report.skippedMatches.push({ file, line: lineNumber, reason: 'identifier or protocol token (hyphen, dot or slash attached)', text: truncate(line.trim()) });
      }

      for (const match of nameMatches) {
        const offset = lineOffsets[index] + match.index;
        const result = classify({ file, line, column: match.index, offset, linguiSpans });
        if (result.kind === 'change') {
          replacements.push({ offset, length: match[0].length, value: result.value });
          changedLineNumbers.add(lineNumber);
        } else if (result.kind === 'skip') {
          report.skippedMatches.push({ file, line: lineNumber, reason: result.reason, text: truncate(line.trim()) });
        } else if (!report.ambiguousMatches.some((entry) => entry.file === file && entry.line === lineNumber)) {
          report.ambiguousMatches.push({ file, line: lineNumber, reason: result.reason, text: truncate(line.trim()) });
        }
      }
    });

    for (const target of urlTargets) {
      const offset = content.indexOf(target.find);
      if (offset === -1) {
        report.targetsNotFound.push({ file, contains: target.find });
        continue;
      }
      const value = target.replaceWith ? target.replaceWith.replace('{websiteUrl}', config.websiteUrl) : config.logoUrl;
    replacements.push({ offset, length: target.find.length, value });
      changedLineNumbers.add(content.slice(0, offset).split('\n').length);
    }

    if (replacements.length === 0) continue;

    let updated = content;
    for (const { offset, length, value } of replacements.sort((first, second) => second.offset - first.offset)) {
      updated = updated.slice(0, offset) + value + updated.slice(offset + length);
    }
    const updatedLines = updated.split('\n');

    report.changedFiles.push({
      file,
      lines: [...changedLineNumbers].sort((first, second) => first - second).map((lineNumber) => ({
        line: lineNumber,
        before: truncate(lines[lineNumber - 1].trim()),
        after: truncate(updatedLines[lineNumber - 1].trim()),
      })),
    });

    if (options.write) writeFileSync(join(upstreamDirectory, file), updated);
  }

  for (const target of VISIBLE_TARGETS) {
    if (!matchedTargets.has(target)) report.targetsNotFound.push({ file: target.file, contains: target.contains ?? '(whole file)' });
  }
} finally {
  if (!options.write) {
    for (const patchPath of appliedPatches.reverse()) {
      execFileSync('git', ['apply', '--reverse', patchPath], { cwd: upstreamDirectory, stdio: 'pipe' });
    }
  }
}

const changedLineCount = report.changedFiles.reduce((total, { lines }) => total + lines.length, 0);
const skippedByReason = report.skippedFiles.reduce((counts, { reason, lines }) => {
  counts[reason] ??= { files: 0, lines: 0 };
  counts[reason].files++;
  counts[reason].lines += lines;
  return counts;
}, {});
const skippedMatchesByReason = report.skippedMatches.reduce((counts, { reason }) => {
  counts[reason] = (counts[reason] ?? 0) + 1;
  return counts;
}, {});

const print = (text = '') => console.log(text);

print(`Rebrand ${report.mode} — "Twenty" -> "${config.productName}"`);
print(`Upstream: ${upstreamDirectory}`);
print();
print(`Candidate lines containing "Twenty": ${report.candidateLines} in ${report.candidateFiles} files`);
for (const [packageName, counts] of Object.entries(report.candidatesByPackage)) {
  print(`  ${packageName.padEnd(34)} ${String(counts.lines).padStart(4)} lines in ${String(counts.files).padStart(3)} files`);
}
print();
print(`FILES CHANGED: ${report.changedFiles.length}   LINES CHANGED: ${changedLineCount}`);
for (const { file, lines } of report.changedFiles) {
  print(`  ${file}`);
  for (const { line, before, after } of lines) {
    print(`    ${line}: - ${before}`);
    print(`    ${' '.repeat(String(line).length)}  + ${after}`);
  }
}
print();
print(`FILES SKIPPED: ${report.skippedFiles.length}`);
for (const [reason, counts] of Object.entries(skippedByReason)) print(`  ${reason}: ${counts.files} files, ${counts.lines} lines`);
for (const { file, reason, lines } of report.skippedFiles) print(`    [${reason}] ${file} (${lines} lines)`);
print(`  Enterprise files in scanned packages (all untouched): ${report.enterpriseFilesTotal}`);
print();
print(`MATCHES SKIPPED INSIDE CHANGED/SCANNED FILES: ${report.skippedMatches.length}`);
for (const [reason, count] of Object.entries(skippedMatchesByReason)) print(`  ${reason}: ${count}`);
print();
print(`AMBIGUOUS MATCHES FOR REVIEW (left unchanged): ${report.ambiguousMatches.length}`);
for (const { file, line, reason, text } of report.ambiguousMatches) print(`  ${file}:${line} [${reason}]\n      ${text}`);
print();
print(`TARGETS NOT FOUND (upstream drift): ${report.targetsNotFound.length}`);
for (const { file, contains } of report.targetsNotFound) print(`  ${file}: ${contains}`);
print();
print(`GENERATED FILES${options.write ? '' : ' (dry run: not written)'}: ${report.generatedFiles.join(', ')}`);
print();
print(`OVERRIDES${options.write ? '' : ' (dry run: applied for the scan, then reverted)'}: ${report.overrides.length}`);
for (const { patch, status, files: touched, error } of report.overrides) {
  print(`  ${patch}: ${status} (${touched.join(', ')})${error ? `\n      ${error}` : ''}`);
}

if (options.report) writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`);

if (report.targetsNotFound.length > 0 || report.overrides.some(({ status }) => status !== 'applied' && status !== 'applies cleanly')) {
  process.exitCode = 1;
}
