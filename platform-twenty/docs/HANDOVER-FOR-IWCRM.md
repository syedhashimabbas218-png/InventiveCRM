# Handover for Iwcrm

What we learned building InventiveCRM on Twenty (6 November to 19 November 2026), for the team rebuilding it from scratch in
Rust and Postgres. Twenty is dropped; everything here describes behaviour, not Twenty code. The TypeScript in
`platform-twenty/apps/` and the suites in `platform-twenty/tests/` stay in the repository as the reference implementation:
when this text and the code disagree, the code and its tests are what ran.

Nothing here contains secret values. Where a credential goes is named; its value lives in the server's secret files and
the password manager.

## Parts

| Part | File | Covers |
|---|---|---|
| 0 | `docs/HANDOVER-FOR-IWCRM.md` (this file) | Platform-wide rules, what we would do differently, measured performance, onboarding, go-live, reusable assets |
| 1a | `docs/HANDOVER-FOR-IWCRM-1a-scheduling.md` | Scheduling |
| 1b | `docs/HANDOVER-FOR-IWCRM-1b-feedback.md` | Feedback |
| 2a | `docs/HANDOVER-FOR-IWCRM-2a-quotes-invoices.md` | Quotes & Invoices |
| 2b | `docs/HANDOVER-FOR-IWCRM-2b-campaign-studio.md` | Campaign Studio |
| 3a | `docs/HANDOVER-FOR-IWCRM-3a-team-chat-realtime.md` | Team chat and the realtime service |
| 3b | `docs/HANDOVER-FOR-IWCRM-3b-whatsapp.md` | WhatsApp (the CRM side of InventiveChat) |

Each app part has the same sections: purpose, features and business rules as acceptance criteria, data model, edge
cases and bugs found, test checklist, integrations and exact contracts, settings, notes for the rebuild.

## 1. Platform-wide rules every app relied on

These were provided by Twenty or added around it. The rebuild has to provide them itself.

### Tenants

- One tenant per client business, reached at `<subdomain>.crm.inventiveweb.studio`; sign-in at `app.crm.inventiveweb.studio`.
- A tenant's records, files, settings, connections and secrets are never readable from another tenant, through any
  route, API key, webhook, job or live update. Our smoke check (`tests/qa/workspace-smoke.mjs`) asserts this per app:
  another tenant's key gets 401 or 403 on every signed-in route, and public routes refuse bad or unsigned input
  without writing anything.
- Per-tenant secrets (webhook secrets, payment keys) are stored encrypted, and the encryption is bound to their context
  (tenant id and purpose), so a value copied to another tenant or field does not decrypt.
- Twenty capped a server at five workspaces without a paid organization key. Plan capacity in the rebuild from
  measured cost per tenant (section 3), not from a licence.

### Identities and permissions

- Three kinds of caller: a signed-in person, an API key and an automation (workflow or AI tool). Each route says which
  it accepts.
- A route meant for people must refuse an API key. This was our worst bug: in Twenty an API key reached app routes with
  the app's full role, so a key could read every record the app could. Every signed-in route now checks for a person,
  and acts with that person's permissions.
- Automations act with the app's own role, and are logged under a label, not as a person.
- Clients get a Member role. Connecting payment, email or messaging providers was a workspace-admin action that would
  also have let clients install code, so our staff connect clients' keys during onboarding (section 4).

### Data integrity

- Anything that must be unique is unique in the database, not only checked in code:
  - invoice and quote numbers;
  - recurring-billing keys;
  - feedback source ids;
  - one slot reservation per advisor per 5-minute block;
  - InventiveChat conversation and message ids;
  - delivery ids from other apps.
  Soft-deleted rows still hold their unique values. Several of our worst bugs (duplicate invoice numbers, double
  recurring billing, double bookings) were check-then-write races that only a constraint stops.
- Claim before doing slow work: take the number or the job lease in one atomic statement, then render the PDF or call
  the provider. Our primitive was a filtered `UPDATE ... WHERE ... RETURNING` that returns the rows it changed.
- Statuses only move forward (queued, sent, delivered, read; a failure only before delivery), so late or repeated
  events are harmless.
- State that arrives out of order (who is handling a conversation, opt-out versus consent) applies only if its event
  time is not older than the last applied. Equal times apply.

### Outbound calls and webhooks

- Every outbound call that changes something carries an idempotency key, and the key is kept until the outcome is
  known. A retry uses the same key; a deliberate resend after a definite failure uses a new key.
- "Outcome unknown" is a final state, not a retry: mark it, show it, and let a person decide.
- Inbound webhooks are verified (HMAC over timestamp and raw body, a five-minute window, constant-time compare) before
  anything is written, and are idempotent by the provider's ids. A handler that fails answers 500 so the sender retries.
- Webhooks are not enough on their own: after an outage longer than the sender's retries, events are gone. InventiveChat
  now keeps a feed of every event for 7 days; the CRM reads it from a stored cursor (part 3).
- Hosts allowed in links we send (payment pages) are an allowlist, so a hand-edited link to another site is never sent.

### Background jobs

- Jobs run per tenant. With many tenants they all fire at the same minute, so each job has its own minute offset
  (part of S2 below), and each run has a time budget, a lease against overlapping runs, ordered paging, and a cursor
  that only moves after work is done.
- A failing item must not block the rest or be recorded as done. Our reminders recorded failures as sent and never
  reached item 501; a reconcile checked the same 50 rows forever.

### Live updates

- Screens never poll. A small push service (part 3, "Realtime") sends ids of what changed over Server-Sent Events,
  with signed one-hour passes bound to a tenant and a person. Screens re-read what changed through the normal API,
  and resync after a reconnect, spread over a few seconds.

## 2. What we would do differently

1. **Check the base platform's licence and limits before building.** We found Twenty's five-workspace cap during a load
   test, after two weeks of work, and its price ended the project.
2. **Design for in-process handlers.** In Twenty every app call started a new Node process: about 1 s and 1 CPU-second
   per call whatever it did, about 3 calls a second per server at concurrency 10, against 20 to 35 ms for a plain
   query. Most of our performance work was around that. The rebuild should run handlers in-process.
3. **Put the unique constraint first, then the code.** See section 1. Every race we fixed would have been a constraint
   error instead of bad data.
4. **Give every route an explicit caller rule from day one** (person, API key, automation, public with signed link),
   and test it per route against another tenant's credentials.
5. **Treat every provider as unreliable and out of order.** Idempotency keys, at-most-once sends, outcome-unknown,
   ordered state events and a catch-up feed were all added after something went wrong.
6. **Build a strict test double for every external service before the integration.** Ours (InventiveChat, Google
   Calendar and Microsoft Graph, Resend, Stripe, Revolut) refuse anything outside the provider's contract, so drift fails
   the suite. They are plain HTTP servers and work against any implementation (section 6).
7. **Measure idle cost per tenant early.** Scheduled jobs per tenant were the main idle cost; spreading and lengthening
   intervals cut it by two thirds (section 3).
8. **Never let a scheduled job do unbounded work in one run.** Budget, lease, cursor and resume from the last item
   done. Our WhatsApp catch-up stalled under load until it saved its position per event.
9. **Keep test and production apart by construction.** Our suites refuse the production address; destructive suites
   need a throwaway server. Test-only settings (provider URLs pointing at doubles) must be impossible to ship to
   production. Scheduling's test build reads `SCHEDULING_GOOGLE_*` and `SCHEDULING_MICROSOFT_*` at build time; a build
   without them silently talks to the real providers.
10. **Ops from the start:**
    - verified backups and a monthly restore drill;
    - off-site copies;
    - pinned versions;
    - upgrades rehearsed on a copy;
    - passwords on every internal service (our Redis had none);
    - monitoring with a heartbeat;
    - ports bound to 127.0.0.1. Docker-published ports bypass ufw;
    - nothing private in a public repository (our repo is public, so the owner's address lives only in server-local config).
11. **Default automations in the base platform cost money too.** Twenty's default "Create company when adding a new
    person" workflow ran for every person our WhatsApp app created, at about 1.5 s of worker time each.

## 3. Measured performance

All on one 4-CPU, 8 GB server (Twenty 2.55.0), test instance unless stated.

| What | Result |
|---|---|
| Plain query | 20 to 35 ms (p50 21 ms after fixes); 24 to 41 requests a second sequential |
| App route (any app call) | about 1 s and 1 CPU-second (a Node process per call); 10 at once top out at about 3 a second |
| Booking page, 10 at once | 2.9 to 3.2 requests a second; cached at the proxy, booking pages went from about 10 to over 200 requests a second |
| Idle scheduled jobs, per tenant with all six apps (30 minutes each, before and after the interval change) | 70 to 30 runs an hour, 298 to 94 s of run time an hour; worker CPU for 5 tenants 11.4% to 7.4% of one core |
| Earlier idle estimate | about 0.011 CPU cores per tenant (40 CPU-seconds an hour) before the interval change |
| Realtime service, 1,000 screens over 50 tenants | 101 MB, every notice delivered, 7 ms p50, 15 ms p95 |
| Realtime service, 3,000 screens over 200 tenants | 162 MB, 13 ms p95 |
| Realtime restart | every screen reconnected and told to resync within 2.6 s; in a browser, back after 3.5 s |
| Live messages in a real browser | Team chat to another screen 1.7 to 3 s (two app calls, messages encrypted); WhatsApp message to an open inbox 1.5 to 2 s; a reply shows in about 0.1 s; idle screens make no requests |
| WhatsApp catch-up after a real outage | 5 tenants, 150 missed events each: the first run after the restart applied all 750 in about 145 s, nothing lost; 2 feed requests per tenant; the production server on the same host stayed at a 6 ms median health check |
| Cost per new WhatsApp customer | about 0.4 s of server time with one tenant catching up; more when several do (record fan-out plus the default workflow) |
| Late webhook retry after catch-up | recognised and ignored, about 1 s each (the per-call process start) |
| Image upgrade 2.55 to 2.59 on a copy | about 3 minutes; automatic rollback on a forced failure worked |
| Restore of a backup | about 4 minutes on a small instance, after first saving the current state |
| Database at 200 tenants (schema per tenant) | about 30,000 tables in one Postgres; nightly dump time grows with it |

Job intervals that worked:

| Job | Interval |
|---|---|
| Campaign sending | 5 min |
| Calendar sync | 10 min |
| Reminders | 15 min |
| Payment reconcile | 30 min |
| Feedback | 30 min |
| WhatsApp catch-up and retries | 15 min |

Each job runs on its own minute.

## 4. Onboarding a client (staff-led)

The full runbook is `docs/onboarding-runbook.md`. The platform-agnostic steps:

1. Check capacity first (tenants on the server against its measured limits).
2. Collect from the client:
   - business name, address and VAT details;
   - logo and colours;
   - staff names and emails, with who is an admin;
   - opening hours, appointment types and advisors;
   - which providers they use: Stripe or Revolut for payments, Resend for campaign email, Google or Microsoft
     calendars, WhatsApp through InventiveChat.
3. Receive provider keys safely: a one-time, expiring share from the password manager, with its password given by phone.
   Never over plain email or chat.
4. Create the tenant (subdomain, first admin), install the apps, apply the business setup. Our flow: describe the
   business, have an AI write a setup spec (objects, fields, views, workflows; examples in `setup-specs/`), review it,
   apply it with a script.
5. Connect each provider in the tenant, as staff. Each provider's requirements (key type, permissions, webhooks) are
   in the app parts. Payment providers needed no webhook (the app checks open links); Resend's and InventiveChat's
   webhooks are registered by the apps themselves.
6. WhatsApp: on InventiveChat, create the client's tenant and number, and the templates the WhatsApp part lists.
7. Business details: business profile and document templates; booking pages; consent texts.
8. Invite the client's people with the lowest role that works.
9. Run the smoke and isolation checks against the tenant.
10. Record what was done: date, keys connected (fingerprints only), templates, who did it.
11. Key rotation: connect the new key, check, then disconnect the old one at once. Our Campaign Studio picked whichever
    connection sorted first when two existed.
12. Offboarding: disconnect providers, revoke keys at the provider, export, then delete the tenant.

## 5. Go-live checklist, platform-agnostic

From `docs/deploy-checklist.md`, without the Twenty steps:

1. Owner inputs:
   - DNS for the apex, the wildcard and any service hosts;
   - the Cloudflare DNS token for wildcard certificates (DNS-01);
   - an off-site backup target;
   - a monitoring choice;
   - an SSH public key;
   - real OAuth credentials (Google, Microsoft), kept empty until supplied;
   - InventiveChat live (domain, keys, Meta approval, templates) if WhatsApp is in scope.
2. A full backup first, verified, with an off-site copy that has run once.
3. Wildcard TLS through the proxy, with security headers and rate limits on public endpoints (booking, unsubscribe,
   webhooks).
4. Mail: SPF, DKIM, DMARC and PTR for each sender domain, or a relay if outbound port 25 is blocked.
5. Data checks before any new unique constraint. `scripts/sql/check-duplicates.sql` shows the pattern: it found a
   planted duplicate, and the install over it failed until the duplicate was fixed.
6. Install in the owner's tenant first, then one client, watch it, then the rest. Each step has a rollback. Data-changing
   releases fix forward; to go back, restore the backup taken just before.
7. Internal services: passwords on Redis, the database and any queue. Bind everything to 127.0.0.1 behind the proxy.
   Check from outside that only SSH, 80 and 443 answer.
8. SSH: keys only; turn password login off once a key works; fail2ban.
9. Monitoring:
   - an external uptime check on the health endpoint;
   - a heartbeat;
   - a local health check every 15 minutes (backup age and verification, disk, failed jobs, certificate expiry),
     alerting only when state changes (`deploy/ops/health-check.sh`, `deploy/MONITORING.md`).
10. Before every platform upgrade, a read-only go/no-go: rehearsal verdict, a fresh verified backup, the off-site copy,
    disk, no running jobs, smoke test (`deploy/ops/pre-upgrade-check.sh`, `docs/upgrade-checklist.md`).
11. Keep the encryption key and every secret in the password manager. A backup cannot be restored without the key it
    was taken with.

## 6. Reusable from this repository

| Asset | Where | Use in the rebuild |
|---|---|---|
| Acceptance suites | `tests/*/e2e.mjs`, `tests/qa/workspace-smoke.mjs` | Scenario lists (copied into the parts); many checks are HTTP-level and can be repointed |
| InventiveChat double | `tests/whatsapp/mock-inventivechat.mjs` | Strict double of the full API, webhooks, claims, outcome unknown, the event feed, an outage switch and late retries |
| Calendar double | `tests/scheduling/mock-calendar-providers.mjs` | Google OAuth and Calendar, Microsoft login and Graph |
| Resend double | `tests/campaigns/mock-resend.mjs` | Batch send, webhooks, quota and rate-limit failures on demand |
| Payment and gateway doubles | `tests/commercial-docs/mock-payments.mjs`, `tests/commercial-docs/mock-whatsapp-gateway.mjs` | Stripe and Revolut; the WhatsApp gateway as Quotes & Invoices sees it |
| Multi-tenancy suite | `tests/multitenant/` (signup, onboarding, second workspace, isolation, invites, client limits) | Tenant-level acceptance scenarios: who can create tenants, invite, and what a client role cannot do |
| Load and measurement scripts | `realtime/load.mjs`, `tests/whatsapp/catch-up-load.mjs`, `tests/perf/latency.mjs`, `tests/perf/idle-jobs.sh` | Same measurements against the new platform |
| Realtime service | `realtime/server.mjs` | Small, stateless SSE hub with signed passes; usable as is or as a spec |
| Ops | `deploy/ops/` | Backup with verification, restore drill, restore with a before-restore backup, health check with alerts, pre-upgrade go/no-go, upgrade rehearsal on a copy |
| Proxy | `deploy/caddy/` | Wildcard TLS through Cloudflare DNS-01, security headers, rate limits, edge caching |
| Mail | `deploy/docker-compose.yml` (`mail` service) | Outgoing Postfix with DKIM |
| Duplicate check | `scripts/sql/check-duplicates.sql` | Pattern for a read-only pre-migration check |
| Setup specs | `setup-specs/`, `scripts/apply-setup-spec.mjs` | The describe, generate, apply onboarding flow |

## 7. Open at handover

- Larger items never done (part 2 and part 3 give details):
  - Campaign Studio should remember which Resend key was connected last;
  - WhatsApp resync from InventiveChat's REST reads after a pruned feed position;
  - Stripe links on a client's custom domain;
  - a restored appointment reclaiming its time.
- WhatsApp media (photos, voice notes, files) shows as placeholders; sending it is not built. Unread counts are shared
  by the team, not per person.
- InventiveChat's event feed and 24-hour retries are on its `event-outbox` branch, not deployed. The CRM side was tested
  against the double built to its contract.
- Not tested at all: real Google and Microsoft calendars, real Stripe and Revolut payments, Meta delivery, email
  deliverability (no DNS yet), and Safari, Firefox and mobile browsers.
- Found while writing this handover, by reading the code only (not reproduced, marked open in the parts):
  - Scheduling: changing an appointment's advisor leaves the old advisor's calendar event; moving a group-session
    member moves neither the seat nor the host's time; a calendar account the platform stops listing is no longer
    checked for busy time; a Meet appointment type booked on a Microsoft calendar gets no meeting link.
  - Quotes & Invoices: monthly repeats drift after a short month; Revolut orders carry no idempotency key; a quote can
    be accepted without being sent; the daily job stops after 100 to 200 items a run.
  - Campaign Studio: webhook replays inside the five-minute window are accepted; more than 50 active campaigns wait
    for later runs.
  - WhatsApp: a staff text answered "busy" can stay queued with no Retry button after a reload.
  - Feedback: the public survey route has no rate limit.
