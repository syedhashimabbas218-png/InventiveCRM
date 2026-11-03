# platform-twenty

Build pipeline that rebrands [Twenty](https://github.com/twentyhq/twenty) as InventiveCRM, the managed CRM service of InventiveWeb.studio.

This repository holds only our patches, scripts and brand config. It does not contain the Twenty source. The workflow checks out a pinned upstream tag at build time, applies the branding and builds the Docker image.

## Licence notes

- Twenty is licensed under AGPLv3, with some files under a commercial licence (`@license Enterprise`). Our scripts never modify, copy or publish those files; `apply.mjs` skips them and lists them in its report.
- Each deployed image is built from an upstream tag plus the patches in this repository at a matching tag. The source offer shown in the app points at that tag.
- Twenty is a trademark of Twenty.com PBC. We do not use the Twenty logo. The only mention of Twenty in the product is the About text in `branding/brand.config.json`.
- Legal text naming Twenty.com PBC (the DPA files) is left unchanged. Twenty's DPA does not cover self-hosted deployments; clients need our own.

## Modification notice (AGPLv3 section 5a)

This is a modified version of Twenty. Modified from 2 November 2026 onwards by InventiveWeb.studio. Each release tag `X.Y.Z-pN` in this repository names the upstream tag `twenty/vX.Y.Z` it was built from; the changes are exactly what `branding/apply.mjs` and `branding/overrides/*.patch` produce, and the `rebrand-report.json` attached to each workflow run lists every changed file and line.

What we change: the product name in user-visible strings and AI prompts; the Twenty logo, PWA icons and social card (replaced by our assets); the login and email footers (our terms, privacy and company details, plus the About text); a Settings > General About section; documentation links (to our `documentationUrl`); neutral example values in settings; and removal of content that describes Twenty itself rather than our service: the card linking to Twenty's ChatGPT app, Twenty's SOC2/GDPR badges in onboarding, and the Twenty community, partner and changelog links in Settings > Community.

What we never change: files marked `@license Enterprise`, legal text naming Twenty.com PBC, database code, migrations and upgrade commands, the standard application metadata that is synced into workspaces, package names, import paths, env var names, tests and mocks.

## Layout

```
branding/
  brand.config.json   product name, URLs, About text, pinned upstream tag
  assets/             logo.svg, icon.png and icons/ (every PWA icon size) generated from the InventiveCRM mark;
                      logo-256.png and social-card.png must be hosted at the logoUrl and socialCardUrl in the config
  rules.mjs           scan roots, protected paths and matchers shared by both scripts
  apply.mjs           the patch tool (dry run by default)
  leak-scan.mjs       fails if "Twenty", a Twenty link or a Twenty logo file shows in pages, emails,
                      the PWA manifest or the 2FA label
  overrides/          small hand patches (*.patch), applied with git apply before the string rules;
                      they read brand values from the BrandConfig.ts files apply.mjs generates
apps/commercial-docs/  Quotes & Invoices app (UK quotes, VAT invoices, credit notes, recurring billing)
scripts/
  provision-workspace.mjs  create a client workspace and its admin API key
  set-app-variables.mjs    set an app's instance-wide settings (mail server, WhatsApp service) from a KEY=value file
  apply-setup-spec.mjs     apply an AI-written setup spec (objects, fields, views, workflows) over MCP
setup-specs/            example specs written from client prompts
deploy/
  docker-compose.yml  server, worker, Postgres, Redis and our outgoing mail server (Postfix with DKIM) for one instance
  .env.example        multi-workspace settings; copy to .env and fill in secrets
.github/workflows/rebrand.yml
```

## Usage

```bash
git clone --depth 1 --branch twenty/v2.55.0 https://github.com/twentyhq/twenty upstream
```

```bash
node branding/apply.mjs --upstream ./upstream
```

```bash
node branding/apply.mjs --upstream ./upstream --write --version 2.55.0-p1 --report rebrand-report.json
```

```bash
node branding/leak-scan.mjs --upstream ./upstream
```

The dry run prints files and lines it would change, files skipped with the reason, ambiguous matches left for review, targets that no longer match upstream, and whether each override applies. It exits non-zero if a target or override no longer matches.

The product name is the single `productName` value in `brand.config.json`. Upstream tags are named `twenty/vX.Y.Z`; always pin one, never build from a branch.

## Deploy (multi-tenant)

One instance hosts every client. Each client gets its own workspace at `<subdomain>.crm.inventiveweb.studio`; sign-in is at `app.crm.inventiveweb.studio`.

1. Point `crm.inventiveweb.studio` and `*.crm.inventiveweb.studio` at the server and put a TLS proxy in front of port 3000.
2. Copy `deploy/.env.example` to `deploy/.env`, set `IMAGE` to a built tag and fill in the secrets.
3. Run `docker compose up -d` in `deploy/`. Migrations run when the server starts.
4. Sign up first: the first account on a fresh instance becomes server admin. With `IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS=true`, only server admins can create workspaces; clients join by invitation.
5. Keep `LOGIC_FUNCTION_TYPE=LOCAL` (already in `.env.example`) so app functions such as invoice PDFs run.
6. Mail: the `mail` service sends system emails and documents sent "from our server". Before going live, publish SPF, DKIM (printed in the mail container's log on first start), DMARC and a PTR record for each sender domain, or set `MAIL_RELAYHOST` if the host blocks port 25.

## Tests

`tests/multitenant/run.sh` signs up a server admin, creates two client workspaces, checks that neither can read, change or delete the other's records (including replayed session cookies and cross-origin requests), invites a client and checks they cannot reach the other workspace, create workspaces or open the admin panel, then crawls every settings page for leftover Twenty text, links and logos.

## Onboarding a client

1. Create the workspace and an admin API key (the key file is written with mode 600):

   ```bash
   INVENTIVECRM_ADMIN_PASSWORD=... node scripts/provision-workspace.mjs --server https://crm.inventiveweb.studio --email admin@inventiveweb.studio --name "Acme Plumbing" --subdomain acme --key-file acme.key
   ```

2. Install the Quotes & Invoices app in it (see `apps/commercial-docs/README.md`).
3. Set the workspace up from the client's description. Either connect an AI assistant to the workspace's MCP server
   (`https://acme.crm.inventiveweb.studio/mcp`, header `Authorization: Bearer <API key>`) and describe the business, or have the
   assistant write a setup spec like those in `setup-specs/` and apply it:

   ```bash
   node scripts/apply-setup-spec.mjs --mcp https://acme.crm.inventiveweb.studio/mcp --key-file acme.key --spec setup-specs/plumbing-and-heating.json
   ```

   The script rejects field types and object names outside an allow-list, refuses to touch the Quotes & Invoices objects,
   skips anything that already exists and never deletes, so it can be re-run safely.

Keep API keys out of the repository. The MCP key has the Admin role of that one workspace only.
