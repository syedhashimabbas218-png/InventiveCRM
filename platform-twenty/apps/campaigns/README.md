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
| Connect | Settings, Accounts, **Resend (email campaigns)**: the client pastes a Full access API key on our page. It is checked against Resend (`GET /domains`), stored encrypted by Twenty, and a webhook for delivery events is registered when the CRM has a public https address |
| Consent | Two contact fields: **Agreed to marketing emails** and **Agreed to marketing on WhatsApp**. Campaigns only go to contacts with the matching box ticked. Nothing ticks it automatically |
| Audience | A mailing list (Marketing, Mailing lists, or the Lists screen in the studio) or everyone who agreed. Contacts without consent, without a usable address or on the do-not-contact list are skipped and counted |
| Design | Blocks: heading, text (bold, italic, links), image, button, two columns, divider, space, social links. `{{firstName|there}}` style personalisation. The brand kit adds the logo, colours, the footer address and the unsubscribe link to every email; the footer address is required before sending |
| Sending | Scheduled or immediate. A job every two minutes prepares recipients and sends batches of 100 through `POST /emails/batch` with an idempotency key per batch, so a retried batch is never sent twice. Rate limits, quota limits and outages pause the campaign and it carries on by itself |
| Headers | Every email has `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058, required by Gmail and Yahoo for bulk senders) and tags with the campaign and recipient ids |
| Unsubscribe | `<workspace>/s/campaigns/unsubscribe/<token>`, signed per workspace. Opening the link only shows a button (link scanners must not unsubscribe people); the button and mail providers' one-click POST unsubscribe. The address goes on the do-not-contact list and consent is removed |
| Events | Resend webhooks (delivered, opened, clicked, bounced, complained, failed, suppressed) at `<workspace>/s/campaigns/webhook/<token>`; the token is a per-workspace MAC. Hard bounces and spam complaints go on the do-not-contact list; complaints also remove consent |
| Reports | Recipients, delivery, open and click rates, unsubscribes, bounces and failures, with the problem addresses. Opens are labelled as estimates |
| WhatsApp | Event `campaign.message` in `../commercial-docs/WHATSAPP_HANDOFF.md`: an approved template plus values, in batches of 100, signed with the shared secret. Status and opt-out callbacks at `/s/campaigns/whatsapp/status` |

Open and click tracking are switched on per domain in the Resend dashboard. They need a tracking subdomain,
which Resend asks for when you switch them on.

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
input limits, address handling and link signing across workspaces. `../../tests/campaigns/e2e.mjs` runs the whole loop
on the throwaway test server against the Resend and WhatsApp double (32 checks).
