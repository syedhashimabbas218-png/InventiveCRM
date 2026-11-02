# platform-twenty

Build pipeline that rebrands [Twenty](https://github.com/twentyhq/twenty) for our managed CRM service.

This repository holds only our patches, scripts and brand config. It does not contain the Twenty source. The workflow checks out a pinned upstream tag at build time, applies the branding and builds the Docker image.

## Licence notes

- Twenty is licensed under AGPLv3, with some files under a commercial licence (`@license Enterprise`). Our scripts never modify, copy or publish those files; `apply.mjs` skips them and lists them in its report.
- Each deployed image is built from an upstream tag plus the patches in this repository at a matching tag. The source offer shown in the app points at that tag.
- Twenty is a trademark of Twenty.com PBC. We do not use the Twenty logo. The only mention of Twenty in the product is the About text in `branding/brand.config.json`.
- Legal text naming Twenty.com PBC (the DPA files) is left unchanged. Twenty's DPA does not cover self-hosted deployments; clients need our own.

## Layout

```
branding/
  brand.config.json   product name, URLs, About text, pinned upstream tag
  assets/             logo and icon sources (not chosen yet)
  rules.mjs           scan roots, protected paths and matchers shared by both scripts
  apply.mjs           the patch tool (dry run by default)
  leak-scan.mjs       fails if "Twenty" shows in pages, emails, the PWA manifest or the 2FA label
  overrides/          small hand patches (*.patch), applied with git apply
.github/workflows/rebrand.yml
```

## Usage

```bash
git clone --depth 1 --branch twenty/v2.55.0 https://github.com/twentyhq/twenty upstream
```

```bash
node branding/apply.mjs --upstream ./upstream
```

```bash
node branding/apply.mjs --upstream ./upstream --write --report rebrand-report.json
```

```bash
node branding/leak-scan.mjs --upstream ./upstream
```

The dry run prints files and lines it would change, files skipped with the reason, ambiguous matches left for review, targets that no longer match upstream, and whether each override applies. It exits non-zero if a target or override no longer matches.

The product name is the single `productName` value in `brand.config.json`. Upstream tags are named `twenty/vX.Y.Z`; always pin one, never build from a branch.
