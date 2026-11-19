# Launch readiness: QA and architecture review

18 November 2026, for the owner, before any production launch. Everything below ran on the test server, a
throwaway copy of the production stack (removed afterwards) or a local copy of the realtime service. Nothing was
installed, upgraded or started on production, and no production data was read or changed.

## Verdict: no-go for production today

The apps and scripts are in good shape: every suite passes, backup, restore and rollback work end to end, and the
realtime service holds up under load and restarts. Production should still wait for five things outside the code:

- public HTTPS;
- off-site backups;
- key-only SSH;
- installing the QA'd app versions (after a duplicate check only the owner can approve);
- InventiveChat going live, if WhatsApp is part of the launch;
- a decision on Twenty's limit of five workspaces per server (B6, found on 18 November).

Once those are done, the verdict is go for a first group of clients, up to the limits in "Scale".

## Findings

### Blockers

| # | Finding | What it takes |
|---|---|---|
| B1 | No public HTTPS: DNS records and the Cloudflare token are missing, so clients cannot reach the CRM and no payment, calendar or webhook callback can arrive | Owner: DNS records and the token file (README) |
| B2 | Backups are on the same disk as the data: one disk failure loses every client | Owner: choose an off-site store; then `BACKUP_OFFSITE_COMMAND` |
| B3 | Root SSH accepts passwords and is under constant brute force (fail2ban only) | Owner: add an SSH key; then disable password login |
| B4 | Production runs the app versions from before the 17-18 November fixes. Among the issues already fixed: API keys acting with an app's full role, duplicate invoice numbers, double recurring billing, deleted appointments blocking time | Owner approval to install, owner workspace first. Before that, check production for duplicate invoice numbers, quote numbers and Feedback `sourceId`s: the new unique indexes fail to install over duplicates, and I am not allowed to read production data |
| B5 | WhatsApp only: InventiveChat has no domain, HTTPS, real Meta secret, Meta approval, tenants or keys | Owner, in InventiveChat's session. The CRM can launch without WhatsApp |
| B6 | Twenty 2.55 refuses to create a sixth workspace on a server without Twenty's paid organization key (`ENTERPRISE_KEY`). The count is server-wide: production has the owner and canary workspaces, so room for three clients | Owner decision: buy the key, run several servers of five, or another model. The limit is in Twenty's enterprise code, which we do not change |

### Should fix

| # | Finding | Proposal |
|---|---|---|
| S1 (runbook written) | Clients stay on the Member role because app code is not isolated between workspaces. Connecting Stripe, Revolut, Resend or InventiveChat is workspace-wide and needs Twenty's Applications permission, which would also let a client register their own apps (code on our server). In practice our staff paste each client's keys during onboarding | Owner decision. Either write the staff-led runbook (below), or design a connect flow where the client enters keys on our page without the Applications permission (a redesign) |
| S2 (done) | Scheduled jobs run per workspace: about 70 function runs an hour per workspace with all apps, each a fresh Node process (see "Scale") | Approve longer intervals where minutes do not matter (table in "Scale"), and add a second worker before about 100 workspaces |
| S3 (prepared) | Both Redis instances have no password, and app functions run in the same container network | Owner approval for `requirepass` plus a restart in a maintenance window |
| S4 (built) | No monitoring or alerting: a failed nightly backup, a failing cron job, a full disk or an expiring certificate goes unnoticed until someone looks | An external uptime check on `/healthz`, an email from the ops scripts on failure, and a disk check in cron |
| S5 (built) | The manual check before a production upgrade, and how a "ready" verdict reaches you, are still undefined | Owner decision; the pipeline already stops at "ready" |
| S6 | App rollback was documented as lossless. A plan of reinstalling each production version over the new one shows 21 (Quotes & Invoices), 10 (Scheduling), 5 (Feedback) and 14 (Campaign Studio) deletions, including fields with data | Fixed in UPDATES.md: releases fix forward, with a backup before every app install |
| S7 | One server for everything: an outage takes all clients down. Measured: an upgrade with automatic rollback takes about 6 minutes of downtime on an empty instance; restore time grows with data | Accept for the first clients with off-site backups (B2); a standby restore target later |
| S8 | Twenty 2.59.3 changes how app connections start (signed-in browser plus a cookie). Production stays on 2.55.0; our connect pages and the e2e helpers need updating before that upgrade | Next upgrade cycle |

### Nice to have

| # | Finding |
|---|---|
| N1 | WhatsApp photos, voice notes and files show as placeholders; sending them is not built. Templates cannot carry a PDF header (InventiveChat), so invoices go as a link |
| N2 | WhatsApp unread counts are shared by the team, not per person |
| N3 (fixed) | The WhatsApp workflow step and AI tool had no send limit. Now 5 messages per contact in 10 minutes and 60 a minute (WhatsApp 0.3.4) |
| N4 | Team chat messages reach other screens in about 1.7 to 3 s (two app function calls, since messages are encrypted); WhatsApp in about 1.5 to 2 s |
| N5 | Timeline entries for WhatsApp use Twenty's default line; a card showing who wrote what would read better |
| N6 | Smaller items from the app reviews: the daily-run and reconcile routes act with the app role for any signed-in user; a restored appointment does not reclaim its time; Stripe links on a custom domain lose the Pay now button |

## Readiness pass, 19 November

Approved by the owner on 18 November: production-ready, not deployed. Nothing was installed, upgraded or restarted on
production, and no production data was read.

| Item | What was done | Result |
|---|---|---|
| S1 | `docs/onboarding-runbook.md`: staff-led onboarding, safe key transfer, the workspace-count check first | Written |
| S2 | Longer job intervals, each on its own minute (commit ad6b4ae79e) | Per workspace with every app, 30 minutes measured before and after on the idle test server (`tests/perf/idle-jobs.sh`): 70 to 30 runs an hour, 298 to 94 seconds of run time an hour; worker CPU 11.4% to 7.4% of a core |
| S3 | Both Redis servers take a password when `REDIS_PASSWORD` and `REDIS_QUEUE_PASSWORD` are in `.env`; without them nothing changes. Maintenance steps in README.md, "Redis password" | Rehearsed on the production compose (below): about 4 minutes unavailable, sessions kept, a Redis restart recovered on its own, and restore works with the passwords set |
| S4 | `deploy/ops/health-check.sh` and `deploy/MONITORING.md` (commit 1921e462fe) | Ran on this server: everything OK except a WARN for the missing off-site copy. Alerts tested against local listeners only |
| S5 | `deploy/ops/pre-upgrade-check.sh` and `docs/upgrade-checklist.md` | Ran on this server: NO-GO today, rightly (the 2.59.3 rehearsal is not-ready and the newest backup was 19 hours old) |
| B4 | `scripts/sql/check-duplicates.sql` and `docs/duplicate-check.md` | Rehearsed (below): the check finds a planted duplicate, and without the fix the Quotes & Invoices install fails on it |
| N3 | Send limit for WhatsApp automations | Fixed |
| WhatsApp | Claims, unconfirmed sends, ordered state and consent events, catch-up from InventiveChat's event feed (WhatsApp 0.3.4) | 66 unit tests, 62 end-to-end checks |

**Every suite on the test server** with the release versions: Scheduling 38 passed (2 map checks skipped: no routing
server there), Scheduling security 8, restricted role 2, Feedback 13, Campaign Studio 39, Team chat 35, Quotes &
Invoices 7, 9 and 12, WhatsApp 62. No failures.

**WhatsApp catch-up under load.** Five workspaces, each its own InventiveChat account on the test double, got 150 events
each (50 new customers, two messages each and an approval) while the test server and worker were stopped, so every
webhook failed. After the restart (223 s), the first scheduled run (WhatsApp checks every 15 minutes) applied all 750
events in about 145 s: every workspace had its 50 conversations and 100 messages, nothing lost. Two feed requests per
workspace. CPU over the 10 minutes: server 30% of a core on average (206% at the peak), worker 41% (322%), database 18%
(106%). The production server on the same machine answered all 231 health checks in the meantime (median 6 ms, slowest
2.2 s). The pace is set by Twenty's own work per new record, not by the feed: about 0.4 s per new customer with one
workspace catching up and more when several do. Much of it is Twenty's default "Create company when adding a new
person" workflow, which every workspace starts with and which runs for each person the WhatsApp app creates (about
1.5 s of worker time each). Clients who do not want it can switch it off.

**Late retries after catch-up** are recognised and change nothing (end-to-end check, newest first); each still costs
Twenty's usual function start, about 1 s.

**Dress rehearsal** on a throwaway copy of the production compose and image (2.55.0-p1, port 3300, empty database,
removed afterwards), with an owner and a client workspace:

1. Installed production's app versions (Quotes & Invoices 0.5.4, Scheduling 0.3.6, Feedback 0.1.1, Campaign Studio
   0.3.0, Team chat 0.2.2) in both, and seeded companies, people, invoices, quotes and feedback requests, with one
   duplicate invoice number in the client.
2. `check-duplicates.sql`, run as `docs/duplicate-check.md` says, found it. Installing Quotes & Invoices 0.6.2 anyway
   failed on the new unique index (`INV-qaclient-1001 is duplicated`) and left the workspace on 0.5.4. After the
   documented fix the check said OK.
3. Backup, then the release versions over production's, owner first: Quotes & Invoices 0.6.2 (plan: 21 to add, 18 to
   change), Scheduling 0.4.2 (10, 15), Feedback 0.2.2 (5, 7), Campaign Studio 0.4.2 (14, 11), Team chat 0.3.4 (0, 2),
   WhatsApp 0.3.4 (new). Nothing to destroy anywhere.
4. Data unchanged (counts and a hash of every number identical); `workspace-smoke.mjs` passed in both workspaces,
   each refusing the other's key.
5. The Redis password steps from README.md, word for word: about 4 minutes unavailable (the server's normal start),
   both Redis servers refuse requests without the password, a session from before stayed valid, and the smoke check
   passed. Restarting both Redis servers: the CRM and its scheduled jobs carried on by themselves.
6. `restore.sh` of the pre-release backup, with the passwords set: about 4 minutes, production's versions back and the
   data identical to the backup.

**Not verified in this pass:**
- anything that needs DNS and TLS: certificates, the TLS check against a real certificate, alert emails reaching
  Gmail, and the `owner` CLI remote after leaving local mode;
- InventiveChat's real event feed and 24-hour retries: they are on InventiveChat's `event-outbox` branch, not deployed.
  The CRM side is tested against the double, built to the contract InventiveChat gave (resuming from an event's cursor
  confirmed by them);
- the realtime service in the production compose (it was not started in the rehearsal);
- external alert services (ntfy, Slack, healthchecks.io): only local listeners;
- the duplicate check on production data, which the owner decides who runs;
- Google and Microsoft calendars with real credentials;
- `tests/qa/workspace-smoke.mjs` against production: it only builds `*.localhost` addresses, so the runbook gives
  the same checks by hand.

**Larger should-fixes, with cost (not done):**

| Item | Cost |
|---|---|
| Campaign Studio uses whichever Resend connection sorts first when an old one is still connected. Fix: remember the key last connected, as WhatsApp now does. Until then the runbook says to disconnect the old key at once | about 1 hour |
| WhatsApp after a pruned feed position (over 7 days without catching up): resync conversations and messages from InventiveChat's REST reads, as InventiveChat suggests. Today it is reported under "Missed events" | half a day to a day |
| Stripe links on a client's custom domain: trust the address Stripe's API returned instead of the host name | about half a day |
| A restored appointment takes its time slot back | about half a day |
| The test server listens on all interfaces (ufw blocks it; Twenty has no listen-address setting). It is kept stopped when idle; a Node preload in the test stack could bind it to loopback | about 1 hour |
| `workspace-smoke.mjs` against a public address (a `--workspace-url` option) | about 1 hour |
| Twenty's default "Create company when adding a new person" workflow runs for every person the WhatsApp app creates (about 1.5 s of worker time each) | owner or client decision to switch it off |

## Fixed during this QA

Commit 5b31a5a8fc on main (with this report in the commit after it).

| Fix | Apps | Why |
|---|---|---|
| `WHATSAPP_GATEWAY_URL` may be a path (`/s/whatsapp/gateway`), resolved against the sending workspace's own address | Quotes & Invoices 0.6.1, Campaign Studio 0.4.1, Feedback 0.2.1 | The setting is shared by every workspace, but app routes belong to the workspace they are called on: a full address would have sent every client's WhatsApp through one workspace's account (refused by the gateway, so it would have failed, not leaked). Verified live: invoice ACME-0045 reached InventiveChat through Acme's own WhatsApp app |
| After a realtime restart, screens spread their catch-up over 5 to 8 seconds | Team chat 0.3.4, WhatsApp 0.1.7 | 3,000 screens resyncing at once would have meant 3,000 app calls at the same moment |
| App rollback documented as fix-forward | UPDATES.md | Finding S6 |
| QA tools: `tests/qa/workspace-smoke.mjs` (run after onboarding any workspace on the test server) and `realtime/load.mjs` | | Repeatable checks |

Earlier the same day, the WhatsApp composer was fixed after a browser test showed sent text staying in the box (Enter
cannot be cancelled inside Twenty's app sandbox).

## What was tested

| Area | How | Result |
|---|---|---|
| Unit tests | `scripts/check-apps.sh` (locked install, strict typecheck, vitest) for six apps; `node --test` for the realtime service | 226 and 8 passed |
| End-to-end suites | `tests/run-all.sh` on the test server with the final versions | 208 checks passed; 2 road-routing checks skipped (no OSRM on the test server) |
| Real browser | Team chat and WhatsApp live checks (`tests/*/live.cjs`) | Idle screens send no requests; a chat message reached another screen in 1.7 s; a WhatsApp message reached the open inbox in 1.5 s; a reply showed in 109 ms; the composer clears and keeps focus |
| Clean install | All six apps into a brand-new workspace, then `tests/qa/workspace-smoke.mjs` | Installed cleanly; 25 of 25 smoke and isolation checks, also on Acme |
| Upgrade path | The test workspaces went from the production app versions to the new ones | Every plan 0 to destroy; every suite passes afterwards |
| App rollback | Plans of the production versions over the new ones (nothing applied) | Lossy, see S6 |
| Image upgrade and rollback | Throwaway copy of the production stack, real `upgrade.sh` and `restore.sh` | A forced failure rolled itself back; a real 2.55.0 to 2.59.3 upgrade took 3 minutes; a manual rollback afterwards worked; seeded rows and files intact each time |
| Backup and restore | Same copy: `backup.sh`, `verify-backup.sh --full`, damage, `restore.sh` | Every seeded row and file came back; a before-restore backup was taken first |
| Workspace isolation | Smoke script: other workspaces' keys on every signed-in route; WhatsApp webhooks, gateway and passes per workspace | Refused everywhere; realtime passes are workspace-bound (unit and load tests); a cross-workspace gateway callback is refused (e2e) |
| Realtime service | `realtime/load.mjs` and a browser restart test | 1,000 screens / 50 workspaces: 101 MB, every notice delivered, 7 ms p50, 15 ms p95. 3,000 screens / 200 workspaces: 162 MB, 13 ms p95. Restart: every screen back and resynced within 2.6 s; in the browser, "Reconnecting" while down, back after 3.5 s, then a new message in 1.9 s |
| Held notifications | WhatsApp e2e | A notification held while a teammate is chatting is released after the hand-back and sent once |
| Disconnect | Every Acme WhatsApp connection disconnected as the admin | The last one disabled the app's webhook at InventiveChat |
| Rebrand pipeline | Dry run, write and leak scan on pristine Twenty 2.55.0 | All patches apply; leak scan passes |
| Scheduled job load | Server and worker CPU sampled every 5 s for 14 minutes on the idle test server (3 workspaces, all apps) | Worker, which runs the scheduled functions: 3.3% of one core on average, 88% at peaks; server: 9.9%. See "Scale" |

## Not verified

- **InventiveChat itself.** It has no public address or keys, so every behaviour below was proven only against our
  strict test double, which follows the contract its session confirmed (commits c307260 and 981df78):
  - send-to-phone starting or reusing a conversation;
  - `on_behalf_of` counting as a person and pausing the AI;
  - free text refused outside the window;
  - consent recording, and STOP winning over it;
  - the full `data.message` on message webhooks, `conversation.updated` and `consent.updated`;
  - 423 `human_active` with `paused_until`;
  - `meta_rate_limited` and `provider_rejected`;
  - subscription list, create and disable;
  - the templates list shape and named parameters;
  - the claim flow;
  - echo messages from the business phone;
  - several numbers per tenant.
- **Open questions sent to InventiveChat's session, not yet answered:** whether disabling an already-disabled
  subscription answers 200. The claim field (`latest_message_id`), claim release and the crashed-send notice were
  answered on 18 November and the app follows them from WhatsApp 0.1.9.
- **Real outside services:** Meta delivery and template approval, Google and Microsoft OAuth, Stripe, Revolut, Resend.
  All suites use doubles.
- **Production data:** the duplicate check before installing (B4), and a restore at production size. The 17 November
  data rehearsal restored and upgraded a copy of a production backup, before the no-production-data instruction.
- **Mail deliverability** (SPF, DKIM, PTR): DNS is not set.
- **Other browsers:** only Chromium was used, so Safari, Firefox and mobile are untested.
- **Accessibility:** not audited.
- **A sustained load test with 200 real workspaces:** the realtime service and the per-call cost were measured separately.

## Architecture review

**Fit.** One rebranded Twenty instance with a workspace (its own Postgres schema) per client on a wildcard subdomain
suits small-business clients:
- onboarding is a script and two DNS-free steps;
- one upstream version and one patch pipeline serve everyone;
- our apps install per workspace and look native.

The costs are shared fate (one instance, one database) and shared capacity. The design is sound for tens of clients
and workable for low hundreds with the changes below. Twenty's core stays untouched.

**Apps on Twenty.** Every app call runs as a new Node process: about 1 s and about 1 CPU-second. That shapes
everything:
- reads go straight to Twenty where possible (WhatsApp inbox);
- writes and secret-holding work go through functions;
- scheduled jobs are the main idle cost.

**InventiveChat on its own server** is the right split. WhatsApp traffic, Meta compliance and its AI scale apart from
the CRM, and InventiveChat keeps its own tenant isolation in the database. The link between the two:
- each workspace's own InventiveChat key (stored encrypted by Twenty);
- webhooks signed with a per-workspace secret, sealed in the workspace, checked before any write and idempotent;
- the hand-off from our other apps signed with one server-wide secret that only our apps hold.

If InventiveChat is down:
- inbox sends show the failure;
- held notifications retry on their own;
- documents fail visibly and can be sent again;
- webhooks are retried by InventiveChat for about a day, and anything older is read back from its event feed (7 days) by the WhatsApp catch-up.

**The realtime service** is a small, stateless fan-out:
- signed one-hour passes bound to a workspace and person;
- notices carrying ids only, so a pass leak shows activity, not content;
- one instance holds thousands of screens in under 200 MB.

Failure modes:
- *Down:* screens say "Reconnecting" and stop updating live, but data stays correct and a reload shows it.
- *Restarted:* screens resync, now spread out.
- *Publishing fails:* the write still succeeds.

Limits:
- one shared secret for all apps, so a leaked app environment could mint passes for any workspace (ids only);
- no per-channel filtering, so members see that a private channel changed, not what;
- a second instance would need shared publishes (Redis pub/sub).

The alternatives were worse:
- Twenty's own event stream cannot be read through the app sandbox's request relay;
- polling costs a function call per screen per tick;
- InventiveChat's stream would announce changes before the CRM has written them.

**Scale.**

Measured on the idle test server, the scheduled jobs of one workspace with every app cost about 0.011 CPU cores
(about 40 CPU-seconds an hour, from about 70 function runs). Scaled linearly:

| | 10 workspaces | 50 workspaces | 200 workspaces |
|---|---|---|---|
| Scheduled function runs | 700/h | 3,500/h | 14,000/h |
| CPU for them, before any user activity (this server has 4 cores) | about 0.1 core | about 0.55 core | about 2.2 cores, more than half the server |
| Realtime service | trivial | trivial | 3,000 screens measured at 162 MB |
| Database | small | fine | about 30,000 tables in one Postgres; nightly dump time grows |

User activity comes on top: every app action costs about 1 CPU-second, and 10 at once top out at about 3 a second
per server.

Job intervals (approved, in place since 19 November):

| Job | Before | Now |
|---|---|---|
| Campaign Studio | every 2 min | every 5 min |
| Calendar sync | every 5 min | every 10 min |
| Reminders | every 10 min | every 15 min |
| Payment reconcile | every 10 min | every 30 min |
| Feedback | every 15 min | every 30 min |
| WhatsApp retry | every 5 min | every 15 min |

That is 30 runs an hour per workspace (measured), cutting the 200-workspace idle load to about 1 core. Note that
without Twenty's organization key a server holds at most five workspaces (B6). Past about 100
workspaces, add a worker (it scales without code changes) or a bigger server. A second server needs file storage on
S3 first.

**Open items.** Redis password (S3), off-site backups (B2), the manual check before upgrades (S5), DNS and Cloudflare
(B1): all owner actions, none code.

**Observability.** What exists:
- container logs (capped);
- `/healthz` and the smoke test;
- the update status file;
- each app's own error records (Scheduling audit events, delivery records, "issues to fix" fields).

There is no alerting at all (S4).

**Onboarding a client today:**
1. `scripts/provision-workspace.mjs` creates the workspace and an admin API key.
2. Install the apps in it.
3. Our staff connect the client's Stripe, Revolut, Resend and InventiveChat keys (S1).
4. Invite the client's people as Members.
5. Run `tests/qa/workspace-smoke.mjs` against a test copy of the setup.
6. On InventiveChat, create the tenant and its number, and the templates named in `apps/whatsapp/README.md`.
