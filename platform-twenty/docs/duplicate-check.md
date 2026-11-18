# Duplicate check before installing Quotes & Invoices 0.6 and Feedback 0.2

Quotes & Invoices 0.6.0 and later make the invoice **Number** (`invoiceNumber`) and **Quote number** (`quoteNumber`)
unique. Feedback 0.2.0 and later do the same for the feedback request's **Source record id** (`sourceId`). On install,
Twenty creates a plain unique index for each in that workspace's schema. If two rows already share a value, the index
cannot be created and the install fails. Production runs older versions, which could hand out the same number twice.

How Twenty's index treats the data (checked on the test server):

- Soft-deleted rows (records in the trash) still count. Deleting a duplicate in the CRM is not enough.
- Empty fields (no value) never clash.
- Values must match exactly: `INV-0042` and `INV-0042 ` (trailing space) are different values.

The same release adds a unique **Repeat key** to invoices. It is a new, empty column, so it needs no check.

`scripts/sql/check-duplicates.sql` lists every value held by more than one row, in every workspace schema of the
database, deleted rows included. It changes nothing.

## Running it on production

The owner runs it on the production server. It only reads, with three guards:

- the session is read-only (`PGOPTIONS`), so Postgres refuses any write;
- the script runs inside a `READ ONLY` transaction;
- the transaction ends with `ROLLBACK`.

It also gives up after 5 seconds instead of queueing behind another session's lock.

```bash
cd /opt/inventivecrm/platform-twenty
out=/root/duplicate-check-$(date -u +%Y%m%dT%H%MZ).txt
(umask 077; docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' inventivecrm-db-1 \
  sh -c 'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < scripts/sql/check-duplicates.sql > "$out")
less -S "$out"
```

The output holds invoice numbers and record ids, so it is written for root only. Delete it once the fix-up is done.
The run takes a second or two and is safe while clients are working.

## Reading the output

**Result 1** has one line for each workspace and check. A workspace without the app has no table and is not listed.

| Column | Meaning |
|---|---|
| `check` | `invoice number`, `quote number` or `feedback sourceId` |
| `workspace_schema`, `workspace` | The Postgres schema, then the workspace name and subdomain. `deleted workspace` means it is in Twenty's trash and will not be installed into. `(no workspace row)` means a schema Twenty no longer knows: tell whoever looks after the server |
| `rows_with_value` | Rows that have a value, deleted rows included |
| `duplicated_values` | Values held by more than one row. Anything above 0 must be fixed |
| `rows_sharing_a_value` | How many rows hold those values |

**Result 2** has one line for every row involved, grouped by value. It is empty when there is nothing to fix.

| Column | Meaning |
|---|---|
| `value` | The shared value in quotes, so `''` (empty text) and stray spaces show |
| `copies` | How many rows share it |
| `position` | `1` is the row to keep: the invoice issued first, the quote sent first, the feedback request created first. Ties fall back to the oldest row |
| `id` | The record id, for the CRM address `https://<subdomain>.crm.inventiveweb.studio/object/<object>/<id>` (objects: `invoice`, `quote`, `feedbackRequest`) or a GraphQL update |
| `created_utc`, `deleted_utc` | When the row was created, and when it was deleted (empty if it is not deleted) |
| `details` | Type, status and the issued, sent or answered times, to decide which case below applies |

**Result 3** is the verdict: `OK: no duplicates ...` or `FIX FIRST: ...`.

## Fixing what it finds

Do it with the client, since it is their data, and with their accountant for any issued invoice. Take a backup first:
`deploy/ops/backup.sh before-duplicate-fix` (kept until removed by hand). Leave the row in position 1 alone and change
the others. Editing a number starts no app logic, so it is a plain field change.

### Invoice numbers

Pick the case from `details` for each row after position 1.

| The later row is | Fix |
|---|---|
| A Draft, never issued (no `issuedAt`) | Clear its Number. The app gives it the next free number when it is issued. A suffix such as `INV-0042-A` also works, but would then be printed |
| Issued, not paid | Do not renumber it silently: its filed PDF and any copy the customer has show the shared number. Issue a full credit note against it first, so the credit note quotes the number the customer knows. Then issue a new invoice with the same lines, which gets a fresh number, and send both to the customer if the first was sent (`lastSentAt` set). Last, change the credited invoice's Number to `INV-0042-A` and say why in its Notes |
| Paid or part paid | Do not credit it. Add the suffix (`INV-0042-A`), explain in Notes, and give the accountant the list. Any open pay-now link keeps the old number in its description; refresh it with **Send pay-now link** |
| Deleted (`deleted_utc` set) | Open the invoice's deleted records, restore it, apply the case above, then delete it again. A deleted draft that was never issued can be permanently destroyed instead |
| An empty value (`''`) | Twenty 2.55 saves an emptied field as no value, so `''` only comes from outside the CRM. Clear the field: it then holds no value and never clashes |

A credit note shares the same column, with its own prefix. A clash between an invoice and a credit note is fixed the
same way, on whichever was issued later.

### Quote numbers

A quote is not a tax document. Add a suffix to the later quote (`Q-0042-A`). If it was sent, note in its Notes that the
customer's copy shows the old number. A draft that was never sent can have its number cleared instead, like an invoice.
Invoices made from an accepted quote point at the quote record, not its number, so they are unaffected.

### Feedback source ids

Two requests with the same source id mean the customer was asked twice about one appointment or invoice. Keep one:
the one with an answer (status `ANSWERED`), or the one sent first if neither has an answer. If both hold an answer, keep
the first and copy the other's comment into the kept request's Comment. Then remove the other:

- select both under Feedback requests and use **Merge records**, keeping the chosen one; Twenty removes the merged one
  for good; or
- delete it, then open the deleted feedback requests and **Permanently destroy** it. A plain delete leaves it in the
  trash, where it still blocks the index.

### The same fixes through GraphQL

For many rows, use the workspace's API key. The key files are in `/root/secrets/keys/` (Admin role).

```bash
SERVER=https://crm.inventiveweb.studio   # http://localhost:3000 while the server runs in local mode
KEY_FILE=/root/secrets/keys/owner.key    # the key of the workspace the row is in
gql() {
  curl -sS "$SERVER/graphql" -H 'Content-Type: application/json' \
    -H @<(printf 'Authorization: Bearer %s\n' "$(tr -d '\n' < "$KEY_FILE")") \
    --data "$(jq -cn --arg query "$1" '{query: $query}')"
  echo
}
gql 'mutation { updateInvoice(id: "<id>", data: { invoiceNumber: "INV-0042-A" }) { id invoiceNumber } }'
gql 'mutation { updateInvoice(id: "<id>", data: { invoiceNumber: null }) { id invoiceNumber } }'
gql 'mutation { updateQuote(id: "<id>", data: { quoteNumber: "Q-0042-A" }) { id quoteNumber } }'
gql 'mutation { restoreInvoice(id: "<id>") { id } }'
gql 'mutation { deleteInvoice(id: "<id>") { id } }'
gql 'mutation { deleteFeedbackRequest(id: "<id>") { id } }'
gql 'mutation { destroyFeedbackRequest(id: "<id>") { id } }'
```

An answer with `errors` changed nothing. Credit notes and replacement invoices are made in the CRM as usual.

## Re-run, then install

Run the check again. Install only when Result 3 says `OK`. The old versions can still hand out a shared number, so
run the last check right before the install, then follow `UPDATES.md`, "Releasing an app": owner workspace first,
then one client, then the rest. A workspace's install fails on its own duplicates only, so a client whose duplicates
are still being sorted out can wait while the others go ahead.
