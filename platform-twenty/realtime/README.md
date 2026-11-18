# Realtime

Live change notices for the InventiveCRM app screens (WhatsApp inbox, Team chat). When an app function changes a
record a screen shows, it publishes "these records changed"; every open screen of that workspace hears it at once over
Server-Sent Events and re-reads those records through Twenty, so Twenty's permissions decide what each person sees.
Notices carry record ids only, never content.

Twenty gives app screens no live channel of their own: their requests to Twenty go through a relay that waits for the
whole response, so they cannot hold a stream open. Requests to another origin go straight out from the browser, and
Twenty's Content-Security-Policy does not restrict them, so the screens connect here. Measured in a real browser on the
test server: a notice published on the server appeared in an app screen 560 ms later, including the test's own checks.

`server.mjs` has no dependencies and keeps nothing on disk. `node --test server.test.mjs` runs its tests.

## Protocol

| Call | Who | What |
|---|---|---|
| `GET /v1/stream?token=…&topics=whatsapp,chat` | Browsers (any origin) | Server-Sent Events. `event: change` with `id` and data `{ topic, kind, ids, at }`; `event: resync` when the gap since `Last-Event-ID` (or `lastEventId=`) is no longer known, so the screen re-reads what it shows; `event: expired` when the pass runs out; a `: ping` comment every 20 s |
| `POST /v1/publish` | App functions only (Caddy refuses it from outside) | Body `{ workspace, topic, events: [{ kind, ids }] }`, headers `X-Realtime-Timestamp` (unix seconds, 5 minutes either way) and `X-Realtime-Signature` = `sha256=` + hex HMAC-SHA256(secret, "timestamp.body") |
| `GET /healthz` | Monitoring | `{ ok, streams }` |

A pass is `v1.<base64url JSON { workspace, member, topics, exp }>.<base64url HMAC-SHA256(secret, "v1.<payload>")>`,
minted by an app's signed-in route for the person asking, valid for an hour. Ids keep increasing across restarts, so a
screen that reconnects after one gets a resync instead of a silent gap. Limits: 5,000 streams, 20 per person, the last
500 notices per workspace kept for catching up, and a screen that stops reading is dropped (it reconnects and resyncs).

## Running it

Production: `COMPOSE_PROFILES=realtime` and `REALTIME_SECRET` (32+ characters) in `deploy/.env`, then
`docker compose up -d realtime` in `deploy/`; Caddy serves it at `https://realtime.crm.inventiveweb.studio`. The app
containers share the `realtime` network with it and publish to `http://realtime:3200`. Each publishing app needs the
app variables `REALTIME_SECRET` (the same secret), `REALTIME_INTERNAL_URL=http://realtime:3200` and
`REALTIME_PUBLIC_URL=https://realtime.crm.inventiveweb.studio`.

Test server: `REALTIME_SECRET=… REALTIME_HOST=127.0.0.1 node server.mjs`, with the apps' variables pointing at
`http://127.0.0.1:3200` for both URLs.

| Setting | Default |
|---|---|
| `REALTIME_SECRET` | required, 32+ characters |
| `REALTIME_HOST`, `REALTIME_PORT` | `0.0.0.0`, `3200` |
| `REALTIME_TOPICS` | `whatsapp,chat` |
| `REALTIME_MAX_STREAMS`, `REALTIME_MAX_STREAMS_PER_MEMBER` | `5000`, `20` |
| `REALTIME_BUFFER_PER_WORKSPACE` | `500` |
| `REALTIME_HEARTBEAT_MS` | `20000` |

One instance holds every stream in memory. A second instance would need the publishes shared between them (for
example Redis pub/sub); until then, run one.
