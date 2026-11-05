# Updates, backups and rollback

How InventiveCRM moves to new versions without losing client data. The scripts in `deploy/ops/` enforce most of these rules; the rest are checklist items.

## The three layers

| Layer | What changes it | Rollback |
|---|---|---|
| Twenty core + our branding patches (the Docker image) | A new upstream tag, built by the `platform-twenty rebrand and build` workflow | Restore the pre-upgrade backup (database, files, DKIM keys and the old image together) |
| Quotes & Invoices and Scheduling apps | `app publish`, then `app install` per workspace | Install the previous version again; data stays because releases never delete anything (rule 9) |
| Each client's own setup (fields, views, workflows made by prompt) | Data in the database | Comes back with any database restore |

Nothing updates on its own. Images are pinned by tag, private app installs have auto-upgrade switched off, and the weekly `platform-twenty upstream watch` workflow only opens an issue when Twenty ships a release, saying whether our branding still applies.

## Rules

1. **Pin everything.** Images are `ghcr.io/<owner>/platform-twenty:X.Y.Z-pN`, never `latest`. `upgrade.sh` refuses an unpinned tag.
2. **Never move backwards in place.** Twenty migrates the database on start and has no supported downgrade. Going back always means restoring the backup taken before the upgrade; `upgrade.sh` refuses an older version.
3. **No upgrade without a fresh, verified backup.** `upgrade.sh` stops the stack, backs up, verifies checksums and readability, and only then switches the image.
4. **A failed upgrade rolls itself back.** If the server is not healthy within `UPGRADE_TIMEOUT`, a workspace fails to migrate (the image keeps starting even then, so the script reads its log), or the smoke test fails, `upgrade.sh` restores the pre-upgrade backup.
5. **A restore never destroys data.** `restore.sh` first backs up the current state (label `before-restore`). Work done after an upgrade that is then rolled back is in that backup.
6. **Rehearse on staging first.** Staging is a second server restored from last night's production backup (`restore.sh <backup>` with production's `ENCRYPTION_KEY`). Run the upgrade there and the test suites (`tests/multitenant`, `tests/commercial-docs`, `tests/scheduling`), then production.
7. **`ENCRYPTION_KEY` never changes.** It decrypts connected mailboxes, app secrets and 2FA. Backups store a fingerprint of it, never the key, and `restore.sh` refuses a mismatch. Keep `.env` in the password manager; a backup is useless without it.
8. **Keep old images.** Never delete an image tag that a backup's `manifest.json` still names; `restore.sh` needs it.
9. **App releases never remove objects or fields.** On upgrade the server deletes whatever the new version no longer declares, with its data, in every workspace. Run `twenty app plan --json | node scripts/check-app-plan.mjs` against the owner workspace before every publish; it fails on any deletion. Add fields, or stop using old ones.
10. **One client first.** Install a new app version in our own workspace, then one client, then the rest.
11. **Upgrades happen in a maintenance window.** The CRM is offline while it migrates (about 2 minutes in the rehearsal, longer with more data). Announce it to clients.
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

1. The upstream watch issue (or Twenty's release notes) says a release is out. Read the notes for breaking changes.
2. Run the build workflow with `dry_run: true` and the new tag. If branding targets or patches no longer match, fix them in `branding/` first.
3. Run it without dry run. It builds `platform-twenty:X.Y.Z-pN`, pushes it and creates release `X.Y.Z-pN` (the source offer in the app links there).
4. Staging: `deploy/ops/upgrade.sh ghcr.io/<owner>/platform-twenty:X.Y.Z-pN`, then the test suites.
5. Production, in the window: the same command. Add `--yes` only in automation.
6. Update `upstreamTag` in `branding/brand.config.json` and the `IMAGE` in `deploy/.env.example`.

To roll back by hand later (for example a problem found the next day): `deploy/ops/restore.sh latest-pre-upgrade`. Anything clients entered since the upgrade is then only in the `before-restore` backup, so decide with them first.

## Releasing an app

The same steps for Quotes & Invoices (`apps/commercial-docs`, id `93ae1d55-5c54-4fac-922b-fd9fa4a69ab5`) and Scheduling (`apps/scheduling`, id `54c65493-4e80-4efa-824a-456671383c86`).

1. Bump `version` in the app's `package.json`; run `yarn install --immutable`, `yarn test` and `yarn typecheck`. Each app commits its `yarn.lock` (the CLI will not build without one) and pins every dependency exactly. Yarn 4.18 refuses packages published in the last few days, so a brand-new SDK release can only be used once Yarn accepts it.
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
