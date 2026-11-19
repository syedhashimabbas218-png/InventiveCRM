# Handover for Iwcrm, part 3b: WhatsApp (the CRM side of InventiveChat)

Part of the handover that starts in `docs/HANDOVER-FOR-IWCRM.md` (part 0). Team chat and the realtime service are part 3a
(`docs/HANDOVER-FOR-IWCRM-3a-team-chat-realtime.md`). This describes behaviour, not Twenty code. The reference
implementation is `apps/whatsapp/` (version 0.3.4); `src/lib/inventivechat.ts` holds the whole InventiveChat contract. The
suites are in `apps/whatsapp/src/__tests__/` and `tests/whatsapp/`. Where this text and the code disagree, the code and
its tests are what ran.

InventiveChat is our separate WhatsApp platform, with its own server and database. It owns the Meta connection, the
numbers, templates, its AI and opt-out keywords. The CRM owns contacts, consent, a record of every message, the shared
inbox, and the gateway the other apps send notifications through. InventiveChat has no live tenants yet: everything
below was proven against our strict double (`tests/whatsapp/mock-inventivechat.mjs`), which refuses anything outside
the contract.

---

## WhatsApp

### 1. Purpose

WhatsApp inside the CRM through each tenant's own InventiveChat account: a shared inbox, conversations on contact and
company pages and timelines, staff replies as themselves, approved templates outside the 24-hour window, a workflow
step and AI tool, and the signed gateway that Quotes & Invoices, Feedback and Campaign Studio use for notifications.

### 2. Features and business rules

**Routes and callers**
- The inbox route (`/s/whatsapp/api`) and the manual retry route (`/s/whatsapp/retry`) accept only a signed-in person; an
  API key gets 403.
- The webhook route (`/s/whatsapp/events`) and the gateway (`/s/whatsapp/gateway`) are public but signed.
- The inbox route checks with the caller's own permissions that they can see the conversation or contact (404
  otherwise), then acts with the app's role.

**Connecting a tenant**
- One InventiveChat account per tenant, connected by an admin (in practice our staff) pasting a system key `wa_...`.
- The key must be `wa_` plus 10 to 200 letters, digits, "_" or "-"; anything else connects nothing.
- The connect page posts the key only to the platform's own connection callback (same origin, fixed path, a `state`
  value); any other callback address gets 400.
- The key is checked with `GET /v1/account`; a refused key, or an answer without a tenant id, connects nothing.
- The key is stored encrypted as the tenant's connection, identified by its fingerprint (first 16 hex of its SHA-256).
  The page polls a public route that only says whether that fingerprint is connected (8 tries, 1 s apart).
- Webhook registration: our earlier subscriptions to the same address that are not disabled are disabled first
  (InventiveChat allows 10 active per account and has no delete), then one subscription is created for all 13 event types
  at `https://<tenant address>/s/whatsapp/events`.
- The webhook signing secret is returned only once; it is stored sealed (AES-256-GCM, a key derived per tenant from
  `WHATSAPP_APP_SECRET`, bound to account id and subscription id), never in plain text.
- If registration fails, the connection still stands and "Connection problem" says new messages will not arrive until
  WhatsApp is connected again.
- Number choice: keep the tenant's chosen number if it is still active; otherwise use the only active number; with
  several active numbers (or none), choose none and ask an admin to put the number id (`wac_...`) in settings.
- Saved per tenant: account id, business name, number id and phone, key fingerprint, webhook id, address, sealed secret.
- Connecting a different account resets the feed position to the newest event and clears "Missed events".
- With several connections, the app uses the one whose fingerprint was saved in settings; failing that, the first
  working one by id, the same every time.
- Disconnecting: if another working connection remains, nothing changes; otherwise our subscriptions are disabled, the
  subscription id and secret cleared, and "Connection problem" says WhatsApp is disconnected.

**Receiving webhooks**
- Without settings or a secret the webhook answers 503 so InventiveChat retries.
- The signature is checked before anything is written: HMAC-SHA256 over `<timestamp>.<raw body>`, timestamp within 5
  minutes, constant-time compare. Missing headers, a wrong secret, a stale or future timestamp or an altered body get 401.
- A body that cannot be read gets 400; an event for another InventiveChat account gets 403.
- A handler error answers 500 so InventiveChat retries; every step is idempotent, so a retry finishes the work.
- Replays and retries change nothing twice: records are keyed on InventiveChat's ids (unique). A 200 says what happened.
- `template.status_updated` and `conversation.ready_for_reply` are answered 200 and ignored.

**Conversations and people**
- A conversation is found by InventiveChat's conversation id, or created (status Open, named from the profile name, else
  the phone, else "WhatsApp customer").
- Missing profile name, WhatsApp id and phone are filled in from later events.
- For an inbound message on a conversation without a person, the phone is matched to a person: primary and additional
  numbers, compared exactly in international format.
- Stored numbers are national plus a calling code; readings with and without a leading 0 are both tried.
- With no match, a person is created when "Add unknown numbers as people" is on (the default), named from the profile
  (first word first name, the rest last name, up to 100 characters; the phone as first name without a profile).
- Only the request that created the conversation may create a person, so two webhooks for a new customer cannot add two.
- If the number is refused when creating the person, the person is created without it; the conversation keeps it.
- A conversation linked to a person takes the person's company if it has none.
- A message's time is when it was received (inbound) or sent (outbound), else the event's time.
- A message's kind: text, template, media (image, video, audio, voice, document, sticker), buttons, or other.
- Replies typed on the business phone (echo) are stored as outbound, sender "Business phone" or the given name.
- Senders: the CRM member's name, "InventiveChat AI" (ai, agent), "InventiveChat" (system, automation).
- A failure shows the first of Meta's errors as "title: message".
- History imported when a number joins counts as already read.
- The last message time and preview only move forward, so an old message arriving late never replaces a newer preview.
- Unread is recounted from the inbound messages after the read position, never incremented. It is shared by the team.

**Message statuses**
- Statuses only move forward: queued, sent, delivered, read.
- A failure can only follow queued or sent; a delivery or read report after a failure wins, because it proves arrival.
- A repeated status changes nothing.
- An outbound message without a status is recorded as sent.

**24-hour window**
- A customer writing sets "Customer last wrote" (forward only), opens the window until 24 hours later, and reopens a
  closed conversation.
- Free text is allowed only while the window is open; outside it, only an approved template.
- The app refuses free text outside the window itself (409) before calling InventiveChat, which would answer 422 `outside_window`.

**Staff replies**
- Staff free text goes to the conversation as text on behalf of the person (`on_behalf_of`: member id and name).
  InventiveChat treats it as a human takeover and pauses its AI.
- A staff template in a conversation also goes on behalf of the person.
- The screen chooses the message id; sending the same id again returns the saved message without sending twice. An id
  already used by another conversation or contact gets 409.
- Each person can send 30 messages a minute (429).
- Nothing is sent to an opted-out conversation (409).
- The message is saved as queued before the call and updated with the outcome, so the thread shows sent, waiting or
  failed without waiting for a webhook.
- A busy InventiveChat (429 `rate_limited` or `too_many_concurrent_sends`, 5xx, unreachable) is retried with backoff
  within 12 s, with the same key; if still busy, the message stays queued with "WhatsApp is busy right now" (503), and
  Retry reuses the same key.
- A definite refusal marks the message failed with a plain reason (409, 422 or 503); Retry then uses a new key.

**Templates and starting conversations**
- Template lists show every template; approved ones first, then pending, paused, rejected and disabled (greyed out with
  their status).
- Only approved templates can be sent. Language: the requested one, then the tenant's default, then any approved one.
- Parameters are named; values are filled by name, or from a list in the template's order. At most 20, each cut to
  1,024 characters. A missing value is refused naming it.
- The first message to a contact is always a template, sent to the person's number with `send-to-phone`; free text gets
  400 ("Choose a template.").
- The number used is the person's primary number if it reads as international, otherwise the first that does; none
  gives 409.
- If any conversation with that number has opted out, nothing is sent (409).
- `send-to-phone` starts or reuses InventiveChat's conversation; the CRM finds or creates its record and links the person
  and company.

**Notifications from other apps (gateway)**
- Requests are signed with `WHATSAPP_GATEWAY_SECRET` (same scheme, 5-minute window); a bad or stale signature gets 401.
- Without a connection the gateway answers 503.
- A status callback address must be one of this tenant's own app routes (400 otherwise).
- Each event uses an approved template; its named parameters are filled from request fields by a mapping (defaults in
  section 6, overridable per tenant). An event without a mapping gets 422; an unapproved template or an unfilled
  parameter gets 422 naming it.
- Templates cannot carry a PDF header, so documents go as a link in the body.
- Sends use `send-to-phone` without `on_behalf_of`, recorded under the app's label ("Quotes & Invoices", "Feedback",
  "Campaign Studio").
- The delivery id is unique: a repeated request answers with the message already sent, or the wait already set, without
  calling InventiveChat. A delivery that failed for sure is sent again under a new key.
- A wait is answered 202 "accepted and queued", never as a failure; the status callback follows.
- Campaign batches hold 1 to 100 messages; each recipient id is used once (`campaign:<recipient id>`), so a repeated batch
  is answered from what it already produced and never sends a recipient twice.
- A recipient without an international number, or whose values do not fill the template, is left out of `accepted`.
- Before a batch is sent, marketing consent is recorded with InventiveChat for each phone still to send (source `crm`);
  a customer who sent STOP is refused there and skipped.
- A batch sends 3 at a time (InventiveChat allows 5 concurrent sends per account), within 20 s. Once Meta's limit is hit,
  the rest are held with the same retry time; what does not fit in the time is held for the next retry run.
- Statuses go back to the caller's callback, signed: documents get sent, delivered, read and failed; campaigns get
  delivered, read, failed and opted_out. A receiver's 5xx makes our webhook answer 500 so InventiveChat retries; a 4xx
  is only logged.

**Waits and give-up**
- InventiveChat asks to wait with 423 `human_active` (a teammate is chatting), 429 `meta_rate_limited` (Meta's limit) or
  busy codes.
- A notification or automated template that must wait is kept queued with a send-again time and "waiting for"
  (person, meta or busy). It shows as waiting, with the reason.
- Send-again time: `paused_until`; else now plus `retry_after_seconds`; else, for a teammate with no time limit, the
  24-hour give-up; else 15 minutes (Meta's limit) or 2 minutes (busy).
- When `conversation.updated` (or a hand-back event) shows the person is no longer active, every notification held for
  that person, by conversation or phone, is due at once.
- The retry job sends due messages with the same idempotency key, rebuilt from the stored request; a message whose request
  was not kept fails ("what to send was not kept").
- A message not sent within 24 hours of its creation fails ("Not sent within 24 hours.") and its failure is reported to
  the calling app.
- The retry job runs every 15 minutes (minutes 9, 24, 39, 54), or when a signed-in person calls the retry route. It
  first catches up from the feed, then sends up to 60 due messages, oldest wait first, 3 at a time, within 40 s.

**Automation (workflow step "Send WhatsApp message" and AI tool)**
- Workflows can start when a WhatsApp message is created (filter Direction = From the customer for incoming).
- Input: `personId` (required), `templateName`, `parameters` (by name), `languageCode`, `text`, `topic`.
- Templates by default. Free text needs a topic (1 to 64 of letters, digits, ".", "_", "-") and a conversation with the
  person whose window is open and who has not opted out (the most recent inbound first).
- Free text without a topic and without a template is refused with "needs a topic".
- With text and topic but no open window, a template is required; without one the step says so.
- Limits: 5 automated messages per contact in 10 minutes ("Check the workflow for a loop"), 60 a minute per tenant.
  Every message recorded counts, including ones InventiveChat refused.
- Automated sends are recorded under the label "Automation" with no member.
- InventiveChat's refusals are passed on as they are: awaiting approval, a person is handling it, paused, a newer
  message, a topic not allowed (with the allowed topics, or "none yet").
- A wait answers success with "Queued: <reason>" and the send-again time.
- Output: `{ success, message, messageId?, conversationId?, queuedUntil? }`.

**Claims (automated free text)**
- Before automated free text, the app reads the conversation's `latest_message_id` (the customer's latest message) and
  claims the conversation for it (`claimant: ai`, 60 s).
- A customer who never wrote is refused before claiming.
- The reply is sent with the claim id and topic, and the claim is released at once, sent or refused.
- When InventiveChat is unreachable, the release is skipped (the claim expires anyway).
- A failed release never hides a sent message.
- Each attempt claims afresh, so a retried send never carries a released claim.
- A claim refused or invalidated is shown plainly: "awaiting approval", "already answering", "the customer wrote
  again", "the conversation changed while the reply was being sent".

**Outcome unknown**
- A 502 or 409 `outcome_unknown` is final: the message fails with "InventiveChat could not confirm whether WhatsApp
  accepted this message. Check the conversation before sending it again." It is never retried with the same key.
- A send cut off mid-request is retried once with the same key, which InventiveChat answers 409 `outcome_unknown`.
- `message.send_outcome_unknown` is matched by our idempotency key: an unknown key is ignored; a message already sent is
  left alone; otherwise the message fails with that reason, leaves the retry queue, and the calling app is told.
- Retry in the thread sends it under a new key, after a person has checked the conversation.

**Opt-out and consent**
- `customer.opted_out` marks every conversation with that conversation id or phone as opted out.
- It clears "Agreed to WhatsApp messages" (Quotes & Invoices) and "Agreed to marketing on WhatsApp" (Campaign Studio) on
  the people of those conversations and the person with that phone, where those fields exist.
- It tells Campaign Studio through the callback of the latest campaign message to that customer (`opted_out`).
- `consent.updated` sets or clears the marketing field (consent and not opted out), and sets "opted out" on the
  conversations to the reported value.
- Opt-out and consent reports apply only if no older than the last one applied (equal times apply), so a STOP and a START
  retried out of order cannot swap places. With no conversation to compare, the report applies.
- Nothing is sent to an opted-out customer; the thread says "They have to send START before you can message them again."
- The CRM is the source of marketing consent, but a STOP sent on WhatsApp wins at InventiveChat until START.

**Conversation state**
- Handled by: AI replying, A person (is replying), Wants a person, Automation awaiting approval, or nothing.
- `conversation.updated` is a full snapshot: AI when automation is replying; a person while the state is `HUMAN_ACTIVE`
  and any AI pause has not ended; awaiting approval for `AWAITING_APPROVAL`. It also sets "Waiting for us" and "AI paused
  until", and closes the conversation for `CLOSED`.
- Takeover sets a person, a hand-off request sets "Wants a person", AI resumed or approved sets AI. These events ignore
  conversations the CRM does not know.
- "Wants a person" stays until a state replaces it; a closing snapshot clears it.
- State events apply only if no older than the last one applied; equal times apply.
- Closing, reopening and assigning in the CRM are CRM-only; they are not sent to InventiveChat.

**Catch-up from the event feed**
- At the start of every retry run, the app reads InventiveChat's feed from the tenant's stored position and applies each
  event through the same handlers as webhooks.
- A lease (an atomic "running until" on the settings row) stops two runs reading at once; the other run skips.
- A connection without a position starts at the newest event (`after=latest`) and replays nothing.
- Pages of 100, 200 ms apart, leaving most of the key's rate limit for sends; busy answers are retried within the run.
- Each page needs one lookup: a message already recorded, with a conversation, at a status the event cannot move, is skipped.
- Events for another account are ignored.
- The position is saved after each page, or after the last event processed when the run's time ends mid-page. If nothing
  on the page was processed, the position does not move.
- A pruned position (410 `cursor_expired`, over 7 days) is reported under "Missed events" with the time of the last
  successful catch-up, and the feed is read again from its oldest event.
- A run may take 150 s after an outage; an idle one takes about a second.

**Inbox screen**
- Filters: Mine (open, assigned to me), Unassigned (open, nobody), All (open; the default), Closed. Newest message first.
- A row shows the person's name (else conversation name, profile name, phone, "WhatsApp customer"), the preview, a
  relative time (now, N min, today's time, Yesterday, weekday, date) and one of: unread badge, "Wants a person", "Waiting".
- A live status: Connecting…, Live, Reconnecting…, Live updates are off.
- Callouts for "WhatsApp is not connected yet" and for the connection problem text.
- The thread header shows the title and phone; tags for who is handling it, "Waiting for us", and either "Opted out",
  "Replies open for N min" (or N h) or "Template only"; links to the contact and company; "Assigned to X"; Assign to me
  or Unassign; Close or Reopen.
- The thread shows the newest message at the bottom, 40 a page, with "Load earlier messages" and day separators (Today,
  Yesterday, then weekday and date).
- A bubble shows "Template: name", an attachment placeholder with its file name, the text, the problem for failed or
  waiting messages, the sender for outbound messages, the time and ticks: a clock (sending or waiting), one tick (sent),
  two (delivered), two coloured (read), an alert (not sent).
- Retry shows on a failed message that this screen sent, or any failed text message.
- The composer offers free text only while the window is open: Enter sends (not while composing with an input method),
  Shift+Enter adds a line, the box grows, 4,096 characters, "Use a template" switches to templates.
- Outside the window only the template picker shows, with the reason.
- The template picker previews the body with values filled in, lists quick-reply buttons, has a field per parameter, and
  keeps Send disabled until every field is filled. With no approved template it says so.
- An opted-out conversation has no composer.
- A sent message shows at once (optimistic, under the id the screen chose) and settles when the server answers. After
  Enter the box is empty and keeps the cursor.
- Opening a conversation with unread messages marks it read for the team.
- On a narrow screen (under 760 px) the list and thread show one at a time.
- Lists under a WhatsApp menu folder: All conversations, Open conversations, All messages, WhatsApp settings.

**Contact and company pages, timeline**
- Contacts and companies have a WhatsApp tab listing their conversations, opened in place.
- On a contact, "Message this contact" opens the template picker; if a conversation is in its window, the tab offers to
  reply there.
- Every message linked to a person appears on that person's timeline at its time.

**Live updates**
- After every write, one notice per request lists the changed conversation and message ids (topic `whatsapp`).
- Each open screen holds one stream, shared by its list and thread, with an hour-long pass from the inbox route, renewed
  when under a minute is left; a 401 or 403 drops the pass.
- Notices are batched for 50 ms. The list re-reads changed conversations by id and drops those that no longer match; the
  thread re-reads changed messages of its conversation, and the header when the conversation changed.
- After a reconnect or a `resync`, the list and thread reload once, at a random moment within 5 s.
- No data or ping for 45 s means a dead line: reconnect. Reconnects back off from 1 s doubling to 30 s, times 0.75 to 1.25.
- Unchanged rows keep their identity, so nothing re-renders needlessly. Nothing polls.
- Screens read records directly through the normal API with the viewer's permissions; writes go through the app.
- Without the hub, screens update after the person's own actions.

### 3. Data model

Per tenant. Relations to person, company and member are nullable and set to null when the target is deleted.

**whatsapp_conversation**

| Field | Type | Rules | Meaning |
|---|---|---|---|
| id | uuid | PK | |
| name | text | | Profile name, phone, or the person's name when started from the CRM |
| customer_phone | text | E.164, indexed | |
| wa_id | text | | Phone digits without "+" |
| profile_name | text | | WhatsApp profile name |
| status | enum `OPEN`, `CLOSED` | default `OPEN`; index (status, last_message_at) | |
| handling | enum `AI`, `PERSON`, `HANDOFF_REQUESTED`, `AWAITING_APPROVAL` | nullable | Who InventiveChat says is answering |
| last_message_at, last_message_preview | timestamptz, text | forward only | Preview up to 140 characters |
| last_inbound_at | timestamptz | forward only | Customer last wrote |
| window_expires_at | timestamptz | | last_inbound_at plus 24 h |
| last_read_at, unread_count | timestamptz, int | unread default 0, recounted | Team-wide read position |
| opted_out | bool | default false | |
| customer_waiting | bool | default false | "Waiting for us" |
| ai_paused_until | timestamptz | | |
| state_event_at | timestamptz | | occurred_at of the last state event applied |
| consent_event_at | timestamptz | | occurred_at of the last opt-out or consent report applied |
| inventivechat_conversation_id | text | unique | |
| person_id, company_id, assignee_id | FK person, company, member | | |

**whatsapp_message**

| Field | Type | Rules | Meaning |
|---|---|---|---|
| id | uuid | PK; may be chosen by the screen | |
| name | text | | Preview, 80 characters |
| conversation_id | FK conversation | nullable, cascade delete | Empty until a send to a phone has a conversation |
| person_id | FK person | | Timeline entry |
| direction | enum `INBOUND`, `OUTBOUND` | | |
| message_type | enum `TEXT`, `TEMPLATE`, `MEDIA`, `BUTTONS`, `OTHER` | default `TEXT` | |
| text, template_name | text | | |
| media_kind, attachment_id, media_filename | text | | Media is not downloaded or shown yet |
| status | enum `QUEUED`, `SENT`, `DELIVERED`, `READ`, `FAILED` | forward only; index (status, retry_at) | |
| error | text | | Plain reason |
| sent_by_id, sent_by_name | FK member, text | | Member, or a label |
| occurred_at | timestamptz | | |
| inventivechat_message_id | text | unique | |
| idempotency_key | text | indexed | Our current send key |
| delivery_id | text | unique | Gateway delivery id, or `campaign:<recipient id>` |
| gateway_event, batch_id, status_callback_url | text | batch_id indexed | |
| retry_at, waiting_for | timestamptz, text | | `person`, `meta` or `busy` |
| send_payload | json | | `{ route: "phone", to, template }` or `{ route: "conversation", conversationId, template }` for automated and gateway templates |
| recipient_phone | text | | |

**whatsapp_settings** (one per tenant; if extra rows exist, the oldest counts)

| Field | Set by | Meaning |
|---|---|---|
| name, display_name, phone_number | connect | Business name and number shown |
| whatsapp_account_id | connect or admin | Number id (`wac_...`) for new conversations |
| tenant_id | connect | InventiveChat account id |
| subscription_id, webhook_url, webhook_secret | connect | Webhook; the secret is sealed |
| webhook_problem | connect, disconnect | "Connection problem" |
| key_fingerprint | connect | Which connection's key to use |
| auto_create_people | admin, default true | Add unknown numbers as people |
| gateway_templates | admin | JSON mapping overrides (section 6) |
| default_language_code | admin, default `en_GB` | Template language |
| event_cursor, events_checked_at, events_problem | catch-up | Feed position, last full catch-up, "Missed events" |
| catch_up_lease_until | catch-up | Lease |

Elsewhere: the tenant's connection holds the key, encrypted, with its fingerprint and an auth-failure flag. The person
fields `whatsapp_opt_in` and `whatsapp_marketing_consent` belong to Quotes & Invoices and Campaign Studio and are written
only if those apps are installed.

Uniqueness, and the bug each prevents:
- inventivechat_conversation_id: two webhooks for a new customer at once create one conversation, and only its creator may add a person, so no duplicate people;
- inventivechat_message_id: retries, replays and the feed overlapping webhooks record each message once, so unread is not inflated;
- delivery_id: another app retrying after a timeout, or a repeated campaign batch, sends once per delivery or recipient;
- the message id chosen by the screen: a double submit or Retry reuses one record and never sends a sent message again.

### 4. Edge cases and bugs found

- The composer kept the text after Enter → in the app sandbox Enter cannot be cancelled in time; the newline reached the
  box after the send and its stale change event put the text back → each send mounts a fresh box and ignores changes
  from a replaced one, keeping focus. Checked in a browser.
- Resync storms after a realtime restart → every open screen reloaded at once, one app call each → each screen waits a
  random 0 to 5 s.
- The crashed-send notice was dropped → `message.send_outcome_unknown` has no message id, so it was read as malformed →
  match it by our idempotency key; fail the message with the reason; take it off the retry queue; tell the calling app.
- A 502 `outcome_unknown` retried with the same key → the same key only ever answers 409 `outcome_unknown`, and a new key
  could send twice → unknown outcome is final; a person decides, and Retry uses a new key.
- Claims not released → a claim outlives the send, so the next automated reply was refused `already_claimed` until it
  expired → release after every send, sent or refused; claim afresh per attempt, since a released claim gives `claim_invalid`.
- Late retries overwriting newer state → InventiveChat retries for a day and can reorder, so an old takeover would undo
  a hand-back → apply state only if occurred_at is not older than the last applied (one conditional update); equal applies.
- A STOP and a START swapping places → a late retry of the STOP after the START would leave the customer opted out → the same
  rule on a separate consent time.
- Catch-up stalling under load → a run that ran out of time mid-page saved nothing, so the next run redid the same half
  page and never got further → save the position of the last event processed; skip already-recorded messages with one
  lookup per page.
- A tenant using an old connection's key → connecting another key left the earlier one, listed in no set order, so a
  run could use the old key → save the key fingerprint with the settings and prefer it; otherwise always the same one.
- Twenty refused a query that uses the same root field twice → the two automation counts (per contact, per minute) are
  two queries. In SQL, one query with two `FILTER` clauses does it.
- The gateway URL must be per tenant → `WHATSAPP_GATEWAY_URL` is shared by all tenants on a server, so a full address
  sent every tenant's notifications to one tenant's app (where they were refused: failed, not leaked) → the value is a
  path resolved against the sending tenant's own address.
- Notifications during a takeover with no time limit → a short retry timer would only get 423 again → wait for the
  hand-back event, with a 24-hour give-up.
- A held notification whose outcome later became unknown → would have been sent again from the queue → the notice
  fails it and clears its send-again time.
- Replays and late webhooks → inflated unread, statuses moving back, an old preview winning → unread recounted from
  messages; status, last message and preview only move forward, by conditional updates.
- Callbacks to arbitrary hosts → a request could make the CRM post signed statuses anywhere → only an app route of this
  tenant (its own hosts, path `/s/`, no user info, up to 500 characters), checked on receipt and before each forward.
- Phones stored nationally, with or without a trunk 0, and strict validation on new people → both readings compared;
  a person whose number is refused is created without it.
- Automations in a loop → could flood a customer or the account's Meta limit → 5 per contact in 10 minutes, 60 a minute.
- The default "Create company when adding a new person" workflow → about 1.5 s of worker time for every person created
  from WhatsApp, the main cost of catch-up → clients who do not want it can switch it off.
- A staff text left queued after a busy answer and a page reload → shows "waiting" with no Retry button, and the retry job
  does not pick it up (no send-again time) → open; the rebuild should offer Retry on any unsent message.
- A pruned feed position → events older than 7 days cannot be read back → reported under "Missed events"; resync from
  InventiveChat's REST reads is not built (half a day to a day).
- Open question to InventiveChat: whether disabling an already disabled subscription answers 200.

### 5. Test checklist

**Unit** (`apps/whatsapp/src/__tests__/`, 66 tests)

`signatures.test.ts`
- [ ] Correct webhook signature, also 299 s old: accepted.
- [ ] Wrong secret, timestamp 301 s off either way, altered body, missing headers or secret, non-numeric timestamp: refused.
- [ ] Gateway callback signature: matches the hand-off contract.
- [ ] Sealed webhook secret: opens only in the same tenant for the same subscription.
- [ ] `WHATSAPP_APP_SECRET` under 32 characters: sealing refuses to work.
- [ ] Key fingerprint: 16 hex characters, different per key.
- [ ] Realtime publish: signed over timestamp and raw body.
- [ ] Realtime pass: one member, topic `whatsapp`, expires after an hour.

`phones.test.ts`
- [ ] WhatsApp ids and international numbers in any layout: become E.164.
- [ ] Empty, words, too short, "+0...", null: not phone numbers.
- [ ] Stored national number plus calling code, with or without trunk 0: read correctly; no calling code gives nothing.
- [ ] Primary and additional numbers: match exactly; another country code does not.
- [ ] Several numbers: the primary is messaged first, else the first international one.
- [ ] Database search: narrows by the last 7 digits, LIKE wildcards escaped.

`rules.test.ts`
- [ ] Sent, delivered, read: move in order; going back is ignored.
- [ ] Failure after delivered or read: ignored; delivered after a failure: applies.
- [ ] Customer writes: window open for exactly 24 hours.
- [ ] Any POST: wrapped in the envelope InventiveChat checks (control characters stripped, `cor_` ids).
- [ ] Number choice: the active one, by default only when exactly one.
- [ ] Templates: chosen by language order and approval; values fill by name or in template order.
- [ ] Each refusal code: sorted into short wait, long wait or final.
- [ ] Each refusal code: explained in plain words.
- [ ] Waits: as long as InventiveChat asks, or until hand-back with the 24-hour give-up.
- [ ] Idempotency key: kept while the outcome is not definite, new after a definite failure.

`events.test.ts`
- [ ] `message.received`: maps onto a conversation and an inbound message.
- [ ] Echo from the business phone: stored as outbound.
- [ ] Status update of our send: keeps our key and the CRM sender; templates and voice notes map.
- [ ] Failed status: reason read from Meta's errors array.
- [ ] `conversation.updated`: AI, person, expired pause, approval and closed read correctly.
- [ ] Opt-out, consent, hand-off request: read, customer as a bare WhatsApp id.
- [ ] `message.send_outcome_unknown`: named by our key; without a key, unreadable.
- [ ] Unknown type: ignored; unreadable body: refused.

`gateway.test.ts`
- [ ] `invoice.send`, `feedback.survey`: named parameters filled by the default mapping.
- [ ] Unapproved template, unfilled parameter, unknown event, national phone, bad delivery id: explained, nothing sent.
- [ ] Callback on another host: refused; on the tenant's custom domain: kept.
- [ ] Campaign batch: one send per recipient, parameters in template order, bad recipients rejected.
- [ ] Repeated batch: answered from records (sent and waiting accepted, failed sent again).
- [ ] Wait: answered 202 queued, never as a failure.
- [ ] Settings mapping and request paths: read safely (amounts, firstName, bad JSON, bad paths).
- [ ] Look-alike hosts, other tenants, other paths, user info, scripts: never a callback target.
- [ ] Callback bodies: the shapes the other apps expect (no "sent" for campaigns, nothing for queued).

`claims.test.ts`
- [ ] Automated reply: latest message read, claimed, sent, released, in that order.
- [ ] Refused send: claim released, refusal passed on.
- [ ] Two attempts: two claims, one send key.
- [ ] InventiveChat stops answering: no release attempted.
- [ ] Release fails after a send: the send still succeeds.
- [ ] Customer never wrote: refused before claiming.
- [ ] 502 or 409 `outcome_unknown`: never retried, explained.
- [ ] `claim_invalid`: explained.

`catch-up.test.ts`
- [ ] Two pages from the stored position: every event applied, each position stored, lease released.
- [ ] No position: starts at the newest event, replays nothing.
- [ ] Messages already recorded at that status: skipped, one lookup per page.
- [ ] Event for another account: ignored.
- [ ] Time runs out mid-page: position of the last event processed kept.
- [ ] Time runs out before any event: position unchanged.
- [ ] 410 `cursor_expired`: "Missed events" set, feed read from its oldest event.
- [ ] Lease held by another run: feed not read.

`connections.test.ts`
- [ ] Older connection still present: the key saved in settings is used.
- [ ] No or broken saved key: the same fallback every time.

`thread.test.ts`
- [ ] Nothing changed: the same list and rows kept.
- [ ] Changes: only the changed row replaced, new ones in order, removed and non-matching dropped.
- [ ] Inbox filters: mine, unassigned, all, closed.
- [ ] Ticks: sending, waiting, sent, delivered, read, failed.
- [ ] Relative times: read like a messaging app.
- [ ] Reconnects: back off from 1 s to 30 s with jitter.
- [ ] Event stream split across chunks: parsed, heartbeats reported.

**End to end** (`tests/whatsapp/e2e.mjs` against the double, 62 checks)

Connecting
- [ ] Connect page with a foreign callback: 400.
- [ ] Key InventiveChat refuses: not connected.
- [ ] Valid key: connected.
- [ ] Webhook: registered for every event type.
- [ ] Settings: account and its only active number saved; secret only stored sealed.
- [ ] Connecting again: old webhook disabled, new one registered.

Receiving
- [ ] Signed webhook: accepted.
- [ ] New number writes: conversation and inbound message recorded, unread, window open.
- [ ] Unknown number: becomes a person named from the profile, with the number.
- [ ] Known number: linked to the person and their company, no new person.
- [ ] Forged, stale or altered webhook: 401, nothing written.
- [ ] Replayed webhook: no second message, unread unchanged.

Staff sending
- [ ] Staff reply: text on behalf of that person, no claim.
- [ ] Reply record: sent by that person, under the id the screen chose.
- [ ] Same id again: not sent twice.
- [ ] Late "sent" after "delivered": ignored.
- [ ] 502 `outcome_unknown`: failed with the reason, not sent again.
- [ ] Its notice: accepted, message stays failed.
- [ ] Deliberate resend: new key, goes out.
- [ ] Send cut off mid-request: retried once with the same key, ends `outcome_unknown`.
- [ ] Crash notice (own actor, new correlation id): matched by our key.
- [ ] Notice for a key that is not ours: accepted and ignored.
- [ ] Mark read: unread cleared.
- [ ] Assign to me, close: applied.
- [ ] Customer writes again: conversation reopens.
- [ ] Free text outside the window: 409, never reaches InventiveChat.
- [ ] Template list: named parameters; unapproved ones with status, approved first.
- [ ] Free text to a contact: 400.
- [ ] Template to a contact: `send-to-phone` with named parameters, number id and `on_behalf_of`; conversation linked.
- [ ] Incomplete template: InventiveChat's refusal shown plainly (422).
- [ ] API key or anonymous caller on the inbox route: refused.

Gateway
- [ ] Bad or stale signature: 401; foreign callback: 400.
- [ ] `invoice.send` twice: one send, default mapping, same message id both times.
- [ ] Unapproved template for the event: 422 with the reason.
- [ ] Delivery status: forwarded, signed, to Quotes & Invoices (skipped if not installed).
- [ ] 423 `human_active`: 202 queued, waiting for the teammate, not on a short timer.
- [ ] Hand-back: releases it to the retry job.
- [ ] Retry job: sends it with the same key.
- [ ] Outcome unknown while waiting: failed, off the queue.
- [ ] Campaign batch: consent recorded, parameters by name, each recipient once, STOP skipped.
- [ ] Repeated batch: answered from what was sent.

Opt-out and state
- [ ] Opt-out: conversation marked.
- [ ] Opt-out: marketing consent withdrawn on the person (skipped without Campaign Studio).
- [ ] Send to an opted-out customer: 409.
- [ ] Approval snapshot: AI replying, customer waiting.
- [ ] Late takeover and late snapshot, older than shown: accepted, ignored.
- [ ] Newer event, and one at the same millisecond: both apply.

Realtime
- [ ] Every write: announced to the hub, signed (skipped if not configured).
- [ ] Pass: signed, one hour, this member, topic `whatsapp`.

Automation (AI tool over MCP)
- [ ] Free text without a topic: refused, not sent.
- [ ] Topic not allowed: refused, with the allowed topics.
- [ ] Allowed topic: claim for the latest message, reply on the topic, no `on_behalf_of`.
- [ ] After a refused and a sent reply: both claims released.
- [ ] Second reply straight after: not blocked.
- [ ] Sixth automated message to a contact in 10 minutes: refused, not sent.
- [ ] Template by default: sent.
- [ ] Template to a customer a teammate is handling: queued, not failed.

Catch-up
- [ ] Whole feed read after webhooks delivered it: nothing recorded twice.
- [ ] Outage: every event withheld from the CRM and kept in the feed.
- [ ] Catch-up after the outage: new customer, reply, status, hand-back, opt-out then opt-in all applied.
- [ ] Late retries, newest first, after catch-up: accepted, nothing changes.
- [ ] Pruned position: reported; events still kept are applied.

**Browser** (`tests/whatsapp/live.cjs`)
- [ ] Idle inbox for 10 s: no requests.
- [ ] Customer writes: appears in the open inbox by itself (1.5 to 2 s).
- [ ] Reply: shows at once (under 1 s; 109 ms measured).
- [ ] Enter: box empty, cursor kept.

**Load** (`tests/whatsapp/catch-up-load.mjs`)
- [ ] Tenants (own accounts) get a backlog while the CRM is stopped: scheduled runs drain every feed, nothing lost. Measured: 5 tenants, 750 events, about 145 s, 2 feed requests each.

**Tenant smoke** (`tests/qa/workspace-smoke.mjs`)
- [ ] WhatsApp records: reachable; inbox route: refuses an API key and another tenant's key.
- [ ] Unconnected tenant: webhook 401 or 503, nothing written; unsigned gateway call: 401.

### 6. Integrations and exact contracts

**InventiveChat API.** Base `INVENTIVECHAT_API_URL` plus `/v1`. Every call: `Authorization: Bearer <tenant key>`, 15 s
timeout, at least 60 ms between calls per process. Rate limit per key: 20 requests a second, burst 60, shared with
sends; a 429 answers `{"error":"rate_limited"}` with `Retry-After`.

The facts below about the latest message id, claims, release, outcome unknown, webhook retries, `occurred_at`, the feed
and the rate limit were confirmed by InventiveChat. They are on its `event-outbox` branch, not deployed yet.

Every POST body is an envelope; any other top-level field is refused:

| Field | Rule |
|---|---|
| `tenant_id` | The account id from `/v1/account`; another account's gets 403 `tenant_mismatch` |
| `actor` | `{ type: "system", id }`; ours is `inventivecrm` (InventiveChat substitutes the key's own id) |
| `correlation_id` | `cor_` plus 8 to 64 letters or digits; ours is the CRM message id without dashes |
| `idempotency_key` | 1 to 200 characters, no control characters |
| `occurred_at` | ISO date with time zone |
| `payload` | object |

Our keys: send `crm_<message id hex>_<attempt>` (the attempt grows only after a definite failure); claim `<send
key>_claim_<random>`; release `crm_release_<claim id>`; subscription `crm_subscription_<uuid>`; disable
`crm_disable_<subscription id>`; consent `crm_consent_<digits>_<yes|no>_<uuid>`.

| Call | Payload | Answer |
|---|---|---|
| `GET /account` | | `{ tenant: { id, name }, numbers: [{ id: "wac_...", display_phone_number, verified_name, status }], settings }`; we read tenant and numbers |
| `GET /subscriptions` | | `{ subscriptions: [{ id, url, event_types, status, created_at }] }` |
| `POST /subscriptions` | `{ url, event_types }` | 201 `{ id, secret }`; the secret is shown once; at most 10 active |
| `POST /subscriptions/:id/disable` | `{}` | `{ id, status: "disabled" }`; there is no delete |
| `GET /templates` | | `{ templates: [{ name, language, category, body, parameters, quick_replies, status }] }`; body uses `{{name}}`; status approved, pending, paused, rejected or disabled |
| `POST /messages/send` | `{ conversation_id, type: "text", body }` or `{ conversation_id, type: "template", template: { name, language_code, parameters: { name: value } } }`, plus `on_behalf_of: { crm_member_id, name }` (staff) or `claim_id` and `topic` (automation text) | `{ message_id, conversation_id, replayed? }` |
| `POST /messages/send-to-phone` | `{ to: E.164, whatsapp_account_id?, type: "template", template, on_behalf_of? }` | `{ message_id, conversation_id }`; starts or reuses the conversation |
| `GET /conversations/:id` | | `latest_message_id` at the top level: the latest inbound customer message only, or null if the customer never wrote |
| `POST /conversations/:id/claim` | `{ claimant: "ai", latest_message_id, ttl_seconds }` (default 120, 1 to 300; we use 60) | `{ claimed: true, claim_id, expires_at }` |
| `POST /conversations/:id/release` | `{ claim_id }` | always 200 `{ released: true }` |
| `POST /contacts/consent` | `{ phone, consent, source: "crm", given_at?, proof? }` | `{ phone, consent, marketing_allowed }` (false after a STOP) |
| `GET /events/feed?after=&limit=` | | see "Event feed" |

Rules:
- A claim stays held after a send, sent or refused, until it expires, is released, or a new inbound message, a takeover
  or a pause clears it. A send under a cleared claim answers 409 `claim_invalid`.
- Sends are at most once. A Meta timeout answers 502 `{ reason: "outcome_unknown" }`; the same key then always answers
  409 `outcome_unknown`. To resend deliberately, use a new key.
- Automation text (no `on_behalf_of`) needs a live claim and an allowed topic; by default no topic is allowed and each
  conversation needs a person's approval.
- A template without `on_behalf_of` is a notification, held back (423) while a teammate is active.

Refusals are flat: `{ reason, ... }` for an operation, `{ error, details }` for the envelope or the key.

| Code | Status | Meaning, our handling |
|---|---|---|
| `invalid_envelope` | 400 | `details[]`; shown as "InventiveChat refused the request: ..." |
| `unauthenticated` | 401 | Key refused; "reconnect WhatsApp" |
| `tenant_mismatch`, `operation_not_allowed_for_actor` | 403 | Key or account wrong; admin reconnects |
| `invalid_payload` | 422 | `errors[]`, shown as they are |
| `outside_window` | 422 | Free text outside 24 h |
| `whatsapp_account_id_required` | 422 | Several numbers, none given |
| `conversation_not_found` | 404 | |
| `opted_out` | 409 | |
| `awaiting_approval`, `paused`, `newer_message`, `already_claimed`, `human_active` | 409 | Claim refusals, passed on as they are |
| `claim_invalid` | 409 | Claim cleared during the send |
| `out_of_scope` | 422 | `allowed_topics[]`, `action: "handoff"` |
| `human_active` | 423 | On a notification send: `paused_until` and `retry_after_seconds`, either may be null; long wait |
| `meta_rate_limited` | 429 | `retry_after_seconds`, `meta_error { code, title }`; long wait |
| `rate_limited`, `too_many_concurrent_sends` | 429 | Short wait, `Retry-After`; retried with backoff |
| `provider_rejected` | 502 | Final; "WhatsApp refused the message: <title> (Meta error <code>)" |
| `outcome_unknown` | 502, then 409 | Final, see section 2 |
| `cursor_expired` | 410 | Feed position pruned |
| feed `after` malformed | 422 | |

Retry rule in the app: retry within the request (backoff 400 ms doubling to 4 s plus up to 200 ms jitter, or
`Retry-After`) for unreachable, 429 other than the long waits, and 5xx other than `provider_rejected` and
`outcome_unknown`; defer for `human_active` and `meta_rate_limited`; everything else is final.

**Webhooks from InventiveChat.**
- Headers: `X-Event-Id`, `X-Event-Type`, `X-Signature-Timestamp` (unix seconds), `X-Signature-256` = `sha256=` plus hex
  HMAC-SHA256 with the subscription secret over `<timestamp>.<raw body>`.
- Body: an envelope `{ tenant_id, actor, correlation_id, idempotency_key, occurred_at, payload: { type, data } }`;
  `idempotency_key` equals `X-Event-Id`.
- Retries: 15 attempts, waiting min(30 s × 2^(n-1), 4 h) × a random 0.5 to 1.5 between them, about 24 h in total. Body,
  `X-Event-Id` and `occurred_at` are identical on every retry; only the two signature headers change. Retries can reorder
  deliveries.
- `occurred_at` is set once, when the event is created, in milliseconds of InventiveChat's clock, not commit order. Drop
  a state event only if strictly older than the last applied; apply equal times. `conversation.updated` is a full snapshot.
- Our answers: 200 `{ ok, ... }`, 400, 401, 403, 503 (not connected), 500 (retry).

| Event | `data` |
|---|---|
| `message.received`, `message.sent`, `message.status_updated` | `{ message: { id, conversation_id, whatsapp_account_id, customer (digits), profile_name, direction (inbound, outbound, echo), sender { type, id ("crm:<member id>" for staff), name }, type, text, template { name, parameters }, attachment { id, kind, mime_type, filename, voice, status }, status, ai_topic, imported_from_history, idempotency_key (ours for our sends), sent_at, received_at }, status?, errors? [{ code, title, message }] }` |
| `message.send_outcome_unknown` | `{ conversation_id, idempotency_key (ours), detail }`, no message id. `X-Event-Id` is `message.send_outcome_unknown:<our key>`. A crash mid-send is reported about 1 to 2 minutes later with actor `messaging-service` and a fresh correlation id |
| `conversation.updated` | `{ conversation_id, whatsapp_account_id, customer, profile_name, state (AI_ACTIVE, HUMAN_ACTIVE, AWAITING_APPROVAL, CLOSED), automation_approved, automation_replying, ai_paused_until, customer_waiting, last_message_at }` |
| `conversation.human_takeover`, `.handoff_requested`, `.ai_resumed`, `.ai_approved` | `{ conversation_id }` |
| `customer.opted_out` | `{ customer, conversation_id?, profile_name? }` |
| `consent.updated` | `{ customer, consent, source, at, opted_out }` |
| `conversation.ready_for_reply`, `template.status_updated` | ignored |

Status words: queued, accepted and pending are queued; sent; delivered; read; failed and undeliverable are failed.

**Event feed.** `GET /v1/events/feed?after=<cursor>&limit=1..500` (default 100) answers `{ events: [{ cursor, event }],
next_cursor, has_more }`, where `event` is the webhook envelope.
- Commit order; paging never skips or repeats an event. Any event's cursor works as `after`. `after=latest` gives the
  newest position; no `after` starts at the oldest event kept.
- 410 `cursor_expired` means the events were pruned (7-day retention); 422 means a malformed cursor.
- Every event of the business is in the feed. `event.idempotency_key` equals the webhook's `X-Event-Id`.
- An optional `subscription_id` parameter adds webhook-identical signatures (we do not use it).

**Gateway for the other apps** (`apps/commercial-docs/WHATSAPP_HANDOFF.md`). `POST /s/whatsapp/gateway`, JSON, headers
`X-InventiveCRM-Timestamp` (unix seconds) and `X-InventiveCRM-Signature` = `sha256=` plus hex HMAC-SHA256 with
`WHATSAPP_GATEWAY_SECRET` over `<timestamp>.<raw body>`; 5-minute window, constant-time compare. Senders set
`WHATSAPP_GATEWAY_URL` to the path `/s/whatsapp/gateway`, resolved against their own tenant address.

Single events: `{ event, deliveryId (1 to 100 of letters, digits, ":", "_", "-", not starting "campaign:"), business: {
name }, recipient: { name, phone (E.164) }, document: { number, total, amountDue (amount objects with formatted), dueDate,
validUntil, pdf: { url }, paymentUrl }, survey: { url, question }, statusCallbackUrl? }`.

| Event | Default template | Parameters (request field) |
|---|---|---|
| `invoice.send` | `invoice_ready` | customer_name, business_name, invoice_number, amount_due, due_date, invoice_link (`document.pdf.url`) |
| `credit_note.send` | `credit_note_ready` | customer_name, business_name, credit_note_number, amount (`document.total`), document_link |
| `quote.send` | `quote_ready` | customer_name, business_name, quote_number, total, valid_until, quote_link |
| `invoice.overdue_reminder` | `invoice_overdue` | customer_name, business_name, invoice_number, amount_due, due_date, payment_link (`document.paymentUrl`) |
| `invoice.payment_link` | `invoice_payment_link` | customer_name, business_name, invoice_number, amount_due, payment_link |
| `feedback.survey` | `feedback_request` | customer_name, business_name, survey_link (`survey.url`) |

`customer_name` is `recipient.firstName`, read as the first word of `recipient.name`; `business_name` is
`business.name`; an amount object gives its `formatted` text. A tenant override in settings:
`{ "<event>": { "name", "language"?, "parameters": { "<parameter>": "<dotted path>" } } }`; invalid entries are dropped.

Answers: 200 `{ messageId }`; 202 `{ messageId: null, queued: true, retryAt, reason }`; 400, 401, 422 `{ error }`; 503
not connected or templates unreadable; 500.

Campaigns: `{ event: "campaign.message", campaignId, batchId, template: { name, language }, messages: [{ recipientId
(uuid), to, variables[], optOutUrl }], statusCallbackUrl }`; `variables` fill the template's parameters in its order.
Answer 200 `{ accepted: [{ recipientId, messageId | null }] }`; messages left out count as failed.

Status callbacks, signed the same way: documents `{ deliveryId, messageId?, status: sent | delivered | read | failed,
error? }`; campaigns `{ recipientId, status: delivered | read | failed | opted_out, error? }`. 3 s timeout. Receivers
move statuses forward only, so a repeat is harmless.

**Inbox route.** `POST /s/whatsapp/api`, `{ action, ... }`; refusals are `{ error }` (plus `message`, the saved record,
for a refused send) with 400, 403, 404, 409, 422, 429, 502 or 503.

| Action | Input | Answer |
|---|---|---|
| `send` | `conversationId` with `text` or `template { name, languageCode, parameters }`, or `personId` with `template`; optional `clientMessageId` (uuid) | `{ message }` |
| `templates` | | `{ templates }` |
| `markRead` | `conversationId` | `{ unread }` |
| `assign` | `conversationId`, `memberId` (omitted: me; null: nobody) | `{ assigneeId }` |
| `close`, `reopen` | `conversationId` | `{ status }` |
| `realtimeToken` | | `{ url, token, expiresAt }` or `{ url: null }` |

Other routes: `GET /s/whatsapp/connect?callback=` (the key page), `POST /s/whatsapp/connect-status { fingerprint }`
(`{ connected }`), `POST /s/whatsapp/retry` (signed-in; `{ sent, waiting, failed, catchUp }`).

**Realtime.** Topic `whatsapp`; one publish per request: `{ kind: "conversation", ids }` and `{ kind: "message", ids }`
with CRM record ids. Pass and publish formats are in part 3a.

**Where credentials go.** Values live in the server's secret files and the password manager, never here.

| Name | Scope | Use |
|---|---|---|
| `INVENTIVECHAT_API_URL` | server | InventiveChat's address; `/v1` is added |
| `WHATSAPP_APP_SECRET` | server, 32 or more characters | Seals each tenant's webhook secret; changing it means reconnecting every tenant |
| `WHATSAPP_GATEWAY_SECRET` | server | The same value as in Quotes & Invoices, Feedback and Campaign Studio; signs gateway requests and status callbacks |
| `REALTIME_SECRET`, `REALTIME_INTERNAL_URL`, `REALTIME_PUBLIC_URL` | server | The realtime hub; empty URLs turn live updates off |
| `WHATSAPP_GATEWAY_URL` | server, in the other apps | The path `/s/whatsapp/gateway` |
| `TWENTY_FUNCTIONS_URL` | server, optional | Where app routes are reached when not the tenant's own address; used for the webhook address and allowed callback hosts |
| InventiveChat system key `wa_...` | tenant | Stored encrypted as the tenant's connection; pasted by staff |
| Webhook signing secret | tenant | Sealed in settings |

### 7. Settings and configuration

Per tenant (WhatsApp settings record): number id (`wac_...`, needed when the account has several active numbers), "Add
unknown numbers as people" (default on), template language (default `en_GB`), templates for app notifications (JSON).
Everything else in settings is maintained by the app. Recommended hardening per tenant: remove the Member role's edit
rights on the WhatsApp objects; reading stays open for the inbox.

On InventiveChat, per tenant: the account, its number, a system key, the templates named in section 6 with those
parameter names (or a mapping in settings), allowed automation topics and approvals if automations should send free text.

| Limit or timer | Value |
|---|---|
| Window for free text | 24 h after the customer last wrote |
| Staff sends | 30 a minute per person |
| Automations | 5 per contact per 10 minutes; 60 a minute |
| Text | 4,096 characters |
| Template parameters | 20, each up to 1,024 characters |
| Claim | 60 s |
| Budgets | inbox send 12 s, gateway 22 s (batch 20 s), automation 40 s, retry run 40 s, catch-up 150 s |
| Retry job | every 15 minutes (minutes 9, 24, 39, 54); 60 messages, 3 at a time |
| Waits | busy 2 min, Meta limit 15 min, or as InventiveChat says; give up after 24 h |
| Feed | 100 a page, 200 ms between pages |
| Calls to InventiveChat | 60 ms apart, 15 s timeout |
| Inbox | the 50 newest conversations per filter (no paging); 40 messages a page |
| Pass | 1 hour |

### 8. Notes for the rebuild

- Keep `inventivechat.ts` as the model: one module owns the whole contract, and a strict double refuses drift.
- Put the four uniqueness rules in the database, and both "only if newer" rules (state, consent) in conditional updates.
- Unknown outcome is a state, not an error. Keep the key until the outcome is known; new key only after a definite failure.
- Webhooks are not enough: read the feed from a stored cursor, with a lease, a time budget and a position saved per event.
- Build what is missing: resync from InventiveChat's REST reads after a pruned position; media display and sending;
  per-person unread; Retry for any unsent message; a richer timeline card.
- Before go-live: InventiveChat deployed with the event outbox, a domain and HTTPS, Meta approval, templates per tenant;
  then rerun `tests/whatsapp/e2e.mjs` against the real service where possible.
