# Handover for Iwcrm, part 1b: Feedback

Behaviour of the Feedback app as built on Twenty (app version 0.2.2, repository state of 19 November 2026), written for a rebuild in Rust and Postgres. Where the README and the code disagree, this document follows the code and tests. Part 1a covers Scheduling, which supplies one of Feedback's triggers.

Conventions: "the platform" means something Twenty did for us that Iwcrm must do itself. **Open** marks known gaps, not behaviour to copy.

## 1. Purpose

Asks customers how likely they are to recommend the business (0 to 10, Net Promoter Score) after an appointment is completed or an invoice is paid, by email or WhatsApp. A low score creates a follow-up task on the customer and alerts the team; a high score is offered the business's Google review link. An overview shows NPS, response rate and the latest comments.

## 2. Features and business rules

### 2.1 Triggers: who is asked and when

- The settings record is created switched off the first time someone opens the overview. Without a settings record the job does nothing. With automatic asking off no new requests are scheduled, but requests already scheduled (and manual ones) are still sent, retried and expired.
- Sources: appointments whose status is Completed (setting "After an appointment is completed", default on) and invoices whose status is Paid ("After an invoice is paid", default off).
- If a source app is not installed, that source is skipped silently. Any other error reading a source stops the scan without moving its cursor, so nobody is lost; due surveys are still sent in the same run.
- Each scan reads records of those statuses changed since the cursor (`updatedAt` at or after it), oldest change first, at most 200 per source. If a source filled its page, the next scan resumes from its last row; otherwise the cursor moves to the start of this run.
- If a full page never gets past the cursor (one bulk update of more than 200 rows at the same instant), the cursor steps forward by 1 ms so the scan cannot loop forever.
- The first scan after the cursor is empty only records the time: customers from before the app was switched on are never asked.
- One request per source record (the source id is unique), even when the record is updated again or two runs overlap.
- A source record without a linked person creates no request.
- Cool-down: a person with a request created within the cool-down (default 60 days) that is Scheduled, Sending, Sent, Answered or Expired is not asked again. Failed and Skipped requests do not count. Within one scan each person gets at most one request.
- A new request is due after the delay (default 2 hours) and takes the channel set at that moment; later setting changes do not affect it.
- Its name is the appointment's customer name (else the appointment name) or `Invoice <number>`.
- Scheduling marks appointments Completed only once a day, a day after they end, unless staff complete them sooner; automatic surveys therefore go out one to two days after a visit, plus the delay.

### 2.2 Sending

- The job runs at minutes 13 and 43 of every hour, and on demand for a signed-in user. Each run: schedule new requests (only when enabled), fail interrupted ones, send due ones, expire old ones.
- Due requests are Scheduled with their send time reached, oldest first, at most 100 per run. A run stops taking new requests after 4 minutes.
- A request is claimed by moving it from Scheduled to Sending in one conditional update; only the run whose update succeeded sends it, so overlapping runs never send twice.
- Channel Email sends to the person's primary email. Channel WhatsApp sends to the person's primary phone, only if the person has WhatsApp consent. Email and WhatsApp sends both where possible.
- Phone numbers become E.164: a number starting with `+` is kept (other non-digits removed); otherwise the calling code (default `+44`) is prefixed and leading zeros dropped.
- If at least one channel succeeded: Sent, with sent time, recipients, link expiry (now plus link lifetime, default 14 days) and any failure of the other channel kept in Problem.
- If every attempted channel failed: tried again after 30 minutes, then after 2 hours; after the third failed attempt it is Failed with the reason.
- If nothing could be attempted: Skipped, "No email address." (or "No mobile number with WhatsApp consent." for WhatsApp only).
- A request still Sending 30 minutes after its last change was interrupted mid-send: it becomes Failed and is never sent again, because it may have arrived.
- Sent requests whose link has expired become Expired (200 per run). Answered requests keep their status after expiry but stop accepting changes.

### 2.3 Asking one customer now

- A signed-in user can ask one person straight away (admin action `askNow`; a button on the person record is not built yet).
- Refused with 409 if that person has a request Scheduled or Sending, or one sent in the last 24 hours.
- Refused with 429 once 30 manual requests were created in the workspace in the past hour.
- Allowed inside the cool-down and while automatic asking is off.
- The request is created already Sending (source "Sent by hand", source id `manual:<person id>:<epoch ms>`), so the job cannot send it a second time, and is sent at once. The answer is the resulting status.
- The person must be readable by the user who asks.

### 2.4 Survey page and answers

- The link is `<workspace>/s/feedback/<token>`; the page is never cached.
- It shows "Hello <first name>, how did we do?", the question, a 0 to 10 scale from "Not at all likely" to "Extremely likely", and an optional comment (at most 2,000 characters).
- A `?score=N` link from the email preselects that score; the customer still presses Send.
- A survey is open while it is Sent or Answered and its link has not expired; otherwise the page says the survey is closed and answers get 400 CLOSED.
- The score must be a whole number from 0 to 10 (400 INVALID otherwise).
- The first answer moves Sent to Answered in one conditional update, so of two simultaneous answers exactly one is "first". Later answers change score and comment until the link expires.
- The thank-you page says the feedback reached the business. If the score is at or above the review score (default 9) and the Google review link is an https address, it offers "Leave a Google review" and records that the link was shown.
- An unknown, altered or other-workspace token gets 404 "This link is not valid."
- Opening a link that was answered shows the saved score and comment.

### 2.5 Low scores

- On the first answer at or below the alert score (default 6), and only if no task exists yet:
  - a task "Follow up: feedback score <n> from <name>" is created, To do, due in 24 hours, linked to the customer; its body quotes the comment as plain text (every markdown punctuation character escaped, each line quoted) or says no comment was left;
  - the alert list (comma separated, up to 10 valid addresses) is emailed "Unhappy customer: score <n> from <name>" with the comment and whether the task was created.
- Changing an answer never repeats the task or the alert. A first answer that was high and is later changed to low raises no alert.
- A task, link or email failure is logged (addresses redacted) and never fails the customer's answer.

### 2.6 Overview and views

- Signed-in users only. Opening it creates the settings record (switched off) if missing.
- Over the last 90 days: NPS = percentage of promoters (9 and 10) minus percentage of detractors (0 to 6), rounded, or none without answers; promoter, passive (7 and 8) and detractor counts; asked = requests Sent, Answered or Expired that were sent in the period; response rate = answers / asked; the 12 latest answers with their group and comment.
- It also shows whether asking is on, the channel, the triggers, and whether a review link and alert emails are set.
- Native views: all feedback, Detractors (answered with score 6 or less, a fixed threshold), Feedback settings.

### 2.7 Emails

| Email | From | Subject | Content |
|---|---|---|---|
| Survey | `<business> via InventiveCRM` at the sender address | `How did we do? <business> would like your feedback` | "Hello <first name>," (else "there"), the question, 11 one-tap score links `<link>?score=0` to `10`, plain-text alternative with the link |
| Alert | `InventiveCRM Feedback` | `Unhappy customer: score <n> from <name>` | score, comment or "No comment was left.", task created or "please follow up directly" |

- The business name defaults to "Our team" and the question to "How likely are you to recommend us to a friend or colleague?".
- Every customer-visible value in the HTML is escaped.

### 2.8 Permissions and security

| Route | Access |
|---|---|
| `GET /s/feedback/:token` | public |
| `POST /s/feedback/api` (actions `info`, `answer`) | public, token required |
| `POST /s/feedback/admin` (actions `overview`, `askNow`) | signed-in users only; API keys get 403 |
| `POST /s/feedback/run` | signed-in users only; API keys get 403 |

- The overview reads as the signed-in user (their role intersected with the app's) and creates settings as the app. `askNow` reads the person as the user, then creates and sends as the app. The job runs as the app.
- The app's role can read and update every record and create records; it can neither soft-delete nor permanently delete anything. It cannot be given to users or API keys.
- Survey links are signed per workspace over a random nonce stored on the request (section 6).
- Review links must be https; comments become plain text in tasks; logs keep ids, not addresses.
- **Open**: the public survey API has no rate limit.

## 3. Data model

Every object also has `id` (uuid), `createdAt`, `updatedAt`, `deletedAt` (soft delete), `createdBy`, `position`. No field is required in the database; code enforces what section 2 says.

**FeedbackRequest**: one request to one customer, and their answer.

| Field | Type | Default | Meaning |
|---|---|---|---|
| name | text | | customer or invoice label |
| status | SCHEDULED, SENDING, SENT, ANSWERED, FAILED, SKIPPED, EXPIRED | SCHEDULED | |
| score | int | | 0 to 10 |
| comment | text | | at most 2,000 |
| channel | EMAIL, WHATSAPP, EMAIL_AND_WHATSAPP | EMAIL | copied from settings at creation |
| source | APPOINTMENT, INVOICE, MANUAL | MANUAL | |
| sourceId | text, unique | | appointment id, invoice id or `manual:<person>:<ms>` |
| recipient | text | | addresses and numbers it went to |
| sendAt | timestamptz | | due time |
| sentAt, answeredAt, expiresAt | timestamptz | | |
| nonce | text | | signs the link |
| error | text | | last problem, with attempt count |
| followUpTaskId | text | | CRM task id |
| reviewLinkShown | bool | false | |
| attempts | int | 0 | send attempts |

Relation: person (Person, set null on delete); Person gets a `feedbackRequests` list.

**FeedbackSettings** (oldest record used): see section 7 for fields and defaults; also `lastScannedAt` (timestamptz), the scan cursor.

Indexes: only the unique `sourceId`.

| Unique | Prevents |
|---|---|
| FeedbackRequest.sourceId | two surveys for one appointment or invoice, from overlapping runs or a record updated again; a parallel run's insert fails and is ignored |

Data read from other apps: Appointment `id, name, customerName, personId, status, updatedAt` (Scheduling); Invoice `id, invoiceNumber, personId, status, updatedAt` (Quotes & Invoices); Person `name, emails.primaryEmail, phones.primaryPhoneNumber, phones.primaryPhoneCallingCode` and `whatsappOptIn` (added by Quotes & Invoices; without that app WhatsApp is never sent). Data written elsewhere: Task (`title`, `status`, `dueAt`, markdown body) and TaskTarget (task to person).

## 4. Edge cases and bugs found

Each line: problem → what goes wrong → rule that prevents it. Versions are when it was fixed.

- Overlapping runs could survey twice (0.2.0) → a scheduled and a manual run both sent → unique source id and the Scheduled to Sending claim.
- A failed scan moved its cursor (0.2.0) → customers changed in that window were never asked → only a "no such field or type" error means the source app is missing; anything else (including the API not answering) stops the scan and keeps the cursor.
- One failed send was final (0.2.0) → a mail server blip lost the survey → three attempts, 30 minutes and 2 hours apart.
- Sends cut off midway → unknown whether the customer got it → Failed after 30 minutes in Sending, never resent.
- Bulk update larger than a page at one instant → the cursor never advanced → step 1 ms past it (rows sharing the last timestamp are re-read and skipped by the unique source id).
- First run after switching on → would have surveyed every past customer → the first run only records the time.
- Two completed appointments for one person in one scan → two surveys → one per person per scan, plus the cool-down.
- Failed or skipped requests blocking the cool-down → nobody was asked but the person was locked out for 60 days → they do not count.
- API keys acting with the app's full role (0.2.0) → a read-only key could send surveys or run the job → admin and run routes require a signed-in user.
- Manual asking abused (0.2.0) → a script or stuck button could spam a customer → one per person per 24 hours, 30 per workspace per hour, created already claimed.
- Markdown in comments (0.2.0) → a customer's links, images or HTML rendered inside the CRM task → escaped and quoted as plain text.
- Repeated alerts → changing an answer alerted again → alerts only on the first answer, decided by the conditional update.
- HTML in names or the question → injected into the email → escaped (unit test).
- `javascript:` review link → script on the thank-you page → https only.
- Addresses in logs → personal data in logs → redacted.
- Hanging mail server → used up the 300 s job → SMTP timeouts 10/10/20 s and a 4-minute send budget.
- One WhatsApp gateway address for every workspace (0.2.1) → every client's surveys would leave through one workspace's account (and be refused) → a path such as `/s/whatsapp/gateway` is resolved against the sending workspace's own address.
- Duplicate source ids in existing data → the unique index fails to install → check and remove duplicates before adding the constraint (production check written, `docs/duplicate-check.md`).
- Found while writing (**open**): without `FEEDBACK_LINK_SECRET` every send throws before sending, so requests end Failed as "interrupted" 30 minutes later instead of showing a configuration error.
- Found while writing (**open**): source records without a person are dropped silently, while the README says skipped requests say why.
- Found while writing (**open**): the Detractors view uses a fixed 6, not the alert setting; a high first answer changed to low never alerts.
- Documentation drift: the architecture audit says the job runs every 15 minutes; since 0.2.2 it runs every 30.

## 5. Test checklist

Unit tests (`apps/feedback/src/__tests__/feedback.test.ts`, vitest, no doubles)
- [ ] groups scores the standard way: 0 to 6 detractor, 7 and 8 passive, 9 and 10 promoter.
- [ ] is percent promoters minus percent detractors: [10, 10, 9, 8, 3] gives 40; no answers gives none.
- [ ] accepts only whole scores from 0 to 10: -1, 11, 5.5 and "7" are refused.
- [ ] alerts at or below the threshold.
- [ ] offers the review link only to promoters and only over https.
- [ ] verify in their own workspace and fail in another or with another key.
- [ ] escapes the business name and question and links every score.
- [ ] retries a failed send after 30 minutes, then 2 hours, and gives up after the third attempt.
- [ ] treats only a missing source app as nothing to scan: "Cannot query field" and "Unknown type" only, never when the API did not answer.
- [ ] moves the cursor to now when every page was read completely.
- [ ] resumes from the earliest last row of a full page.
- [ ] steps past a full page that never gets beyond the cursor.
- [ ] asks once per source record and once per customer, skipping those without a person or asked recently.
- [ ] shows the comment as plain text, without links, images or html.
- [ ] quotes every line of the comment.
- [ ] keeps addresses out of logged errors.
- [ ] sends a path to the WhatsApp app of this same workspace, and keeps a full address as it is.

End-to-end (`tests/feedback/e2e.mjs` on the test server, using the Scheduling test world's appointments; double: Mailpit for mail; run after the Scheduling suite)
- [ ] the overview creates settings, switched off.
- [ ] the first run only remembers where it started, so earlier customers are not asked.
- [ ] completed appointments are picked up and their customers asked by email.
- [ ] the email comes from the business via InventiveCRM and links every score.
- [ ] the survey page opens without caching.
- [ ] the survey shows the question and business.
- [ ] an invalid score and a link used in another workspace are refused.
- [ ] a low score creates a follow-up task on the customer and emails the alert list.
- [ ] a high score is thanked with the Google review link.
- [ ] changing an answer does not repeat the alert.
- [ ] the cool-down stops a second request to the same customer, and re-runs ask nobody twice.
- [ ] an expired link no longer accepts answers.
- [ ] the overview reports the answers and NPS.

Last full run: 13 of 13 on the test server. Not covered: WhatsApp sending (no e2e; the gateway contract is tested in the WhatsApp and Quotes & Invoices suites), invoice-paid triggers, `askNow`, retries after a mail failure, interrupted sends.

## 6. Integrations and exact contracts

**Learning of completed appointments and paid invoices**: polling, not events. Every run queries each enabled source for records with status Completed (appointments) or Paid (invoices) and `updatedAt` at or after the cursor, ordered by `updatedAt`, 200 at a time (section 2.1). Appointments become Completed when staff set it or when Scheduling's daily job completes them a day after they end; invoices become Paid in Quotes & Invoices (payment webhooks or reconcile).

**Email**: SMTP with the same rules as Scheduling (port default 587; `SMTP_SECURITY` TLS, STARTTLS or NONE; login only with a username; timeouts 10 s connect, 10 s greeting, 20 s socket). Survey emails have HTML and text parts.

**WhatsApp gateway** (InventiveChat through the workspace's WhatsApp app; contract in `apps/commercial-docs/WHATSAPP_HANDOFF.md`):

- `POST <WHATSAPP_GATEWAY_URL>`. A value starting with `/` is resolved against the sending workspace's own origin (normally `/s/whatsapp/gateway`); a full URL is used as is.
- Body:

```json
{
  "event": "feedback.survey",
  "deliveryId": "<feedback request id>",
  "business": { "name": "<business name>" },
  "recipient": { "name": "<first last>", "phone": "<E.164>", "whatsappOptIn": true },
  "survey": { "url": "<survey link>", "question": "<question>" }
}
```

- Headers: `Content-Type: application/json`, `X-InventiveCRM-Timestamp` (Unix seconds), `X-InventiveCRM-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>" with WHATSAPP_GATEWAY_SECRET>`. The service rejects a wrong signature or a timestamp more than 5 minutes old.
- 20 s timeout. Any 2xx is success; anything else fails that channel with `WhatsApp service answered <status>: <error>`. No status callback is expected for this event. The service sends a utility template with the question and a button to the URL.

**Signed links**: workspace key = HMAC-SHA256(`FEEDBACK_LINK_SECRET`, `workspace:<workspace id>`); token = `<request id>.<first 32 base64url characters of HMAC(workspace key, "survey:<request id>:<nonce>")>`; nonce = 12 random bytes, base64url, stored on the request; constant-time comparison. The link stays valid until `expiresAt`; the nonce is not rotated after an answer. A link from one workspace is refused in every other.

**Follow-up**: a CRM Task plus a TaskTarget to the person.

**Where credentials and settings go**

- Server-wide app variables: `FEEDBACK_LINK_SECRET` (secret, at least 32 characters; changing it invalidates every survey link already sent), `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USERNAME`, `SMTP_PASSWORD` (secret), `SMTP_FROM_ADDRESS`, `WHATSAPP_GATEWAY_URL`, `WHATSAPP_GATEWAY_SECRET` (secret).
- Per tenant: the Feedback settings record. Per-workspace WhatsApp credentials live in that workspace's WhatsApp app, not here.
- Test runner: `SERVER_URL` (required, never production), `MAILPIT_URL`.

## 7. Settings and configuration

Per tenant, **Feedback settings** (oldest record used; created switched off):

| Setting | Default | Effect |
|---|---|---|
| businessName | empty ("Our team") | shown in emails and pages |
| enabled | false | automatic asking |
| afterAppointments | true | trigger on completed appointments |
| afterPaidInvoices | false | trigger on paid invoices |
| delayHours | 2 | wait before sending |
| cooldownDays | 60 | at most one automatic request per person in this time |
| expiryDays | 14 | link lifetime |
| channel | EMAIL | or WHATSAPP, EMAIL_AND_WHATSAPP |
| question | "How likely are you to recommend us to a friend or colleague?" | |
| googleReviewUrl | empty | https only |
| promoterScore | 9 | show review link from this score |
| alertBelowScore | 6 | alert at or below |
| alertEmails | empty | comma list, first 10 valid used |
| lastScannedAt | empty | scan cursor; empty means "start from now" |

Server-wide: the variables in section 6. Job at minutes 13 and 43, 300 s timeout with a 240 s send budget; admin route 60 s; public API 30 s.

## 8. Notes for the rebuild

Keep:
- Unique source id, the conditional claim before sending, and never resending an interrupted send.
- First run records the time only; failed and skipped requests do not start the cool-down.
- Alerts on the first answer only, decided atomically; plain-text comments; https-only review links.
- Per-workspace signed links over a stored nonce.

Do differently:
- Trigger from domain events written in the same transaction as "appointment completed" or "invoice paid" (an outbox), instead of polling `updatedAt` with a cursor.
- Decide when a visit counts as done (for example its end time) rather than waiting for a daily completion job.
- Rate-limit the public survey API; check configuration (link secret, mail) at start-up.
- Record a Skipped request for a source without a person, and let the detractor view follow the alert setting.
- Keep per-channel delivery results (email and WhatsApp) instead of one combined status.
