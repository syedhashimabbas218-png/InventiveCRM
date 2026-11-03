# Quotes & Invoices (InventiveCRM app)

UK quotes, VAT invoices, credit notes and recurring billing for InventiveCRM workspaces. Built on the Twenty apps SDK, so it installs per workspace and needs no change to the core product.

## What a client gets

| Area | Behaviour |
|---|---|
| Business profile | One record per workspace with the details that must appear on documents: legal and trading name, address, legal structure, Companies House number, place of registration, registered office, VAT number, bank details, numbering prefixes, payment terms, VAT rounding |
| Products and services | Price list. Picking a product on a line fills description, unit, price and VAT rate |
| Quotes | Lines with quantity, unit price, VAT rate and discount. Set the status to **Sent** to number the quote and file its PDF on the client. Set it to **Accepted** to get a draft invoice with the same client and lines |
| Invoices | Set the status to **Issued**: UK checks run, the invoice gets the next number, totals are frozen and the PDF is filed on the invoice and on the client's company and contact. If a check fails the invoice stays a Draft and **Issues to fix** says why |
| Credit notes | An invoice of type Credit note, linked to the invoice it credits, with its own number sequence. A full credit marks the original Void |
| Recurring invoices | Tick Recurring, choose weekly, monthly, quarterly or yearly, every N periods, a first date and an optional end date. A daily job creates each repeat and issues it, so its PDF lands on the client card too |
| Daily job | Creates due repeats, marks unpaid invoices past their due date Overdue and expires out-of-date quotes. Also callable at `POST /s/billing/daily-run` |
| Paid | Setting the status to Paid records the payment date and amount |
| Sending | Issued invoices and sent quotes go to the contact with the PDF, by email, WhatsApp or both (the contact's **Send documents by** field). Each attempt is a **Delivery** on the document with its status. Overdue reminders are optional |
| AI and workflows | `issue-document` (MCP `app_issue-document`) issues invoices and quotes; `send-document` (MCP `app_send-document`, also `POST /s/documents/send`) sends or re-sends one, or sends a reminder. Both are workflow actions too |

All money is calculated in integer pence. VAT is worked out per rate on the summed net amounts (HMRC allows invoice-level calculation), rounded to the nearest penny or down, as set in the Business profile.

## Templates

| Template | Use |
|---|---|
| UK VAT invoice | VAT-registered businesses. Shows VAT number, time of supply (tax point), VAT rate per line, net, VAT per rate and total |
| UK invoice (not VAT registered) | Sole traders and others below the threshold. No VAT columns, states that no VAT is charged |
| UK VAT invoice: domestic reverse charge (CIS) | Construction services to VAT-registered contractors. Shows the customer's VAT number and the VAT due, excludes it from the amount payable, and carries the "customer to account for VAT to HMRC" wording |
| Credit note | Any of the above with type Credit note; references the credited invoice |
| Quotation | VAT shown when the business is VAT registered; validity date and terms |

## UK requirements covered

Checked before a document is issued, and printed on it:

- Unique, sequential numbers per business. A number is only used once the PDF is stored, so failed attempts leave no gaps
- Seller's legal name, trading name and address; customer's name, and address on VAT invoices
- Invoice date, time of supply, due date, customer reference
- Description, quantity, unit price excluding VAT, VAT rate and line amount; totals excluding VAT, VAT per rate, total
- Valid UK VAT number for VAT invoices; no VAT charged by a business that is not VAT registered
- Domestic reverse charge wording and the customer's VAT number
- For companies and LLPs: registered name, company number, place of registration and registered office (Companies Act 2006 and the 2015 disclosure regulations)
- Optional late payment notice (Late Payment of Commercial Debts (Interest) Act 1998)

Confirm the numbering scheme and the VAT rounding choice with the client's accountant.

## Sending

Business profile settings: **Send documents when issued**, **Send overdue reminders**, **Send emails from** (our mail server or the business's own mailbox), **Business mailbox address** and an optional **Email message**.

| Send email from | How it works |
|---|---|
| InventiveCRM mail server (default) | Our Postfix server (`mail` in `deploy/docker-compose.yml`) sends from `SMTP_FROM_ADDRESS` with the business name as sender and the business email as reply-to |
| Business's own connected mailbox | The mailbox connected in Settings > Accounts (Google, Microsoft or IMAP/SMTP) sends it, so it appears in their Sent folder. It must belong to, or be shared with, the person who issues. Automatic sends with nobody signed in (recurring invoices, reminders, API calls) go through our server instead, and the Delivery says so |

WhatsApp needs a mobile number and **Agreed to WhatsApp messages** on the contact (UK GDPR and Meta both require consent). The app does not talk to Meta: it hands the document to our WhatsApp (WABA) service, which owns the templates and numbers. The contract is in [WHATSAPP_HANDOFF.md](WHATSAPP_HANDOFF.md).

Instance-wide settings are server variables, set once by the owner workspace (values stay on the server):

```bash
node ../../scripts/set-app-variables.mjs --server https://crm.inventiveweb.studio --key-file owner.key --env-file app-variables.env
```

```
SMTP_HOST=mail
SMTP_PORT=587
SMTP_SECURITY=NONE
SMTP_FROM_ADDRESS=invoices@inventiveweb.studio
WHATSAPP_GATEWAY_URL=https://wa.inventiveweb.studio/messages
WHATSAPP_GATEWAY_SECRET=<openssl rand -hex 32, shared with the WhatsApp service>
```

`SMTP_SECURITY` is `TLS`, `STARTTLS` or `NONE` (only inside the private Docker network). `SMTP_USERNAME` and `SMTP_PASSWORD` are optional.

## Not included yet

Payment links, accounting exports (Xero, QuickBooks, FreeAgent), e-signature, stock, multi-currency.

## Install

Logic functions must be enabled on the server (`LOGIC_FUNCTION_TYPE=LOCAL`). The app needs the `UPLOAD_FILE` and `SEND_EMAIL_TOOL` permissions, which its role declares.

From an owner workspace (ours), build and publish privately to the server:

```bash
yarn install
```

```bash
npx twenty@2.54.3 auth login --url https://crm.inventiveweb.studio --name owner
```

```bash
npx twenty@2.54.3 app publish --private --remote owner
```

Then in each client workspace, with that workspace's API key:

```bash
printf '%s' "$CLIENT_API_KEY" | npx twenty@2.54.3 auth login --with-token --url https://crm.inventiveweb.studio --name client
```

```bash
npx twenty@2.54.3 app install --universal-identifier 93ae1d55-5c54-4fac-922b-fd9fa4a69ab5 --remote client
```

Bump `version` in `package.json` for every publish, and run the plan check first (see the release checklist in `../../UPDATES.md`):

```bash
npx twenty@2.54.3 app plan --remote owner --json | node ../../scripts/check-app-plan.mjs
```

Private installs do not auto-upgrade: run `app install` again in each workspace to move it to the new version.

Never remove an object or field from the app: on upgrade the server deletes whatever the new version no longer declares, with its data, in every workspace. Add fields, or stop using old ones.

## Develop

```bash
yarn test
```

```bash
yarn typecheck
```

End-to-end tests against a running server are in `../../tests/commercial-docs`.
