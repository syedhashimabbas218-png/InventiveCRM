# Verification — 30 September 2026

These results are local checks, not evidence of a live deployment.

| Check | Result | Boundary |
| --- | --- | --- |
| Native app `npm run lint` | PASS | Strict SDK typechecking including unused symbols; not server installation |
| Native app `npm test` | PASS: 20 tests | Schema safety, publication/retry/permission behavior and SDK adapter contracts |
| Native app `npm run pack:app` | PASS | Official Twenty SDK 2.43.0 builds and packages the native component/function/manifest |
| Native app `npm run verify:manifest` | PASS | Restricted roles, protected object writability and inverse relations in actual build output |
| Branding application | PASS: 191 patched files | Applied to upstream revision below; all anchors preflight before writes |
| `scripts/branding/verify.mjs` | PASS | Patched hashes, five generated assets, source notice and unchanged upstream licence |
| Patched TS/TSX syntax | PASS: 86 files | TypeScript transpilation diagnostics; not the full upstream typecheck/build |
| Runtime branding audit | PASS: 15,322 source files | Explicit technical/licence exceptions; not browser rendering |
| Branding guard regressions | PASS: 9 checks | URL gates, duplicate application, drift and reintroduced vendor branding |
| Production placeholder rejection | PASS | Missing real PUBLIC_APP_URL rejects before source changes |
| Dockerfile generation | PASS | Derived from pinned upstream build stages; native source included in source offer |
| Compose/workflow YAML | PASS | Parses; no published host ports, three persistent volumes, matching server/worker settings |
| Entrypoint shell | PASS | `sh -n`; migration behavior still needs a running server |

Upstream: `twenty/v2.43.0`, commit
`87339fe7489c3a3c0ea72aad593a2a538357291c`.
SDK and client SDK: `2.43.0`, native app: `0.3.0`.

Manifest includes six objects, twenty-two relationship fields, five roles, three authenticated
logic functions, one front component, six navigation entries, a standalone layout and an
app settings entry. These counts describe metadata, not completed appointment/invoice features.

The GET/POST form response shapes were compared with the pinned server's
`rest-api-find-many.handler.ts` and `rest-api-create-one.handler.ts`. CLI installation
arguments were checked against the installed SDK help. Successful real save/reload still
requires native-host browser testing.

## Not run

There is no Docker engine in this execution environment. The complete Twenty image,
Compose startup, database upgrade sequence, nginx runtime configuration and native app
installation were not run. No image was published. GitHub write access was verified on
30 September 2026 after the earlier HTTP 403; remote CI results must be checked on the PR.
No Contabo/Coolify connection, OAuth consent, calendar/provider request, customer submission,
email delivery or backup/restore was performed. No customer or remote Twenty workspace was changed.

The expanded customer white-label implementation is documented in [white-label.md](white-label.md).
Changed brand messages use reviewed English across 102 catalogs pending localization.
Native-host visual review and external OAuth consent branding remain staging gates.
Operator Enterprise licensing retains its upstream identity; the DPA templates are not relabeled.
Server-enforced superadmin integration management is pending; the gateway's MCP denial is
only a staging safeguard. The initial module roles are not production customer role templates.

Follow [acceptance.md](acceptance.md) to qualify staging before onboarding customers.

The previous independent backend passed 23 tests in the earlier increment. It is not part of
this repository import or these native-app checks. The outer fork reports SDK 2.15.0 and is
not upgraded by this change. Full Nx frontend lint/typecheck was attempted but Yarn is unavailable locally. Its full Nx suite was not run: this isolated npm application
does not change any core package. Context7 is not exposed in this session; API contracts were
checked against the pinned official source and installed SDK types instead.

The native-app GitHub Actions run for PR #1 passed lint, 20 tests, SDK packaging and manifest verification on commit `56ad58c5d9c45a78a4fd44c036cf7bc87fce3a43`. The branding increment adds its own pinned-source CI workflow; consult the PR for the latest run status.
