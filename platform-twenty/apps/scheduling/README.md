# Scheduling (InventiveCRM app)

Calendly-style scheduling inside the CRM: appointment types, availability, team and location-based assignment, public booking pages and embeds, and two-way sync with Google and Microsoft calendars. It is a Twenty app built with the apps SDK, so it installs per workspace and changes nothing in the core product. Upgrades of Twenty leave it alone, and removing it removes only its own objects.

## Architecture

| Layer | What it is |
|---|---|
| Data | 16 app objects (below). Appointments are ordinary CRM records linked to the person and company, so views, filters, workflows, permissions and the API work on them as on any record |
| Engine | `src/engine/`: pure functions for time zones and DST, working intervals, slot generation, assignment strategies and geography. No I/O, unit tested |
| Services | `src/lib/`: availability search, booking, contact matching, calendar adapters, sync outbox, notifications, signed tokens, rate limits |
| Functions | `src/logic-functions/`: public HTTP routes for booking pages, an authenticated admin route for the UI, database-event handlers for side effects, and three cron jobs |
| UI | Navigation folder **Scheduling**, native views, and three pages built as front components (Overview, Availability, Calendar connections) |
| Calendars | Per-user OAuth connections declared with `defineConnectionProvider`. Twenty runs the OAuth flow, stores tokens encrypted and refreshes them; the app only reads them |
| Maps | Geocoder (Nominatim API), router (OSRM table API) and map tiles, each behind one function in `src/lib/geo/services.ts`, so any compatible service can replace them |

Twenty is the source of truth. Calendar providers receive copies of appointments and are read for busy time; changes made directly in a provider are put back or flagged.

### Objects

Scheduling team, Advisor, Team membership, Office, Availability schedule, Availability override (time off and special hours), Appointment type, Booking link, Appointment, Appointment participant, Slot reservation, Calendar setting, Calendar sync (outbox), Scheduling audit event, Public request counter, Scheduling settings. Person and Company get an **Appointments** relation.

### How double booking is prevented

Each booking claims one **Slot reservation** row per advisor per 5-minute tick it occupies, buffers included, in a single insert. `key` is unique, so two simultaneous bookings for overlapping time cannot both succeed: the database rejects the second and the customer is told the time was just taken. Group sessions claim seat keys instead. Cancelling or moving destroys the old rows (soft-deleted rows would still hold the key). Collective meetings claim for every participant at once.

### Appointment types

An appointment type combines independent settings, so the brief's types are combinations rather than separate code paths:

| Setting | Values |
|---|---|
| Assignment | One named advisor, round robin, first available, customer chooses the advisor, collective (everyone) |
| Round-robin strategy | Equal, weighted, least recently assigned, lightest workload, priority, first available. Manual: change the advisor on the appointment; it is audited, calendars move and both sides are emailed |
| Meeting format | Video call (Google Meet, Microsoft Teams or a fixed link), phone, in person at an office, at the customer's address |
| Location mode | Nearest, fastest travel time, within service radius, postcode territory, first available nearby, customer picks on a map, round robin among nearby advisors |
| Capacity | 1 for one-to-one; more for group sessions (one calendar event for the whole session) |
| Rules | Duration, increments, buffers before and after, minimum notice, horizon, daily and weekly limits, cancellation and reschedule cut-offs, intake questions, approval, reminders, allowed embed domains, verified travel required |

Each assignment decision stores its reason on the appointment (`assignmentReason`) and in the audit trail. Round-robin fairness counts bookings inside the team's fairness window.

### Availability

Weekly hours per advisor in their own time zone, with overrides for time off and special hours, windows that run past midnight, and daily and weekly limits. Times are converted with the platform's time zone database: a time inside a spring-forward gap moves to the first valid minute, and an ambiguous autumn time takes its first occurrence. Busy time from every calendar the advisor selected is subtracted. If a connected calendar cannot be read, that advisor is withdrawn from the offer rather than offered blind.

### Location-based scheduling

Advisors have a base (or an office), a service radius, an optional GeoJSON service area and optional postcode territory (`LS`, `LS6`, `YO`). Customers enter an address; it is geocoded, eligible advisors are filtered by area, radius or territory and ranked by road time from OSRM, or straight-line distance if routing is unavailable. Travel-aware scheduling checks that an advisor can get from the previous visit and on to the next one. Without a router the estimate is marked unverified, and types that require verified travel refuse it. Exact advisor bases are never sent to customers, only a label and a rounded distance.

### Calendar sync

Each provider write goes through the **Calendar sync** outbox. Retries back off after 1, 5, 15, 60 and 240 minutes, up to 8 attempts, then the advisor is emailed. Google event ids are derived from the appointment, and Microsoft writes carry a `transactionId`, so a retry after a timeout never creates a second event. Customers are not added as provider attendees (that would send a second invitation); they receive our email with an ICS file instead. Every 5 minutes the sync job also reconciles upcoming events: an event moved in the provider is moved back and logged, a deleted one is flagged on the appointment.

### Public pages and security

| Route (under the workspace URL) | Purpose |
|---|---|
| `GET /s/book/:slug` | Booking page for an appointment type, booking link or advisor |
| `GET /s/booking/manage/:token` | Reschedule or cancel |
| `POST /s/booking/api` | JSON API used by those pages |
| `GET /s/booking/embed.js` | Inline, popup and floating-button embeds |
| `GET /s/scheduling/map?ticket=` | Staff advisor map (10-minute signed ticket) |
| `POST /s/scheduling/admin` | UI actions, signed-in users only |
| `POST /s/scheduling/sync-now`, `/s/scheduling/reminders-now` | Run the jobs now, signed-in users only |

Manage links are HMAC-signed over a per-appointment nonce, so they cannot be guessed and changing the nonce revokes them. Booking forms carry a signed ticket: submissions under 3 seconds or older than a day are refused, as is a filled honeypot field. Requests are limited per client address (hashed, never stored raw): bookings per hour come from Scheduling settings (default 10), page, slot, address and manage calls per minute. Repeated submits with the same idempotency key return the same booking. Customers only ever see their own appointment.

Embeds run in an iframe from the workspace URL. If an appointment type lists allowed domains, the widget refuses other sites, and bookings from other origins are rejected server-side.

### Contacts

A booking is matched to an existing person by email, or by phone when exactly one person has that number (Scheduling settings, **Match customers to contacts by**). Otherwise a person is created, and linked to the company with the email's domain unless it is a free-mail domain.

### Notifications and workflows

Customers get a confirmation with an ICS invitation and a manage link, plus move, cancel and reminder emails in their own time zone. Advisors are emailed about bookings and changes. Every change is written to **Scheduling audit events**. Because appointments are records, Twenty workflows can trigger on them directly (created, updated, status changes) for anything further, such as SMS or Slack.

## Settings

Set these once per server as app variables (`node scripts/set-app-variables.mjs`, see the root README):

| Variable | Required | Meaning |
|---|---|---|
| `BOOKING_LINK_SECRET` | Yes | 32+ random characters (`openssl rand -hex 32`). Signs manage links, form tickets and map tickets. Changing it invalidates every manage link already emailed |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_FROM_ADDRESS` | Yes | Mail server for booking emails. With the bundled stack: `mail`, `587`, `NONE` |
| `SMTP_USERNAME`, `SMTP_PASSWORD` | If needed | Mail server login |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | For Google | OAuth client below |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | For Microsoft | Entra app below |
| `GEOCODER_URL`, `GEOCODER_COUNTRY_CODES` | For location features | e.g. `http://geocoder:8080`, `gb` |
| `ROUTER_URL` | Recommended | e.g. `http://osrm:5000`. Without it travel times are estimated and marked unverified |
| `MAP_TILE_URL`, `MAP_ATTRIBUTION` | For maps | Raster tile template. See "Maps" for which tile service to use |
| `GOOGLE_CALENDAR_API_URL`, `MICROSOFT_GRAPH_API_URL` | No | Only for tests against a provider double |

Server `.env`: keep `LOGIC_FUNCTION_TYPE=LOCAL` and set `APPLICATION_API_RATE_LIMITING_LIMIT` (see `deploy/.env.example`). Twenty counts each app's API calls against one limit **across all workspaces**, default 500 per minute. A slot search makes several calls per advisor, so the default throttles a busy multi-client instance; the test suite hit it.

Per workspace, in **Scheduling settings**: contact matching, contact and company creation, default time zone, sender name, advisor emails, bookings per hour per client, maximum appointment types.

## Google setup

1. In Google Cloud Console, create a project and enable the **Google Calendar API**.
2. OAuth consent screen: user type External (or Internal for a single Google Workspace), add the scopes `openid`, `email`, `.../auth/calendar.calendarlist.readonly`, `.../auth/calendar.freebusy`, `.../auth/calendar.events`.
3. Credentials, Create OAuth client ID, type Web application. Authorized redirect URI: `${SERVER_URL}/auth/apps/callback`, for example `https://crm.inventiveweb.studio/auth/apps/callback`. It is the server URL, not a workspace subdomain.
4. Put the client id and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
5. `calendar.events` is a sensitive scope. Until Google verifies the app, only listed test users can connect, and refresh tokens of apps in Testing status expire after 7 days. Submit for verification before going live.

## Microsoft setup

1. Microsoft Entra admin center, App registrations, New registration. Supported account types: accounts in any organizational directory and personal Microsoft accounts (the app signs in through the `common` endpoint).
2. Redirect URI, platform Web: `${SERVER_URL}/auth/apps/callback`.
3. Certificates & secrets: create a client secret (note its expiry date and renew it before then).
4. API permissions, Microsoft Graph, Delegated: `openid`, `email`, `offline_access`, `User.Read`, `Calendars.ReadWrite`. Grant admin consent for your own tenant; client tenants may need their admin to consent too.
5. Put the application (client) id and secret in `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`.
6. Teams links need a work or school account with Teams; expect personal Outlook.com accounts to get the event without one (not yet verified against a real account).

Each user connects their own accounts at **Settings, Accounts, Applications, Scheduling** (the **Calendar connections** page links there). Google and Microsoft can be connected at the same time, and several accounts of each. Per connection the user picks the calendars that block their time and the one that receives bookings.

## Maps

Self-host routing and geocoding with the `maps` profile in `deploy/docker-compose.yml`. Both need an OpenStreetMap extract of your region, for example Great Britain from Geofabrik, in `MAPS_DIR` (default `deploy/maps`):

```bash
mkdir -p deploy/maps && curl -fL -o deploy/maps/region.osm.pbf https://download.geofabrik.de/europe/united-kingdom/england/west-yorkshire-latest.osm.pbf
```

```bash
docker run --rm -v "$PWD/deploy/maps:/data" ghcr.io/project-osrm/osrm-backend:v6.0.0 osrm-extract -p /opt/car.lua /data/region.osm.pbf
```

```bash
docker run --rm -v "$PWD/deploy/maps:/data" ghcr.io/project-osrm/osrm-backend:v6.0.0 osrm-partition /data/region.osrm
```

```bash
docker run --rm -v "$PWD/deploy/maps:/data" ghcr.io/project-osrm/osrm-backend:v6.0.0 osrm-customize /data/region.osrm
```

```bash
docker compose --profile maps up -d osrm geocoder
```

The geocoder imports the extract on first start (minutes for a county, hours and tens of GB of disk for all of Great Britain); it answers once the import finishes. Then set `ROUTER_URL=http://osrm:5000` and `GEOCODER_URL=http://geocoder:8080`. To refresh the data, download a new extract, rerun the three OSRM steps and recreate the `geocoder-data` volume.

Tiles: the OpenStreetMap Foundation's `tile.openstreetmap.org` is fine for testing but its usage policy rules out production traffic. Use a commercial tile provider or a self-hosted tile server and set `MAP_TILE_URL` to its template. Map pages load Leaflet 1.9.4 from unpkg.

## Install

Same flow as the Quotes & Invoices app (`../commercial-docs/README.md`): publish privately from the owner workspace, then install per client. Application id: `54c65493-4e80-4efa-824a-456671383c86`. Run the plan check before every publish:

```bash
npx twenty@2.54.3 app plan --remote owner --json | node ../../scripts/check-app-plan.mjs
```

Never remove an object or field from the app: the server deletes undeclared ones with their data in every workspace.

## Using it

1. **Overview**: click **Create my advisor profile** (Mon to Fri, 9 to 5). Today, upcoming (mine or team), connection health, recent activity, booking pages with links and embed codes, **Schedule an appointment** for phone bookings, **New appointment type**, **Advisor map**.
2. **Calendar connections**: connect Google or Microsoft, choose calendars, test the connection. A revoked or expired account shows **Reconnect**, and the advisor's times are withdrawn until then.
3. **Availability**: weekly hours, time zone, daily and weekly limits, time off and special hours.
4. **New appointment type** creates a draft with sensible defaults; open it to fine-tune, then set the status to **Active** to publish its page at `/s/book/<slug>`.
5. Teams: create a team under **Team scheduling**, add members with weights and priorities, and point a round-robin, first-available, customer-choice or collective type at it.
6. Advisors and locations: set each advisor's base, radius, territory or service area, and the offices.
7. Embeds: copy the inline, popup or floating snippet from the Overview, and list the client's domain in **Allowed embed domains**.

## Tests

`src/__tests__/engine.test.ts` covers the engine (time zones, DST, overrides, cross-midnight, buffers, limits, strategies, geography, travel). `tests/scheduling/` at the repository root holds the end-to-end and browser suites, run against a real Twenty server with a Google and Microsoft double (`mock-calendar-providers.mjs`). See its README.

## Not included yet

- Real Google and Microsoft accounts: everything provider-facing ran against the double, which mirrors the documented APIs. Verify with a real account of each before going live: OAuth consent, Meet and Teams link creation, free/busy, event update and delete, token refresh.
- Push notifications from providers. External changes are picked up by the 5-minute reconciliation, not instantly.
- Spatial indexing (PostGIS). Distances and areas are computed in the app, which is fine for hundreds of advisors per workspace, not tens of thousands.
- The allowed-domains check cannot use HTTP headers (Twenty drops custom headers on app routes), so it is enforced by the widget and on bookings rather than by the browser's frame policy.
- SMS reminders. Use a workflow on the appointment record.
- The appointment type editor is the native record page plus the quick-create card; there is no step-by-step wizard.
