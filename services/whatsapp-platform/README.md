# WhatsApp platform

Messaging layer for WhatsApp (plan `03-whatsapp-platform.md`, phase 1). It holds conversations and the takeover lock,
and exposes them over REST and MCP so any automation provider (n8n, an external AI agent, Make, ...) can read messages
and send replies. It runs no AI itself.

Standalone package, not part of the Yarn/Nx workspace. TypeScript on Node 22, Fastify, Postgres 16 via `pg`,
hand-written SQL migrations, a Postgres job queue, `node:test`. Runtime dependencies: `fastify`, `pg`.

## How a provider connects

1. A system credential registers a webhook: `POST /v1/subscriptions` with `url` and `event_types`. The response holds the signing secret, once.
2. The provider receives `conversation.ready_for_reply` after the grace period and debounce, once per burst of customer messages
   (or `message.received` immediately, for logging).
3. It reads context (`GET /v1/conversations/:id/messages`), claims (`POST .../claim`), sends (`POST /v1/messages/send`),
   or hands over (`POST .../handoff`). The send endpoint re-checks the lock itself, so a provider bug cannot talk over a human.

AI agents can do step 3 over MCP instead: `POST /mcp/:tenantId` with the same bearer credential.

## Endpoints

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/v1/conversations?awaiting_reply=true&limit=` | any | |
| GET | `/v1/conversations/:id` | any | state, window, claim, latest message id |
| GET | `/v1/conversations/:id/messages?limit=` | any | oldest first; customer text is untrusted |
| POST | `/v1/conversations/:id/claim` | agent, system | `{ claimant: "ai", latest_message_id, ttl_seconds }` → 200 / 409 |
| POST | `/v1/conversations/:id/release` | agent, system | `{ claim_id }` |
| POST | `/v1/conversations/:id/handoff` | any | `{ reason, summary }`; pauses automated replies |
| POST | `/v1/messages/send` | any (user = owner inbox, no claim) | → 200 / 409 / 423 / 422 / 502 |
| GET, POST | `/v1/templates` | read any, write system | per-client templates |
| GET, POST | `/v1/subscriptions`, `POST /v1/subscriptions/:id/disable` | system | |
| POST | `/mcp/:tenantId` | agent | MCP tools: `list_conversations`, `get_conversation`, `get_messages`, `claim_conversation`, `release_claim`, `send_message`, `request_handoff`, `list_templates` |
| GET, POST | `/webhooks/whatsapp` | Meta | signed with `X-Hub-Signature-256` |

Every POST under `/v1` carries the request envelope (`tenant_id`, `actor`, `correlation_id`, `idempotency_key`, `occurred_at`,
`payload`). The tenant always comes from the bearer credential; the envelope may only repeat it. Writes are audit-logged.

## Outbound events

Delivered as the envelope in JSON with headers `X-Event-Id`, `X-Event-Type`, `X-Signature-Timestamp` and
`X-Signature-256: sha256=HMAC(secret, "<timestamp>.<raw body>")`. Reject stale timestamps and de-duplicate on `X-Event-Id`.
Failed deliveries are retried up to 8 times. Types: `message.received`, `message.sent`, `message.status_updated`,
`message.send_outcome_unknown`, `conversation.ready_for_reply`, `conversation.human_takeover`, `conversation.handoff_requested`,
`customer.opted_out`, `template.status_updated`.

## Templates

Each client has its own templates (`POST /v1/templates`), validated against Meta's limits. A template can be sent only once its
status is `approved`, which follows Meta's `message_template_status_update` webhook. There is no per-customer cap; STOP opt-outs
are honoured, and marketing templates need recorded consent.

## Database roles

- Owner role (`DATABASE_OWNER_URL`): migrations and provisioning. Needs `BYPASSRLS`.
- `wa_app` (`DATABASE_URL`): the service. Every tenant table has forced row-level security on `tenant_id`; with no tenant set,
  queries return nothing. Cross-tenant reads go only through `SECURITY DEFINER` functions: tenant lookup by phone number id or
  WABA id, API token lookup, job dequeue.

## Run

```bash
npm ci
DATABASE_OWNER_URL=postgres://... npm run migrate
npm run typecheck
TEST_DATABASE_ADMIN_URL=postgres://owner:pw@localhost:5432/postgres npm test
npm run mock-whatsapp             # local Graph API stand-in; nothing here talks to Meta
npm start                         # see .env.example
```
