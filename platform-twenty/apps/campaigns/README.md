# Campaign Studio (InventiveCRM app)

Email and WhatsApp marketing campaigns for each client workspace: a step-by-step builder (setup, audience, design,
review), a block designer with live desktop and phone preview, starter templates, a brand kit, mailing lists, consent,
unsubscribe, bounce and complaint handling, and per-campaign reports. Email goes out through the client's own Resend
account; WhatsApp goes through InventiveChat. Built on the Twenty apps SDK and twenty-ui; installs per workspace.

Twenty's own Campaigns menu is a different, Enterprise-licensed feature that cannot send marketing email on our
self-hosted community edition, so this app has its own sending engine. It does not use or copy that code.

## How it works

| Part | Behaviour |
|---|---|
| Connect | Settings, Accounts, **Resend (email campaigns)**: a workspace admin pastes a Full access API key on our page. It is one connection for the whole workspace (members who are not admins cannot add or replace it). It is checked against Resend (`GET /domains`), stored encrypted by Twenty, and a webhook for delivery events is registered when the CRM has a public https address |
| Consent | Two contact fields: **Agreed to marketing emails** and **Agreed to marketing on WhatsApp**. Campaigns only go to contacts with the matching box ticked. Nothing ticks it automatically |
| Audience | A mailing list (Marketing, Mailing lists, or the Lists screen in the studio) or everyone who agreed. Contacts without consent, without a usable address or on the do-not-contact list are skipped and counted |
| Design | Blocks: heading, text (bold, italic, links), image, button, two columns, divider, space, social links. `{{firstName|there}}` style personalisation. The brand kit adds the logo, colours, the footer address and the unsubscribe link to every email; the footer address is required before sending |
| Sending | Scheduled or immediate. A job every five minutes works on one campaign at a time under a lease, so overlapping runs never double-send. It first prepares the audience page by page (Preparing), storing each contact's name and company for personalisation, checks the campaign again, then claims up to 100 queued recipients at a time, re-checks their consent, their current address and the do-not-contact list, and sends them through `POST /emails/batch` under one idempotency key. A campaign keeps the brand kit it started with. A batch Resend refuses outright (rate or plan limit, rejected key) goes back in the queue. A batch whose outcome is unknown (timeout, outage, crash) is sent again exactly as first built, with the same key, within Resend's 24-hour window, and is marked failed after that rather than risked; if Resend answers that the key was already used for it, it counts as sent. A batch holding an invalid address is sent one message at a time, at most two a second. A batch only starts when the run has time to finish it. Rate limits, quota limits, outages and the CRM restarting pause the campaign and it carries on by itself. Stop sending skips everyone not yet sent; Resume checks the campaign again, then picks them up |
| Test sends | Up to five addresses at a time and ten tests an hour per campaign, counted on the campaign with the sender's own permissions |
| Headers | Every email has `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058, required by Gmail and Yahoo for bulk senders) and tags with the campaign and recipient ids |
| Unsubscribe | `<workspace>/s/campaigns/unsubscribe/<token>`, signed per workspace. Opening the link only shows a button (link scanners must not unsubscribe people); the button and mail providers' one-click POST unsubscribe. The address goes on the do-not-contact list and consent is removed |
| Events | Resend webhooks (delivered, opened, clicked, bounced, complained, failed, suppressed) at `<workspace>/s/campaigns/webhook/<token>`; the token is a per-workspace MAC, and every event must carry Resend's signature (HMAC over the event id, timestamp and body, five-minute window). The signing secret is read from Resend with the connected key and kept encrypted in the brand kit record; unsigned, altered and replayed events get 401. Hard bounces and spam complaints go on the do-not-contact list; complaints also remove consent. Events only move a recipient forward: a bounce, complaint, unsubscribe or failure is never undone, and a failure report never overrides a delivery |
| Reports | Recipients, delivery, open and click rates, unsubscribes, bounces and failures, with the problem addresses. Opens are labelled as estimates |
| WhatsApp | Event `campaign.message` in `../commercial-docs/WHATSAPP_HANDOFF.md`: an approved template plus values, in batches of 100, signed with the shared secret. Status and opt-out callbacks at `/s/campaigns/whatsapp/status` |

Open and click tracking are switched on per domain in the Resend dashboard. They need a tracking subdomain,
which Resend asks for when you switch them on.

## Hardening for a workspace

Campaign Studio and the manual run route (`/s/campaigns/run`) answer only people signed in to the workspace; API keys get
403. Campaign and recipient records are ordinary CRM records. For full protection, a workspace admin can remove the Member
role's edit rights on the Campaign, Campaign recipient and Do-not-contact objects (Settings, Roles). Sending re-checks
consent and the do-not-contact list before each batch either way.

## Server variables

`node ../../scripts/set-app-variables.mjs --app 992fae47-c2c3-4731-b8aa-ebdcdb466631 ...`

| Variable | Meaning |
|---|---|
| `CAMPAIGN_LINK_SECRET` | 32+ random characters (`openssl rand -hex 32`). Signs unsubscribe links and the webhook URL; changing it breaks links already sent and the registered webhook |
| `WHATSAPP_GATEWAY_URL`, `WHATSAPP_GATEWAY_SECRET` | InventiveChat, for WhatsApp campaigns |
| `RESEND_API_URL` | Test environments only (points at `tests/campaigns/mock-resend.mjs`). Leave empty in production |

## Install

Same flow as the other apps (see `../../UPDATES.md`, "Releasing an app"). Application id:
`992fae47-c2c3-4731-b8aa-ebdcdb466631`.

## Tests

`yarn test` covers the email compiler (escaping, unsafe links, personalisation, plain text, footer and unsubscribe),
input limits, address handling, link signing across workspaces, sealed settings, Resend webhook signatures, how Resend
and Twenty errors are classified (refused, unknown, already sent, pause), single-send keys and pacing, the checks before
each batch, webhook status rules and the test-send allowance. `../../tests/campaigns/e2e.mjs` runs the whole loop
on the throwaway test server against the Resend and WhatsApp double (39 checks, including parallel job runs,
a batch refused by a rate limit and sent once afterwards, consent withdrawn while a campaign waits and forged or
replayed webhook events).
