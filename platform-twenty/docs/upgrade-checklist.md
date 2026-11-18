# Upgrade checklist

The manual part of moving production to a new Twenty release. The weekly pipeline ([UPDATES.md](../UPDATES.md),
"Upgrading Twenty") builds and rehearses the release and stops at a verdict; a person does the rest, in this order.
App releases follow "Releasing an app" in UPDATES.md instead.

Commands run as root on the production server. `deploy/` is `/opt/inventivecrm/platform-twenty/deploy`.

## How the verdict reaches you

| What | Where |
|---|---|
| A Twenty release is out | The weekly `platform-twenty upstream watch` workflow on GitHub: an issue, or a failed run while Issues are switched off |
| It has been built and rehearsed | Cron runs `deploy/ops/auto-update.sh` on Monday at 02:47 UTC. It takes about an hour, longer when it builds |
| The verdict | `deploy/ops/auto-update.sh --status`, which reads `deploy/state/update-status.json` |

Nothing sends the verdict to you today: read it on Monday morning, or run `deploy/ops/auto-update.sh` by hand instead
of waiting. `--status` prints the time, the verdict (`ready`, `not-ready` or `up-to-date`) and the reason; on `ready` it
adds the tag command and the upgrade command. Each stage's log is under `/var/lib/inventivecrm-update/logs/<run>/`, and
`deploy/state/history.log` keeps every run.

Once `deploy/ops/health-check.sh` runs from cron, it also reports a rehearsed release waiting for `upgrade.sh`, through
the alert channels chosen in [deploy/MONITORING.md](../deploy/MONITORING.md).

## Before the window

1. `deploy/ops/auto-update.sh --status` says `ready` for `platform-twenty:X.Y.Z-pN`, checked in the last 8 days. If it
   is older, run `deploy/ops/auto-update.sh` again (about an hour; production is not touched).
2. Read Twenty's release notes (<https://github.com/twentyhq/twenty/releases>) for every version between production's
   and the target. Look hardest at apps, logic functions and `/auth/apps`: Twenty 2.59 changed how app connections
   start ([launch-readiness.md](launch-readiness.md), S8).
3. Push the source tag the status prints (UPDATES.md step 4). The pre-upgrade check warns while it is missing.
4. Choose the window and tell clients (UPDATES.md rule 11). The CRM is offline from the pre-upgrade backup until the
   smoke test passes. For sizing:
   - the data rehearsal logs how long a copy of production took to migrate:
     `grep 'upgraded in' /opt/inventivecrm/platform-twenty/deploy/state/history.log | tail -1` (200 to 237 s for
     2.55.0 to 2.59.3);
   - a real 2.55.0 to 2.59.3 upgrade of a throwaway copy took 3 minutes;
   - an upgrade that rolled itself back took about 6 minutes on an empty instance.
5. Keep the window clear of cron: the nightly backup (02:17 UTC), the update check (Monday 02:47 UTC) and the restore
   drill (the 1st of the month, 04:43 UTC). The upgrade holds the operations lock, so a backup starting in the window
   fails, and an update check would rehearse on the same memory at the same time.
6. No app release in the same window: app installs and image upgrades roll back differently.

## In the window

1. Open a `tmux` session on the server and work inside it, so a dropped SSH connection cannot stop `upgrade.sh` half
   way.
2. Make sure nobody else is running app commands against production. The check below only sees this server's
   processes, and an `app install` that timed out or was stopped with Ctrl+C keeps running on the server (run the same
   command again to wait for it).
3. Take a fresh backup. The CRM stays up; it takes about a minute at today's size.

   ```bash
   /opt/inventivecrm/platform-twenty/deploy/ops/backup.sh manual
   ```

   `upgrade.sh` takes its own backup as well. This one proves, before the CRM goes offline, that backups and the
   off-site copy work today.
4. Run the check:

   ```bash
   /opt/inventivecrm/platform-twenty/deploy/ops/pre-upgrade-check.sh
   ```

   It takes the target from the status file (or pass the image as the only argument), and it must end with `GO`.
   Never run `upgrade.sh` after a `NO-GO`: fix what it names and run the check again. It takes no backup, pulls
   nothing and restarts nothing; the only write is the `smoke: ok` line the smoke test adds to
   `deploy/state/history.log`.

   | Check | No-go when |
   |---|---|
   | Target image | not a pinned `X.Y.Z-pN` tag, not newer than production, or not on this server |
   | Rehearsals | the verdict is not `ready` for this image, is 8 days old or more, started from another production image, or the stage logs do not show both rehearsals passing |
   | Fresh backup | the newest backup is over 60 minutes old (it prints the command to take one), its checksums fail, it was taken on another image or with another `ENCRYPTION_KEY`, or production's current image is gone (a rollback restarts it) |
   | Off-site copy | never a no-go, but a loud warning when `BACKUP_OFFSITE_COMMAND` is empty or the fresh backup's copy failed |
   | Disk | less free than two backups (the pre-upgrade one, and the one a rollback takes first) plus the image's size |
   | Nothing else running | a backup, upgrade, restore, update check, rehearsal or image build holds its lock; an app install, publish or workspace script runs here; the server container runs another image than `deploy/.env` names |
   | Smoke test | `deploy/ops/smoke-test.sh` fails now |

   It also warns when the source tag is not pushed and when `SMOKE_KEYS_DIR` holds no canary key. It ends with the
   current and target versions, the upgrade command and the rollback commands. `PRE_UPGRADE_MAX_REHEARSAL_DAYS` and
   `PRE_UPGRADE_MAX_BACKUP_MINUTES` change the two limits.

   Read every `WARN`. Without an off-site copy, a disk failure in the window loses every client's data: go only if you
   accept that, knowingly.
5. Upgrade, with the command the check printed:

   ```bash
   /opt/inventivecrm/platform-twenty/deploy/ops/upgrade.sh platform-twenty:X.Y.Z-pN
   ```

   Type `yes` at the prompt. Never add `--no-rollback`, and add `--yes` only in automation. It stops the worker and
   server, takes and verifies the pre-upgrade backup (`<time>-pre-upgrade-<old>-to-<new>`), switches `IMAGE`, waits up
   to `UPGRADE_TIMEOUT` (1200 s) for the server, reads its log for workspaces that did not migrate, starts the worker
   and runs the smoke test. Any failure restores the pre-upgrade backup by itself.

   To watch from a second terminal: `tail -f /opt/inventivecrm/platform-twenty/deploy/state/history.log`, and in
   `deploy/`, `docker compose logs -f server`.

## After

1. `upgrade.sh` ends with `upgrade: done, running <image>; backup <dir>`. If it ends with `rolled back to <old image>`,
   production is back on the old image and data: read the reason in `deploy/state/history.log`, keep the notice up
   until the smoke test below passes, and treat the release as not ready.
2. `/opt/inventivecrm/platform-twenty/deploy/ops/smoke-test.sh` passes, and so does `deploy/ops/health-check.sh`.
3. In the owner workspace, signed in at <https://app.crm.inventiveweb.studio> (or <http://app.localhost:3000> through
   the SSH tunnel while production is in local mode):
   - Settings, General: the About section names the new version, and its source link opens the pushed tag.
   - Settings, Apps: every app is still listed with the same version as before (an image upgrade does not touch apps).
   - People and Companies open, one record of each opens, and search finds it.
   - Each app screen opens once, which runs app code on the new image: an invoice in Quotes & Invoices, an active
     appointment type's booking page (`/s/book/<slug>`) in a private window, the Feedback overview, Campaign Studio,
     and Team chat (post in #general).
   - Settings, Accounts, Applications, Quotes & Invoices: the Stripe and Revolut pages open. Do not replace a key.
   - One workflow and its last runs open.
4. One client: open the workspace of a client agreed beforehand (owner input), repeat the record and app screen
   checks, and ask them to confirm. Then lift the notice.
5. The next morning: the nightly backup ran on the new image
   (`grep 'backup nightly: starting' /opt/inventivecrm/platform-twenty/deploy/state/history.log | tail -1`), and
   `deploy/ops/health-check.sh` reported nothing.
6. Finish UPDATES.md step 6: `upstreamTag`, the `IMAGE` in `deploy/.env.example`, `branding/overrides/previous/` and
   the `newIn` flags. Keep the old image: backups still name it (UPDATES.md rule 8).

## Rolling back later

For a problem found after the window, for example the next day:

```bash
/opt/inventivecrm/platform-twenty/deploy/ops/restore.sh latest-pre-upgrade
```

It puts every workspace back to the pre-upgrade backup, with the old image. Everything clients entered since the
upgrade is then only in the `before-restore` backup it takes first, so agree it with them beforehand. It needs the old
image on this server and the same `ENCRYPTION_KEY` in `deploy/.env`. Restoring one client only is a manual job
(UPDATES.md, "Backups").
