# WhatsApp platform

Messaging service and customer-facing agent for WhatsApp (plan `03-whatsapp-platform.md`, phase 1).
Standalone package, not part of the Yarn/Nx workspace.

Stack: TypeScript on Node 22, Fastify, Postgres 16 via `pg`, hand-written SQL migrations, a Postgres job queue, `node:test`.

## Layout

| Path | What it does |
|---|---|
| `migrations/` | Schema. Every tenant table has forced row-level security on `tenant_id`. |
| `src/messaging/` | Webhook ingest: `X-Hub-Signature-256` check, replay window, de-duplication, normalisation, echoes (route A). |
| `src/conversations/` | Takeover state, `claim` and `send` (plan 6.3). The send path re-checks the lock itself. |
| `src/api/` | `POST /v1/conversations/:id/claim`, `POST /v1/messages/send`, `POST /v1/conversations/:id/state`. Bearer credential per tenant. |
| `src/tools/` | Tenant-scoped tool gateway, permission classes (7.4), customer confirmations, audit log. |
| `src/agent/` | Turn pipeline (7.3), model adapters, reply checks, escalation rules. |
| `src/templates/` | Template library (8.3) as JSON data, and the send policy for templates. |
| `src/reminders/` | 24h and 2h appointment reminders as jobs, with stop conditions. |
| `src/interfaces/`, `src/stubs/` | CRM, calendar, event bus and owner alerts. Only in-memory stubs exist here. |
| `src/dev/mock-graph-server.ts` | Mock of the Graph API. Nothing here talks to Meta. |
| `eval/` | 30 scripted conversations (plan 12). |

## Database roles

- Owner role (`DATABASE_OWNER_URL`): runs migrations and provisioning. Needs `BYPASSRLS`.
- `wa_app` (`DATABASE_URL`): the running service. No `BYPASSRLS`. All tenant work goes through `withTenant()`, which sets
  `app.tenant_id` for the transaction; with no tenant set, queries return nothing. The only cross-tenant reads are
  three `SECURITY DEFINER` functions: tenant lookup by phone number id, API token lookup, and job dequeue.

## Run

```bash
npm ci
DATABASE_OWNER_URL=postgres://... npm run migrate
npm run typecheck
TEST_DATABASE_ADMIN_URL=postgres://owner:pw@localhost:5432/postgres npm test
npm run eval                      # worst-case scripted model
EVAL_MODEL=real npm run eval      # configured provider (OLLAMA_API_KEY, OLLAMA_MODEL)
npm run mock-whatsapp             # local Graph API stand-in
npm start                         # see .env.example
```

Tests create and drop a throwaway database per file.

## Send outcomes

`send` answers 200 with `message_id`; 423 `human_active` / `paused` / `closed`; 409 `claim_invalid`, `newer_message`,
`in_progress`, `outcome_unknown`, `idempotency_key_reused`, `opted_out`; 422 `invalid_payload`, `outside_window`,
`template_not_allowed`; 429 `template_cap_reached`; 502 `provider_rejected` (safe to retry) or `outcome_unknown` (never retried).
