# InventiveWeb native workspace

Native Twenty application and pinned Coolify staging deployment. App version **0.3.0**;
required server and SDK **2.43.0**.

This directory is independently installed with npm. The surrounding Twenty fork currently
reports SDK 2.15.0; it is not a qualified server for this app. The provided Dockerfile builds
the reviewed upstream 2.43.0 revision and applies our branding. It does not build the outer
fork checkout or upgrade any existing database automatically.

## Run locally

```bash
cd inventiveweb/apps/inventiveweb
npm ci
npm run typecheck
npm test
npm run pack:app
npm run verify:manifest
```

## Implemented

- Native form editor with conditional questions, required rules and customer/staff visibility.
- Publish a reviewed saved form into an append-only revision. Publishing checks the signed-in
  member's native update permission and rejects stale drafts. Unique native indexes make
  retry/concurrent requests converge on one publication.
- Choose a published appointment form for a booking service, under the caller's native
  permissions. A conditional update rejects a concurrently changed form association.
- Initial module roles and native schemas for appointments, quotes and invoices.
- InventiveWeb customer-facing branding across login, settings, emails, API presentation, AI wording, help and legal destinations; pinned image recipe and corresponding-source archive.
- Coolify stack and native-app/branding CI workflows.

Publishing does not accept customer answers or create appointments. Live Google/Microsoft
availability, public booking embeds, customer document views, invoices, bookkeeping and
superadmin MCP management remain pending. The staging gateway denies MCP until its access
boundary is implemented. Independent Growth & Reports, Automations and Websites stay outside.

## Review and deploy

- [Publishing behavior and boundaries](docs/implementation/form-publishing.md)
- [White-label coverage and boundaries](docs/implementation/white-label.md)
- [Verification](docs/implementation/verification.md)
- [Coolify runbook](docs/implementation/coolify.md)
- [Staging acceptance](docs/implementation/acceptance.md)
- [Agreed scope](docs/implementation/scope.md)

No Docker engine or staging credentials are available in the development environment. The
SDK build and local tests do not replace installation, browser and cross-workspace tests.
For a first deployment use a fresh, operator-only staging database. Do not point the new
image at an existing Twenty database until its supported upgrade path and backup are verified.

The native app is AGPL-3.0-only. Upstream licences and Enterprise boundaries are preserved.
The earlier independent platform API and private project history are not included in this
public repository import.
