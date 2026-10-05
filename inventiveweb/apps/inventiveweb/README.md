# InventiveWeb native app

Built with the official Twenty SDK 2.43.0. This is a native app package containing object,
relation, role, navigation, layout, front-component and logic-function definitions.

```bash
npm ci
npm run typecheck
npm test
npm run pack:app
npx twenty remote:add --url https://YOUR_WORKSPACE --as inventiveweb-staging
npx twenty plan . --remote inventiveweb-staging --no-delete
npx twenty apply . --remote inventiveweb-staging --no-delete
```

Authenticate as the operator. Review the plan before applying; never install an unreviewed
schema change into a customer workspace. No remote was configured or changed during this build.

## Working slice

Open **Form builder** from the native sidebar. Create a named draft for appointments, quotes
or invoices, add questions, test the customer preview, save and reopen it. API persistence is
implemented but still needs the first live Twenty browser test. Managers can edit draft forms and booking
service definitions; the publishing function alone adds form versions through application access. The editor loads the first 100 forms;
search/pagination is a later addition for larger form catalogs.

The SDK supplies scoped authentication; the front component contains no workspace secret.
`POST /s/inventiveweb/forms/validate` validates a schema and customer answers. It does not
publish, book, issue, send or accept a customer submission. Draft JSON remains untrusted and
must be validated again by all future publishing and business-action implementations.

Eight field types: text, textarea, email, phone, number, date, select and checkbox. Conditions
depend on an earlier unconditional field. Public-visible fields cannot depend on staff-only
answers. Unexpected, hidden and staff-only answers are removed from customer validation output.
Required checkboxes must be checked. Limits prevent unbounded schema/answer payloads.

## Permissions and unfinished modules

Initial roles: application runtime, business manager, staff, bookkeeper and read-only.
They grant no global settings, API-key assignment, agent assignment or destructive permissions.
They do not replace the complete production role model for CRM or platform administration.

Appointments, quotes, invoices and form versions use APPLICATION writability. Only the
application runtime has a write grant for form versions, guarded by native caller permissions
in the publishing action. Appointment/quote/invoice business actions are not yet implemented.
No calendar/provider is connected.

Use **Publish saved draft** after saving, then choose a published version for a linked booking
service. See [publishing behavior](../../docs/implementation/form-publishing.md).

The visible customer panel is a preview, not the requested public booking embed. Public
booking and customer document views will be built separately, with customer-scoped access.

See [current scope](../../docs/implementation/scope.md) and
[staging acceptance](../../docs/implementation/acceptance.md).
