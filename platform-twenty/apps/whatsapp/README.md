# WhatsApp (InventiveCRM app)

WhatsApp inside the CRM, through the workspace's InventiveChat account: a shared inbox, conversations on contact and
company pages, approved templates outside the 24-hour window, automations, and the signed WhatsApp gateway the other
apps already use (`../commercial-docs/WHATSAPP_HANDOFF.md`). InventiveChat keeps the Meta connection, numbers, templates,
its AI and opt-out handling; the CRM keeps contacts, consent and a record of every message. Built on the Twenty apps SDK
and twenty-ui; installs per workspace.

## How it works

| Part | Behaviour |
|---|---|
| Connect | Settings, Accounts, **InventiveChat (WhatsApp)**: a workspace admin pastes an InventiveChat system key (`wa_...`) on our page (one connection per workspace; members who are not admins cannot add or replace it). The page posts only to Twenty's own callback. The key is checked with `GET /v1/account` and stored encrypted by Twenty. Our earlier webhook (same address) is disabled and a new one registered for every event at `https://<workspace>/s/whatsapp/events` (InventiveChat allows ten active per account and has no delete). The signing secret it returns once is kept sealed (AES-256-GCM, key derived per workspace from `WHATSAPP_APP_SECRET`) in **WhatsApp settings**. Disconnecting disables the webhook (Twenty's disconnect hook) unless another connection is still working. The only active number is used; with several, an admin puts its id (`wac_...`) in "WhatsApp number id" |
| Records | **WhatsApp conversations** (customer, phone, person, company, assignee, Open/Closed, who is replying, last message, unread, free replies until, opted out) and **WhatsApp messages** (direction, kind, text, template, attachment, status, problem, sent by, time). Both are ordinary records with views under the WhatsApp folder, and contacts and companies get a WhatsApp tab |
| Receiving | `POST /s/whatsapp/events` checks InventiveChat's signature (HMAC-SHA256 over timestamp and raw body, five-minute window, constant-time compare) before anything is written. Records are keyed on InventiveChat's ids (unique fields), so retries, replays and out-of-order events change nothing twice, and statuses only move forward (sent, delivered, read; a failure only before delivery). A new number is matched to a person by phone (primary and additional numbers, compared in international format), or added as a person named from the WhatsApp profile when "Add unknown numbers as people" is on; the conversation takes the person's company. A customer writing opens the 24-hour window and reopens a closed conversation. Replies typed on the business phone (coexistence) are stored as ours. `conversation.updated` keeps "AI replying", "A person is replying" (state `HUMAN_ACTIVE` while the AI pause lasts), "Automation awaiting approval" and "Waiting for us" current, and closes the conversation when InventiveChat does. State events (`conversation.updated`, takeover, hand-off, AI resumed) and opt-out or consent reports apply only if they are no older than the last one applied (`occurred_at`, fixed per event), so a late retry never undoes a newer change. Failures show the first of Meta's errors |
| Catch-up | InventiveChat retries a webhook for about a day and keeps every event in its feed (`GET /v1/events/feed`) for 7 days. The scheduled run (every 15 minutes, so within 15 minutes of a restart) reads the feed from where this workspace stopped and applies each event through the webhook handlers, for up to two and a half minutes a run (an idle run takes a second), pausing between pages to leave the key's rate limit for sends. Most events also arrive by webhook, so each page needs one lookup to skip messages already recorded. The position is stored per workspace (`Event feed position`) after each page, or after the last event applied when a run stops halfway; a lease stops two runs reading at once. A new connection starts at the newest event (`after=latest`). A position InventiveChat has pruned (over 7 days without a run) is reported under "Missed events" and the feed is read again from its oldest event |
| Inbox | WhatsApp, Inbox: Mine, Unassigned, All and Closed, unread badges, the thread with day separators and ticks (clock, sent, delivered, read, failed with Retry), links to the contact and company, assign to me, close and reopen. While the customer wrote in the last 24 hours the composer takes free text (Enter sends, Shift+Enter adds a line); otherwise, and to start a conversation, it offers templates with a field for each named parameter (those not approved are listed greyed out with their status). Messages appear at once and settle when InventiveChat answers |
| Contact and company pages | A WhatsApp tab lists the record's conversations and opens them in place; on a contact, **Message this contact** sends a template (the first message to a contact is always a template) |
| Sending | Signed-in route `POST /s/whatsapp/api` (actions `send`, `templates`, `markRead`, `assign`, `close`, `reopen`, `realtimeToken`). It refuses callers that are not a signed-in person (API keys included), checks with the caller's own token that they can see the conversation or contact, then sends with the workspace key. Staff text goes out on behalf of the person (`on_behalf_of`), which InventiveChat treats as a human taking over and pausing its AI. 30 sends a minute per person |
| Automations | Workflows can start when a **WhatsApp message** is created (Twenty's own record trigger; filter on Direction = From the customer for incoming messages). The **Send WhatsApp message** workflow action and AI tool send an approved template (values by parameter name). Free text goes out only when the step names a topic, while the customer is in their 24-hour window: the conversation is claimed for the customer's latest message, the reply is sent on that topic, and the claim is released straight away whether it went out or not (a claim otherwise blocks the next reply until it expires). InventiveChat allows no topics and asks a person to approve automation per conversation by default, so its refusals (awaiting approval, a person is handling it, paused, a newer message, topic not allowed with the allowed topics) are passed on as they are |
| Gateway bridge | `POST /s/whatsapp/gateway` implements `WHATSAPP_HANDOFF.md`, so Quotes & Invoices, Feedback and Campaign Studio can point `WHATSAPP_GATEWAY_URL` here unchanged. Same headers, signature (`WHATSAPP_GATEWAY_SECRET`) and five-minute window. Each event uses an approved template whose named parameters are filled from the request (defaults below, overridable in WhatsApp settings; the language is the template's own) and is sent with `send-to-phone`; the delivery id (unique) makes a repeated request answer with the first message. Status callbacks are accepted only on this workspace's own app routes and forwarded there, signed, as the contract says. Campaign batches record marketing consent with InventiveChat first (the CRM is the source of consent; a STOP on WhatsApp still wins), fill the template's named parameters with the campaign's values in the template's order, send each recipient once, three at a time, and answer a repeated batch from what was already sent |
| Waiting | When InventiveChat asks to wait (a teammate is handling the customer: 423 `human_active`; Meta's limit: `meta_rate_limited`; or busy), a notification is reported to the calling app as accepted and queued, not failed, and the retry job (every 15 minutes, or `POST /s/whatsapp/retry`) sends it with the same idempotency key: at `paused_until` or after `retry_after_seconds`, or, when the teammate took over with no time limit, as soon as `conversation.updated` shows they handed back. It gives up after 24 hours and reports the failure. Short waits (`rate_limited`, `too_many_concurrent_sends`) are retried with backoff at once. Meta's refusals (`provider_rejected`) show Meta's reason. A send InventiveChat cannot confirm (`outcome_unknown`: a 502 at once, or a `message.send_outcome_unknown` notice later, matched by our idempotency key) is marked failed with that reason and never sent again with the same key; Retry in the thread sends it under a new key, after a person has checked the conversation |
| Opt-out and consent | `customer.opted_out` marks the conversations and clears **Agreed to WhatsApp messages** (Quotes & Invoices) and **Agreed to marketing on WhatsApp** (Campaign Studio) on the contact when those fields exist, and tells Campaign Studio through its status callback. `consent.updated` sets or clears the marketing field. Nothing is sent to a customer who opted out |
| Live updates | After every write the app tells the realtime hub which conversations and messages changed (`REALTIME_INTERNAL_URL`, signed with `REALTIME_SECRET`). Open screens hold one event stream to the hub (`REALTIME_PUBLIC_URL`) with an hour-long token from the `realtimeToken` action, re-read only the changed records with GraphQL and merge them in place; on reconnect or `resync` they re-read once. There is no polling; without a hub the screens update after your own actions |

## Hardening for a workspace

Conversation and message records can be edited through Twenty's API like any record. A workspace admin can remove the
Member role's edit rights on the WhatsApp settings, conversation and message objects (Settings, Roles); the app keeps
working because it uses its own role, and reading stays open so the inbox works. The webhook secret is sealed, so
reading the settings record does not reveal it.

## Server variables

`node ../../scripts/set-app-variables.mjs --app 23e5cd3d-e631-461b-9e06-849c0a577688 ...`

| Variable | Meaning |
|---|---|
| `INVENTIVECHAT_API_URL` | InventiveChat's API address (the app adds `/v1`) |
| `WHATSAPP_APP_SECRET` | 32+ random characters (`openssl rand -hex 32`). Seals the webhook secret; changing it means connecting WhatsApp again in each workspace |
| `WHATSAPP_GATEWAY_SECRET` | The same value the other apps sign with, so they can use this app as their gateway |
| `REALTIME_INTERNAL_URL`, `REALTIME_PUBLIC_URL`, `REALTIME_SECRET` | The realtime hub as the server and as browsers reach it, and its shared secret. Leave the URLs empty to turn live updates off. If the hub has a private address, Twenty's `OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS` may need its host name |

To use this app as the gateway, set the other apps' `WHATSAPP_GATEWAY_URL` to the path `/s/whatsapp/gateway`, not a full address. The variable is shared by every workspace; a path is resolved against the sending workspace's own address, so each workspace's messages leave through its own WhatsApp app and InventiveChat account.

## Notification templates

Each event from the other apps uses this template unless "Templates for app notifications" in WhatsApp settings says
otherwise. The keys are the template's parameter names in InventiveChat; the values are fields of the request. An amount
gives its formatted text (`£114.00`) and `recipient.firstName` is the first word of the recipient's name. Create the
templates in InventiveChat with these names and parameters, or map your own:

| Event | Template | Parameters |
|---|---|---|
| `invoice.send` | `invoice_ready` | `customer_name`, `business_name`, `invoice_number`, `amount_due`, `due_date`, `invoice_link` |
| `credit_note.send` | `credit_note_ready` | `customer_name`, `business_name`, `credit_note_number`, `amount`, `document_link` |
| `quote.send` | `quote_ready` | `customer_name`, `business_name`, `quote_number`, `total`, `valid_until`, `quote_link` |
| `invoice.overdue_reminder` | `invoice_overdue` | `customer_name`, `business_name`, `invoice_number`, `amount_due`, `due_date`, `payment_link` |
| `invoice.payment_link` | `invoice_payment_link` | `customer_name`, `business_name`, `invoice_number`, `amount_due`, `payment_link` |
| `feedback.survey` | `feedback_request` | `customer_name`, `business_name`, `survey_link` |

The fields behind them (`src/lib/gateway.ts`): `customer_name` is `recipient.firstName`, `business_name` is
`business.name`, numbers come from `document.number`, amounts from `document.amountDue` or `document.total`, dates from
`document.dueDate` or `document.validUntil`, links from `document.pdf.url`, `document.paymentUrl` or `survey.url`. An
override names the template and maps every one of its parameters:

```json
{
  "invoice.send": { "name": "my_invoice", "language": "en_GB", "parameters": { "name": "recipient.firstName", "amount": "document.amountDue", "link": "document.pdf.url" } }
}
```

A template that is not approved, or a parameter the mapping does not fill, is refused with a message saying which.
Templates cannot carry a header document or other media, so the invoice or quote PDF goes in as a link in the body.
`campaign.message` names its own template; its values fill the template's parameters in order.

## What InventiveChat must provide

The adapter (`src/lib/inventivechat.ts`) follows the API InventiveChat confirmed. Still open with them:

- `POST /v1/subscriptions/:id/disable` answers 200 for a subscription that is already disabled.
- The event feed and 24-hour webhook retries are on InventiveChat's `event-outbox` branch, not deployed yet. The app
  is tested against the double's model of them, including resuming from an individual event's cursor.
- After a pruned feed position, InventiveChat suggests resyncing from its conversation and message reads; the app
  only reports the gap for now.

## Install

Same flow as the other apps (see `../../UPDATES.md`, "Releasing an app"). Application id:
`23e5cd3d-e631-461b-9e06-849c0a577688`.

## Tests

`yarn test` covers webhook and gateway signatures (good, wrong secret, stale, altered body), the sealed secret across
workspaces, realtime signing and tokens, phone normalisation and matching, webhook events to records, the gateway
contract (default mapping, named parameters, campaign batches, dedupe, callbacks only to this workspace, waits reported
as queued), status rules, the request envelope, number choice, InventiveChat refusals and how long to wait, idempotency
keys, list merging, ticks and the event-stream parser.

`../../tests/whatsapp/e2e.mjs` runs against `tests/whatsapp/mock-inventivechat.mjs` (InventiveChat and the hub's publish
endpoint, port 8098). The double is strict: an envelope or payload that does not match InventiveChat's contract is
refused with InventiveChat's own error shapes, so drift fails the suite. It covers connecting, messages from unknown and known numbers, forged, stale, altered and replayed webhooks,
staff replies, template-only rules, a template to a contact, API keys refused, the gateway with a signed `invoice.send`
and its status forwarded to Quotes & Invoices, a notification held back by a teammate and sent after they hand back,
campaign batches, opt-outs, conversation state, realtime publishes and tokens, sends whose outcome is unknown (502,
a cut-off request, the later notice, a deliberate resend), late and out-of-order state events, an outage longer than the
webhook retries (catch-up from the feed, then late retries newest first changing nothing, and a pruned position), and
the AI tool over MCP (topics, approval, claims and their release). `catch-up-load.mjs` stops the test server while
several workspaces get a backlog, then measures how the scheduled runs drain it.
`tests/run-all.sh` starts the double; the keys dir needs `whatsapp-test-vars.env` with `WHATSAPP_GATEWAY_SECRET`
(the same value as Quotes & Invoices on the test server), `WHATSAPP_APP_SECRET` and `REALTIME_SECRET`, and the app
installed with `INVENTIVECHAT_API_URL`, `REALTIME_INTERNAL_URL` and `REALTIME_PUBLIC_URL` set to `http://127.0.0.1:8098`.
