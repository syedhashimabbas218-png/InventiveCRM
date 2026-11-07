# Quotes & Invoices and setup-by-prompt tests

End-to-end checks against a running multi-workspace test server (never production), given in `SERVER_URL`, for example `http://localhost:3001`; the scripts refuse to start without it, with logic functions enabled
(`LOGIC_FUNCTION_TYPE=LOCAL`). Provision two workspaces first and keep their API keys in `keys/`:

```bash
node ../../scripts/provision-workspace.mjs --server http://localhost:3000 --email admin@example.test --name "Acme Plumbing" --subdomain acme --key-file keys/acme.key
```

```bash
node ../../scripts/provision-workspace.mjs --server http://localhost:3000 --email admin@example.test --name "Glow Beauty Salon" --subdomain glow --key-file keys/glow.key
```

Install the app in both (see `apps/commercial-docs/README.md`), then run, in order:

| Script | Checks |
|---|---|
| `node inv1-quote-to-invoice.mjs keys/acme.key` | price list fills lines, VAT totals, quote sent and numbered, accepted quote becomes an invoice, invoice issued, PDFs filed on the company and contact |
| `node inv2-rules.mjs keys/acme.key acme.localhost` | VAT invoice blocked without customer address, domestic reverse charge, credit note voids the original, recurring invoice created and issued once, overdue, paid |
| `node inv3-non-vat.mjs keys/glow.key` | sole trader not registered for VAT: no VAT charged, non-VAT template, PDF on the client |
| `node mcp-invoice.mjs` | an AI assistant creates and issues an invoice over MCP |
| `node inv4-delivery.mjs keys/acme.key http://acme.localhost:3000 gateway.log user.token office@acmeplumbing.test` | email from our server (Mailpit: sender name, reply-to, PDF, DKIM), WhatsApp hand-off and signed delivered/read callbacks, forged callback refused, no WhatsApp consent, client mailbox sent and not connected, automatic-send fallback, overdue reminder |
| `node e2e/inv5-templates.mjs keys/acme.key fixtures` (from the app directory, after `make-template-fixtures.mjs`) | Word, scanned PDF (OCR), letterhead and fillable form templates are classified and checked; a typo is caught; issuing picks the client's template, then priority, falls through when a form has too few rows, gives credit notes the credit note template and falls back to the built-in layout |
| `node setup-verify.mjs` | after `scripts/apply-setup-spec.mjs` with both specs: custom fields save, workflows create tasks, workspaces stay separate |

`inv4-delivery.mjs` needs, on the test host only:

- Postfix from `deploy/docker-compose.yml` relaying to Mailpit (`RELAYHOST=[127.0.0.1]:1025`, Mailpit API on 8025), and the app's server variables pointing at it (`scripts/set-app-variables.mjs`)
- `mock-whatsapp-gateway.mjs` running with the same `WHATSAPP_GATEWAY_SECRET` and `LOG_FILE=gateway.log`, with `WHATSAPP_GATEWAY_URL=http://127.0.0.1:8090/messages`
- an IMAP/SMTP test mailbox (GreenMail, API on 8180) connected in Settings > Accounts by the user whose access token is in `user.token`, and `OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS=127.0.0.1` on the server so it may reach it
