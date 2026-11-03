# WhatsApp platform

Messaging service and customer-facing agent for WhatsApp (plan: `03-whatsapp-platform.md`, phase 1).
Standalone package, not part of the Yarn/Nx workspace.

Stack: TypeScript on Node 22, Postgres 16 via `pg`, hand-written SQL migrations, Postgres-backed job queue, `node:test`.

## Database roles

- Owner role (`DATABASE_OWNER_URL`): runs migrations and provisioning. Needs `BYPASSRLS`.
- `wa_app` (`DATABASE_URL`): the running service. No `BYPASSRLS`; every table has forced row-level security on `tenant_id`.
  All tenant work goes through `withTenant()`, which sets `app.tenant_id` for the transaction. With no tenant set, queries return nothing.

## Run

```bash
npm ci
DATABASE_OWNER_URL=postgres://... npm run migrate
npm run typecheck
TEST_DATABASE_ADMIN_URL=postgres://owner:pw@localhost:5432/postgres npm test
```

Tests create and drop a throwaway database per test file.
