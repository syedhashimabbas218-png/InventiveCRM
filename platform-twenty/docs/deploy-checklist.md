# Go-live checklist

How production goes from today's state to clients working at `https://<client>.crm.inventiveweb.studio`. It closes
blockers B1 to B5 in [launch-readiness.md](launch-readiness.md). Section 1 is a decision, section 2 what the owner
supplies, section 3 the steps in order, section 4 how to undo each step, section 5 what is left for later.

Today production runs `platform-twenty:2.55.0-p1` in local mode (`SERVER_URL=http://localhost:3000`, reached through
an SSH tunnel), with the app versions from before the 17 and 18 November fixes in the owner workspace. Caddy is
installed and enabled, and waits for the Cloudflare token.

Conventions:

- Commands run as root on the production server. `platform-twenty/` is `/opt/inventivecrm/platform-twenty`.
- Every app command names its remote. The CLI's default remote is `owner`, which is production, so a command without
  `--remote` changes production.
- The app CLI needs Node 24.5 or newer; the system Node is older. Before any `npx twenty` command:
  `export PATH=/opt/node24/bin:$PATH`.
- Angle brackets mark a value to fill in: a name you choose, or an owner input from section 2.

## 1. Decision first: five workspaces per server

Twenty 2.55 refuses to create more than five workspaces on a server without Twenty's paid organization (enterprise)
key: "Workspace limit reached. A valid Organization key is required to create more workspaces."
(`MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY = 5`, counted whenever a workspace is created). The count is instance-wide:
the owner workspace, the canary workspace and three clients make five, so a fourth client cannot be created and
`scripts/provision-workspace.mjs` fails with that message. The test server is a separate instance with its own count.

The owner decides before onboarding past that point:

| Option | What it means |
|---|---|
| Buy the key | Twenty's organization key in `ENTERPRISE_KEY` in `deploy/.env`. Price, terms and how many workspaces it allows: owner input, from Twenty |
| Several servers | Up to five workspaces each. Every server is a full copy of this stack with its own backups, upgrades, monitoring and sign-in address; how clients are spread across servers and domains is an owner input |
| Another model | For example retiring the canary workspace (the smoke test would then need a read-only key in the owner workspace) frees one slot. A shared workspace for several clients is not an option: they would see each other's data |

Changing or removing the check is not an option: it would work around Twenty's commercial licence.

## 2. What the owner supplies first

| # | Input | Details | Needed by |
|---|---|---|---|
| 1 | Workspace limit decision | Section 1 | Step 9, past the fifth workspace |
| 2 | DNS records (B1) | In Cloudflare, DNS only (grey cloud): A and AAAA records for `crm.inventiveweb.studio`, `*.crm.inventiveweb.studio` and `realtime.crm.inventiveweb.studio`, pointing at this server (`ip -brief address show scope global`). The wildcard already covers `realtime`; its own record keeps it working if the wildcard changes. A short TTL during go-live makes a rollback quick | Step 2 |
| 3 | Mail DNS | SPF: add this server's addresses to the existing record, which already includes Cloudflare's mail servers (a domain may have only one SPF record). DKIM: the record the mail container prints on first start (`docker compose logs mail` in `deploy/`). DMARC: the policy. PTR for both addresses, at the hosting provider. `mail.inventiveweb.studio` (`MAIL_HOSTNAME`) points at another server today: repoint it here or choose another name. If outbound port 25 is blocked, a relay in `MAIL_RELAYHOST` | Step 5 (mail check) |
| 4 | Cloudflare DNS token | An API token with DNS edit rights on the `inventiveweb.studio` zone, written by the owner to `/root/secrets/cloudflare-dns-token` (step 3), never pasted into a chat or a file in the repository | Step 3 |
| 5 | Off-site backups (B2) | A store with another provider, the tool and its pinned version (restic or rclone), where its credentials live on the server, and the resulting `BACKUP_OFFSITE_COMMAND` | Step 1 |
| 6 | Monitoring (S4) | An external uptime service for `/healthz`, and the alert channels for `deploy/ops/health-check.sh` (`deploy/MONITORING.md`) | Step 13 |
| 7 | SSH public key (B3) | The owner's public key, so password login can be turned off. Also confirm the hosting provider's web console works, as the way back if SSH locks out | Step 12 |
| 8 | WhatsApp (B5) | InventiveChat live: its domain with HTTPS (`INVENTIVECHAT_API_URL`), a real Meta secret and Meta's approval, a tenant and number per client, each workspace's system key (`wa_...`), the templates named in `apps/whatsapp/README.md` approved, and its event feed deployed. Without it, go live without WhatsApp and add it later | Step 7, WhatsApp only |
| 9 | Credentials for outside services | Google (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) and Microsoft (`MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`) for Scheduling's calendar sync, with the redirect URI `https://crm.inventiveweb.studio/auth/apps/callback` and Google's verification (`apps/scheduling/PUBLISHING.md`). They stay empty until the owner provides them, and so do Twenty's own Google and Microsoft settings (`AUTH_GOOGLE_*`, `AUTH_MICROSOFT_*`), which are not in `deploy/.env`. Each client's Stripe or Revolut, Resend and InventiveChat keys are entered by our staff at onboarding (S1) | Steps 7 and 8 |
| 10 | Rollout choices | Which client goes first, and how long it runs before the rest | Steps 8 and 9 |
| 11 | Duplicates | How each duplicate the check finds is resolved, with the client | Step 6 |

## 3. Go-live steps

### Step 1. Off-site copy and a backup

Set the command in `deploy/ops.env`. It runs after every backup through `sh -c`, with `BACKUP_PATH` set to the new
backup; keep its credentials out of the repository. The form of `ops.env.example`:

```bash
BACKUP_OFFSITE_COMMAND=restic -r <off-site repository> backup "$BACKUP_PATH"
```

Then back up and run the restore drill:

```bash
/opt/inventivecrm/platform-twenty/deploy/ops/backup.sh pre-go-live
```

```bash
/opt/inventivecrm/platform-twenty/deploy/ops/verify-backup.sh latest --full
```

Check: `tail -4 /opt/inventivecrm/platform-twenty/deploy/state/history.log` shows `backup pre-go-live: copied offsite`
and the drill's workspace count. Once, fetch that backup back from the store into an empty folder and run
`deploy/ops/verify-backup.sh <that folder> --full`: it proves the off-site copy restores. Keep `deploy/.env` in the
password manager; no backup restores without its `ENCRYPTION_KEY`.

### Step 2. DNS

Add the records from section 2, item 2. Check from the server:

```bash
for name in crm app.crm realtime.crm; do dig +short A $name.inventiveweb.studio @1.1.1.1; dig +short AAAA $name.inventiveweb.studio @1.1.1.1; done
```

Each name returns this server's addresses. Add the mail records (item 3) now too, so they have spread by step 5.

### Step 3. Caddy and TLS

Write the token without it reaching the shell history:

```bash
( umask 077; read -rsp 'Cloudflare DNS token: ' token && printf '%s' "$token" > /root/secrets/cloudflare-dns-token )
```

Install the Caddyfile from the repository (it adds the realtime site to the one in `/etc/caddy`), check it and start
Caddy. The unit only starts once the token file exists.

```bash
cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.before-go-live
install -m 644 /opt/inventivecrm/platform-twenty/deploy/caddy/Caddyfile /etc/caddy/Caddyfile
caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl start caddy
journalctl -u caddy -f
```

Wait in the journal until certificates for `crm.inventiveweb.studio`, `*.crm.inventiveweb.studio` and
`realtime.crm.inventiveweb.studio` are obtained. Check:

```bash
curl -fsS https://crm.inventiveweb.studio/healthz
echo | openssl s_client -connect app.crm.inventiveweb.studio:443 -servername app.crm.inventiveweb.studio 2>/dev/null | openssl x509 -noout -subject -issuer -enddate
```

### Step 4. Leave local mode

From the README, "Before DNS: local mode", step 5. Keep a copy of `.env` first:

```bash
cd /opt/inventivecrm/platform-twenty/deploy
cp .env state/env.$(date -u +%Y%m%dT%H%M%SZ).bak && chmod 600 state/env.*.bak
```

In `deploy/.env`, set `SERVER_URL=https://crm.inventiveweb.studio` and delete the `COMPOSE_FILE=` line.
`docker compose up -d` recreates every service whose definition changed since it started, so first make sure the
stack is the committed one: `git -C /opt/inventivecrm status --short platform-twenty/deploy` prints nothing. Then:

```bash
docker compose up -d
until curl -fsS http://127.0.0.1:3000/healthz; do sleep 5; done
```

The server and worker are recreated on the same image (no migration). From now on the worker and app code reach the
server through its public address, and links in emails and booking pages use it.

### Step 5. Checks

```bash
/opt/inventivecrm/platform-twenty/deploy/ops/smoke-test.sh
```

Then from your own computer, outside the tunnel:

- <https://app.crm.inventiveweb.studio> shows the InventiveCRM sign-in; sign in and open the owner workspace at
  `https://<owner>.crm.inventiveweb.studio`.
- App code reaches the server through the public address: post a message in Team chat.
- Mail: invite an address you own to the owner workspace, or ask for a password reset. The email arrives, its headers
  show `spf=pass` and `dkim=pass`, and its link starts with `https://`, not `localhost`.
- From a phone on mobile data, an active appointment type's booking page loads:
  `https://<owner>.crm.inventiveweb.studio/s/book/<slug>`.

### Step 6. Duplicate check (B4)

Run `scripts/sql/check-duplicates.sql` on production as [duplicate-check.md](duplicate-check.md) describes. It only
reads, and lists duplicate invoice numbers, quote numbers and Feedback `sourceId`s in every workspace, deleted records
included. A duplicate makes the unique index of Quotes & Invoices 0.6 or Feedback 0.2, and so the install, fail in
that workspace. Resolve each one with the client (section 2, item 11) as that document describes, and run the check
again until it reports none.

### Step 7. Apps in the owner workspace

In this order. Install the versions committed on `main` at go-live; on 19 November those are:

| # | App | Folder | Version | Application id | Note |
|---|---|---|---|---|---|
| 1 | Quotes & Invoices | `apps/commercial-docs` | 0.6.2 | `93ae1d55-5c54-4fac-922b-fd9fa4a69ab5` | after step 6 |
| 2 | Scheduling | `apps/scheduling` | 0.4.2 | `54c65493-4e80-4efa-824a-456671383c86` | |
| 3 | Feedback | `apps/feedback` | 0.2.2 | `f69757a9-c451-4ac3-8042-79a99ad8e749` | after step 6 |
| 4 | Campaign Studio | `apps/campaigns` | 0.4.2 | `992fae47-c2c3-4731-b8aa-ebdcdb466631` | |
| 5 | Team chat | `apps/team-chat` | 0.3.4 | `6c6eba62-6fc2-487e-a212-3b8b01bb4365` | live updates from step 11 |
| 6 | WhatsApp | `apps/whatsapp` | 0.3.4 | `23e5cd3d-e631-461b-9e06-849c0a577688` | only once InventiveChat is live (B5) |

The saved `owner` remote points at `http://127.0.0.1:3000`. If it stops answering after step 4, log in again at the
public address: `npx twenty@2.54.3 auth login --url https://crm.inventiveweb.studio --name owner`.

For each app, from a clean checkout (`git -C /opt/inventivecrm status --short platform-twenty/apps/<folder>` prints
nothing):

1. Check and back up:

   ```bash
   cd /opt/inventivecrm/platform-twenty
   scripts/check-apps.sh <folder>
   deploy/ops/backup.sh pre-install-<folder>-<version>
   ```

2. Plan: it must report 0 to destroy. Scheduling only may pass `--allow navigationMenuItem` (UPDATES.md, "Releasing an
   app"). An app never published to this server (WhatsApp) has no plan yet (`PLAN_UNAVAILABLE`): go on to publish.

   ```bash
   cd /opt/inventivecrm/platform-twenty/apps/<folder>
   npx twenty@2.54.3 app plan --remote owner --json | node ../../scripts/check-app-plan.mjs
   ```

3. Publish:

   ```bash
   npx twenty@2.54.3 app publish --private --remote owner
   ```

4. Server variables. An empty file only lists them, each as `kept` (set) or `not set`:

   ```bash
   node ../../scripts/set-app-variables.mjs --server https://crm.inventiveweb.studio --key-file /root/secrets/keys/owner.key --env-file /dev/null --app <app id>
   ```

   The ones each app needs now (the README of each app explains them):

   | App | Needed now |
   |---|---|
   | Quotes & Invoices | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_FROM_ADDRESS`, `DOCUMENT_CONVERTER_URL` |
   | Scheduling | `BOOKING_LINK_SECRET` and the `SMTP_` settings; Google and Microsoft stay empty until supplied; `GEOCODER_URL`, `ROUTER_URL` and the map settings only with the `maps` profile |
   | Feedback | `FEEDBACK_LINK_SECRET` and the `SMTP_` settings |
   | Campaign Studio | `CAMPAIGN_LINK_SECRET`; `RESEND_API_URL` stays empty |
   | Team chat | `CHAT_SECRET` |
   | WhatsApp | `INVENTIVECHAT_API_URL`, `WHATSAPP_APP_SECRET`, and `WHATSAPP_GATEWAY_SECRET`, a new secret that step 11 gives the other three apps too |

   For a missing one, put only that `KEY=value` in a mode 600 file under `/root/secrets` (new secrets:
   `openssl rand -hex 32`, also kept in the password manager) and run the same command with `--env-file <that file>`.
   Keys left out of the file are kept. Never change a secret that is already set: a link secret breaks every link
   already sent, `CHAT_SECRET` makes every message unreadable, and `WHATSAPP_APP_SECRET` means connecting WhatsApp
   again in every workspace.

5. Install:

   ```bash
   npx twenty@2.54.3 app install --universal-identifier <app id> --remote owner
   ```

6. Verify in the owner workspace. Settings, Apps shows the new version, then:

   | App | Click |
   |---|---|
   | Quotes & Invoices | Create a draft quote for a test company whose contact is your own address, add a line, set it to Sent: it gets a number and its PDF is filed on the company |
   | Scheduling | Scheduling settings open; an active appointment type's booking page shows slots in a private window; book a slot, then cancel it from the manage link in the email |
   | Feedback | The Feedback overview opens (the first time, it creates Feedback settings, switched off) |
   | Campaign Studio | The studio opens; once Resend is connected (Settings, Accounts, Resend (email campaigns)), a test send reaches your own address |
   | Team chat | A message posted in #general shows |
   | WhatsApp | Settings, Accounts, InventiveChat (WhatsApp) accepts the owner tenant's key; a template reaches your own number |

### Step 8. One client

The client chosen in section 2, item 10. If its workspace does not exist yet (it counts towards the limit in section 1):

```bash
cd /opt/inventivecrm/platform-twenty
INVENTIVECRM_ADMIN_EMAIL="$(cat /root/secrets/inventivecrm-admin-email)" INVENTIVECRM_ADMIN_PASSWORD="$(cat /root/secrets/inventivecrm-admin-password)" \
  node scripts/provision-workspace.mjs --server https://crm.inventiveweb.studio --name "<client name>" --subdomain <subdomain> --key-file /root/secrets/keys/<subdomain>.key
```

Give the CLI a remote named after the client:

```bash
tr -d '\n' </root/secrets/keys/<subdomain>.key | npx twenty@2.54.3 auth login --with-token --url https://crm.inventiveweb.studio --name <subdomain>
```

Back up, then for each app the client takes, in the order of step 7, from the app's folder. The plan matters when the
client already has an older version: it compares against what that workspace has.

```bash
/opt/inventivecrm/platform-twenty/deploy/ops/backup.sh pre-install-<subdomain>
```

```bash
cd /opt/inventivecrm/platform-twenty/apps/<folder>
npx twenty@2.54.3 app plan --remote <subdomain> --json | node ../../scripts/check-app-plan.mjs
npx twenty@2.54.3 app install --universal-identifier <app id> --remote <subdomain>
```

Then, as a workspace admin: connect the client's Stripe or Revolut, Resend and InventiveChat keys (S1), invite the
client's people as Members (never Admin, nor a role with the Workflows, Applications or Roles permission; README,
"Client roles"), and repeat the clicks of step 7 in their workspace. Let it run for the time agreed (item 10).

### Step 9. The other clients

Step 8 for each, with a backup before each one. Past the fifth workspace on the server, only with the decision of
section 1 in place.

### Step 10. Realtime service

Make a secret (`openssl rand -hex 32`), keep it in the password manager, and uncomment both lines in `deploy/.env`:

```bash
COMPOSE_PROFILES=realtime
REALTIME_SECRET=<the secret>
```

```bash
cd /opt/inventivecrm/platform-twenty/deploy
docker compose up -d realtime
curl -fsS http://127.0.0.1:3200/healthz
curl -fsS https://realtime.crm.inventiveweb.studio/healthz
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://realtime.crm.inventiveweb.studio/v1/publish
```

Both health checks answer `{ ok, streams }`; the last command prints 404, because publishing stays inside the server.
The Caddy site came with step 3. No workspace may use the subdomain `realtime`.

### Step 11. App variables

For each app, a mode 600 file under `/root/secrets` with only these keys, then:

```bash
cd /opt/inventivecrm/platform-twenty
node scripts/set-app-variables.mjs --server https://crm.inventiveweb.studio --key-file /root/secrets/keys/owner.key --env-file /root/secrets/<file> --app <app id>
```

| App | Keys |
|---|---|
| Team chat | `REALTIME_SECRET=<the secret from step 10>`, `REALTIME_INTERNAL_URL=http://realtime:3200`, `REALTIME_PUBLIC_URL=https://realtime.crm.inventiveweb.studio` |
| WhatsApp | The same three |
| Quotes & Invoices, Feedback, Campaign Studio | `WHATSAPP_GATEWAY_URL=/s/whatsapp/gateway`, `WHATSAPP_GATEWAY_SECRET=<the WhatsApp app's value from step 7>` |

`WHATSAPP_GATEWAY_URL` is a path, not an address: the setting is shared by every workspace, and the path is resolved
against the sending workspace's own address, so each workspace sends through its own WhatsApp app. Set it once every
workspace runs at least Quotes & Invoices 0.6.1, Feedback 0.2.1 and Campaign Studio 0.4.1 (older versions need a full
address), and the WhatsApp app is installed wherever WhatsApp is used.

Check: Team chat open in two browsers as two people; a message shows on the other screen within about 3 seconds
without reopening the channel. If it does not, see the note on `OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS` in
`apps/whatsapp/README.md`. With WhatsApp live: issue an invoice to a test contact with WhatsApp consent and your own
number; it arrives through that workspace's WhatsApp app.

### Step 12. SSH hardening (B3)

Independent of the rest: do it as soon as the key arrives. Keep the current SSH session open throughout.

```bash
printf '%s\n' '<owner public key>' >> /root/.ssh/authorized_keys
```

From your own computer, in a new terminal, check the key works:
`ssh -o PreferredAuthentications=publickey root@<server address>`. Then add these lines to
`/etc/ssh/sshd_config.d/10-hardening.conf`. It is read before `50-cloud-init.conf`, which says
`PasswordAuthentication yes`, and sshd keeps the first value it reads.

```
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
```

```bash
sshd -t && systemctl reload ssh
sshd -T | grep -E '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin) '
```

It prints `no`, `no` and `prohibit-password`. From a new terminal, the key still logs in, and
`ssh -o PubkeyAuthentication=no root@<server address>` is refused. fail2ban stays on.

### Step 13. Monitoring (S4)

- The external uptime service (item 6) checks `https://crm.inventiveweb.studio/healthz`, and
  `https://realtime.crm.inventiveweb.studio/healthz` from step 10 on; with certificate expiry alerts if it has them.
- `deploy/ops/health-check.sh` runs from cron with the alert channels in `deploy/ops.env`, as `deploy/MONITORING.md`
  describes.
- Send a test alert through each channel; do not stop production to test.

### Step 14. Final smoke

```bash
/opt/inventivecrm/platform-twenty/deploy/ops/smoke-test.sh
curl -fsS https://crm.inventiveweb.studio/healthz
/opt/inventivecrm/platform-twenty/deploy/ops/backup.sh post-go-live
/opt/inventivecrm/platform-twenty/deploy/ops/verify-backup.sh latest --full
```

- `deploy/state/history.log` shows the backup `copied offsite` and the drill's workspace count.
- From a phone on mobile data: the sign-in page, and one client's booking page.
- Record the image, each workspace's app versions and the backup names with the operations notes.

## 4. Rollback

`deploy/ops/restore.sh` puts back the whole instance, every workspace. Before clients work in the CRM that costs
nothing; afterwards, everything entered since the backup is only in the `before-restore` backup it takes first, so
agree it with the clients beforehand.

| Step | Undo |
|---|---|
| 1. Off-site, backup | Nothing in production changes. If the off-site copy fails, the local backup is intact: fix the command and take another backup |
| 2. DNS | Delete the records, or point them back. The CRM stays reachable through the SSH tunnel once step 4 is undone |
| 3. Caddy and TLS | `systemctl stop caddy`. For the old configuration: `cp /etc/caddy/Caddyfile.before-go-live /etc/caddy/Caddyfile && systemctl reload caddy`. The CRM itself listens on 127.0.0.1 only, so stopping Caddy just takes it off the internet |
| 4. Local mode | In `deploy/`: `cp state/env.<time>.bak .env && docker compose up -d` |
| 5, 6. Checks | Read-only |
| 7 to 9. Apps | Fix forward, below |
| 10. Realtime | `docker compose stop realtime` in `deploy/`, and comment out `COMPOSE_PROFILES` so a later `up -d` leaves it off. Screens show "Reconnecting" and keep working; data stays correct and a reload shows it |
| 11. App variables | Run `set-app-variables.mjs` again with the previous values (keep a copy of each file before editing). Empty `REALTIME_INTERNAL_URL` and `REALTIME_PUBLIC_URL` turn live updates off. Secrets are never rolled back (step 7) |
| 12. SSH | From the session kept open: remove the three lines, then `sshd -t && systemctl reload ssh`. Locked out: the hosting provider's web console |
| 13. Monitoring | Remove the check or the cron line; nothing else changes |

**App installs fix forward.** Never install an older version over a newer one to go back: the server deletes whatever
the older version does not declare (fields, indexes, functions) with the data in them, in that workspace, and
`check-app-plan.mjs` refuses it (5 to 21 deletions per app were measured, launch-readiness S6).

- A defect: release a fixed version. Bump `version`, then `scripts/check-apps.sh <folder>`, plan, publish and install
  as in step 7, owner workspace first.
- An install that fails part way: from the app's folder, `npx twenty@2.54.3 app plan --remote <remote>` shows where
  the workspace stands, and the same `app install` command retries or waits for a job still running on the server. If
  it still fails, restore the pre-install backup.
- Data damaged and no time for a fix: restore the backup taken before that install, for example
  `deploy/ops/restore.sh <time>-pre-install-commercial-docs-0.6.2`. It replaces every workspace, as above.

**Image upgrades** are not part of go-live: production stays on 2.55.0 (S8). When one comes,
[upgrade-checklist.md](upgrade-checklist.md) applies. `upgrade.sh` restores its own pre-upgrade backup by itself if the
server is not healthy within `UPGRADE_TIMEOUT`, a workspace fails to migrate or the smoke test fails. Later, by hand:
`deploy/ops/restore.sh latest-pre-upgrade`.

## 5. Not part of go-live

- S8: Twenty 2.59's connect flow (a signed-in browser and a cookie for app connections). Production stays on 2.55.0;
  the connect pages and the e2e helpers are updated before that upgrade.
- N1: WhatsApp photos, voice notes and files show as placeholders, and sending them is not built; invoices go as a link.
- N2: WhatsApp unread counts are shared by the team.
- N3: the WhatsApp workflow step and AI tool have no send limit.
- N4: Team chat and WhatsApp messages take 1.5 to 3 seconds to reach other screens.
- N5: WhatsApp timeline entries use Twenty's default line.
- N6: smaller app review items (app-role routes for any signed-in user, restored appointments, Stripe custom domains).

The remaining should-fix items (S1 staff-led connections, S2 job intervals, S3 Redis password, S7 one server) are owner
decisions in [launch-readiness.md](launch-readiness.md) and do not block go-live.
