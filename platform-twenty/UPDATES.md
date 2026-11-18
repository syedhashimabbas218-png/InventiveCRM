# Updates, backups and rollback

How InventiveCRM moves to new versions without losing client data. The scripts in `deploy/ops/` enforce most of these rules; the rest are checklist items.

## The three layers

| Layer | What changes it | Rollback |
|---|---|---|
| Twenty core + our branding patches (the Docker image) | A new upstream tag, built on the server by `deploy/ops/auto-update.sh` | Restore the pre-upgrade backup (database, files, DKIM keys and the old image together) |
| Quotes & Invoices and Scheduling apps | `app publish`, then `app install` per workspace | Fix forward with a new release. Installing the previous version again deletes everything the newer one added (fields, indexes, functions) with the data in them; the plan lists it and `check-app-plan.mjs` refuses it. Measured for the 18 November releases: 5 to 21 items per app. Use it only in an emergency, after a backup |
| Each client's own setup (fields, views, workflows made by prompt) | Data in the database | Comes back with any database restore |

Production never upgrades on its own: images are pinned by tag and private app installs have auto-upgrade switched off. Everything before that last step is automatic. Every Monday night the server runs `deploy/ops/auto-update.sh` (cron). When Twenty has a newer release than production runs, it rebrands a throwaway checkout, runs the leak scan, builds the image on the server, upgrades a sealed copy of the newest backup with it and checks that no table lost rows, then runs every app suite against an upgraded copy of the test stack. The verdict (`ready`, `not-ready` or `up-to-date`) goes to `deploy/state/update-status.json`; `deploy/ops/auto-update.sh --status` prints it with the command to run next. While a release is waiting, both rehearsals are repeated every week on the newest backup.

The weekly `platform-twenty upstream watch` workflow on GitHub is the notice that a release is out. It rebrands a throwaway copy, runs the leak scan and says whether we are ready to build, in the run summary and in an issue. While Issues are switched off for the repository (the default on a fork) the run fails instead, and that failed run is the notice. It also runs on every push that touches `branding/`.

## Rules

1. **Pin everything.** Images are `platform-twenty:X.Y.Z-pN` (Twenty's version, then our build number for it), never `latest`. `upgrade.sh` refuses an unpinned tag. Images are built on the server and are not pushed anywhere.
2. **Never move backwards in place.** Twenty migrates the database on start and has no supported downgrade. Going back always means restoring the backup taken before the upgrade; `upgrade.sh` refuses an older version.
3. **No upgrade without a fresh, verified backup.** `upgrade.sh` stops the stack, backs up, verifies checksums and readability, and only then switches the image.
4. **A failed upgrade rolls itself back.** If the server is not healthy within `UPGRADE_TIMEOUT`, a workspace fails to migrate (the image keeps starting even then, so the script reads its log), or the smoke test fails, `upgrade.sh` restores the pre-upgrade backup.
5. **A restore never destroys data.** `restore.sh` first backs up the current state (label `before-restore`). Work done after an upgrade that is then rolled back is in that backup.
6. **Rehearse first, on copies.** `rehearse-data.sh <image>` restores the newest backup into throwaway containers on a network with no way out and no worker, so the copy cannot reach production's database or send anything to a customer; it lets the new image migrate that copy and fails if a workspace did not migrate or any table in a workspace has fewer rows than before. `rehearse-apps.sh <image>` copies the test stack, upgrades the copy and runs `tests/run-all.sh` against it. The suites delete records and refuse the address in `deploy/.env` and loopback port 3000 (`tests/guard.cjs`); on a staging server restored from a production backup, pass `ALLOW_DESTRUCTIVE_TESTS=<that address>`.
7. **`ENCRYPTION_KEY` never changes.** It decrypts connected mailboxes, app secrets and 2FA. Backups store a fingerprint of it, never the key, and `restore.sh` refuses a mismatch. Keep `.env` in the password manager; a backup is useless without it.
8. **Keep old images.** Never delete an image tag that a backup's `manifest.json` still names; `restore.sh` needs it and there is no registry to pull it from. `auto-update.sh` removes only superseded images it built itself that neither production, the test stack nor any backup names.
9. **App releases never remove objects or fields.** On upgrade the server deletes whatever the new version no longer declares, with its data, in every workspace. Run `twenty app plan --json | node scripts/check-app-plan.mjs` against the owner workspace before every publish; it fails on any deletion. Add fields, or stop using old ones.
10. **One client first.** Install a new app version in our own workspace, then one client, then the rest.
11. **Upgrades happen in a maintenance window.** The CRM is offline while it migrates (the data rehearsal logs how long the copy took). Announce it to clients.
12. **Never sync this repository's `main` from upstream Twenty.** The build always downloads the pinned upstream tag, so it never needs it. A sync brings back Twenty's own workflows (deploys to their cloud, translation and AI-catalog syncs), which fail here without their secrets and use our Actions minutes. The only workflows here are `platform-twenty-rebrand.yml` and `platform-twenty-upstream-watch.yml`.

## Backups

`deploy/ops/backup.sh nightly` (cron example in `deploy/ops/crontab.example`) writes `$BACKUP_DIR/<UTC time>-<label>/`:

| File | Contents |
|---|---|
| `db.dump` | the whole Postgres database (every workspace), `pg_dump` custom format |
| `storage.tar.gz` | uploaded files: PDFs, attachments, avatars |
| `mail-dkim.tar.gz` | the DKIM keys behind our DNS records |
| `manifest.json` | time, label, image and its digest, database, `ENCRYPTION_KEY` fingerprint |
| `SHA256SUMS` | checksums of the above |

A backup is only renamed into place after it verifies, so a half-written one never looks complete. Nightly backups are kept `BACKUP_RETENTION_DAYS` (30); pre-upgrade and before-restore backups are kept until removed by hand. Set `BACKUP_OFFSITE_COMMAND` so every backup is also copied off the server (restic or rclone to another provider), and run `verify-backup.sh latest --full` monthly: it restores into a throwaway Postgres and counts the workspaces.

Restoring one client only (everyone else keeps their newer data) is a manual job: restore the backup into a throwaway database with `verify-backup.sh --full`'s method, then copy that client's `workspace_*` schema across. Ask before doing it.

## Upgrading Twenty

1. The upstream watch (its issue, or its failed run while Issues are off) says a release is out. By the next Monday morning the server has built and rehearsed it: `deploy/ops/auto-update.sh --status` gives the verdict, and the output of each stage is under `/var/lib/inventivecrm-update/logs/`. To not wait for Monday, run `deploy/ops/auto-update.sh` by hand; it takes about an hour and leaves production alone.
2. If it says not ready, the status names the stage. Branding that no longer fits is fixed in `branding/`: a patch rewritten for the new release keeps its old version in `branding/overrides/previous/`, and a rebrand target in a file the old release does not have gets `newIn` in `apply.mjs`, so the release production runs can still be built. Lost rows or a failed app suite mean the release is not safe for us yet; read the stage's log before anything else. Then run `auto-update.sh` again.
3. Read Twenty's release notes for breaking changes.
4. Push the tag `X.Y.Z-pN` the status gives (the commit the image was built from). The About text in the app links to it as the source of the running version, which the AGPL requires.
5. Production, in the window, following [docs/upgrade-checklist.md](docs/upgrade-checklist.md): a fresh backup, then `deploy/ops/pre-upgrade-check.sh`, which must say GO, then the command the status gives, `deploy/ops/upgrade.sh platform-twenty:X.Y.Z-pN`. It takes its own backup and rolls back by itself on failure. Add `--yes` only in automation.
6. Update `upstreamTag` in `branding/brand.config.json` and the `IMAGE` in `deploy/.env.example`, then delete `branding/overrides/previous/` and the `newIn` flags in `apply.mjs`. The test stack moves to the new image by itself at the next rehearsal.

The stages also run on their own: `build-image.sh <twenty/vX.Y.Z> <image>`, `rehearse-data.sh <image> [backup]`, `rehearse-apps.sh <image>`. The `platform-twenty rebrand and build` workflow on GitHub builds the same image and pushes it to a registry with a release; it is only needed if images are ever served from a registry instead of built on the server.

To roll back by hand later (for example a problem found the next day): `deploy/ops/restore.sh latest-pre-upgrade`. Anything clients entered since the upgrade is then only in the `before-restore` backup, so decide with them first.

## Releasing an app

The same steps for every app under `apps/`:

| App | Folder | Application id |
|---|---|---|
| Quotes & Invoices | `apps/commercial-docs` | `93ae1d55-5c54-4fac-922b-fd9fa4a69ab5` |
| Scheduling | `apps/scheduling` | `54c65493-4e80-4efa-824a-456671383c86` |
| Feedback | `apps/feedback` | `f69757a9-c451-4ac3-8042-79a99ad8e749` |
| Campaign Studio | `apps/campaigns` | `992fae47-c2c3-4731-b8aa-ebdcdb466631` |
| Team chat | `apps/team-chat` | `6c6eba62-6fc2-487e-a212-3b8b01bb4365` |
| WhatsApp | `apps/whatsapp` | `23e5cd3d-e631-461b-9e06-849c0a577688` |

1. Bump `version` in the app's `package.json`; run `scripts/check-apps.sh <app>` (`yarn install --immutable`, `yarn typecheck`, `yarn test`), then the end-to-end suites on the throwaway test server with `tests/run-all.sh`. Each app commits its `yarn.lock` (the CLI will not build without one) and pins every dependency exactly. Yarn 4.18 refuses packages published in the last few days, so a brand-new SDK release can only be used once Yarn accepts it.
2. `npx twenty@2.54.3 app plan --remote owner --json | node ../../scripts/check-app-plan.mjs`: must report 0 to destroy.
3. `npx twenty@2.54.3 app publish --private --remote owner`.
4. `app install --universal-identifier <app id>` in our workspace, check, then one client, then the rest.
5. Scheduling only: navigation items cannot change what they point at. To repoint one, give it a new id; the plan then destroys the old item, which holds no client data, so pass `--allow navigationMenuItem` to `check-app-plan.mjs`. It still refuses any other deletion, and never allows objects or fields.

## Rehearsal record

On 3 November 2026 the scripts were run against our `deploy/docker-compose.yml` with the official Twenty images v2.53.1 and v2.54.0:

- nightly backup and full restore drill
- upgrade to v2.54.0 in 1m39s, with data and files intact
- rollback to v2.53.1 restored the exact pre-upgrade data and file; post-upgrade work was kept in the `before-restore` backup
- a forced failed upgrade rolled itself back with no data lost
- `latest`, a downgrade, a changed `ENCRYPTION_KEY`, no backups, and two operations at once were all refused
- `check-app-plan.mjs` blocked an app release that removed one field (4 items would have been destroyed)

On 17 November 2026 the automatic pipeline ran end to end for Twenty 2.59.3, from cron's environment:

- `build-image.sh` rebranded and built `platform-twenty:2.59.3-p1` on the server. Twenty's translation step only passed once its worker start-up limit was raised for the build stages; the setting does not reach the image.
- `rehearse-data.sh` upgraded a sealed copy of the nightly backup from 2.55.0 in 200 s. All 123 tables kept their rows; four empty workflow tables were removed by the upgrade. The smoke test passed on the copy.
- `rehearse-apps.sh` failed, as it should have. Twenty 2.59 requires a signed-in browser session and a browser cookie for app connections (`/auth/apps/authorize`), so the suites' connect steps for Resend, Stripe, Revolut and the calendar reconnect stop there. The verdict was `not-ready`; production stayed on 2.55.0.

