# Form publishing and service selection — app 0.3.0

Managers can save a draft, publish its reviewed content, and choose one published version for
a booking service. Draft changes do not rewrite published records or change existing selections.
The native frontend calls authenticated Twenty logic functions. No separate database or
customer token is involved in this increment.

## Publishing

`POST /s/inventiveweb/forms/publish`

```json
{
  "formId": "the-native-form-record-uuid",
  "expectedDraft": {
    "name": "Consultation",
    "purpose": "APPOINTMENT",
    "schema": { "schemaVersion": 1, "fields": [] }
  }
}
```

The example shows the request shape; at least one valid question is required to publish.

1. Require a human workspace member from Twenty's execution context. Caller-supplied workspace,
   author and version values are ignored.
2. Resolve the native Form object by its stable universal ID and query `recordPermissions`
   with the caller's scoped MetadataApiClient. Require read and update permission on that form.
   Read the draft through the caller's REST client as an additional native data-access check.
3. Normalize the saved name, purpose and schema. Compare with the editor's expected snapshot.
   Unsaved or stale content returns 409; no publication occurs.
4. Hash the form ID and normalized snapshot. Reuse an existing identical publication.
5. Insert a version through application access. The native unique indexes cover snapshot key
   and `(form, version)`. Concurrent duplicate attempts reuse the committed record; conflicting
   version numbers retry up to five times. A lost response is recovered by snapshot key.

The action never updates or deletes a version. Shipped customer roles have no write permission
on versions, and the object uses APPLICATION writability. This is append-only application
behavior, not a database WORM guarantee against server operators or someone who can modify
the application's roles/code. Native installation and OAuth/scoped-token behavior must be
verified before customer onboarding. Existing bespoke broad roles need their own review.

Each version records schema, purpose, author membership ID, timestamp and ordinal. Publishing
the same content again returns the existing ordinal. Reverting a draft to old content reuses
that original version; it does not create an identical new revision.

## Selecting a service form

`POST /s/inventiveweb/services/select-form`, body `{ "serviceId": "...", "versionId": "..." }`.

The caller must be a human member. Read the service and version with their native access.
Reject versions that belong to another form, have a non-appointment purpose, or lack complete
publication metadata. Update the service with caller permissions and a conditional
`id + formId` filter. A changed association or missing writable record returns 409.
The application does not elevate service-selection writes.

A subsequent direct native edit can still change a service's form association. Every future
booking/customer-read action must revalidate the selected version against the current service
and check active status, provider availability and policy. A selected version is not proof
that a service is publicly bookable.

## Native UI

Form builder includes **Publish saved draft**, a published-version selector and a linked
booking-service selector. Save first. If a teammate changed the draft, reopen the form and
review it before publishing. Create/link booking services in native records. Lists currently
load at most 100 records; search/pagination remains pending for larger catalogs.

## Verification and remaining work

Twenty SDK 2.43.0 builds the app. Local tests cover denied roles, anonymous invocation, stale
drafts, authority injection, replay, concurrent publication, revision-number conflicts,
response loss, incomplete definitions and incorrect service selections. Adapter tests use the
real SDK with intercepted HTTP to verify token choice, permission denial and conditional-write
handling. They do not prove live server permission behavior or database concurrency.

On staging, check both unique indexes actually exist; retry publications from two processes;
try roles and direct writes; then test two workspaces. Do not install this 2.43.0 app into the
outer fork's 2.15.0 server. Live calendars, booking embeds and quote/invoice issuance are next
integrations, not side effects of publishing a form.
