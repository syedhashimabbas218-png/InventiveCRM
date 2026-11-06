# Scheduling tests

End-to-end and browser tests for `apps/scheduling`, run against a real multi-workspace server with the app installed, Mailpit for mail, OSRM and Nominatim for maps, and `mock-calendar-providers.mjs` standing in for Google Calendar and Microsoft Graph (including their OAuth endpoints).

## Prepare

1. Start the provider double: `node mock-calendar-providers.mjs` (port 8095).
   On the test server set `OUTBOUND_HTTP_SAFE_MODE_ENABLED=false`: from Twenty 2.55 the server refuses OAuth token requests to internal addresses such as 127.0.0.1. Production keeps the default.
2. Build and install the app with the OAuth endpoints pointed at the double. The connection providers read `SCHEDULING_GOOGLE_AUTHORIZE_URL`, `SCHEDULING_GOOGLE_TOKEN_URL` and `SCHEDULING_MICROSOFT_LOGIN_URL` at build time, for example `http://127.0.0.1:8095/google/oauth/authorize`, `http://127.0.0.1:8095/google/oauth/token` and `http://127.0.0.1:8095/microsoft`.
3. Set the app variables, with `GOOGLE_CALENDAR_API_URL=http://127.0.0.1:8095/google/calendar/v3` and `MICROSOFT_GRAPH_API_URL=http://127.0.0.1:8095/graph/v1.0`, any client id and secret, a `BOOKING_LINK_SECRET`, SMTP pointing at Mailpit, and the map services.
4. Create the test world (two users, five advisors, an office, teams and nine appointment types, with Alice on Google and Bob on Microsoft):

```bash
SERVER_URL=http://localhost:3001 node setup.mjs http://acme.localhost:3001 acme.key state.json
```

## Run

Every script needs `SERVER_URL` set to the throwaway test server; there is no default, so tests can never reach a live instance by accident. Never point it at production: `e2e.mjs` deletes every appointment, reservation and audit record in the workspace it is given.

```bash
node e2e.mjs state.json acme.key glow.key
```

```bash
node browser.cjs state.json acme.key shots
```

```bash
node restricted-role.mjs state.json acme.key
```

`e2e.mjs` clears the app's appointments, reservations, sync rows, audit events and rate-limit counters first, so it can be rerun. `glow.key` is a second workspace, used to check isolation. `browser.cjs` saves screenshots to `shots/` and undoes the changes it makes to Alice's availability. `restricted-role.mjs` gives Bob a role without permanent delete for the duration of the check, then puts his role back.

## What is covered

| Scenario | Where |
|---|---|
| Booking without an account; record, contact and company created; confirmation with ICS and manage link | e2e |
| Google busy time removes times; booking appears in Google with a Meet link | e2e |
| Microsoft booking in Outlook with a Teams link, no customer attendee | e2e |
| Round robin rotation and recorded reasons | e2e |
| Two simultaneous bookings for one slot (one wins), and simultaneous round-robin bookings (two advisors) | e2e |
| Collective times and events in both calendars; group session capacity and one event | e2e |
| Office appointment; map search, nearest by road; territory; travel-aware refusal and offer | e2e |
| Reschedule overlapping the old time; guessed manage link refused; advisor cancellation | e2e |
| Revoked access withdraws times until reconnect | e2e |
| Provider outage retried without duplicates; external move put back | e2e |
| Customer time zone in emails; reminders once; rate limits, instant submit and honeypot; cross-workspace isolation | e2e |
| Booking, manage and phone layout; map selector; inline, popup and floating embeds; domain allowlist | browser |
| Overview, calendar connections, appointment calendar, availability editor, advisor map, quick appointment type | browser |
| A member whose role cannot permanently delete records books and cancels; the held time is still freed | restricted-role |

What the double cannot prove: real Google and Microsoft consent screens, token refresh against their servers, and the exact Meet and Teams link behaviour. Check those once with real accounts before going live.
