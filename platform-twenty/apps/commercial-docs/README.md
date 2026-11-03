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
| AI and workflows | The `issue-document` function is an AI tool (MCP `app_issue-document`) and a workflow action, so an assistant or a workflow can issue invoices and send quotes |

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

## Not included yet

Sending documents by email or WhatsApp, payment links, accounting exports (Xero, QuickBooks, FreeAgent), e-signature, stock, multi-currency.

## Install

Logic functions must be enabled on the server (`LOGIC_FUNCTION_TYPE=LOCAL`). The app needs the `UPLOAD_FILE` permission, which its role declares.

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

Bump `version` in `package.json` for every publish; installed workspaces with auto-upgrade switch over on their own.

## Develop

```bash
yarn test
```

```bash
yarn typecheck
```

End-to-end tests against a running server are in `../../tests/commercial-docs`.
