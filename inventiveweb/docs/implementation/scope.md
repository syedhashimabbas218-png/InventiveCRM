# Agreed product scope — 30 September 2026

This document supersedes conflicting planning statements in the original foundation docs.
The original supplied specification is retained unchanged for provenance.

## Architecture decisions

- InventiveWeb is the product identity. Self-host Twenty on Contabo, managed by Coolify.
- Pin the Twenty server and SDK to 2.43.0 for this increment. Upgrade deliberately.
- A small reviewed core patch covers branding. Business modules remain official Twenty Apps,
  using native metadata, objects, relations, roles, front components and logic functions.
- Keep Growth & Reports, Automations and Websites outside Twenty as independent services.
- Reuse native CRM people, companies and opportunities rather than duplicating customers.
- Calendars use Google and Microsoft. Reuse native account connections where applicable;
  booking availability must use current provider free/busy and an atomic reservation path.
- Public booking pages and embeds are separate customer surfaces, always displaying
  “Powered by InventiveWeb”. They must never receive workspace credentials or private events.
- Appointment forms vary by business AND service. Quote/invoice forms also vary by business.
- Public quote/invoice views must scope access to a specific customer/document. A full login
  portal has not yet been selected. Public customers do not become staff workspace members.
- Bookkeeping supports a future provider connection; whether the user's “bookkeepers” means
  human access, accounting integrations or both remains to be clarified. Initial finance
  role metadata is included. No accounting provider is connected.
- Only the InventiveWeb superadmin may configure MCP connections, credentials, workspace
  grants and tool policies. This is a server-side authorization requirement. Ordinary business
  owners are not platform superadmins.
- Reuse Zapier's connector for appropriate CRM actions where branding permits. Sensitive
  operations must call approved business actions. A customer-facing InventiveWeb Zapier
  connector is a separate future deliverable.

## Delivered in this increment

1. A compiled native app with six objects: Forms, Form versions, Booking services,
   Appointments, Quotes, Invoices; 22 bidirectional relationship fields; five roles;
   six navigation entries; a standalone Form builder page; an app settings entry;
   and three authenticated logic functions for validation, publishing and service selection.
2. A native form editor with field ordering, eight input types, choices, required rules,
   staff/customer visibility, single-level conditions, customer preview and draft save/load
   through the Twenty REST client. Form records and booking service definitions are writable
   according to workspace roles. The schema parser treats stored JSON as untrusted.
3. Appointment, quote, invoice and published-form-version objects are APPLICATION-writable.
   Form publishing now creates validated revisions; appointment/quote/invoice business actions
   remain pending. The published revision captures schema, purpose, author and publication time.
   Booking services can select a revision through a caller-authorized action.
4. Pinned source branding transformations and a Dockerfile derived from upstream's own
   build stages. It embeds a corresponding-source archive and preserves upstream licences.
5. A five-service Coolify stack: gateway, Twenty server, worker, PostgreSQL and Redis.
   Three persistent volumes. No host-published database, Redis or application ports.

## Explicitly not complete

- Actual installation and browser acceptance inside a running Twenty workspace.
- Full screen-by-screen white-label coverage, translated catalog review and branded
  Google/Microsoft consent screens. A branding patch is not a completed whole-product audit.
- Calendar free/busy, booking confirmation, rescheduling, cancellations, public booking/embeds.
- Quote/invoice generation, public document views, sending, payments or bookkeeping sync.
- Instagram, Messenger, operational dashboard and native identity bridge to the earlier platform API. That API is NOT deployed by this stack.
- Superadmin-only MCP configuration and Zapier integration management. MCP requests through
  the staging gateway are denied until this is implemented. This does not implement or prove
  the eventual authorization system; native settings/API permissions still need staging review.
- Full role templates for existing CRM objects, per-record constraints and customer access.
  The shipped roles are initial module permissions, not the complete customer's production roles.
- Cross-workspace isolation testing, external penetration testing, backups/restore rehearsal,
  image build verification or deployment to Contabo.

## Next implementation sequence

1. Deploy operator-only staging; install the native app; verify CRUD, permission intersection,
   branding and backup/restore. Finish the server-side superadmin integration boundary.
2. Qualify the implemented form publishing and service-to-version selection on staging. Add
   metadata field mappings, live Google/Microsoft availability and reservations, then public embed.
3. Build quote/invoice business actions and secure customer views, with configurable templates.
4. Add bookkeeping provider adapters. Keep independent products and any future messaging/AI features outside Twenty.

Native metadata changes, pricing snapshots and reservation/issuance actions must keep a single
documented authority each. Do not create a second active source of invoice numbers or calendar
bookings while connecting the earlier platform foundation.
