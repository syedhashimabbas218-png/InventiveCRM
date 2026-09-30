import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// All paths and copy anchors are reviewed against branding/upstream.json.
export function extendBranding({
  root,
  repositoryRoot,
  brand,
  change,
  replaceOnce,
  changes,
}) {
  const front = 'packages/twenty-front/src/';
  const server = 'packages/twenty-server/src/';
  const emails = 'packages/twenty-emails/src/';
  const literal = JSON.stringify;
  const origin = brand.appUrl.replace(/\/$/, '');
  const help = `${origin}/inventiveweb/help.html`;
  const source = `${origin}/inventiveweb/source.html`;
  const rules = JSON.parse(
    readFileSync(join(repositoryRoot, 'branding/copy-rules.json'), 'utf8'),
  );
  for (const { path, before, after, count } of rules) {
    change(path, (text) => {
      if (text.split(before).length - 1 !== count)
        throw new Error(`Brand copy anchor drift: ${path}: ${before}`);
      return text.replaceAll(before, after);
    });
  }
  const template = (name) =>
    readFileSync(join(repositoryRoot, `branding/templates/${name}.tsx`), 'utf8')
      .replaceAll('__SUPPORT_URL__', literal(brand.supportUrl))
      .replaceAll('__WEBSITE_URL__', literal(brand.websiteUrl))
      .replaceAll('__COMPANY__', literal(brand.company))
      .replaceAll('__TERMS_URL__', literal(brand.termsUrl))
      .replaceAll('__PRIVACY_URL__', literal(brand.privacyUrl))
      .replaceAll('__DPA_URL__', literal(brand.dpaUrl));
  change(front + 'pages/settings/community/SettingsCommunity.tsx', () =>
    template('SettingsCommunity'),
  );
  change(front + 'pages/settings/legal/SettingsLegalDpa.tsx', () =>
    template('SettingsLegalDpa'),
  );
  change(
    front + 'pages/settings/legal/SettingsLegalDpaNew.tsx',
    () =>
      "// InventiveWeb: both legal routes use the operator's agreements.\nexport { SettingsLegalDpa as SettingsLegalDpaNew } from './SettingsLegalDpa';\n",
  );
  change(
    front + 'modules/settings/components/SettingsDiscoveryHeroCard.tsx',
    () => template('SettingsDiscoveryHeroCard'),
  );
  change(
    front +
      'modules/onboarding/components/import-contacts/OnboardingTrustBadges.tsx',
    () =>
      '// InventiveWeb does not inherit upstream certifications.\nexport const OnboardingTrustBadges = () => null;\n',
  );
  change(
    front + 'modules/settings/hooks/useSettingsNavigationItems.tsx',
    (text) =>
      replaceOnce(text, 'label: t`Community`', 'label: t`Help & support`'),
  );
  change(
    front + 'modules/support/utils/getDocumentationUrl.ts',
    () =>
      `// InventiveWeb ships a local guide; links do not leave for vendor documentation.\nimport { type DocumentationPath } from 'twenty-shared/constants';\nexport const getDocumentationUrl = (_options: { locale?: string | null; path?: DocumentationPath | string }): string => ${literal(help)};\n`,
  );
  change(
    'packages/twenty-shared/src/constants/DocumentationBaseUrl.ts',
    () =>
      `export const DOCUMENTATION_BASE_URL = ${literal(origin + '/inventiveweb/help.html#')};\n`,
  );
  change(
    front +
      'modules/workflow/workflow-steps/workflow-actions/form-action/components/WorkflowEditActionFormBuilder.tsx',
    (text) =>
      replaceOnce(
        text,
        'https://docs.twenty.com/user-guide/workflows/capabilities/workflow-actions#form',
        help + '#forms',
      ),
  );
  change(
    front +
      'modules/navigation-menu-item/edit/hooks/useNavigationMenuItemAddOptions.tsx',
    (text) =>
      replaceOnce(
        replaceOnce(text, "name: 'Twenty'", "name: 'InventiveWeb'"),
        "'https://twenty.com'",
        literal(brand.websiteUrl),
      ),
  );
  change(
    front +
      'modules/settings/data-model/constants/SettingsCompositeFieldTypeConfigs.ts',
    (text) =>
      text
        .replaceAll('@twenty.com', '@example.com')
        .replaceAll(
          "'github.com/twentyhq/twenty'",
          literal(new URL(brand.websiteUrl).host),
        )
        .replaceAll("'twenty.com'", literal(new URL(brand.websiteUrl).host))
        .replaceAll("'Twenty Repo'", "'InventiveWeb website'")
        .replaceAll("'Twenty'", "'InventiveWeb'"),
  );
  for (const name of ['Standard', 'Custom']) {
    change(
      front +
        `pages/settings/applications/utils/get${name}ApplicationDescription.ts`,
      (text) => {
        const split = text.indexOf('#### Build your own app');
        if (split < 0)
          throw new Error(`Missing app description anchor: ${name}`);
        return (
          text.slice(0, split).replaceAll('Twenty', 'InventiveWeb') +
          '#### Workspace extensions\n\nContact your InventiveWeb administrator to configure or install extensions for your business.`;\n'
        );
      },
    );
  }
  // Never relabel Twenty's published ChatGPT app as our own connector.
  change(
    front + 'modules/settings/mcp-and-apis/utils/buildMcpSetupCategories.tsx',
    (text) => {
      text = replaceOnce(
        text,
        "import OpenAiLogo from '@/settings/mcp-and-apis/assets/mcp-clients/openai.svg';\n",
        '',
      );
      const card =
        "      {\n        title: t`ChatGPT`,\n        badge: t`Official app`,\n        description: t`Open Twenty's official ChatGPT integration for your workspace.`,\n        ctaLabel: t`Open`,\n        href: MCP_SETUP.chatGptTwentyAppUrl,\n        logo: <McpClientLogo src={OpenAiLogo} invertInDarkMode />,\n      },\n";
      return replaceOnce(text, card, '');
    },
  );
  change(
    front + 'modules/settings/mcp-and-apis/constants/McpSetup.ts',
    (text) =>
      replaceOnce(
        text,
        "  chatGptTwentyAppUrl:\n    'https://chatgpt.com/apps/twenty/asdk_app_6a0ac8d7e28c8191a58ea65bb0ca3d5c',\n",
        '',
      ),
  );
  // Other native entry points can open this modal directly, not only the shared hero.
  change(
    front + 'modules/settings/components/SettingsCustomizeVideoModal.tsx',
    (text) => {
      const start = text.indexOf('const StyledVideoIframe = styled.iframe`');
      const end = text.indexOf(
        'export const SettingsCustomizeVideoModal',
        start,
      );
      if (start < 0 || end < 0) throw new Error('Missing video style anchors');
      text = text.slice(0, start) + text.slice(end);
      const contentStart = text.indexOf('      <StyledVideoIframe');
      const contentEnd = text.indexOf(
        '\n    </StyledVideoContainer>',
        contentStart,
      );
      if (contentStart < 0 || contentEnd < 0)
        throw new Error('Missing video render anchors');
      return (
        text.slice(0, contentStart) +
        `      <div><p>{t\`Find guidance for your workspace or contact InventiveWeb support.\`}</p><p><a href=${literal(help)} target="_blank" rel="noopener noreferrer">{t\`Workspace guide\`}</a></p><p><a href={${literal(brand.supportUrl)}} target="_blank" rel="noopener noreferrer">{t\`Contact support\`}</a></p></div>` +
        text.slice(contentEnd)
      )
        .replaceAll('t`Video tutorials`', 't`Help topics`')
        .replaceAll('t`Close video`', 't`Close help`');
    },
  );
  // Use a light-backed image wrapper so the supplied dark logo works in both themes.
  change(front + 'modules/auth/components/Logo.tsx', (text) =>
    replaceOnce(
      text,
      'background-size: cover;',
      'background-color: #fff;\n  background-size: contain;\n  background-position: center;\n  background-repeat: no-repeat;\n  border-radius: 8px;',
    ),
  );
  change(
    emails + 'constants/DefaultWorkspaceLogo.ts',
    () =>
      `export const DEFAULT_WORKSPACE_LOGO = ${literal(origin + '/inventiveweb/logo.png')};\n`,
  );
  change(emails + 'emails/clean-suspended-workspace.email.tsx', (text) =>
    replaceOnce(
      text,
      'href="https://app.twenty.com/"',
      `href={${literal(brand.appUrl)}}`,
    ),
  );
  for (const name of readdirSync(join(root, emails, 'emails')).filter((name) =>
    name.endsWith('.tsx'),
  )) {
    const path = emails + 'emails/' + name;
    const current =
      changes.get(path)?.updated ?? readFileSync(join(root, path), 'utf8');
    if (/https:\/\/(?:app|acme)\.twenty\.com/.test(current)) {
      change(path, (text) =>
        text.replaceAll(/https:\/\/(?:app|acme)\.twenty\.com/g, origin),
      );
    }
  }
  change(
    server +
      'engine/core-modules/well-known/utils/build-mcp-server-card.util.ts',
    (text) =>
      text
        .replace("'com.twenty/twenty'", "'studio.inventiveweb/crm'")
        .replaceAll('Twenty CRM', 'InventiveWeb CRM')
        .replace("'https://twenty.com'", literal(brand.websiteUrl))
        .replace(
          "'https://github.com/twentyhq/twenty'",
          "'https://github.com/syedhashimabbas218-png/InventiveCRM'",
        ),
  );
  change(
    server + 'engine/core-modules/open-api/utils/base-schema.utils.ts',
    (text) =>
      text
        .replaceAll('Twenty Api', 'InventiveWeb API')
        .replaceAll('Twenty MCP server', 'InventiveWeb MCP server')
        .replace(
          '> twenty-${schemaName}.json',
          '> inventiveweb-${schemaName}.json',
        )
        .replace(
          "'https://github.com/twentyhq/twenty?tab=coc-ov-file#readme'",
          literal(brand.termsUrl),
        )
        .replace(
          "email: 'felix@twenty.com'",
          `name: ${literal(brand.company)},\n        url: ${literal(brand.supportUrl)}`,
        )
        .replace(
          "'https://github.com/twentyhq/twenty?tab=License-1-ov-file#readme'",
          literal(source),
        )
        .replace('**Twenty**', '**InventiveWeb**')
        .replace("'https://twenty.com'", literal(brand.websiteUrl)),
  );
  change(
    server +
      'engine/workspace-manager/twenty-standard-application/utils/page-layout-widget/compute-my-first-dashboard-widgets.util.ts',
    (text) =>
      replaceOnce(
        text,
        'https://docs.twenty.com/getting-started/introduction',
        help,
      ),
  );
  change(
    server +
      'engine/workspace-manager/standard-objects-prefill-data/utils/prefill-workflows.util.ts',
    (text) =>
      text
        .replaceAll("'https://twenty.com'", literal(brand.websiteUrl))
        .replaceAll("'twenty.com'", literal(new URL(brand.websiteUrl).host)),
  );
  // No fallback to the vendor's search proxy: use operator Mintlify config, or a clear support result.
  change(
    server +
      'engine/core-modules/tool/tools/search-help-center-tool/search-help-center-tool.ts',
    (text) => {
      const before =
        "      const endpoint = useDirectApi\n        ? `https://api-dsc.mintlify.com/v1/search/${MINTLIFY_SUBDOMAIN}`\n        : 'https://twenty-help-search.com/search/twenty';";
      return replaceOnce(
        text,
        before,
        `      if (!useDirectApi) {\n        return { success: false, message: 'Help search is not configured. Open the workspace guide or contact InventiveWeb support.', result: [{ title: 'InventiveWeb support', url: ${literal(brand.supportUrl)} }] };\n      }\n      const endpoint = \`https://api-dsc.mintlify.com/v1/search/\${MINTLIFY_SUBDOMAIN}\`;`,
      );
    },
  );

  for (const [path, { updated }] of changes) {
    if (path.startsWith(front) && updated.includes('/inventiveweb/logo.png')) {
      change(path, (text) =>
        text.replaceAll('/inventiveweb/logo.png', '/inventiveweb/icon.svg'),
      );
    }
  }

  // Carry branded message IDs into every PO catalog before Lingui's extract/compile.
  // Changed copy falls back to the reviewed English text instead of serving stale vendor
  // translations (including transliterations of the old name). Unrelated translations stay intact.
  for (const pkg of ['twenty-front', 'twenty-emails', 'twenty-server']) {
    const folder =
      pkg === 'twenty-server'
        ? 'packages/twenty-server/src/engine/core-modules/i18n/locales'
        : `packages/${pkg}/src/locales`;
    const packageChanges = [...changes].filter(([path]) =>
      path.startsWith(`packages/${pkg}/src/`),
    );
    for (const file of readdirSync(join(root, folder)).filter((file) =>
      file.endsWith('.po'),
    )) {
      const path = `${folder}/${file}`;
      const original = readFileSync(join(root, path), 'utf8');
      const updated = original
        .split(/\n\n/)
        .map((block) => {
          const match = block.match(
            /^msgid (".*"(?:\n".*")*)\nmsgstr (".*"(?:\n".*")*)/m,
          );
          if (!match) return block;
          const decode = (value) =>
            value
              .split('\n')
              .map((line) => JSON.parse(line))
              .join('');
          const message = decode(match[1]);
          if (!message || !/(\bTwenty\b|twenty\.com)/.test(message))
            return block;
          // Legal/Enterprise statements describe the upstream vendor, not the product name.
          if (
            /pre-signed by Twenty|Organization key|Twenty.com, Public Benefit Corporation/.test(
              message,
            )
          )
            return block;
          // Only entries referenced by a patched source file are in scope.
          const references = [...block.matchAll(/^#: (.+)$/gm)].map(
            (item) => item[1],
          );
          if (
            !packageChanges.some(([sourcePath]) =>
              references.some((ref) =>
                ref.includes(sourcePath.slice(`packages/${pkg}/`.length)),
              ),
            )
          )
            return block;
          const newMessage = message
            .replaceAll('Twenty', 'InventiveWeb')
            .replaceAll('twenty.com', 'example.com');
          return block.replace(
            match[0],
            `msgid ${JSON.stringify(newMessage)}\nmsgstr ${JSON.stringify(newMessage)}`,
          );
        })
        .join('\n\n');
      if (updated !== original) change(path, () => updated);
    }
  }
}
