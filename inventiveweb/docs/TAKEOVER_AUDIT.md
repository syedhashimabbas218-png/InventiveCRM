# Takeover audit — InventiveCRM

## Snapshot

- Repository: `https://github.com/syedhashimabbas218-png/InventiveCRM`
- Default branch: `main`
- Implementation branch: `codex/inventiveweb-native-publishing`
- Head commit after takeover fix: `20ad8e1eafac354e583c138e96623d7ad2115fe6`
- PR: #1 (draft, open)
- Pinned upstream: Twenty `v2.43.0`, commit `87339fe7489c3a3c0ea72aad593a2a538357291c`
- Native app: `@inventiveweb/workspace@0.3.0`
- Takeover date: 2026-10-05

## What was broken at handoff

1. **Branded Docker image build failed.** The `InventiveWeb container build` workflow failed with `src/components/Footer.tsx(6,95): error TS2322` during `twenty-emails:build`. The branded `Footer.tsx` passed a mixed array of `Link` elements and strings to `ShadowText`, whose prop type only accepts `JSX.Element | JSX.Element[] | string`.
2. No live deployment, no container image published, no browser acceptance run.
3. Several roadmap features are object/schema definitions only; business actions are not implemented.

## Fix applied

- File: `inventiveweb/scripts/branding/apply.mjs`
- Wrapped the link row in the branded `Footer.tsx` with a React fragment (`<></>`), making it a single `JSX.Element` that satisfies `ShadowTextProps.children`.
- Committed as `20ad8e1e` and pushed to `codex/inventiveweb-native-publishing`.

## Current architecture

- **Outer fork:** Twenty SDK 2.15.0 repository. Not used as the runtime server.
- **Branded runtime:** Pinned Twenty 2.43.0 source is cloned, patched, built, and packaged by `inventiveweb/infrastructure/coolify/twenty.Dockerfile`.
- **Native app:** `inventiveweb/apps/inventiveweb` defines six objects, 22 relationship fields, five roles, one front component, six navigation entries, one settings entry, and three authenticated logic functions.
- **Deployment stack:** Gateway (nginx), Twenty server, worker, PostgreSQL 16, Redis 7.4. Gateway blocks MCP routes as a staging safeguard.
- **Separate services:** Growth/SEO reporting, website factory, and automation orchestration are intentionally outside Twenty per `scope.md`.

## Existing functionality (verified locally)

| Area | Status | Evidence |
| --- | --- | --- |
| Native app lint/typecheck | PASS | `npm run lint` |
| Native app tests | PASS | 20/20 tests |
| Native app packaging | PASS | `npm run pack:app` |
| Native app manifest | PASS | `npm run verify:manifest` (6 objects, 22 fields, 5 roles) |
| Branding apply | PASS | 191 patched files |
| Branding verify/source/guard | PASS | `verify.mjs`, `check-source.mjs`, `test-pipeline.mjs` |
| Dockerfile generation | PASS | matches committed `twenty.Dockerfile` |
| Branded Docker image build | IN PROGRESS | GitHub Actions re-running after fix |

## Broken / incomplete functionality

- Branded Docker image build was failing at handoff; fix pushed, CI re-running.
- No verified live deployment on Coolify/Contabo.
- No native-host browser acceptance.
- Calendar OAuth, free/busy, reservation, public booking embed not implemented.
- Quote/invoice issuance, PDF generation, secure customer views not implemented.
- MCP superadmin-only configuration and execution not implemented (gateway denies all MCP).
- Zapier connector not configured.
- WhatsApp/Conversations and AI assistant not implemented.
- No backup/restore rehearsal.
- No cross-workspace runtime verification.
- No complete production RBAC mapping (existing roles are module-only starters).

## Technical debt

1. Native app front component uses inline styles and raw DOM; acceptable for a Twenty native component but should be replaced with upstream design-system components if a larger UI surface is built.
2. Form builder loads only the first 100 forms; pagination/search pending.
3. Customer preview is local-only; public booking uses a separate future surface.
4. Roles are initial module grants; they do not cover platform administration, per-record CRM constraints, or the full conceptual role set in the directive.
5. Gateway MCP denial is a nginx safeguard, not server-enforced authorization.

## Missing dependencies / external blockers

- Docker engine and Linux build runner not available in the local environment.
- No Coolify project, Contabo server access, or DNS/TLS credentials available.
- No SMTP, Google/Microsoft OAuth app, or WhatsApp provider credentials available.
- No container registry namespace configured for image publishing.
- Earlier independent platform API backend is not in this repository import.

## Known security issues

- **MCP access:** Only blocked at the gateway. The directive requires server-enforced superadmin-only MCP configuration and scoped execution before enabling.
- **Integration credentials:** No credential encryption implementation beyond what Twenty provides natively; external connector architecture not yet built.
- **Tenant isolation:** Native workspace isolation is relied upon, but no cross-workspace negative tests have been run on a live server.

## Verified test results

```text
# From inventiveweb/apps/inventiveweb
npm run lint        -> PASS
npm test            -> 20 pass / 0 fail
npm run pack:app    -> PASS
npm run verify:manifest -> PASS (6 objects, 22 fields, 5 roles)

# From inventiveweb (after npm ci in apps/inventiveweb)
node scripts/branding/apply.mjs .local/twenty-upstream --development -> 191 changes
node scripts/branding/verify.mjs .local/twenty-upstream -> PASS
node scripts/branding/check-source.mjs .local/twenty-upstream -> PASS (86 TS/TSX, 15322 source files)
node scripts/branding/test-pipeline.mjs .local/twenty-upstream -> PASS (9 guard checks)
node scripts/branding/generate-dockerfile.mjs .local/twenty-upstream -> matches committed Dockerfile
```

## CI links

- PR #1: https://github.com/syedhashimabbas218-png/InventiveCRM/pull/1
- Latest push: commit `20ad8e1e` on `codex/inventiveweb-native-publishing`
- `InventiveWeb container build` status: in progress after fix
- `InventiveWeb branding` and `Native InventiveWeb app` workflows: triggered on push

## Next engineering task

Run the GitHub Actions container build to completion. If it passes, move to Phase A2/A3: prepare Coolify staging inputs, install the native app, and verify existing forms in a live workspace. If it fails, capture the exact error and fix the source-level cause in our branding/native-app code.
