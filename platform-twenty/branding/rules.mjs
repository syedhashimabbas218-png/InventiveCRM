import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const ENTERPRISE_MARKER = '@license Enterprise';

// Packages that end up in the Docker image (see packages/twenty-docker/twenty/Dockerfile).
export const SCAN_ROOTS = [
  'packages/twenty-front/index.html',
  'packages/twenty-front/public/manifest.json',
  'packages/twenty-front/src',
  'packages/twenty-server/src',
  'packages/twenty-emails/src',
  'packages/twenty-ui/src',
  'packages/twenty-shared/src',
  'packages/twenty-front-component-renderer/src',
  'packages/twenty-client-sdk/src',
];

const SCANNED_EXTENSIONS = /\.(ts|tsx|js|mjs|cjs|json|html)$/;

export const PROTECTED_PATHS = [
  { pattern: /(\.(test|spec|stories)\.|__tests__|__mocks__|__stories__|\/mocks?\/|\/mock-data\/|\/test\/|\/testing\/)/, reason: 'test, mock or story' },
  { pattern: /(\/dpa\/|\/legal\/|Dpa)/, reason: 'legal text (DPA)' },
  { pattern: /^packages\/twenty-server\/src\/database\//, reason: 'database, migrations or upgrade commands' },
  { pattern: /\/dev-seeder\//, reason: 'dev seed data' },
  { pattern: /(\/generated\/|\/locales\/)/, reason: 'generated or translation catalogue (rebuilt by the Docker build)' },
];

// Matches the bare word. Hyphenated, dotted or slashed forms (X-Twenty-Webhook, Twenty.com, //Twenty//) are excluded.
export const NAME_PATTERN = /(?<![\w\-./@])Twenty(?![\w-])(?!\.[a-z])/g;
export const ANY_TWENTY_PATTERN = /\bTwenty\b/g;

const LINGUI_SPAN_PATTERNS = [
  /\b(?:t|msg)`(?:\\.|\$\{[^}]*\}|[^`\\])*`/g,
  /<Trans>[\s\S]*?<\/Trans>/g,
  /<Trans\s+id=(["'])[\s\S]*?\1/g,
  /i18n\._\(\s*(["'`])(?:\\.|(?!\1)[\s\S])*?\1/g,
];

export const listFiles = (upstreamDirectory) => {
  const files = [];
  const walk = (path) => {
    const stats = statSync(path, { throwIfNoEntry: false });
    if (!stats) return;
    if (stats.isDirectory()) {
      if (path.endsWith('node_modules')) return;
      for (const entry of readdirSync(path)) walk(join(path, entry));
      return;
    }
    if (SCANNED_EXTENSIONS.test(path)) files.push(relative(upstreamDirectory, path));
  };
  for (const root of SCAN_ROOTS) walk(join(upstreamDirectory, root));
  return files.sort();
};

export const readUpstreamFile = (upstreamDirectory, file) =>
  readFileSync(join(upstreamDirectory, file), 'utf8');

export const isEnterpriseFile = (content) => content.includes(ENTERPRISE_MARKER);

export const getProtectedReason = (file) =>
  PROTECTED_PATHS.find(({ pattern }) => pattern.test(file))?.reason;

export const getLinguiSpans = (content) => {
  const spans = [];
  for (const pattern of LINGUI_SPAN_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      spans.push([match.index, match.index + match[0].length]);
    }
  }
  return spans;
};

export const isInsideSpans = (spans, offset) =>
  spans.some(([start, end]) => offset >= start && offset < end);

export const isInComment = (line, columnIndex) => {
  const before = line.slice(0, columnIndex);
  const trimmed = line.trimStart();
  if (/^(\/\/|\/\*|\*|<!--|\{\/\*)/.test(trimmed)) return true;
  return /(^|[^:'"`\w])\/\/|\/\*|<!--/.test(before);
};

export const isLoggerLine = (line) =>
  /\b(logger|console)\.(log|warn|error|debug|info)\b|loggerLink\(/.test(line);

export const lineStartOffsets = (content) => {
  const offsets = [0];
  for (let index = 0; index < content.length; index++) {
    if (content[index] === '\n') offsets.push(index + 1);
  }
  return offsets;
};
