# InventiveWeb white-label distribution

Implemented against Twenty 2.43.0 at `87339fe7489c3a3c0ea72aad593a2a538357291c`.
This is a source/build implementation, not a claim that a customer deployment is live.

## Customer surfaces

| Surface | Behavior |
| --- | --- |
| Browser title, metadata, PWA, login, onboarding and workspace fallback logos | InventiveWeb identity and supplied artwork; favicon has a white backing for dark/light browser themes |
| Settings, import headings, activity author, AI model descriptions | InventiveWeb copy |
| Invite, verification, password and lifecycle emails | InventiveWeb copy, sender labels, images, subjects and operator links |
| Authenticator enrollment | InventiveWeb issuer; existing secrets and authentication verification are unchanged |
| Help and community | Native InventiveWeb help screen and a bundled workspace guide; operator support/website destinations |
| Settings discovery cards and tutorials | InventiveWeb cards and help links; upstream screenshot/video promotions removed from rendered components |
| Legal and generate-DPA routes | Operator terms/privacy/DPA links; neither route generates or relabels a Twenty-signed document |
| Onboarding trust badges | Upstream SOC2/GDPR promotional badges are not inherited |
| AI and MCP presentation | InventiveWeb prompt identity, installer labels and metadata; the upstream published ChatGPT app is not advertised as an InventiveWeb connector |
| OpenAPI presentation | InventiveWeb title, contact and terms; source/licence link retained |
| Translated branded copy | 34 catalogs per frontend, emails and server; changed branding messages use reviewed English pending localization, with unrelated translations retained |
| Deployment defaults | Upstream telemetry, analytics, remote company-icon requests and hosted support chat disabled |

The original artwork is preserved. The favicon and native logos wrap it in a light background;
no new logo or third-party certification is invented.

## What deliberately retains its real identity

- Source/licence notices and the complete corresponding-source download identify the upstream
  project and preserve its licence and Enterprise markers.
- Operator-only Enterprise licensing and upstream version diagnostics remain truthful.
- Real third-party package provenance, the actual SDK CLI, internal identifiers, database
  metadata and signed `X-Twenty-Webhook-*` headers retain their compatibility names.
- Original DPA templates/archive components remain in upstream source, with original document
  names. The customer legal routes use operator links. Server DPA APIs have not been repurposed
  as InventiveWeb agreement signing.
- Optional example people retain their sample avatar URLs. Existing customer data, custom
  workspace names, previously sent emails and installed third-party app descriptions are not
  rewritten by a build. Review existing data separately when migrating a workspace.

This is white-label customer presentation, not concealment of the underlying open-source
software from source inspection or developer tools. No licence or Enterprise access check is
removed. MCP remains denied by the staging gateway until superadmin enforcement is implemented.

## Build configuration

Set the real workspace, website, support, terms, privacy and DPA URLs using
`infrastructure/coolify/build.env.example`. They are public build arguments, not secrets.
Production branding rejects `.invalid` placeholders. The legal content itself must be supplied
by the operator; this change does not invent terms or an executed DPA.

Google and Microsoft consent screens belong to the operator's OAuth app registrations. Set
InventiveWeb as the app display name, upload the supplied logo, configure the verified domain,
support/privacy URLs, and use the callbacks in the Coolify runbook. Consent branding cannot be
changed from the CRM's source and has not been configured in external provider accounts.

Existing authenticator entries may retain their old label until the user renames them. Changing
the displayed issuer for new enrollment does not rotate TOTP secrets or invalidate existing OTPs.

## Reproduce verification

Use a clean checkout of the pinned upstream, with frontend, email, server source, shared/UI and
Docker packages present. From this directory:

```bash
npm ci --prefix apps/inventiveweb
node scripts/branding/apply.mjs /path/to/pinned-upstream --development
node scripts/branding/verify.mjs /path/to/pinned-upstream
node scripts/branding/check-source.mjs /path/to/pinned-upstream
node scripts/branding/test-pipeline.mjs /path/to/pinned-upstream
```

Do not deploy a development branding build. The production Docker build runs without
`--development`, verifies asset/source hashes, extracts/compiles Lingui catalogs through the
pinned upstream build, and bundles matching source.

Local results: 191 patched files (86 TS/TSX and 102 PO catalogs), five generated public assets,
15,322 runtime source files scanned, nine guard checks pass. The scanner's explicit exceptions
are documented in `check-source.mjs`; it rejects unexpected runtime branding rather than
rewriting all code identifiers. The GitHub branding workflow reproduces these checks on a clean
pinned checkout.

Full Nx lint/typecheck could not run locally because Yarn and the full upstream dependency tree
are unavailable. TypeScript parse checks do not replace framework typechecking. Full Docker
build, Lingui extraction/compilation, native-host browser checks, external consent screens and
real email delivery still require staging qualification. Use the acceptance checklist before
client onboarding; do not mark those gates passed based on this source audit.
