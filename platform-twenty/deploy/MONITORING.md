# Monitoring and alerts

`deploy/ops/health-check.sh` watches this server with cron, curl and the files the other ops scripts already write; no paid service is needed. It runs every 15 minutes (`ops/crontab.example`), prints one line per check (OK, WARN or FAIL), keeps the last result in `deploy/state/health.json` and exits 1 when a check fails. It only reads, so run it by hand whenever you like.

## Checks

| Check | WARN | FAIL |
|---|---|---|
| `healthz` | | `http://127.0.0.1:3000/healthz` does not answer within 10 s |
| `containers` | a container is still starting | a service of the stack is not running or is unhealthy |
| `worker` | a failed job or ERROR line in the worker log since the previous check | 10 or more of them |
| `backup` | no off-site copy is set up | the newest backup is older than 26 h, a backup did not finish, or its off-site copy failed |
| `backup-verify` | no full restore drill in 35 days | the last verification or restore drill failed |
| `disk`, `backup-disk` | `/` or the backup folder is 80% full | 90% full |
| `tls` | a certificate expires within 21 days | within 7 days, or it is missing or does not verify |
| `release` | a rehearsed release waits for `upgrade.sh`, or the weekly update check has not run for 8 days | never |

- The thresholds are settings in `ops.env`; `ops.env.example` lists them with their defaults.
- `backup.sh` only moves a backup into place after `verify-backup.sh` passes, so the newest backup counts as verified when taken. A `backup-verify` FAIL stays until `ops/verify-backup.sh latest --full` passes.
- The worker check reports only which components logged errors, never the messages, since those can hold client data. Read them with `docker compose logs --since <time> worker` in `deploy/`.
- The TLS check connects to `127.0.0.1:443` under each site name in `caddy/Caddyfile`, so it sees what Caddy serves even before DNS points here. It is skipped while nothing listens on 443.

## Alerts

An alert goes out only when the set of failing checks changes: once when something starts failing, again if the set changes, and once when everything recovers. A lasting failure sends nothing more. WARN lines never alert on their own; they show in the output, in `health.json` and in the next alert. To hear about every failed job, set `HEALTH_WORKER_ERRORS_FAIL=1`. Each alert is logged in `deploy/state/history.log` with the channels that took it.

All channels are optional and set in `deploy/ops.env`. After changing them, run `ops/health-check.sh --test-alert`: it sends a test through each channel and pings the heartbeat, without touching the recorded state.

- **`ALERT_EMAIL`**: plain text through the stack's mail relay (the `mail` container), or `sendmail` if the host has one; skipped when neither works. The owner's address is set in `ops.env`. Never put it in `ops.env.example`: the repository is public. Until SPF, DKIM and DMARC are published (README.md, Deploy step 7), Gmail is likely to file these mails as spam or refuse them, so do not rely on email alone yet.
- **`ALERT_WEBHOOK_URL`**: a POST with a small JSON body: `title`, `text` (the title and every check line), `content` (the same text), `status`, `failing` (the failing check names), `host` and `checkedAt`.
  - ntfy (push to a phone, no account): `https://ntfy.sh/<long random topic>?tpl=1&t={{.title}}&m={{.text}}`. Anyone who knows the topic can read it. A self-hosted ntfy needs version 2.10.0 or later for these templates.
  - Slack or Mattermost: the incoming webhook URL (they read `text`).
  - Discord: the channel webhook URL (it reads `content`).
  - healthchecks.io: `https://hc-ping.com/<uuid>/fail`, with `HEARTBEAT_URL` set to the same check. The recovery message also goes to `/fail` while the check is already down, and the heartbeat sent in the same run marks it up again.
- **`HEARTBEAT_URL`**: fetched after every run without a FAIL, for example `https://hc-ping.com/<uuid>` (healthchecks.io, period 15 minutes) or an Uptime Kuma push monitor (`https://<kuma>/api/push/<token>?status=up&msg=OK&ping=`). That service alerts when the pings stop, which also covers what this script cannot report itself: the server down, cron not running, or a disk too full to run anything.

Which to choose:

1. A heartbeat, in every setup. It is the only channel that notices when this server or its cron goes quiet.
2. A webhook for the message itself: ntfy is the quickest, Slack or Discord if the team already works there.
3. Email once the mail DNS records are live. It is already set, so it starts arriving as soon as the relay can deliver.

A setup that costs nothing today: ntfy as `ALERT_WEBHOOK_URL`, a healthchecks.io free check as `HEARTBEAT_URL`, and email as it is.

## External uptime monitor

The health check runs on the server it watches, so it cannot see DNS, the network path or the certificate as visitors get it. Once DNS points here and Caddy serves TLS, add an outside HTTP monitor:

- URL `https://crm.inventiveweb.studio/healthz`, expecting HTTP 200 and a body containing `"status":"ok"`.
- Every 1 to 5 minutes, alerting after 2 failures in a row. Turn on its certificate-expiry alert if it has one.
- Any HTTP monitor works: UptimeRobot, Better Stack, an Uptime Kuma on another machine, or whichever paid service is picked later. Point its alerts at the same place as `ALERT_WEBHOOK_URL` or `ALERT_EMAIL`.

Until DNS exists that URL does not resolve; the heartbeat covers the server meanwhile.
