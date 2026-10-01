# ADR 014: Branded Twenty distribution and Coolify

Date: 2026-09-30
Status: Accepted for implementation; staging qualification pending

Supersedes the no-core-fork restriction in ADR 002 for branding only.

The user requires InventiveWeb branding throughout the customer experience and actual native
Twenty Apps for business features. Inspection of Twenty 2.43.0 identified hard-coded platform
identity in HTML, assets, login and emails. The implementation applies a small, reviewed patch
to a pinned upstream commit. Each modified file is hashed in a build manifest. Existing source
modifications or a different upstream revision cause patch application to stop.

The Docker build follows upstream's server/frontend stages, preserves licensing, and serves
its complete patched source and build tooling from the resulting image. No blanket source-code
string replacement is used. Authorization, migrations and Enterprise markers are not renamed
or bypassed. The replacement container entrypoint fails startup when migrations fail.

Coolify on Contabo manages a Compose deployment. Only the gateway receives a public domain;
server, worker, Postgres and Redis use the resource's private service network. Source-heavy
builds may run separately and deployment uses a promoted image digest.

The initial deployment is operator-only staging. Initial MCP access is disabled at the gateway
pending the actual superadmin configuration boundary; this is not presented as completed MCP
support. A security/permission review and full branding acceptance precede client onboarding.

Native business features stay in `apps/inventiveweb`. Independent Growth & Reports,
Automations and Websites are explicitly outside the Twenty workspace.
