# Iwcrm handover, part 2b: Campaign Studio

This describes how the current Campaign Studio app behaves, not its Twenty code. Part 2a covers Quotes & Invoices.
A "tenant" is one client workspace; "the app's own identity" is the service account background work acts as.

## 1. Purpose

Campaign Studio lets each tenant design and send marketing email campaigns through the tenant's own Resend account, and
WhatsApp marketing campaigns through our WhatsApp gateway (InventiveChat). It only ever contacts people who agreed to
marketing on that channel, honours unsubscribes, bounces and spam complaints, and reports delivery, opens, clicks and
failures per campaign.

## 2. Features and business rules

### Campaigns

- A campaign has one channel, Email (default) or WhatsApp, fixed when the draft is created.
- A new draft is named "New email campaign" or "New WhatsApp campaign" unless named (at most 200 characters), takes the
  brand kit's business name as From name and `hello` as the address before the @.
- A new email draft starts from one of six starter designs (Blank, Simple letter, Monthly newsletter, Special offer,
  Event invitation, Announcement) or a saved template; an unknown starter falls back to Blank.
- Only a Draft can be edited ("Only drafts can be changed. Duplicate the campaign to make a new version.").
- Limits: subject, names, addresses and template name at most 250 characters; preview text 200; WhatsApp values at
  most 12 entries, names 20 characters, values 500.
- Duplicate creates a Draft "<name> (copy)" with the same content and audience, and no counts, schedule or snapshot.
- Before scheduling, an email campaign must have: an audience; a subject; an address before the @ matching
  `[a-z0-9._+-]{1,64}` (any case); a valid reply-to if one is set; at least one design block; the brand kit footer
  (business name and postal address); text and a safe link on every button and an https link on every image; a
  connected Resend account that can be reached; and a chosen sending domain that is `verified` in that account. The
  studio shows the same list as a checklist.
- Before scheduling, a WhatsApp campaign must have an audience, a template name matching `^[a-z0-9_]{1,512}$`, and the
  server's gateway settings present.
- The send time must be between one minute ago and 366 days ahead; a time in the past is treated as now.
- Scheduling is a conditional move from Draft to Scheduled, so two people scheduling the same draft at once produce one
  schedule and one "This campaign is no longer a draft." refusal.
- Unschedule moves a Scheduled campaign back to Draft and clears the send time.
- Campaign statuses and moves:

| From | To | When |
|---|---|---|
| Draft | Scheduled | Schedule, all checks pass |
| Scheduled | Draft | Unschedule |
| Scheduled | Preparing | The job finds the send time has passed and every check passes; records the start time and a snapshot of the brand kit |
| Scheduled | Scheduled | Same, but the only problem is that Resend could not be reached: the problem is shown and the next run tries again |
| Scheduled | Failed | Same, with any other problem |
| Preparing | Sending | The whole audience is prepared and the content checks still pass |
| Preparing | Failed | Content checks fail after preparation, the mailing list was deleted, or a permanent error |
| Sending | Sent | No recipient is queued or in flight; records the finish time and clears the problem text |
| Preparing, Sending | Cancelled | Stop sending |
| Preparing, Sending | Failed | A permanent error (see Quotas and rate limits) |
| Failed, Cancelled | Sending or Preparing | Resume, only if the campaign had started; to Sending when preparation had finished, else Preparing |

- Every status move is one conditional update that names the statuses it may move from, so concurrent actions cannot
  both apply.

### Audience building

- The audience is one mailing list or "Everyone who agreed (email)" / "(WhatsApp)" on the campaign's channel.
- Adding contacts to a list adds each person once (at most 500 per call). "Add everyone who agreed" adds every
  consenting contact on a channel, up to 20,000 per call. Removing deletes that membership only. The member count is
  recalculated after each add or remove in the studio.
- People search needs 2 characters, matches first name, last name or email case-insensitively (with `%`, `_` and `\`
  literal), returns at most 20, and is debounced 300 ms. The list screen shows 200 members, newest first, and the total.
- Preparation turns the audience into one recipient row per person, 200 people per page. Every person gets a row, so
  the report can say why someone was skipped.
- A person is queued only if all of these hold, checked in this order; otherwise the row is Skipped with the reason:
  1. they agreed on this channel ("Has not agreed to marketing.");
  2. they have a usable address ("No valid email address." or "No mobile number with a country code.");
  3. the address is not on the do-not-contact list ("On the do-not-contact list.");
  4. no earlier person in this campaign has the same address ("Same address as another contact.").
- A usable email is at most 254 characters, has one @, a dot in the domain, a domain ending of at least 2 characters,
  and no spaces, quotes, angle brackets, commas or semicolons.
- Email addresses are compared trimmed and lower-cased.
- A usable WhatsApp number is E.164: `+`, then a first digit 1 to 9, then 8 to 15 digits in total.
- A number stored with a leading `+` keeps its digits as they are. Otherwise the number loses spaces, punctuation and
  leading zeros, and gets the stored calling code in front. A number with no calling code is unusable and is never
  guessed.
- Each queued row stores the contact's first name, last name and company as they were at preparation, and a random
  12-byte link key.
- Preparation is resumable: progress is saved after each page, and a page seen twice (after a crash) or a person already
  in the campaign is not queued again.
- Preparation stops when the run's time is nearly used up and carries on in the next run.

### Consent and suppressions

- Every contact has two consent flags: "Agreed to marketing emails" and "Agreed to marketing on WhatsApp". Both default
  to false, and nothing in the app sets them to true.
- The do-not-contact list holds an address (email or phone), its channel, a reason (Unsubscribed, Hard bounce, Marked
  as spam, Added by hand), the campaign it came from, and a note.
- An address is added to the do-not-contact list once per channel. Adding an address that is already there does
  nothing.
- Addresses on the list are normalised (email trimmed and lower-cased; phone reduced to digits and `+`) when compared,
  so a hand-typed entry in another case still blocks.
- Right before each batch, every queued recipient is checked again. A row is Skipped if any of these is true:
  - the contact was deleted ("The contact was deleted.");
  - consent was withdrawn ("Withdrew consent before sending.");
  - the contact's current address differs from the prepared one ("Their address changed after the campaign was
    prepared."); neither the old nor the new address is sent to;
  - the address is now on the do-not-contact list ("On the do-not-contact list.").
- Unsubscribing, a spam complaint and a WhatsApp opt-out each set the contact's consent for that channel to false.

### Sending in batches under a lease

- One background job runs every 5 minutes per tenant; a signed-in member can also start a run by hand. A run has a 90
  second budget and is killed at 110 seconds.
- A run first starts due Scheduled campaigns, then works on Preparing and Sending ones (at most 50 per lookup, oldest
  send time first).
- A run works on a campaign only after taking its lease: one conditional update sets "being worked on until" to now +
  105 s if it is empty or past; otherwise the campaign is skipped. The lease is released when the run is done with the
  campaign, whatever happened; a crashed run's lease expires on its own.
- A page is prepared only with 15 s left and a batch started only with 45 s left (a provider call may take its full
  30 s timeout and must then be recorded). At most 40 batches per campaign per run.
- Each sending run first checks the Resend key is still connected and the domain still verified; if not the campaign
  fails ("The Resend account was disconnected..." or "The domain ... is no longer verified...").
- The campaign status is re-read before every batch, so Stop takes effect before the next batch.
- A batch is at most 100 queued rows, oldest first then by id. Claiming is one conditional update moving rows still
  Queued to Sending with a new batch key `<campaign id>:<random UUID>`; only rows actually moved are sent.
- An email batch is one Resend batch request with the batch key as idempotency key, rendered from the brand snapshot
  (taken at Preparing) and each row's stored personalisation, so a retry produces the same request.
- Resend answers one message id per email, in order: with an id the row becomes Sent; without, Failed ("Resend did not
  accept this message."). Results are one write per outcome per batch, touching only rows still in Sending with that
  key, so a delivery or bounce recorded meanwhile is kept.
- If Resend refuses the batch as invalid (400 or 422), the rows still in Sending go one by one, at least 600 ms apart,
  each with idempotency key `<batch key>:<recipient id>`. An invalid one is Failed with Resend's message; "already used
  with a different body" counts as sent; any other error stops the run after recording what was done.
- Rows left in Sending by a crash or timeout are recovered at the start of the next run: the batch is rebuilt from
  every row carrying its key, whatever their status now, in the original order, and sent again with the same key.
  If its oldest row was claimed over 23 hours ago it is not resent; rows still in Sending become Failed ("Sending was
  interrupted and could not be confirmed.").
- Recipient statuses and moves:

| From | To | By |
|---|---|---|
| (new) | Queued or Skipped | Preparation |
| Queued | Skipped | The check before a batch, or Stop sending |
| Queued | Sending | Batch claim |
| Sending | Queued | Batch refused outright (batch key cleared) |
| Sending | Sent | Accepted by Resend or the gateway |
| Sending | Failed | Invalid message, not accepted, or unconfirmed after 23 h |
| Sending, Sent | Delivered | Delivery event |
| Sending, Sent, Delivered | Bounced, Marked as spam, Unsubscribed | Bounce, complaint or unsubscribe |
| Sending, Sent | Failed | Failure or suppression event |
| Skipped ("Stopped before sending.") | Queued | Resume |

### Quotas and rate limits

- Resend errors are classified:

| Resend answer | Meaning | What happens |
|---|---|---|
| 429 `rate_limit_exceeded` with retry-after up to 10 s | Slow down | In single sends, wait and retry once if the run still has time; otherwise as below |
| 429 (any, including `daily_quota_exceeded`, `monthly_quota_exceeded`), 401, 403 | Refused outright, nothing was sent | A first attempt is released back to Queued; the campaign pauses (429) or fails (401, 403) |
| 409 `invalid_idempotent_request` | The key was used with a different body: the first request was sent | Treated as sent |
| 409 `concurrent_idempotent_requests` | The same request is still in progress | Pause and retry later |
| 400, 422 | One message is invalid | Fall back to one-by-one sending |
| 5xx, timeout, network failure | Outcome unknown | Pause; the batch stays in Sending and is recovered with the same key |

- A batch released after a refusal is sent next time under a new batch key.
- A recovered batch that is refused again is not released, since its first attempt may have been taken.
- A pause leaves the status unchanged and shows the reason; the next run carries on by itself. Pause reasons:
  - "Your Resend plan limit is reached. Sending continues automatically when it resets." (quota)
  - "Resend asked us to slow down. Sending continues shortly." (429)
  - "The CRM was busy or restarting. Sending is retried every five minutes." (our own API timed out, restarted, answered
    without a body, or reported a read timeout or a dropped database connection)
  - "The sending service could not be reached. Sending is retried every five minutes." (anything else transient)
- Any other error fails the campaign with its message (at most 500 characters).
- Test sends (email only): up to 5 addresses per send and 10 tests per hour per campaign, kept on the campaign and
  claimed by compare-and-set. The 11th gets 429; a concurrent one 409.
- A test email has `[Test] ` before the subject, uses the live brand kit and a sample contact (Alex Morgan, Example
  Ltd), a dummy unsubscribe link and no unsubscribe headers, and is tagged `campaign=test` so its events are ignored.
  It needs a connected key and a valid sending address, not a verified domain.

### Pause and resume

- Stop sending moves Preparing or Sending to Cancelled with "Stopped by a user. Contacts not reached yet were not sent
  anything."; every Queued row becomes Skipped with "Stopped before sending.".
- A batch already handed to the provider when Stop is pressed finishes; nothing after it is sent.
- Resume needs a start time. It runs all the checks again (with the campaign's brand snapshot), then moves Failed or
  Cancelled back to Sending or Preparing and re-queues the rows skipped by Stop. Nobody gets the campaign twice.
- Rows skipped for other reasons (consent, address, do-not-contact) stay skipped on resume.
- Rows left in Sending by a failure are recovered on the next run (or failed after 23 hours).

### Tracking

- Open and click tracking are switched on per domain in the tenant's Resend dashboard; the app only shows whether they
  are on.
- Delivery events reach the app through a Resend webhook registered on the tenant's Resend account for seven events:
  `email.delivered`, `email.bounced`, `email.complained`, `email.opened`, `email.clicked`, `email.failed`,
  `email.suppressed`.
- The webhook is registered when the key is connected, if the tenant's address is public https. Otherwise the studio
  offers "Turn on delivery tracking", which refuses until the address is https.
- An event finds its recipient by the `recipient` tag the email carried, falling back to the provider message id.
  Events for other email on the same Resend account are answered 200 and ignored.
- Event effects:

| Event | Status move | Recorded |
|---|---|---|
| `email.delivered` | to Delivered from Sending or Sent | delivered time |
| `email.opened` | none | opened time |
| `email.clicked` | none | clicked time and opened time |
| `email.bounced` | to Bounced from Sending, Sent or Delivered | bounced time; bounce message as the problem |
| `email.complained` | to Marked as spam from Sending, Sent or Delivered | complained time |
| `email.failed` | to Failed from Sending or Sent | Resend's reason |
| `email.suppressed` | to Failed from Sending or Sent | "the address is on your Resend suppression list" |
| anything else | none | ignored, 200 |

- The time recorded is the event's `created_at`, or now if missing or invalid.
- When a status move is not allowed, the event's time is still recorded.
- An open or click overwrites the previous time, so the stored time is the latest one.

### Unsubscribe

- Every campaign email shows the brand kit footer, "You are getting this email because you agreed to hear from
  <business>." and an Unsubscribe link, in both HTML and plain text.
- Every campaign email carries `List-Unsubscribe: <link>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
  (RFC 8058).
- The link is `<tenant address>/s/campaigns/unsubscribe/<token>`, signed per tenant and per recipient.
- Opening the link (GET) never unsubscribes, so link scanners cannot. It shows a page with one button that names the
  business and says transactional email still arrives; "You are unsubscribed" if already done; "This link is not
  valid" with 404 for a bad token. The page is no-store, noindex and no-referrer.
- A POST to the link (the button, or a mail provider's one-click) adds the address to the do-not-contact list for the
  campaign's channel (reason Unsubscribed), removes the contact's consent for that channel, moves the row to
  Unsubscribed with the time, and answers an empty 200. A second POST also answers 200; a bad token 404; an internal
  error 500.
- A token from one tenant is refused in every other, and a token with a changed character is refused.

### Bounces and complaints

- A permanent bounce (`bounce.type` = `Permanent`) adds the address to the do-not-contact list with reason Hard bounce
  and the bounce subtype as the note.
- A soft bounce marks the row Bounced but does not suppress the address, so later campaigns still try it.
- A spam complaint adds the address with reason Marked as spam and removes email consent.
- A bounce, complaint, unsubscribe or failure is never undone by a later event, and a failure report never overrides a
  delivery.
- An address on the do-not-contact list (hard bounce, complaint, unsubscribe or added by hand) is skipped in every
  later campaign of the tenant on that channel.

### WhatsApp campaigns through the gateway

- A WhatsApp campaign has no design. It names a Meta-approved marketing template, a `language` (default `en`) and
  numbered values `1`, `2`, ... that fill the template in numeric order. In each value only `{{firstName}}` (fallback
  "there") and `{{lastName}}` are replaced, from the stored personalisation.
- Each batch is one signed `campaign.message` request to the gateway (section 6). Accepted recipients become Sent;
  ones missing from the answer become Failed ("The WhatsApp service did not accept this message.").
- A gateway answer of 500 or above, or a timeout, pauses the campaign; the batch stays in Sending and is resent with
  the same batch id, which the gateway de-duplicates. Any other non-2xx fails the campaign with the gateway's error.
- Status callbacks: `delivered` → Delivered; `read` → opened time; `failed` → Failed with the error; `opted_out` →
  do-not-contact (WhatsApp, Unsubscribed), WhatsApp consent removed, row Unsubscribed.
- The opt-out link in each message is the signed unsubscribe link; it suppresses on the WhatsApp channel.
- No test sends and no click tracking for WhatsApp.
- Gateway side: each phone is recorded as consenting at InventiveChat before sending (a STOP sent there wins); at most
  3 sends at once within 20 s, the rest queued for the gateway's retry job and reported as accepted; a later STOP is
  forwarded as `opted_out` for the latest campaign message to that conversation.

### Results

- Counts per campaign:

| Count | Rule |
|---|---|
| Recipients | All rows minus skipped |
| Sent | Rows in Sent, Delivered, Bounced, Marked as spam or Unsubscribed |
| Delivered, Opened, Clicked, Bounced, Marked as spam, Unsubscribed | Rows with that time recorded |
| Failed, Skipped | Rows in that status |

- Counts are recalculated after every run that touched the campaign, and on every run for Sent campaigns finished in
  the last 14 days (newest first, up to 50). A count is only written when it changed.
- The report shows the counts and up to 25 problem rows (Bounced, Marked as spam, Failed), most recently changed
  first, with name, address, status and problem.
- While a campaign is Preparing or Sending, the report screen refreshes every 45 seconds.
- The overview shows open rate and click rate across sent campaigns as opened ÷ delivered and clicked ÷ delivered.
- Opens are labelled as estimates; clicks are called the more reliable signal.
- The studio overview shows the Resend connection (label, reachable, tracking ready, domains and their tracking flags),
  whether WhatsApp is set up, the brand kit, the 60 latest campaigns, lists, templates (up to 100 saved), consenting
  contacts per channel and the do-not-contact total.

### Email design rules

- Blocks: heading (level 1 or 2), text, image, button, two columns, divider, spacer, social links; at most 60, anything
  else from the browser is dropped. Text blocks 5,000 characters, headings 300, labels 100, links 2,000, alt text 200.
- Text markup: a blank line starts a paragraph, `**bold**`, `*italic*`, `[label](link)`.
- Variables `{{firstName}}`, `{{lastName}}`, `{{fullName}}`, `{{email}}`, `{{companyName}}`, with an optional fallback
  (`{{firstName|there}}`). An unknown variable stays visible and the preview lists it.
- Contact values are inserted after markup and HTML-escaped, so a contact named `[Win](https://evil)` stays text.
- Links may only be http(s), `mailto:` or `tel:`; images must be https; anything else is dropped.
- Image width 20 to 100 percent of 536 px; spacer 8 to 120 px.
- Brand kit colours must be `#rrggbb` ("Colours must look like #3e63dd."); the font is one of six; the logo is https
  and links to the website.
- From is `"<name>" <local@domain>` with quotes, angle brackets and line breaks removed from the name and the address
  lower-cased (no header injection). The subject is personalised and cut to 250 characters; preview text is a hidden
  preheader.
- Every email has a plain-text part: headings in capitals, links as `label (url)`, `Unsubscribe: <link>` at the end.
- The designer shows placeholders for empty images and buttons; real emails leave them out.

### Permissions and access

- The studio route and the manual run route answer only signed-in members of the tenant; API-key callers get 403. The
  studio route's 21 actions: overview, campaign, createDraft, saveDraft, preview, testSend, checks, schedule, cancel
  (unschedule or stop), resume, duplicate, report, saveTemplate, updateBrand, setupTracking, listMembers, createList,
  searchPeople, addToList, addConsentedToList, removeFromList.
- Studio actions run with the signed-in member's own permissions, limited further by the app's own role. A member
  whose role cannot edit campaigns cannot change them through the studio.
- The background job, the public pages and the webhooks act as the app's own identity. That identity can read and
  update every record and soft-delete, but never permanently delete, and cannot be given to people or API keys.
- Any signed-in member can start a run by hand. A run only does work that is already due.
- Connecting or replacing the Resend key is tenant-wide and needs the platform's application-management permission,
  which only admins hold. In practice our staff paste each client's key during onboarding, and clients stay on the
  Member role.
- Recommended hardening: remove the Member role's edit rights on Campaign, Campaign recipient and Do-not-contact
  records. Sending re-checks consent and the do-not-contact list either way.
- Public routes and what protects each:

| Route (under `<tenant address>/s/`) | Method | Protection |
|---|---|---|
| `campaigns/unsubscribe/<token>` | GET, POST | Token signed with the tenant key over the recipient's link key |
| `campaigns/webhook/<token>` | POST | Tenant-derived URL token (404 if wrong), then Svix signature (401 if bad, 503 if the secret cannot be fetched) |
| `campaigns/whatsapp/status` | POST | HMAC with the shared gateway secret and a timestamp within 5 minutes (401 if bad); 400 for an unknown recipient or status |
| `campaigns/connect?callback=...` | GET | Only renders if the callback is the platform's own connection callback with a `state` (400 otherwise) |
| `campaigns/connect-status` | POST | Takes a 16-hex-character key fingerprint and answers only yes or no |

- The studio route's errors are returned as `{ error }` with status 400, 404, 409 or 429. Unexpected errors return
  500 "Something went wrong. Please try again." and never expose internals.

## 3. Data model

Every object also has the platform's standard id, created time, updated time and soft-delete time. Sending relies on
created time and id for batch order, and on updated time for the 23-hour recovery window. No field is required at the
database level; the app enforces what it needs.

### Campaign (`marketingCampaign`)

| Field | Type | Default | Meaning |
|---|---|---|---|
| name | text | | Campaign name |
| channel | select EMAIL, WHATSAPP | EMAIL | Channel |
| status | select DRAFT, SCHEDULED, PREPARING, SENDING, SENT, CANCELLED, FAILED | DRAFT | Lifecycle (section 2) |
| subject | text | | Email subject, may hold variables |
| previewText | text | | Inbox preview line |
| fromName | text | | Sender display name |
| fromLocalPart | text | | Address before the @ |
| fromDomain | text | | Sending domain, must be verified in Resend |
| replyTo | text | | Optional reply-to |
| listId | text | | Mailing list id, or `ALL` for everyone who agreed on the channel |
| listName | text | | Audience name shown in lists |
| design | JSON | | `{ version: 1, blocks: [...] }` |
| scheduledAt | date-time | | When to send |
| startedAt | date-time | | When preparation started; required for Resume |
| sentAt | date-time | | When sending finished (label "Finished") |
| recipientCount, sentCount, deliveredCount, openedCount, clickedCount, bouncedCount, complainedCount, unsubscribedCount, failedCount, skippedCount | integer | 0 | Results (section 2) |
| whatsappTemplate | text | | Meta template name |
| whatsappVariables | JSON | | `language` and numbered values |
| lockedUntil | date-time | | Lease: being worked on until |
| prepareCursor | text | | Empty (not started), a page cursor, or `DONE` |
| lastError | text | | Pause or failure reason shown to users |
| brandSnapshot | JSON | | Brand kit as it was when sending started |
| recentTestSends | text | | Space-separated times of test sends in the last hour |

Relations: one campaign has many recipients (deleting a campaign deletes its recipients).

### Campaign recipient (`campaignRecipient`)

| Field | Type | Default | Meaning |
|---|---|---|---|
| name | text | | Contact name at preparation (at most 200 characters) |
| destination | text | | Normalised email or E.164 phone (label "Sent to") |
| status | select QUEUED, SENDING, SENT, DELIVERED, BOUNCED, COMPLAINED, UNSUBSCRIBED, FAILED, SKIPPED | QUEUED | Per-recipient lifecycle |
| providerMessageId | text | | Provider message id; read as a fallback lookup, not written by the current build |
| error | text | | Skip or failure reason (at most 300 characters) |
| batchKey | text | | `<campaign id>:<UUID>` of the batch that claimed the row |
| nonce | text | | Random 12-byte link key; empty for skipped rows |
| sentAt, deliveredAt, openedAt, clickedAt, bouncedAt, complainedAt, unsubscribedAt | date-time | | Event times |
| personalisation | JSON | | `firstName`, `lastName`, `companyName` at preparation |
| campaign | relation, many to one | | Cascade delete with the campaign |
| person | relation, many to one | | Set to empty when the person is deleted, so history is kept and the row is skipped |

Indexes: `batchKey` (claims, releases, recovery); `providerMessageId` (fallback event lookup: most events on a shared
Resend account are not campaign emails, so the miss must be cheap).

### Mailing list (`mailingList`) and list member (`mailingListMember`)

| Object | Field | Type | Default | Meaning |
|---|---|---|---|---|
| Mailing list | name | text | | List name |
| | description | text | | |
| | memberCount | integer | 0 | Refreshed by the studio after adds and removes only |
| List member | name | text | | Always "Member" |
| | list | relation, many to one | | Cascade delete with the list |
| | person | relation, many to one | | Cascade delete with the person |

### Do-not-contact entry (`campaignSuppression`)

| Field | Type | Default | Meaning |
|---|---|---|---|
| name | text | | Same as the address |
| destination | text | | Normalised email or phone |
| channel | select EMAIL, WHATSAPP | EMAIL | Channel it applies to |
| reason | select UNSUBSCRIBED, BOUNCED, COMPLAINED, MANUAL | UNSUBSCRIBED | Why |
| campaignId | text | | Campaign it came from |
| note | text | | Bounce subtype or a free note (at most 500 characters) |

### Email template (`campaignTemplate`)

| Field | Type | Default | Meaning |
|---|---|---|---|
| name | text | | Required by the studio |
| category | select NEWSLETTER, PROMOTION, EVENT, ANNOUNCEMENT, OTHER | OTHER | |
| description | text | | At most 500 characters |
| design | JSON | | Block design |

### Brand kit (`campaignBrand`)

The oldest record is the tenant's brand kit; the studio creates it on first save.

| Field | Type | Default | Meaning |
|---|---|---|---|
| name | text | | Business name |
| logoUrl | text | | https image |
| primaryColor | text | `#3e63dd` | Buttons and links |
| backgroundColor | text | `#f1f1f1` | |
| textColor | text | `#333333` | |
| fontFamily | text | Arial, Helvetica, sans-serif | One of six |
| footerText | text | | Business name and postal address, required before sending |
| websiteUrl | text | | Logo link |
| trackingKey | text | | Sealed copy of the Resend webhook signing secret and when it was fetched |

### Fields added to Person

| Field | Type | Default | Meaning |
|---|---|---|---|
| emailMarketingConsent | boolean | false | "Agreed to marketing emails" |
| whatsappMarketingConsent | boolean | false | "Agreed to marketing on WhatsApp" |
| mailingListMemberships | relation, one to many | | List memberships |
| campaignRecipients | relation, one to many | | Campaign history |

### Uniqueness

The current build has no unique indexes in this app. Uniqueness comes from conditional updates and checks:

| Rule | Prevents |
|---|---|
| One lease per campaign (conditional update on `lockedUntil`) | Two runs working on one campaign and sending twice |
| Batch claim only moves rows still Queued | Two runs sending the same recipient |
| Status moves name their allowed source statuses | Double scheduling, and webhooks overwriting final statuses |
| One recipient per person and per address per campaign (checked per page) | Duplicate rows after a crash, and two emails to one shared address |
| Do-not-contact checked before insert | Duplicate entries (a race can still add two; harmless) |
| List member checked before insert | A person on a list twice (a race can still add two; harmless, since preparation de-duplicates) |
| Test-send times compare-and-set | Two tests taking the last free slot |

## 4. Edge cases and bugs found

Versions: 0.1.4 first release; 0.2.3 review fixes; 0.3.0 signed webhooks; 0.4.0 audit fixes; 0.4.1 gateway path;
0.4.2 five-minute job.

- **Batches refused for quota stayed claimed** → a batch Resend refused (rate or plan limit, rejected key) stayed in
  Sending and was retried under the same key until the 23-hour window passed, then marked failed, so those people never
  got the campaign → a batch refused outright (429, 401, 403) on its first attempt is released to Queued with its key
  cleared and later sent under a new key. Fixed 0.4.0; the e2e suite checks two distinct keys and one email each.
- **Idempotent recovery rebuilt a different payload** → after a crash the batch was rebuilt from current data (only
  rows still in Sending, current names, current brand kit), so the body differed. Resend answered 409 for a reused key
  with a different body, and the campaign stalled → recovery rebuilds by batch key from every row ever claimed under
  it, in creation order, using stored personalisation and the brand snapshot. 409 `invalid_idempotent_request` means
  "sent earlier" and 409 `concurrent_idempotent_requests` means "retry later". Fixed 0.4.0.
- **Webhooks overwrote final statuses** → read-then-write updates let a late delivered or failed event replace
  Bounced, Unsubscribed or Delivered → each event is one conditional update from its allowed statuses; finals are never
  undone and failed never overrides delivered. Fixed 0.4.0.
- **Campaign Studio picks an arbitrary Resend connection when two exist** → when a client reconnects with a new key
  while the old connection is still there, the app uses whichever connection id sorts first. It is stable between runs
  but may be the old account, with the wrong domains and webhook → remember the key last connected (about one hour of
  work). **Open.** Until then the runbook says to disconnect the old key at once.
- **The gateway URL had to be a per-tenant path** → `WHATSAPP_GATEWAY_URL` is one server-wide value, but the gateway
  belongs to each tenant. A full address would have sent every client's WhatsApp through one tenant's account; the
  gateway would have refused it, so it would have failed rather than leaked → a value starting with `/` (normally
  `/s/whatsapp/gateway`) is resolved against the sending tenant's own address. A full address is kept as is. Fixed
  0.4.1.
- **API keys acted with the app's full role** → the platform runs an API-key caller with the app's own full identity,
  so a read-only integration key could schedule campaigns or run jobs → the studio and run routes refuse any caller who
  is not a signed-in member (403). Fixed 0.4.0.
- **No timeout on API calls** → a hung call blocked a run, and a proxy error page counted as a permanent failure → 30
  second timeout on every call; "no answer" and "no body" are a separate, retryable error, and database read timeouts
  and dropped connections pause instead of failing. Fixed 0.4.0.
- **Transient errors failed campaigns** → an outage or restart ended a campaign → network, 5xx, 429, concurrent 409
  and our own restarts pause it with a reason, and the next run carries on. Fixed 0.4.0.
- **No time budget per run** → a run could start a batch it could not record before its lease or the job timeout ran
  out → 90 s run budget, 45 s minimum before a batch, 105 s lease, 110 s timeout. Fixed 0.4.0.
- **One invalid address sank a whole batch** → Resend refuses a batch when one message is invalid → fall back to paced
  single sends keyed by recipient, so a retry reuses each message's key. Fixed 0.4.0 (e2e: a `reject@` address).
- **One write per recipient** → slow → one conditional write per outcome per batch. Fixed 0.4.0.
- **Unlimited test sends** → a free way to mail anyone → 5 addresses per send, 10 tests an hour per campaign,
  compare-and-set. Fixed 0.4.0.
- **Address changed after preparation** → mail went to an address the person no longer uses → the current address is
  compared before each batch and the row skipped on a difference. Fixed 0.4.0.
- **Overlapping runs could double-send** (0.1.4) → lease per campaign, atomic claims for scheduling and batches. Fixed
  0.2.3 (e2e: three runs at once).
- **Unbounded audience preparation** → a large list could not be prepared in one run → pages of 200 with a saved
  cursor and a `DONE` marker for a run that stopped between finishing and moving on. Fixed 0.2.3.
- **Consent withdrawn while a campaign waited** → a campaign paused for days could email someone who had since
  unsubscribed → consent, do-not-contact and deletion re-checked before each batch. Fixed 0.2.3.
- **Stop sending** → queued rows could still go out → Stop skips every queued row; status re-read before each batch.
  Fixed 0.2.3.
- **Contact values injected links** → `[Claim prize](https://evil)` as a name became a link → values inserted after
  markup and escaped. Fixed 0.2.3.
- **Numbers without a calling code** → a guessed country could message a stranger → skipped. Fixed 0.2.3.
- **Soft bounces suppressed addresses** → a full mailbox blocked a customer for good → only permanent bounces
  suppress. Fixed 0.2.3. Side effect: soft-bounced addresses are tried by every later campaign, with no limit.
- **Resend account not tenant-wide** → which account sent depended on who connected → one tenant-wide connection that
  only admins add. Fixed 0.2.3.
- **Unsigned webhook events** → anyone with the URL could mark people as complained and suppress them → every event
  must carry a valid Svix signature within 5 minutes. The secret is read from Resend with the connected key and kept
  sealed in the brand kit. Fixed 0.3.0; the e2e suite forges four kinds of event.
- **Forged events could burn the tenant's Resend quota** → each bad signature made the app ask Resend for the secret →
  the stored secret is fetched again at most every 10 minutes. Resend retries what was refused, so a rotated secret is
  picked up within 10 minutes. The e2e suite checks one fetch for many bad calls.
- **Resend unreachable while checking a signature** → 503 so Resend retries, not 401, which would drop the event.
- **Link scanners unsubscribed people** → GET only shows a button; POST unsubscribes.
- **Links working across tenants** → every signed link and the webhook URL use a per-tenant key (e2e: 404 elsewhere).
- **Shared addresses** → two contacts with one email got two copies → the second is skipped.
- **Campaign edited outside the studio while preparing** → generic record screens can edit any field → content checks
  re-run before Sending; Resume re-runs every check.
- **Brand kit or contact name changed mid-campaign** → retries and later batches would differ → brand snapshot at
  start, personalisation stored per row.
- **List deleted during preparation** → fails with "The mailing list no longer exists."
- **Domain unverified or key disconnected mid-campaign** → checked at the start of every sending run; fails with a
  clear message, resumable after the fix.
- **Resend briefly down at the scheduled time** → stays Scheduled with the reason and starts on a later run.
- **Idle job cost** (audit) → the job ran every 2 minutes per tenant even with nothing to send → every 5 minutes from
  0.4.2. The code comment on the job still says two minutes.
- **Slow studio typing** → the preview re-rendered and search fired on every keystroke → deferred preview and 300 ms
  search debounce. Fixed 0.4.0.
- **Test changes from the fixes** (audit section 6) → a short rate limit is now waited out in the run, so the pause
  check uses a 60 s retry-after; a refused batch is now sent again under a new key.
- **App rollback documented as lossless** → reinstalling the earlier version deletes 14 items with their data →
  releases fix forward, with a backup before each install.
- **Public pages without a Content-Security-Policy** (audit 17) → a future script injection on the unsubscribe page
  would reach CRM sessions on the same origin → strict CSP on `/s/campaigns/unsubscribe/*`. **Open.**
- **Webhook replays within 5 minutes** → only the timestamp is checked, not `svix-id`, so a captured event can be
  replayed inside the window. Status moves are conditional, so the only effect is a newer open or click time. **Not
  addressed.**
- **Pause reason left on screen** → after a pause, the reason stays visible while sending resumes, until the campaign
  finishes. **Not addressed.**
- **More than 50 active campaigns in one tenant** → each lookup reads 50, so the rest wait for a later run. **Not
  addressed.**
- **Custom domain changed after connecting** → the registered webhook address includes the tenant's address, so the
  studio offers "Turn on delivery tracking" again and the old webhook stays at Resend. This follows from the code and
  is not tested.

## 5. Test checklist

### Unit tests: email compiler, links, tokens (`campaigns.test.ts`)

- [ ] fills known variables and uses the fallback when empty: `{{firstName}}`, `{{ firstName | there }}`, `{{fullName}}` and `{{companyName}}` resolve.
- [ ] leaves unknown variables visible and reports them: unknown names stay as typed and are listed.
- [ ] only allows web, email and phone links: `javascript:` and `data:` links and http images are dropped.
- [ ] personalises the subject and the body.
- [ ] escapes content and drops unsafe links and images: HTML escaped, markup rendered, bad link and social entry dropped.
- [ ] always carries the footer address and the unsubscribe link: in HTML and in text.
- [ ] has a plain text version with links spelled out: capitals for headings, `label (url)`, `Button: url`.
- [ ] renders every starter template without problems except missing links: starters are valid apart from placeholders.
- [ ] cannot inject markup or links through a contact name: values go in after markup and are escaped.
- [ ] needs a calling code and does not add one twice: phone normalisation.
- [ ] retries only rate limits, outages and network failures: 429, 503, network retry; 422, code bugs, GraphQL errors do not.
- [ ] show empty images and buttons in the designer only: placeholders never reach real email.
- [ ] requires content and a footer address: an empty design and brand give two problems.
- [ ] drops unknown block types and oversize input from the browser: text cut to 5,000, at most 60 blocks.
- [ ] validates and normalises: email shape, lower-casing, phone digits.
- [ ] builds a from header without header injection.
- [ ] verifies an unsubscribe link only in its own workspace and with its nonce: also the webhook token.
- [ ] seals a stored setting for its own workspace and purpose only: wrong purpose, tampering, empty value and another workspace fail.
- [ ] accepts only a fresh, correctly signed Resend event: rotation list accepted; wrong id, body, secret, version, old or bad timestamp refused.
- [ ] refuses to sign without a long secret: under 32 characters throws.
- [ ] sends a path to the WhatsApp app of this same workspace, and keeps a full address as it is.

### Unit tests: sending decisions (`sending.test.ts`)

- [ ] tells a refused request from one whose outcome is unknown: 429, 401, 403 refused; 500, concurrent 409, timeout, network unknown.
- [ ] reads a changed body under a used key as sent earlier, but not a request still in progress.
- [ ] only blames the message itself for 400 and 422: and recognises the quota codes.
- [ ] waits for a short retry-after, but not for a plan quota or a long wait: 2 s waited; 60 s, none, quota, 503 not.
- [ ] pauses while Twenty restarts or its database times out: a forbidden error still fails.
- [ ] keeps retrying a request in progress elsewhere, but not a key Resend will never accept again.
- [ ] are keyed by recipient within their batch: distinct per recipient, at most 256 characters.
- [ ] start at least 600 ms apart: single-send pacing.
- [ ] sends only to the address the contact still has: email and WhatsApp.
- [ ] puts a deleted contact, withdrawn consent and the do-not-contact list first: reason order.
- [ ] normalises an address the same way as when the audience was prepared.
- [ ] never undo a bounce, complaint, unsubscribe or failure: no final status is a source of any move.
- [ ] do not let a failure report override a delivery.
- [ ] never touch recipients that were not sent: Queued and Skipped are never moved by events.
- [ ] count only the last hour: test-send times older than an hour or unreadable are ignored.
- [ ] never keep more than the hourly allowance: at most 10 kept.
- [ ] need a valid sending address: local-part rule.
- [ ] reads back what was stored and fills anything missing: brand snapshot parsing.

### End to end (`tests/campaigns/e2e.mjs`, 39 checks)

Runs on a throwaway test server against a double of Resend and the gateway. The double accepts only keys starting
`re_good`; lists `acme-mail.test` (verified) and `pending.test`; refuses `reject@` addresses and batches over 100
with 422; replays idempotent successes; returns a 429 with retry-after on demand (optionally after skipping calls);
registers webhooks with a fixed secret per address; checks the gateway signature. Seven contacts: three reachable, one
without consent, one on the do-not-contact list, one rejected address, one without an email.

- [ ] the connect page refuses a callback that is not Twenty's own: 400, no key can be posted elsewhere.
- [ ] a key Resend refuses is not connected: a sending-only key connects nothing.
- [ ] a full-access Resend key connects: the fingerprint status says yes.
- [ ] the studio sees the account and its verified domain.
- [ ] a brand colour must be a hex colour: 400.
- [ ] contacts are added to a list once: a repeat adds 0.
- [ ] an unverified domain and a bad button link block sending: both appear in the checklist.
- [ ] with a verified domain and valid content the checklist is clear.
- [ ] a test send arrives marked as a test: subject `[Test] News for Alex`.
- [ ] test sends are limited to five addresses: six give 400.
- [ ] a ready draft can be sent: schedule answers 200.
- [ ] a scheduled campaign cannot be edited: 400.
- [ ] the campaign finishes: status Sent.
- [ ] only consenting, reachable contacts not on the do-not-contact list get it: 4 recipients, 3 skipped, 3 sent, 1 failed.
- [ ] each contact gets their own email, once.
- [ ] the email is personalised and escaped: subject, body, From header, no script.
- [ ] the email carries one-click unsubscribe headers and the footer.
- [ ] batches are sent with an idempotency key: starting with the campaign id.
- [ ] the webhook refuses calls without its secret token: 404.
- [ ] the webhook refuses unsigned, wrongly signed, altered and replayed events: 401 each.
- [ ] the webhook accepts events signed by Resend: 200 for six real events.
- [ ] the signing secret is read from Resend once, however many bad calls arrive.
- [ ] a forged spam complaint changes nothing: no suppression.
- [ ] hard bounces and spam complaints go on the do-not-contact list: with the right reasons.
- [ ] a spam complaint withdraws consent.
- [ ] an unsubscribe link does not work in another workspace: 404.
- [ ] a tampered unsubscribe link is refused: 404.
- [ ] opening the link only shows a confirm button: consent unchanged after GET.
- [ ] one-click unsubscribe works, twice is harmless, and consent is withdrawn: suppression reason Unsubscribed.
- [ ] the report counts deliveries, opens, clicks, bounces, complaints and unsubscribes: 2, 1, 1, 1, 1, 1.
- [ ] the report lists the failed and bounced addresses.
- [ ] a rate limit pauses sending instead of failing: a 60 s retry-after on the pre-send domain check leaves it Sending with "slow down".
- [ ] unsubscribed, bounced and complaining contacts are not emailed again: the duplicate campaign sends nothing.
- [ ] consent withdrawn while a campaign waits is respected: row Skipped "Withdrew consent".
- [ ] a batch refused by a rate limit is put back and sent once under a new key: two distinct keys.
- [ ] parallel job runs never send an email twice: three runs at once, three emails.
- [ ] unscheduling returns the campaign to draft: also after two simultaneous schedule calls.
- [ ] a WhatsApp campaign goes only to contacts who agreed to WhatsApp, signed, with filled values: one message to `+447700900111`, values `Ann|20%`, language `en_GB`.
- [ ] WhatsApp status updates must be signed: unsigned 401, signed 200.

### Related checks on the gateway side (WhatsApp app)

- [ ] plans a campaign batch once per recipient and fills named parameters in the template's order.
- [ ] answers a repeated batch from what it already produced: no second send.
- [ ] reports a wait as accepted and queued, never as a failure.
- [ ] status callbacks go only to this workspace, and use the shapes the other apps expect: no `sent` for campaigns.
- [ ] (e2e) a campaign batch records consent, fills the named parameters, sends each recipient once and skips a customer who sent STOP.

## 6. Integrations and exact contracts

### Resend

- **Key**: the tenant's own Resend API key with **Full access**. A sending-only key cannot list domains or manage
  webhooks, and is refused with "Create a key with Full access, not Sending access."
- **Key check**: the key must match `^re_[A-Za-z0-9_]{10,}$`, and `GET /domains` must succeed with it.
- **Connection record**: account id `resend-<first 16 hex of SHA-256(key)>`, label "Resend key ending XXXX (up to
  three verified domains)", key stored encrypted, one per tenant; a connection marked as failing is ignored.
- **Connect flow**: the platform opens our connect page with a callback URL; the page renders only for the platform's
  own callback with a `state`, posts the key there (the callback checks it with Resend), then polls `connect-status`
  with the key's fingerprint up to 6 times a second apart, since the callback always answers success.
- **Base URL**: `RESEND_API_URL` if set (tests only), else `https://api.resend.com`.
- **Every call**: `Authorization: Bearer <key>`, `User-Agent: InventiveCRM-Campaigns/0.1`, `Idempotency-Key` where
  given, 30 s timeout. Errors are read as status, `name` (code), `message` and `retry-after` (seconds).

| Call | Used for | Request | Answer used |
|---|---|---|---|
| `GET /domains` | Key check, domain choice, verification before scheduling and before each sending run | | `data[].{id, name, status, open_tracking, click_tracking}`; `status` must be `verified` |
| `POST /emails/batch` | Campaign batches | Array of up to 100 emails; `Idempotency-Key: <campaign id>:<UUID>` (cut to 256) | `data[].id`, in request order |
| `POST /emails` | Single fallback sends and test sends | One email; key `<batch key>:<recipient id>` for fallbacks, none for tests | `id` |
| `GET /webhooks` | Is our endpoint registered | | `data[].{id, endpoint}` |
| `POST /webhooks` | Register | `{ endpoint, events: [7 events] }` | |
| `GET /webhooks/{id}` | Read the signing secret (the list omits it) | | `signing_secret` (`whsec_...`) |
| `PATCH /domains/{id}` | Defined (`open_tracking`, `click_tracking` true) but not called; tracking is switched on in Resend's dashboard | | |

- **Email body**: `from`, `to` (one address), `subject`, `html`, `text`, optional `reply_to`, `headers` (the two
  unsubscribe headers) and `tags` `[{name: "campaign", value: <id>}, {name: "recipient", value: <id>}]`.
- **Idempotency**: Resend remembers a key for 24 hours. We stop replaying at 23 hours. A replay must be byte-identical,
  hence the snapshots.
- **Webhook URL**: `<tenant address>/s/campaigns/webhook/<token>`. The token is the first 32 characters of
  base64url(HMAC-SHA256(tenant key, `resend-webhook`)). A wrong token gets 404.
- **Signature (Svix)**: headers `svix-id`, `svix-timestamp`, `svix-signature`. Expected value: base64 of HMAC-SHA256,
  keyed with the base64-decoded part of the secret after `whsec_`, over `<svix-id>.<svix-timestamp>.<raw body>`. The
  header may hold several space-separated `v1,<signature>` entries (rotation); any one may match, compared in constant
  time. The timestamp must be numeric and within 300 s. Use the raw request bytes.
- **Secret storage**: the secret and its fetch time are sealed with AES-256-GCM (key derived from the tenant key,
  purpose `resend-signing-secret` as additional data, format `v1.<iv>.<ciphertext+tag>`) in the brand kit's tracking
  key field. On a failed signature it is fetched again only if the stored copy is over 10 minutes old.
- **Webhook answers**: 200 (also for ignored events), 401 bad signature, 503 secret unavailable, 500 internal error
  (Resend retries 5xx).

### WhatsApp gateway

- **Target**: `WHATSAPP_GATEWAY_URL`. A value starting with `/` is resolved against the sending tenant's own origin
  (normally `/s/whatsapp/gateway`, the WhatsApp app of the same tenant); a full URL is used as is.
- **Request**: `POST`, JSON, 30 s timeout, headers `X-InventiveCRM-Timestamp` (Unix seconds) and
  `X-InventiveCRM-Signature` (`sha256=` + hex HMAC-SHA256 of `<timestamp>.<raw body>` with `WHATSAPP_GATEWAY_SECRET`).
  The receiver refuses a bad signature or a timestamp over 5 minutes old, comparing in constant time.
- **Body of `campaign.message`**:

```json
{
  "event": "campaign.message",
  "campaignId": "<campaign id>",
  "batchId": "<campaign id>:<UUID>",
  "template": { "name": "spring_offer", "language": "en_GB" },
  "messages": [
    { "recipientId": "<recipient id>", "to": "+447700900111", "variables": ["Ann", "20%"], "optOutUrl": "<signed unsubscribe link>" }
  ],
  "statusCallbackUrl": "<tenant address>/s/campaigns/whatsapp/status"
}
```

- **Answer**: 200 with `{ "accepted": [{ "recipientId": "...", "messageId": "wamid... or null" }] }`. Recipients left
  out are failed. 5xx means retry with the same `batchId`; another non-2xx fails the campaign with `error`.
- **Gateway duties**: answer a repeated batch from what it already accepted (kept at least a day); never send one
  recipient twice (keyed `campaign:<recipient id>`); accept 1 to 100 messages; require a `batchId` matching
  `[A-Za-z0-9:_-]{1,100}` and a template name; refuse a callback URL that is not an app route of the same tenant.
- **Status callback**: `POST <tenant address>/s/campaigns/whatsapp/status`, signed the same way with the same secret.
  - Body: `{ "recipientId": "...", "status": "delivered" | "read" | "failed" | "opted_out", "error": "..." }`.
  - Answers: 401 for a bad signature, 400 for an unknown recipient or status, 200 `{ ok: true }`.
- **Other events**: the same endpoint and signature carry `invoice.send`, `credit_note.send`, `quote.send`,
  `invoice.overdue_reminder` and `invoice.payment_link` from Quotes & Invoices (part 2a), and `feedback.survey` from
  Feedback.

### Signed links and the tenant key

- **Tenant key**: HMAC-SHA256(`CAMPAIGN_LINK_SECRET`, `workspace:<tenant id>`). The tenant id is read from the request's
  own access token, and nothing is signed if it is unknown or if the secret is shorter than 32 characters.
- **Unsubscribe token**: `<recipient id>.<first 32 characters of base64url(HMAC(tenant key, "unsubscribe:<recipient
  id>:<link key>"))>`. It is checked in constant time against the row's link key; tokens over 120 characters are cut
  before checking.
- **Rotation**: changing `CAMPAIGN_LINK_SECRET` breaks every unsubscribe link already sent, the registered webhook URL
  and the sealed signing secret.

## 7. Settings and configuration

### Per tenant

| Setting | Where | Notes |
|---|---|---|
| Resend connection | Settings, Accounts, "Resend (email campaigns)" | Full-access key, encrypted; one used (see open issue); staff connect it |
| Verified sending domain | Tenant's Resend account | Must be `verified`; open and click tracking switched on there, with its tracking subdomain |
| Delivery webhook | Registered automatically on connect, or with "Turn on delivery tracking" | Needs a public https address; never add it by hand (tokenised URL, secret read by the app) |
| Brand kit | Studio, Brand kit | Name, logo, colours, font, website, footer address (required) |
| Consent flags | Each contact | Recorded by the client; never set by the app |
| Mailing lists, do-not-contact list, saved templates | Studio and record screens | |
| WhatsApp templates | InventiveChat, as Meta Marketing templates | Named in each campaign |
| Tenant address | Platform | Custom domain if set, else the subdomain; all links and callbacks use it |

### Server-wide

| Variable | Secret | Meaning |
|---|---|---|
| `CAMPAIGN_LINK_SECRET` | yes | At least 32 random characters; root of every tenant key (links, webhook URL, sealed settings) |
| `WHATSAPP_GATEWAY_URL` | no | Gateway address; use the path `/s/whatsapp/gateway` |
| `WHATSAPP_GATEWAY_SECRET` | yes | Shared HMAC secret for gateway requests and status callbacks, the same in every app that uses the gateway |
| `RESEND_API_URL` | no | Test environments only (points at the double); empty in production |
| `TWENTY_FUNCTIONS_URL` | no | Optional override of the tenant base address for app routes (test setups) |

### Schedule and limits

The background job runs every 5 minutes per tenant (cron `1-59/5 * * * *`: minutes 1, 6, 11, ...; every 2 minutes
before 0.4.2). Other fixed values, all in section 2: run budget 90 s, lease 105 s, timeout 110 s; 15 s and 45 s
minimums; batches of 100, at most 40 per run; audience pages of 200; single sends 600 ms apart; retry-after waited up
to 10 s; recovery window 23 h; recount window 14 days; test sends 5 addresses and 10 per hour; schedule horizon 366
days; signature windows 300 s; secret refetch every 10 minutes at most.

## 8. Notes for the rebuild

Keep:

- one lease per campaign, claims by conditional update, and status moves that name their source statuses;
- a batch key as the idempotency key, with snapshots (brand, personalisation, row order) so a replay is identical, and
  the 409 meanings;
- releasing a batch on a definite refusal, and pausing (not failing) on transient errors;
- consent, address and do-not-contact checks right before each batch;
- GET never unsubscribes; one-click POST; per-tenant keys derived from one server secret; Svix verification with a
  rate-limited secret refetch;
- skipped rows with a reason for every person in the audience.

Do differently:

- Unique constraints: recipients on (campaign, person) and (campaign, destination); do-not-contact on (tenant,
  channel, normalised destination); list members on (list, person).
- Store the chosen Resend connection explicitly (closes the open issue) and the provider message id.
- An events table (every open and click, first open kept), with webhooks de-duplicated by `svix-id`.
- The audience as a real relation plus an "everyone who agreed" flag, not a text id.
- A job queue triggered when a campaign is due or resumed, instead of polling every tenant every 5 minutes.
- Per-tenant gateway credentials instead of one shared secret; a CSP on the unsubscribe page; a soft-bounce policy
  (for example, suppress after three); clear the pause reason once sending succeeds again.
