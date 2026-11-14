# Feedback (InventiveCRM app)

Asks customers how likely they are to recommend the business (0 to 10, Net Promoter Score) after an appointment is
completed or an invoice is paid, alerts the team about unhappy customers and invites happy ones to leave a Google
review. Built on the Twenty apps SDK; installs per workspace.

## How it works

| Step | Behaviour |
|---|---|
| Trigger | Every 15 minutes the job looks for appointments set to **Completed** (Scheduling app) and invoices set to **Paid** (Quotes & Invoices app) since its last run. Either app may be missing; its source is then skipped. The first run only records the time, so earlier customers are never asked |
| Who | One request per appointment or invoice, and nobody is asked twice within the cool-down (default 60 days). Customers without an email address, or without WhatsApp consent for WhatsApp, are skipped and the request says why |
| When | After the delay (default 2 hours). The link stays open for 14 days by default |
| How | Email from our mail server, sent as "<business> via InventiveCRM", with the 0 to 10 scale as one-tap links; or WhatsApp through InventiveChat (event `feedback.survey` in `../commercial-docs/WHATSAPP_HANDOFF.md`); or both |
| Answer | A public page at `<workspace>/s/feedback/<token>` (signed per workspace, like Scheduling's manage links). Customers can change their answer until the link expires |
| Low score | At or below the alert score (default 6), the first answer creates a follow-up **Task** linked to the customer and emails the alert list once |
| High score | At or above the review score (default 9), the thank-you page offers the Google review link (https only) |
| Overview | Scheduling-style page in twenty-ui: NPS, answers, response rate, the promoter/passive/detractor split, latest comments |

Staff can also ask one customer straight away through the admin route (`askNow`); a button on the customer record is still to come. Manual requests are
sent even while automatic asking is off.

## Settings

Per workspace, in **Feedback, Feedback settings** (created switched off the first time the overview opens): business
name, triggers, delay, cool-down, link lifetime, channel, question, Google review link, review and alert thresholds,
alert emails.

Server variables (`node ../../scripts/set-app-variables.mjs --app f69757a9-c451-4ac3-8042-79a99ad8e749 ...`):

| Variable | Meaning |
|---|---|
| `FEEDBACK_LINK_SECRET` | 32+ random characters (`openssl rand -hex 32`). Signs survey links; changing it invalidates links already sent |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_FROM_ADDRESS` | Mail server; with the bundled stack `mail`, `587`, `NONE` |
| `WHATSAPP_GATEWAY_URL`, `WHATSAPP_GATEWAY_SECRET` | InventiveChat, if surveys go out by WhatsApp |

## Install

Same flow as the other apps (see `../commercial-docs/README.md` and `../../UPDATES.md`, "Releasing an app"). Application
id: `f69757a9-c451-4ac3-8042-79a99ad8e749`.

## Tests

`yarn test` covers scoring, thresholds, review links, link signing across workspaces and email escaping.
`../../tests/feedback/e2e.mjs` runs the whole loop on the throwaway test server (13 checks).
