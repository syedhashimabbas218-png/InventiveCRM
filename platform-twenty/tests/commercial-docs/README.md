# Quotes & Invoices and setup-by-prompt tests

End-to-end checks against a running multi-workspace server at `http://localhost:3000` with logic functions enabled
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
| `node setup-verify.mjs` | after `scripts/apply-setup-spec.mjs` with both specs: custom fields save, workflows create tasks, workspaces stay separate |
