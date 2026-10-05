# Implementation matrix — InventiveCRM

Statuses:

- `NOT STARTED` — no code or placeholder only
- `IN PROGRESS` — code exists but not verified
- `CODE COMPLETE` — implementation present, not fully tested
- `TESTED LOCALLY` — unit/integration tests pass in development
- `STAGING VERIFIED` — verified in a live staging workspace
- `PRODUCTION VERIFIED` — verified in a live production deployment
- `BLOCKED` — external dependency or blocker identified

## P0 — Recovery and CI

| Feature | Existing | Implemented | Tested | Live verified | Blockers |
|---|---|---|---|---|---|
| Clone repo, inspect PR #1, read implementation docs | yes | STAGING VERIFIED | yes | n/a | n/a |
| Reproduce `Footer.tsx` ShadowText type error | yes | STAGING VERIFIED | yes | n/a | n/a |
| Fix `Footer.tsx` in branding script template | yes | STAGING VERIFIED | yes | n/a | n/a |
| Push fix to implementation branch | yes | STAGING VERIFIED | yes | n/a | n/a |
| Native app lint/typecheck/test/pack/manifest | yes | STAGING VERIFIED | yes | n/a | n/a |
| Branding apply/verify/check-source/test-pipeline | yes | STAGING VERIFIED | yes | n/a | n/a |
| Dockerfile generation matches committed file | yes | STAGING VERIFIED | yes | n/a | n/a |
| Full branded Docker image build in CI | yes | IN PROGRESS | in-progress | n/a | awaiting CI result |
| `TAKEOVER_AUDIT.md` and `IMPLEMENTATION_MATRIX.md` | yes | STAGING VERIFIED | yes | n/a | n/a |

## P1 — Foundation

| Feature | Existing | Implemented | Tested | Live verified | Blockers |
|---|---|---|---|---|---|
| Coolify Compose stack (gateway/server/worker/db/redis) | yes | CODE COMPLETE | YAML/static checks | n/a | no Docker/Coolify access |
| Pinned Twenty 2.43.0 branded Dockerfile | yes | CODE COMPLETE | generated + CI | n/a | image build in progress |
| Gateway MCP denial safeguard | yes | CODE COMPLETE | static | n/a | placeholder until auth |
| Native app: 6 objects, 22 relations, 5 roles | yes | STAGING VERIFIED | 20 tests + manifest | n/a | n/a |
| Form editor: 8 types, conditions, visibility, preview | yes | STAGING VERIFIED | tests | n/a | n/a |
| Form publishing with append-only versions | yes | STAGING VERIFIED | tests | n/a | n/a |
| Service form selection | yes | STAGING VERIFIED | tests | n/a | n/a |
| Live staging workspace installation | partial | NOT STARTED | n/a | n/a | no server/Coolify |
| Cross-workspace isolation tests | no | NOT STARTED | n/a | n/a | no live server |
| Backup/restore rehearsal | no | NOT STARTED | n/a | n/a | no live server |

## P2 — Appointments

| Feature | Existing | Implemented | Tested | Live verified | Blockers |
|---|---|---|---|---|---|
| Google Calendar OAuth app/consent | no | NOT STARTED | n/a | n/a | no OAuth credentials |
| Microsoft Calendar OAuth app/consent | no | NOT STARTED | n/a | n/a | no OAuth credentials |
| OAuth connect/reconnect/revoke in UI | no | NOT STARTED | n/a | n/a | n/a |
| Token refresh and credential storage | no | NOT STARTED | n/a | n/a | n/a |
| Free/busy availability lookup | no | NOT STARTED | n/a | n/a | no provider credentials |
| Atomic slot reservation / double-booking prevention | no | NOT STARTED | n/a | n/a | n/a |
| Customer booking workflow (choose service/time/form) | no | NOT STARTED | n/a | n/a | n/a |
| Reschedule/cancel with provider sync | no | NOT STARTED | n/a | n/a | n/a |
| Public booking page / embed | no | NOT STARTED | n/a | n/a | n/a |
| Rate-limit/spam protection on public booking | no | NOT STARTED | n/a | n/a | n/a |

## P3 — Commercial documents

| Feature | Existing | Implemented | Tested | Live verified | Blockers |
|---|---|---|---|---|---|
| Quote object + relations | yes (object) | CODE COMPLETE | schema only | n/a | business logic pending |
| Invoice object + relations | yes (object) | CODE COMPLETE | schema only | n/a | business logic pending |
| Quote creation/editing UI | no | NOT STARTED | n/a | n/a | n/a |
| Deterministic pricing/tax/discount calculations | no | NOT STARTED | n/a | n/a | n/a |
| Quote finalize / PDF generation | no | NOT STARTED | n/a | n/a | n/a |
| Quote accept/reject/convert to invoice | no | NOT STARTED | n/a | n/a | n/a |
| Atomic invoice numbering | no | NOT STARTED | n/a | n/a | n/a |
| Invoice lifecycle (draft/issued/paid/overdue/void) | no | NOT STARTED | n/a | n/a | n/a |
| Secure signed customer document view | no | NOT STARTED | n/a | n/a | n/a |
| Bookkeeping provider adapter interface | no | NOT STARTED | n/a | n/a | n/a |

## P4 — Integrations

| Feature | Existing | Implemented | Tested | Live verified | Blockers |
|---|---|---|---|---|---|
| Server-enforced platform superadmin role | no | NOT STARTED | n/a | n/a | n/a |
| MCP superadmin-only configuration UI/API | no | NOT STARTED | n/a | n/a | n/a |
| MCP tool allowlists, audit logs, revoke | no | NOT STARTED | n/a | n/a | n/a |
| Replace gateway MCP denial with real authorization | no | NOT STARTED | n/a | n/a | n/a |
| Zapier workflow triggers/actions | no | NOT STARTED | n/a | n/a | requires Zapier review |
| Calendar adapter interface | no | NOT STARTED | n/a | n/a | n/a |
| Bookkeeping adapter interface | no | NOT STARTED | n/a | n/a | n/a |
| Integration credential encryption/rotation | no | NOT STARTED | n/a | n/a | n/a |

## P5 — Conversations and AI (out of scope)

Removed from the current product increment. No WhatsApp, unified inbox, messaging, AI assistant or human-takeover features are implemented. If required later, they will be treated as a separate design phase.

## P6 — Product completion

| Feature | Existing | Implemented | Tested | Live verified | Blockers |
|---|---|---|---|---|---|
| Operational dashboard | no | NOT STARTED | n/a | n/a | n/a |
| White-label full surface audit | partial | IN PROGRESS | source scan | n/a | browser/email tests pending |
| Multi-business workspace isolation | partial | NOT STARTED | n/a | n/a | no live multiworkspace test |
| Separate website/automation/growth boundaries | no | NOT STARTED | n/a | n/a | earlier backend missing |
| Mobile/tablet/dark/light UX review | no | NOT STARTED | n/a | n/a | n/a |

## P7 — Release qualification

| Feature | Existing | Implemented | Tested | Live verified | Blockers |
|---|---|---|---|---|---|
| Full CI green | partial | IN PROGRESS | native/branding pass | n/a | image build in progress |
| End-to-end browser tests | no | NOT STARTED | n/a | n/a | no live server |
| Security regression tests (negative auth) | no | NOT STARTED | n/a | n/a | n/a |
| Backup/restore rehearsal | no | NOT STARTED | n/a | n/a | no off-site storage |
| Staging review on Coolify/Contabo | no | NOT STARTED | n/a | n/a | no access |
| Production release checklist | no | NOT STARTED | n/a | n/a | n/a |
| Operator approval for production | no | NOT STARTED | n/a | n/a | n/a |

## Notes

- Existing object/role definitions are metadata, not completed business features. This matrix marks the business logic as `NOT STARTED` where only schemas exist.
- Staging verification requires a live Twenty 2.43.0 workspace. None is available in the local environment.
- External blockers are recorded explicitly rather than claiming unverified features are complete.
