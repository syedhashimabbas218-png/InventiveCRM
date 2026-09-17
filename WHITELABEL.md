# InventiveCRM White-Label Manifest

This repository (`syedhashimabbas218-png/InventiveCRM`) is a fork of [Twenty](https://github.com/twentyhq/twenty), the open-source CRM.

## License and compliance

- Upstream project: Twenty by Twenty.com, PBC, licensed under the **GNU Affero General Public License v3.0 (AGPLv3)**.
- This fork modifies Twenty only for white-labeling (see list below). As a modified version of Twenty, the AGPLv3 applies in full to this repository.
- This repository is **public** so that anyone interacting with the deployed modified version over a network can obtain its source (AGPLv3 §13).
- The upstream `LICENSE` file has been preserved unchanged.
- Files marked with `/* @license Enterprise */` in upstream Twenty have **not** been modified in this fork.

## Branding changes

The following files were modified from upstream to replace "Twenty" branding with "InventiveCRM" and the InventiveCRM icon:

- `packages/twenty-front/index.html` — page title, OpenGraph/Twitter titles, social-card URL.
- `packages/twenty-front/public/manifest.json` — PWA name and short_name.
- `packages/twenty-front/public/images/icons/*` — 96 app/PWA icon sizes generated from the InventiveCRM mark.
- `packages/twenty-front/src/pages/auth/SignInUp.tsx` — welcome string.
- `packages/twenty-front/src/modules/ui/navigation/navigation-drawer/constants/DefaultWorkspaceLogo.ts` — default workspace logo URL.
- `packages/twenty-emails/src/components/Footer.tsx` — email footer links and corporation line.
- `packages/twenty-emails/src/components/Logo.tsx` — email logo URL and alt text.
- `packages/twenty-emails/src/components/BaseHead.tsx` — email HTML title.
- `packages/twenty-emails/src/constants/DefaultWorkspaceLogo.ts` — default email workspace logo URL.
- `packages/twenty-front/src/locales/*` and `packages/twenty-server/src/engine/core-modules/i18n/locales/*` — lingui message values where "Twenty" appeared as a standalone word (keys are hashes and were not modified).

## How to update

Upstream changes are merged via a monthly pinned ritual:

1. Fetch latest upstream tag (e.g., `twenty/v2.41.0`).
2. Reapply the `[whitelabel] brand overrides` commit on top.
3. Re-run `rebrand.py` (idempotent) and regenerate icons.
4. Build Docker image, deploy to staging, run smoke tests, then promote.

## Support

Open an issue in this repository with the `[whitelabel]` prefix.