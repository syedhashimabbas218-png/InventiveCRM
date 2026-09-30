# Coolify on Contabo — first staging deployment

The stack is prepared for operator-only staging. It has not been started in Docker in the
development environment. Complete [acceptance.md](acceptance.md) before onboarding clients.

Run all commands from the `inventiveweb/` directory unless stated otherwise.
The surrounding repository fork is older than the required server. Use a fresh staging
database first; verify the supported upstream upgrade sequence before any existing database
is attached to 2.43.0.

## Inputs still needed

- Git repository: `syedhashimabbas218-png/InventiveCRM`. Select the reviewed feature branch
  for staging until it is merged. A container registry/image namespace is still needed.
- Coolify project/server access, workspace domain and DNS pointing at the Contabo server.
- Server architecture, available RAM/storage, and whether a separate build runner is available.
- SMTP credentials and public support/terms/privacy/DPA URLs owned by InventiveWeb.
- Google/Microsoft application credentials when calendar integration testing starts.

Do not paste production secrets into a public repository. Enter runtime values in Coolify.

## Build the branded image

Use a Linux Docker BuildKit builder. The upstream frontend build configures an 8 GiB Node heap;
build off the production VPS unless its spare memory can accommodate this plus the other stages.
The upstream source, Node image and SDK are pinned in `branding/upstream.json` and the Dockerfile.

Copy `infrastructure/coolify/build.env.example` to a private local build environment file and
replace the public URLs. The branding build rejects `.invalid` placeholders. PUBLIC_APP_URL must
be the actual HTTPS origin, without a path. The same origin is required at runtime.

```bash
# These values are PUBLIC build settings, never credentials.
export PUBLIC_APP_URL=https://workspace.your-domain.com
export INVENTIVEWEB_WEBSITE_URL=https://inventiveweb.studio
export INVENTIVEWEB_SUPPORT_URL=https://your-domain.com/support
export INVENTIVEWEB_TERMS_URL=https://your-domain.com/terms
export INVENTIVEWEB_PRIVACY_URL=https://your-domain.com/privacy
export INVENTIVEWEB_DPA_URL=https://your-domain.com/dpa

docker buildx build --load --target twenty \
  -f infrastructure/coolify/twenty.Dockerfile \
  --build-arg APP_VERSION=2.43.0 \
  --build-arg PUBLIC_APP_URL \
  --build-arg INVENTIVEWEB_WEBSITE_URL \
  --build-arg INVENTIVEWEB_SUPPORT_URL \
  --build-arg INVENTIVEWEB_TERMS_URL \
  --build-arg INVENTIVEWEB_PRIVACY_URL \
  --build-arg INVENTIVEWEB_DPA_URL \
  -t ghcr.io/YOUR_ORG/inventiveweb-twenty:2.43.0-iw.1 .
docker push ghcr.io/YOUR_ORG/inventiveweb-twenty:2.43.0-iw.1
```

Save the digest printed by the push. Deploy `ghcr.io/...@sha256:...`, not `latest`.
The optional manually triggered `inventiveweb-twenty-image.yml` GitHub workflow performs this build/push.
Publishing that workflow is not evidence it has run successfully.

The built image serves `/inventiveweb/source.html`, the upstream licence, and
`/inventiveweb/source.tar.gz`. The archive contains the complete patched upstream source,
lockfiles, native app source/licence and our public build tooling. Install the native app
from the same repository revision as this image. Rebuild the image/source offer with every
app release so the offered app source matches the deployed app. The archive is generated
before dependency installation;
production credentials are never build arguments. Retain the source and image digest for
every release, including when the deployment is rolled back.

## Create the Coolify resource

1. Add the Git repository to your Contabo-backed Coolify project as an **Application**.
2. Build Pack: **Docker Compose**. Base directory: `/inventiveweb`.
   Compose location: `/infrastructure/coolify/compose.yaml`.
3. Assign a domain ONLY to `gateway`: `https://workspace.your-domain.com:8080`.
   The `:8080` selects the internal port; customers still connect over ordinary HTTPS.
   Do not assign domains to server, worker, db or redis. Do not add host port mappings.
4. Add the runtime variables from `infrastructure/coolify/.env.example` in Coolify.
   Set INVENTIVEWEB_IMAGE to the pushed branded-image digest; add registry credentials in
   Coolify if it is private. Generate distinct 32-byte random hex values for PG_PASSWORD,
   REDIS_PASSWORD, APP_SECRET and ENCRYPTION_KEY. Hex database/Redis passwords avoid URL escaping.
5. Keep IS_MULTIWORKSPACE_ENABLED=false for initial operator-only staging. Keep both calendar
   providers disabled until their credentials/callbacks are configured. The single-workspace
   initial user becomes the server administrator: reserve first signup for the operator.
6. Deploy. Watch server migration logs, then worker logs. Migrations fail startup on error.
   The worker neither migrates nor registers cron jobs. Server registers upstream cron jobs.
7. Verify `/healthz`, HTTPS, login and all three persistent volumes. Finish initial signup
   before exposing staging broadly. The gateway intentionally denies MCP routes at this stage.

Normal Coolify Compose mode manages proxy labels/networks. Leave Raw Compose disabled.
The public edge is the gateway; direct access to the private server bypasses its MCP denial.

## Install the native application

From a development machine with Node 24.5+:

```bash
cd apps/inventiveweb
npm ci
npm run typecheck
npm test
npm run build
npx twenty remote:add --url https://workspace.your-domain.com --as inventiveweb-staging
npx twenty plan . --remote inventiveweb-staging --no-delete
npx twenty apply . --remote inventiveweb-staging --no-delete
```

Authenticate as the InventiveWeb operator in the browser opened by the CLI. Do not use
`--force` for destructive metadata changes. Verify the app registration belongs to the
operator workspace. Open Form builder from the sidebar, create a draft, save, reload and
confirm it persists. Configure a Booking service and link its form using native records.

The app can also be packed with `npm run pack:app`. Building a tarball does not install it.
Use the CLI's supported install/publication process; do not invent a file-upload UI.

## Calendar connection configuration

Register InventiveWeb-owned Google and Microsoft applications. Configure these callbacks:

- Google: `https://workspace.your-domain.com/auth/google-apis/get-access-token`
- Microsoft: `https://workspace.your-domain.com/auth/microsoft-apis/get-access-token`

Set the corresponding client ID/secret and enable the calendar provider in Coolify.
Separate sign-in callback variables are included but social sign-in is off by default.
Provider verification, scope consent and live free/busy/booking are separate pending gates.
Do not regard a successful account connection as proof our appointment flow is complete.

## Operations and promotion

- Keep APP_SECRET and ENCRYPTION_KEY stable; back them up separately and securely.
- Back up Postgres and server-local-data to storage outside this VPS. Keep Redis AOF persistent
  because queues are not disposable. A named volume on the same VPS is not a backup.
- For a consistent first backup, stop ingress writes and workers, then back up DB and uploads.
  Restore into an isolated staging stack and verify records/files before relying on the backup.
- Before changing Twenty versions: back up, apply the patch to the new reviewed revision,
  build a new image, test migrations and the app on a copy, then promote by digest.
- After schema migrations, rolling back the image alone is insufficient; restore a matching
  DB/files snapshot if backwards compatibility has not been established.
- Do not onboard customers until the superadmin integration gate, role assignments and
  cross-workspace isolation are verified. Initial native MCP settings are NOT our final gate.
- For multiple businesses, enable multiworkspace only after qualification, configure wildcard
  DNS/proxy routing, explicitly assign the platform superadmin, and install the app per workspace.
  Workspace roles and plan-dependent row permissions are distinct from tenant isolation.

Official references:
- https://coolify.io/docs/applications/builds/docker-compose
- https://docs.twenty.com/developers/self-host/capabilities/setup
- https://docs.twenty.com/developers/extend/apps/operations/cli
- https://github.com/twentyhq/twenty/tree/twenty/v2.43.0
