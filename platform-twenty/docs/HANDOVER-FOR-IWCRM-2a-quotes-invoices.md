# Iwcrm handover, part 2a: Quotes & Invoices

This describes how the current Quotes & Invoices app (version 0.6.2) behaves, not its Twenty code. Part 2b covers
Campaign Studio; part 0 (`HANDOVER-FOR-IWCRM.md`) has the platform-wide rules. A "tenant" is one client workspace; "the
app identity" is the service account background work acts as. Where the README and the code or tests disagreed, the
code and tests were followed.

## 1. Purpose

Quotes & Invoices lets a UK small business price work, send quotations, turn accepted quotes into VAT-compliant invoices
and credit notes, bill repeat customers automatically and get paid online into its own Stripe or Revolut account. Every
document is checked against UK rules before it is numbered, rendered to PDF (built-in layout or the business's own Word
or PDF template), filed on the client's records and sent by email or WhatsApp.

## 2. Features and business rules

Dates are calendar dates in UK time (Europe/London). Money is GBP, held and calculated in integer pence.

### Quotes

- A new quote is a Draft and can be changed freely.
- Setting **Sent** runs the quote checks: a business profile with legal name and business address (street and postcode),
  company disclosures for a company or LLP, a linked client (company or contact), at least one line, each line with a
  description and a quantity above zero.
- A failing quote goes back to Draft with no number, and **Issues to fix** lists every problem, one per line.
- A passing quote gets, in order: the next quote number; quote date (today if empty); valid until (quote date plus the
  profile's validity days, default 30, if empty); stored totals; a PDF on the quote and attached to the client company
  and contact; the name "`<number> - <customer>`"; a sent time; cleared issues. It is then sent if **Send documents when
  issued** is on.
- Setting Sent again on a quote with a sent time does nothing new.
- A business that is not VAT registered quotes without VAT: no VAT column, and the PDF says no VAT will be charged.
- Setting **Accepted** creates exactly one Draft invoice with the same company, contact, lines, notes and a link to the
  quote, named "Draft from `<quote number>`"; the quote moves to **Converted to invoice**. If an invoice from that quote
  already exists, it is returned instead.
- **Declined** is set by hand and starts nothing.
- If processing throws, the quote returns to its previous status with "Could not process the quote: `<reason>`".

### Invoices

- Statuses and who moves them: Draft to Issued (person, AI tool, workflow, recurring job); Issued or Part paid to
  Overdue (daily job); payable to Part paid or Paid (person or reconcile); to Void (full credit note or person).
- Setting **Issued** runs the UK checks (see "UK VAT rules"). On failure the invoice returns to Draft with no number and
  the reasons in **Issues to fix**.
- On success, in order: template (the invoice's own, else VAT or non-VAT by the profile); invoice date defaults to today;
  time of supply to the invoice date; due date to invoice date plus terms (the invoice's, else the profile's, else 30);
  number claimed and written; totals computed and frozen; PDF rendered, stored and attached to the client company and
  contact; issued time set; issues cleared; pay-now link created if online payments are on; sent if send on issue is on.
- An invoice with an issued time is never renumbered, re-rendered or re-sent by setting Issued again.
- If the status was moved away from Issued while the job waited, the job does nothing.
- If issuing throws, the invoice returns to its previous status with "Could not issue the invoice: `<reason>`".
- A failed pay-now link or send never undoes issuing.
- The customer is the linked company, else the contact's company, shown as "`<Company> (attn. <Contact>)`", or the
  contact's name alone. Address and VAT number come from that company, the email from the contact.
- Setting **Paid** by hand sets **Paid on** to today and **Amount paid** to the total, each only if empty.

### Credit notes

- A credit note is an invoice with Type **Credit note**. It must link the invoice it credits, and that invoice must have
  a number.
- It has its own sequence (default CN-), the title CREDIT NOTE, "CREDIT TO", "Credits invoice `<number>`" and "This
  credit note reduces the amount owed on invoice `<number>`." No due date, payment instructions or pay-now link.
- A credit note whose total is at least the credited invoice's total (above zero) sets that invoice to **Void** at issue.
- A smaller one leaves the status alone and, if the credited invoice has an open pay-now link, replaces it at once with
  one for the new amount owed.
- Only issued, non-void credit notes reduce the amount owed. Lines are entered as positive amounts.

### Numbering

- A number is prefix plus counter, zero-padded to **Number of digits** (default 4): `INV-0042`, `CN-0003`, `QUO-0017`.
  Empty prefixes fall back to INV-, CN-, QUO-. Counters start at 1.
- An issued invoice's number never changes and is unique within the tenant, even when two are issued at the same moment.
- Invoices and credit notes share one unique number column; quotes have their own. Deleted documents' numbers count as
  used. Empty text counts as no number.
- Claim: checks pass first; the first candidate from the profile counter that no record holds (deleted included) is
  written to the document only if it has no number yet; a uniqueness clash means another document took it, so the next
  is tried; then the counter becomes the used value plus one.
- After 20 clashes in a row issuing fails with "No free number was found after 20 tries. Check the next number in the
  Business profile." If another run numbered the same document first, this run stops.
- The number is written before the PDF is rendered and kept on failure for the retry, so there are no gaps.
- A counter edited by hand is respected; used numbers above it are skipped.

### UK VAT rules and rounding

- Rates: Standard 20%, Reduced 5%, Zero 0%, Exempt, Outside the scope, No VAT. A line without a rate counts as 20%.
- Line net = quantity × unit price × (1 − discount% / 100), rounded half up to the penny.
- VAT is calculated per rate on the summed net of that rate, rounded half up or down to the penny as the profile says
  (default nearest). Lines also store their own net and VAT for display.
- Example: 3 × £45.00 and 1 × £19.99 less 10% at 20%, 2 × £12.50 at 5%, £8.00 at 0% → VAT £30.60 on £152.99 and £1.25
  on £25.00; subtotal £185.99, VAT £31.85, total £217.84. Rounding down gives £30.59 on £152.99.
- A business that is not VAT registered never charges VAT: every line is set to No VAT whatever the price list says,
  and it cannot use a VAT template. A VAT-registered business must use one.
- Every invoice needs seller legal name and business address, a client, at least one line, and each line a description
  and quantity above zero.
- A VAT invoice also needs the customer's address (street and postcode), a valid UK VAT number in the profile, a time
  of supply, and a real VAT rate on every line. A non-VAT invoice may carry only No VAT.
- Domestic reverse charge (CIS) also needs the customer's valid VAT number and only 20% or 5% lines. VAT is shown
  ("Reverse charge VAT 20% on £X", "VAT to be accounted for by customer") but not added to the total, with the section
  55A VAT Act 1994 wording.
- A company or LLP also needs a Companies House number (8 digits, or SC, NI, OC, SO, NC or R0 plus 6 digits), a place of
  registration and a registered office, printed in the footer of every page.
- A UK VAT number is valid when, without spaces and upper-cased, it is optional GB plus 9 or 12 digits, or GD or HA plus
  3 digits.
- Invoices carry the late payment notice (1998 Act) when the profile says so (default on); quotes and credit notes never.
- The VAT summary lists "Total excluding VAT", one "VAT `<rate>` on `<net>`" row per charged rate, one "`<rate>`
  supplies `<net>`" row per zero, exempt or outside-scope rate, then "Total VAT".

### Totals frozen at issue

- Before issue, a line created, deleted, restored or changed in quantity, price, discount, VAT rate, product or parent
  recalculates the line and its document (both documents when moved).
- A line with a product fills its empty description (product description, else name), price, VAT rate and unit. A line
  without quantity gets 1.
- Once an invoice has an issued time (a quote a sent time), its totals and PDF never change. A line change adds "Lines
  were changed after this invoice was issued ... raise a credit note" (quote: "... send a new quote") to **Issues to
  fix**; changing the lines back removes it.
- Recalculation writes only changed values, so its own writes start no further round.

### Amount owed and part payments

- Owed = total − amount paid − totals of issued, non-void credit notes, never below zero.
- **Amount paid** is one running figure; a person records a part payment by raising it and setting Part paid.
- Emails, WhatsApp, reminders and pay-now links always use the owed amount ("`<owed>` of invoice `<number>` for
  `<total>`" in a part-paid reminder).
- An online payment adds to **Amount paid**; the status becomes Paid (with **Paid on** today) when nothing is owed,
  else Part paid.

### Recurring billing

- A recurring invoice has Recurring ticked, a frequency (weekly, monthly, quarterly, yearly), an interval (every N
  periods, at least 1), a next invoice date, an optional stop date and **Issue repeats automatically** (default on). It
  can itself be issued like any invoice.
- The daily job takes up to 100 recurring invoices due today or earlier. For each:
  - past the stop date: Recurring is switched off, nothing billed;
  - else one repeat for that date: a Draft "Recurring from `<number>`" with the same template, company, contact, terms,
    reference and notes, invoice and supply date set to that date, linked to the parent, not recurring, with the repeat
    key `<parent id>:<date>`; lines copied, totals computed, then set to Issued (only if still an unissued Draft);
  - the next date moves on by the interval only if it still holds the date just billed; past the stop date it is
    cleared and Recurring switched off.
- Each parent and date is billed once, even with overlapping runs or retries: the repeat key is unique.
- A repeat left half-made by a dead run is finished by the next run, unless younger than 5 minutes (its creator may
  still be working). A deleted repeat skips its date.
- Monthly steps keep the day of month and clamp to month end (31 January + 1 month = 28 or 29 February).
- A failure on one parent is noted on it ("Could not create the repeat for `<date>`: `<reason>`. The next daily run
  tries again."), leaves its schedule unchanged, and does not stop the others. Success removes the note.
- Missed dates are billed one per parent per daily run, oldest first.

### Overdue, reminders, expiry and unfinished documents

- The daily job marks Overdue every invoice (not credit note) that is Issued or Part paid with a due date before today
  (up to 200 per run), each by a conditional update; only the run that moved it sends the reminder.
- That automatic reminder goes only when **Send overdue reminders** is on (default off), once.
- Any reminder goes only for an Overdue or Part paid invoice, past due, with something owed; otherwise nothing is sent
  or recorded. Email subject "Reminder: invoice `<number>` from `<business>` is overdue"; WhatsApp event
  `invoice.overdue_reminder`.
- The daily job sets **Expired** on Sent quotes whose valid-until date is before today (up to 200 per run).
- It puts back to Draft any invoice still Issued without an issued time, or quote Sent without a sent time, unchanged for
  15 minutes (up to 100 each), noting "Issuing did not finish (usually the PDF took too long) and nothing was sent. Set
  the status to Issued again to retry; any number it was given is kept." This also covers a lost background event.
- The daily job runs at 06:00 server time and on `POST /s/billing/daily-run`. Steps run in order (release, recurring,
  overdue, expiry), each even if an earlier one failed. An optional `{ "date": "YYYY-MM-DD" }` replays a past day; a
  future or malformed date becomes today. Answer: `{ date, recurringInvoicesCreated, invoicesMarkedOverdue,
  quotesExpired, documentsReleased, errors? }`.

### PDFs and templates (Word to PDF)

- Built-in layout (A4): title (VAT INVOICE, INVOICE, CREDIT NOTE, QUOTATION) and number; seller block with "Trading as"
  and VAT number when VAT applies; BILL TO, CREDIT TO or PREPARED FOR; detail rows (dates, tax point, credited invoice,
  due date, customer reference, quote reference, valid until, job); lines with a VAT column only when VAT applies; VAT
  summary; total; notices; notes (quote notes and terms); "How to pay" (due date and reference, bank details when sort
  code and account number are set, IBAN and BIC, free text; invoices only); footer with company disclosures, profile
  footer and "Page X of Y" on every page.
- Characters the PDF font cannot encode are replaced (curly quotes, long dashes) or dropped.
- File names: "Invoice `<number>`.pdf", "Credit note `<number>`.pdf", "Quote `<number>`.pdf".
- A business can upload its own templates. Kinds (from the file's first bytes):
  - Word with merge tags, filled and converted to PDF by the document converter;
  - fillable PDF form: fields named after the tags, lines as `description_1`, `quantity_1`, `unitPrice_1`, `vatRate_1`,
    `lineNet_1`, `_2` and so on, VAT summary in `summaryLabels` and `summaryAmounts`; text shrinks to fit (4 to 10 pt);
    the form is flattened;
  - any other PDF is a letterhead: the built-in layout is printed over page 1 between its header and footer.
- Merge tags: `documentTitle`, `documentNumber`, `issueDate`, `supplyDate`, `dueDate`, `validUntil`,
  `purchaseOrderNumber`, `quoteNumber`, `creditedInvoiceNumber`, `sellerName`, `sellerTradingName`, `sellerAddress`,
  `sellerVatNumber`, `sellerEmail`, `sellerPhone`, `sellerWebsite`, `customerName`, `customerAddress`,
  `customerVatNumber`, `subtotal`, `vatTotal`, `totalLabel`, `total`, `notices`, `notes`, `paymentDetails`,
  `legalFooter`; loops `{#lines}` (`description`, `quantity`, `unitPrice`, `vatRate`, `lineNet`) and `{#summaryRows}`
  (`label`, `amount`). Any other `{#tag}...{/tag}` shows its content only when the value is filled.
- A template is checked when added and when its file, Use for or VAT changes (not on the check's own write), without AI:
  - text from the Word text, the PDF text layer (first 3 pages), or OCR of page 1 when the layer has under 20
    non-space characters; **Read from** says which;
  - **Use for**: the earliest of "credit note", "quotation/quote/estimate", "invoice" decides, merge tags ignored; none
    means any document;
  - **VAT**: "reverse charge" wording, else "not VAT registered" or "no VAT charged", else VAT wording or VAT tags, else any;
  - a value set by hand is kept (with a note if the file reads otherwise); **Detect from file** reads again.
- A Word or form template is **Ready** only if it can show what its kind needs: number, date, seller name and address,
  customer name, total, legal footer, line description, quantity, unit price and net; plus valid-until (quotes); tax
  point, seller VAT number, customer address, line VAT rate and summary rows (VAT invoices and credit notes); customer
  VAT number and notices (reverse charge); notices (non-VAT invoices); credited invoice number (credit notes). "Any"
  must meet every case it could be picked for (quotes are never reverse charge).
- **Needs attention**, with reasons in **Check report**, for unknown tags (typos), syntax errors and broken loops,
  missing tags, a form without line fields, a letterhead with content in the middle, no converter for a Word file, a file
  that is not .docx or PDF, or an unreadable file.
- Letterhead: ink in the top 40% is header, in the bottom 30% footer; the layout starts 6 mm below the header and stops
  4 mm above the footer (15 mm if none); ink in between means a finished document. Non-A4 is scaled to A4. Heights can be
  edited.
- Upload limits: 10 MB file, 50 MB unpacked Word, page at most A3, OCR render at most 10 megapixels.
- Before conversion a Word file loses every reference that would make the converter fetch something (remote images,
  OLE objects, attached templates, sub-documents, frames, packages, media, INCLUDE/INCLUDETEXT/INCLUDEPICTURE/LINK/DDE/
  DDEAUTO/IMPORT fields). Hyperlinks and embedded images stay.
- At issue a template is eligible if active, Ready, its Use for and VAT match (or are any), its client matches (or it
  has none), a form has enough line rows, and a Word template has a converter. Most specific wins: client's own, exact
  type, exact VAT scheme, higher **Priority**, newest. None: built-in layout.
- A template that fails while rendering falls back to the built-in layout; the document is still issued. **Layout
  used** records the choice and reason, e.g. "Acme letterhead (matched document type; priority 0; 2 of 5 templates
  eligible)".

### Sending by email and WhatsApp

- Sendable: invoices and credit notes that are Issued, Part paid, Overdue or Paid; quotes that are Sent. Anything else
  sends nothing.
- Channels: the request's list, else the contact's **Send documents by** (Email by default, WhatsApp, or both). Only
  `EMAIL` and `WHATSAPP` are accepted; each is used once however often it is listed.
- Every attempt per channel is a **Delivery** (Queued, then Sent or Failed). A failed channel is recorded, never thrown.
- At most 5 sends per document and 300 per tenant in any 24 hours, counting every channel and failures. A request that
  would pass a limit is refused whole, before anything is sent.
- **Last sent to client** is set when at least one channel succeeded.
- Email: to the contact's primary email; subject "`<Invoice|Credit note|Quote> <number> from <business>`"; greeting by
  first name ("there" if none); amount and due date, validity, or credit amount; a "Pay `<owed>` now" button when there
  is a valid open link for the owed amount; the profile's **Email message**; "Kind regards, `<business>`". All values
  HTML-escaped. PDF attached (at most 15 MB).
- From our mail server (default): display name "`<business>` via InventiveCRM", reply-to the profile's email.
- From the business mailbox: sent through the connected mailbox named in the profile, as the signed-in person, so it
  lands in their Sent folder. Not connected: the delivery fails with "Mailbox `<address>` is not connected or not shared
  with the workspace". With nobody signed in (recurring, reminders, API keys) it goes through our server and the
  delivery says "(automatic send, no signed-in user for `<mailbox>`)".
- WhatsApp only when the contact has **Agreed to WhatsApp messages** and a mobile number, else the delivery fails with
  the reason. Numbers become E.164 (calling code, default +44, plus the number without leading zeros).
- The app hands documents to the WhatsApp gateway (section 6), which owns templates, numbers and opt-outs. A 2xx answer
  marks the delivery Sent with the gateway's message id; anything else Failed with the reason.
- Delivery statuses only move forward in the order Queued, Sent, Failed, Delivered, Read (a Delivered after Failed
  applies).
- There is no opt-out callback for documents: the gateway side clears **Agreed to WhatsApp messages** on opt-out.

### Pay-now links (Stripe and Revolut)

- A tenant connects one Stripe or one Revolut Business account, then picks it under **Online payments** (Off, Stripe,
  Revolut). Money goes to the client's own account; we take no fee.
- Every issued invoice (never a credit note) gets a link for the owed amount: a single-use Stripe Payment Link or a
  Revolut order. If the provider fails, the invoice is still issued and sent without a link.
- Only Issued, Part paid and Overdue invoices get links. Nothing owed: no link ("Nothing is owed on this invoice.") and
  an open one is marked closed.
- An open link with the same provider and the owed amount is reused.
- When the owed amount changed, the old link is closed with the provider, then checked: a payment already made on it is
  recorded (and if that settles the invoice, no new link). Then a link for the rest is created.
- A part credit note replaces the link when issued; a part payment entered by hand replaces it the next time the
  invoice, a reminder or the link is sent.
- Each attempt gets a fresh request key, stored on the invoice before the provider call; the result is written only if
  that key is still the latest. A losing attempt closes the link it made ("Another pay-now link was created for this
  invoice at the same moment; that one is kept.").
- A creation failure sets **Online payment** to "Could not create link" with the reason. A non-https answer is refused.
- Only provider payment pages go into messages: `https` on `buy.stripe.com`, `checkout.stripe.com`,
  `checkout.revolut.com` or `sandbox-checkout.revolut.com`, with no user, password or port. (Test-double hosts
  `buy.stripe.test` and `checkout.revolut.test` only when a provider address is overridden.)
- **Send pay-now link** (`POST /s/payments/link`, AI tool, workflow) takes `invoiceId`, optional `send` and `channels`,
  returns `{ success, url, deliveries }`. With `send` it sends the link alone: email "Pay invoice `<number>` from
  `<business>` online", WhatsApp `invoice.payment_link`; nothing if the link is not on an allowed host. Refused when
  online payments are Off.

### Reconcile

- Every 30 minutes (minutes 7 and 37) and on `POST /s/payments/reconcile`: open links, least recently checked first, in
  pages of 50, for at most 4 minutes. Each check stamps **Payment last checked**, so a run never repeats or loops.
- A paid link records the payment, sets **Online payment** to Paid online and clears the problem; Stripe links are then
  deactivated.
- A payment counts only while the link is still open with the same reference, so overlapping checks count it once.
- An open link on an invoice no longer payable (paid or voided by hand, back to Draft) is closed with the provider and
  marked Paid online (invoice Paid) or Link closed.
- A failed check writes "Could not check the payment: `<reason>`" to **Online payment problem** and moves on.
- Answer: `{ checked, paid, closed, errors }`. Polling needs nothing set up in the client's provider dashboard, and a
  missed event can never leave an invoice unpaid.

### Business profile

- One profile per tenant holds what documents print and the app's settings (section 3). If several exist, the oldest is
  used. Without one nothing can be issued.

### Permissions and access

| Entry point | Who may call | Acts with |
|---|---|---|
| Status changes, line changes, template uploads | anyone whose role lets them edit the record | app identity, so numbering, PDFs and filing never depend on the caller's role |
| `POST /s/documents/send`, AI tool `send-document`, workflow "Send invoice or quote" | signed-in person or API key | the caller's own access (an API key gets the app's role) |
| `POST /s/payments/link`, AI tool, workflow "Send pay-now link" | signed-in person ("Invoice not found." unless their role can read it); API keys, tools, workflows as automation | app identity |
| AI tool and workflow `issue-document` | automation | sets the status, so issuing runs as from the UI |
| `POST /s/billing/daily-run`, `POST /s/payments/reconcile` | any signed-in person or API key | app identity (open: should be admins and scheduler only) |
| `GET /s/payments/connect`, `POST /s/payments/connect-status` | public | connect page; yes or no only |
| `POST /s/whatsapp/status` | public, HMAC signed | app identity |
| Connecting the Stripe or Revolut account | tenant admins only | per tenant, encrypted |

- The app identity can read and update every record, upload files and send through connected mailboxes; it cannot
  delete or destroy records and cannot be given to people or API keys.
- The payment account is per tenant, never per person, so no member can route customer payments to their own account.

## 3. Data model

No field is required at the database level; "needed" marks what the checks demand. Money is integer pence in GBP (the
current build stores amount in micros plus currency code). Empty text counts as unset.

### Business profile

| Field | Type | Unique / needed | Default | Meaning |
|---|---|---|---|---|
| legalName | text | needed | | Registered name, or the owner's for a sole trader |
| tradingName | text | | | "Trading as"; sender name |
| legalStructure | select: SOLE_TRADER, PARTNERSHIP, LIMITED_COMPANY, LLP | | SOLE_TRADER | Company and LLP add Companies Act checks |
| companyNumber, registeredOfficeAddress | text | needed for company/LLP | | |
| registeredIn | select: ENGLAND_AND_WALES, SCOTLAND, NORTHERN_IRELAND | needed for company/LLP | ENGLAND_AND_WALES | |
| businessAddress | address | street, postcode needed | | Seller address |
| vatRegistered | boolean | | false | VAT or non-VAT documents |
| vatNumber | text | valid for VAT invoices | | |
| email, phone, website | text | | | Printed; email is reply-to |
| bankName, bankAccountName, sortCode, accountNumber, iban, bic | text | | | "How to pay" |
| invoicePrefix, creditNotePrefix, quotePrefix | text | | INV-, CN-, QUO- if empty | |
| nextInvoiceNumber, nextCreditNoteNumber, nextQuoteNumber | integer | | 1 | Counters |
| numberPadding | integer | | 4 | Digits |
| defaultPaymentTermsDays, quoteValidityDays | integer | | 30, 30 | |
| vatRounding | select: NEAREST_PENNY, ROUND_DOWN | | NEAREST_PENNY | |
| paymentInstructions, invoiceFooter | text | | | Extra printed text |
| includeLatePaymentNotice | boolean | | true | |
| onlinePayments | select: NONE, STRIPE, REVOLUT | | NONE | Pay-now provider |
| sendOnIssue | boolean | | true | Send issued invoices and sent quotes |
| sendOverdueReminders | boolean | | false | |
| emailSendingMethod | select: OUR_SERVER, CLIENT_MAILBOX | | OUR_SERVER | |
| clientMailbox, emailMessage | text | | | Mailbox address; extra email text |

### Invoice (invoices and credit notes)

| Field | Type | Unique / needed | Default | Meaning |
|---|---|---|---|---|
| name | text | | | "`<number> - <customer>`" at issue |
| invoiceNumber | text | **unique**, deleted rows included | | Claimed at issue |
| kind | select: INVOICE, CREDIT_NOTE | | INVOICE | |
| status | select: DRAFT, ISSUED, PART_PAID, PAID, OVERDUE, VOID | | DRAFT | |
| template | select: UK_VAT_INVOICE, UK_NON_VAT_INVOICE, UK_REVERSE_CHARGE_INVOICE | | chosen at issue | |
| issueDate, supplyDate, dueDate | date | supply date needed on VAT | today, issue date, + terms | |
| paymentTermsDays | integer | | profile | |
| purchaseOrderNumber, notes | text | | | Printed |
| subtotal, vatTotal, total | money | | computed | Frozen at issue |
| amountPaid | money | | | Running total received |
| paidDate | date | | | |
| paymentLinkStatus | select: NONE, OPEN, PAID, CANCELLED, FAILED | | NONE | |
| paymentLinkUrl, paymentReference | text | | | Link; Stripe link id or Revolut order id |
| paymentProvider | select: NONE, STRIPE, REVOLUT | | NONE | Provider of the link |
| paymentLinkAmountPence | integer | | | What the open link charges |
| paymentLinkCreatedAt, paymentCheckedAt | timestamp | | | Last check is kept out of the audit timeline |
| paymentLinkError | text | | | |
| paymentLinkRequestKey | text | | | Latest link attempt (not audited) |
| pdf | file (one) | | | |
| lastSentAt, issuedAt | timestamp | | | issuedAt is set once and freezes the document |
| layoutUsed, complianceIssues | text | | | Template and why; Issues to fix |
| isRecurring, autoIssueRecurring | boolean | | false, true | |
| recurrenceFrequency | select: WEEKLY, MONTHLY, QUARTERLY, YEARLY | | | |
| recurrenceInterval | integer | | 1 | |
| nextRecurrenceDate, recurrenceEndDate | date | | | |
| recurrenceKey | text | **unique** | | `<parent id>:<date>` on a repeat |

Relations: company and person (emptied if they are deleted), creditedInvoice and recurringParent (self, emptied on
delete) with inverses creditNotes and recurringChildren, sourceQuote (emptied), lines and deliveries (deleted with it).

### Quote

| Field | Type | Unique / needed | Default | Meaning |
|---|---|---|---|---|
| name | text | | | Set when sent |
| quoteNumber | text | **unique** | | Claimed at send |
| status | select: DRAFT, SENT, ACCEPTED, DECLINED, EXPIRED, CONVERTED | | DRAFT | |
| issueDate, validUntil | date | | today, + validity days | |
| title, notes, terms | text | | | Job; printed notes |
| subtotal, vatTotal, total | money | | computed | Frozen once sent |
| pdf | file (one) | | | |
| lastSentAt, sentAt | timestamp | | | sentAt set once |
| layoutUsed, complianceIssues | text | | | |

Relations: company, person (emptied on delete), lines and deliveries (deleted with it), invoices made from it.

### Quote line and invoice line

| Field | Type | Default | Meaning |
|---|---|---|---|
| description | text | from product | |
| quantity | number (2 decimals) | 1 | |
| unit | text | from product | |
| unitPrice | money | from product | Excluding VAT |
| vatRate | select: STANDARD_20, REDUCED_5, ZERO, EXEMPT, OUTSIDE_SCOPE, NO_VAT | product, else 20% | NO_VAT forced when not registered |
| discountPercent | number | 0 | |
| netAmount, vatAmount | money | computed | |
| lineOrder | integer | 0 | Print order |

Relations: parent quote or invoice (deleted with it), product (emptied on delete).

### Product or service

name, description (printed), unitPrice (money), vatRate (default STANDARD_20), unit, sku (text), isActive (boolean, true,
not enforced on lines).

### Delivery

| Field | Type | Default | Meaning |
|---|---|---|---|
| name | text | | e.g. "Reminder for Invoice INV-0042 by email" |
| channel | select: EMAIL, WHATSAPP | | |
| method | text | | Our mail server, "Mailbox `<address>`", WhatsApp service, or fallback note |
| recipient | text | | Email or E.164 number |
| status | select: QUEUED, SENT, DELIVERED, READ, FAILED | QUEUED | Forward only |
| sentAt, statusUpdatedAt | timestamp | | |
| errorMessage, providerMessageId | text | | |

Relations: invoice or quote (deleted with it). Its id is the gateway's `deliveryId`.

### Document template

| Field | Type | Default | Meaning |
|---|---|---|---|
| name | text | | |
| file | file (one) | | .docx or .pdf |
| documentType | select: AUTO, ANY, INVOICE, CREDIT_NOTE, QUOTE | AUTO | Use for; AUTO replaced by the check |
| vatScheme | select: AUTO, ANY, VAT, NON_VAT, REVERSE_CHARGE | AUTO | Same |
| format | select: DOCX_MERGE, PDF_FORM, PDF_LETTERHEAD | | Set by the check |
| status | select: CHECKING, READY, NEEDS_ATTENTION | CHECKING | |
| isActive | boolean | true | |
| priority | integer | 0 | Higher wins |
| headerHeightMm, footerHeightMm, lineRows | integer | measured | |
| checkReport, readBy | text | | |
| checkedAt | timestamp | | |

Relation: company ("Only for client", emptied when the company is deleted; see section 4).

### Fields added to existing objects

- Company: vatNumber (text, client VAT number for reverse charge), companyRegistrationNumber (text, no logic reads it),
  relations to quotes, invoices, documentTemplates; every issued PDF is attached to it.
- Person: preferredChannel (select EMAIL, WHATSAPP, EMAIL_AND_WHATSAPP, default EMAIL; "Send documents by"),
  whatsappOptIn (boolean, default false; "Agreed to WhatsApp messages"), relations to quotes and invoices; PDFs attached.

### Indexes and uniqueness

| Rule | Prevents |
|---|---|
| invoiceNumber unique, deleted rows included | Two documents issued at once sharing a number; reuse of a deleted document's number |
| quoteNumber unique | The same for quotes |
| recurrenceKey unique | A parent billed twice for one date by overlapping or retried runs |
| (status, dueDate) on invoices | Slow overdue scans |
| (paymentLinkStatus, paymentCheckedAt) on invoices | Slow reconcile paging |

A unique rule cannot be added over existing duplicates (deleted rows count, empty values never clash, a trailing space
is a different value). Check before migrating (section 4, item 3).

## 4. Edge cases and bugs found

Fixed unless marked Open, or Observed (seen in the code, not reported).

1. **Duplicate invoice numbers.** The number was picked, then the PDF rendered, then the number written, so two
   documents issued together shared one → unique column; number claimed by a conditional write before slow work; next
   candidate on a clash.
2. **Gaps or reuse.** A failed attempt must not burn a number; a deleted document's number must not return → the number
   stays on the document for the retry; the search counts deleted rows.
3. **Existing duplicates.** The unique rule fails over them → list values held twice (deleted included) before
   migrating. Never-issued draft: clear the number. Issued unpaid: full credit note, reissue under a new number, suffix
   the old (`INV-0042-A`). Paid: suffix and tell the accountant. Quotes: suffix.
4. **Double recurring billing.** Overlapping runs or a retry made two repeats for one date → unique repeat key, so
   creating the repeat is the claim; the schedule moves only if it still holds the billed date.
5. **One bad recurring invoice stopped the run.** → per-parent error handling, failure noted, retried next day; later
   daily steps run anyway.
6. **Half-made repeats.** A dead run left a Draft without lines → the next run finishes it (if older than 5 minutes); a
   deleted repeat skips its date.
7. **Documents stuck as Issued or Sent.** A job killed by its time limit (slow PDF) left no PDF and no reason → released
   to Draft with a note after 15 minutes; issue jobs given 3 minutes.
8. **Issued totals changing later.** Line edits after issue changed totals the customer and the link had seen → frozen;
   a note asks for a credit note or a new quote.
9. **Owed amounts ignoring credit notes.** → owed = total − paid − issued non-void credit notes, used everywhere.
10. **Stale link after a part payment or credit.** The client could pay the old amount → a link not matching the owed
    amount is replaced before any send; a part credit note replaces it at issue.
11. **Link replacement needing a fresh idempotency key.** The key was `invoice-<id>-<amount>`; when the owed amount
    returned to an earlier value, Stripe replayed the old, closed link for 24 hours → random key per attempt, stored
    first; only the latest attempt writes; a loser closes its own link.
12. **Payment lost during replacement.** Closing a link just paid lost the payment → close, then check and record, then
    decide on a new link.
13. **Reconcile double counting.** → the payment write applies only while the link is open with the same reference.
14. **Reconcile coverage.** It read the first 200 open links with no order, so some were never checked → ordered by last
    check, paged, stamped, 4-minute budget.
15. **Overdue reminder sent twice** by overlapping runs → only the run whose conditional update moved it sends.
16. **Reminders for the full amount after a part payment** → owed amount; nothing sent when nothing is owed.
17. **Send loops.** `channels: ["EMAIL" x 500]` sent hundreds of emails → validated, de-duplicated, 5 per document and
    300 per tenant per 24 hours, counted before sending.
18. **Forged pay-now URL.** The link came from an editable field → only provider payment hosts are sent.
19. **Stripe links on a custom domain lose the Pay now button.** Such links fail the host allowlist, so no button and no
    stand-alone send. **Open.** Fix: trust the URL the provider's API returned at creation, stored apart from editable
    fields.
20. **API keys acting with the app's full role.** → the pay-now route holds a signed-in person to their own read access;
    API keys are trusted automation. **Open:** daily-run and reconcile act as the app for any signed-in person.
21. **Per-person payment accounts** let a member route payments to their own account → one per tenant, admins only.
22. **Connect page abuse.** → posts only to the platform's own callback (origin, path, state), escapes it; the status
    route answers yes or no for a key's hash prefix. A key the provider refuses stores nothing.
23. **WhatsApp gateway URL needing to be a per-tenant path.** One server-wide address sent every tenant through one
    tenant's gateway (refused there, so failed, not leaked) → a path is resolved against the sending tenant's address.
24. **Callback timestamps that never expire.** A non-numeric timestamp passed the age check forever → 1 to 12 digits,
    5-minute window, constant-time compare.
25. **Out-of-order delivery callbacks** → forward-only statuses.
26. **Template uploads as an attack** (zip bombs, huge pages, references that make the converter fetch URLs or local
    files) → limits, references stripped, converter without internet.
27. **A broken template stopping issuing** → fallback to the built-in layout, recorded.
28. **Misclassified template.** `{quoteNumber}` on an invoice made it a quote → tags ignored, earliest word decides.
29. **Self-triggering loops.** The template check and line recalculation re-ran on their own writes → skip the check's
    own write; recalculate only on listed fields; write only changes.
30. **Behaviour depending on who clicked.** Numbering and filing failed for roles lacking a permission → follow-up work
    runs as the app identity.
31. **Non-VAT businesses charging VAT from the price list** → No VAT forced; checks refuse VAT rates.
32. **Empty text versus no value.** The platform stores empty text as `''` → treat it as unset everywhere.
33. **Daily run with a future date** would issue and send early → replaced by today.
34. **Sending in the wrong state** (drafts, void documents, reminders not due) → sendable statuses and reminder
    conditions.
35. **Mailbox send without a person** failed automatic sends → fall back to our server, say so.
36. **Outages.** No timeouts hung jobs; a proxy error page counted as permanent → 30 s API timeout with a retryable
    error; SMTP 10 s connect and greeting, 20 s socket; providers 20 s; gateway 30 s; converter 60 s.
37. **Provider or mail outage during issue** → issuing is never undone by a link or delivery failure.
38. **Lost background events** between commit and queue left an invoice Issued but unprocessed → the 15-minute release.
39. **Monthly drift (Observed).** The next date comes from the clamped date: 31 January, 28 February, 28 March. Keep the
    anchor day.
40. **Revolut orders without an idempotency key (Observed).** A timed-out create can leave an extra pending order.
41. **Which payment key is used (Observed).** The last working connection listed, assumed newest; order not guaranteed
    (same family as Campaign Studio's open Resend issue).
42. **Client template becoming general (Observed).** Deleting the client company empties "Only for client", so the
    template becomes eligible for everyone.
43. **Several business profiles (Observed).** Nothing stops a second; it is silently ignored.
44. **Daily batch caps (Observed).** Overdue and expiry 200, recurring and release 100 per run; the rest wait a day.
45. **WhatsApp PDF links (Observed).** InventiveChat templates cannot carry a document, so the PDF goes as a
    time-limited link that can expire in old messages.
46. **Accepting an unsent quote (Observed)** works and creates an invoice from an unnumbered quote.

## 5. Test checklist

### Unit: UK checks (`compliance.test.ts`)

- [ ] accepts a complete VAT invoice: no issues for a full profile, customer and lines.
- [ ] requires company number, registered office and a valid VAT number.
- [ ] stops a business that is not VAT registered from charging VAT.
- [ ] requires the customer's VAT number for the domestic reverse charge.
- [ ] requires a credit note to reference the invoice it credits.
- [ ] issues to fix: adds a note once and keeps the other issues.
- [ ] issues to fix: swaps a dated note for the newest one and removes it when resolved.

### Unit: dates (`dates.test.ts`)

- [ ] adds days across month ends.
- [ ] clamps monthly repeats to the month end, leap years included.
- [ ] steps recurring invoices by frequency and interval.

### Unit: delivery (`delivery.test.ts`)

- [ ] names the business, number, amount and due date in the email.
- [ ] writes an overdue reminder and the business message, escaping HTML.
- [ ] asks only for what is still owed after a part payment or credit note.
- [ ] escapes quotes so a value cannot leave an HTML attribute.
- [ ] gives a quote its validity date.
- [ ] turns a UK mobile into E.164.
- [ ] follows the contact's preferred channel.
- [ ] uses the contact's preferred channels when none are given.
- [ ] sends on each channel at most once.
- [ ] refuses anything other than EMAIL and WHATSAPP.
- [ ] accepts a fresh, correctly signed callback and rejects anything else.
- [ ] rejects every callback when no secret is configured.
- [ ] sends a gateway path to the same tenant's WhatsApp app and keeps a full address as it is.

### Unit: templates (`document-templates.test.ts`)

- [ ] lets the first document word decide, ignoring merge tags.
- [ ] reads the VAT scheme from the wording or the VAT tags.
- [ ] prefers the client, then the exact type, then priority.
- [ ] skips templates that cannot be used and falls back to the built-in layout.
- [ ] the sample Word template reads as a VAT invoice with every required tag.
- [ ] fills in the Word document, one table row per line.
- [ ] reports typos and broken loops instead of failing later.
- [ ] measures a letterhead and keeps the layout clear of it.
- [ ] spots a finished document that is not a letterhead.
- [ ] reads and fills a fillable PDF form.
- [ ] reads a scanned credit note with OCR.

### Unit: money (`money.test.ts`)

- [ ] converts between micros and pence without drift.
- [ ] totals a mixed-rate VAT invoice per rate (the example in section 2).
- [ ] rounds VAT down when the business chooses to.
- [ ] shows but does not charge VAT under the domestic reverse charge.
- [ ] formats pounds sterling, thousands and negatives.

### Unit: numbering (`numbering.test.ts`)

- [ ] recognises a unique clash and nothing else.
- [ ] claims the first free number.
- [ ] moves past a number another document took between the check and the write.
- [ ] starts the next search after the clashing number, not after the counter.
- [ ] gives up after a bounded number of clashes.
- [ ] passes other errors through without retrying.
- [ ] reports a record that another run has already numbered.

### Unit: payments (`payments.test.ts`)

- [ ] encodes nested Stripe parameters with brackets.
- [ ] charges only what is still owed.
- [ ] takes issued credit notes off what is owed, but not drafts or voided ones.
- [ ] maps connection names to providers.
- [ ] posts keys only to the platform's own callback.
- [ ] escapes the callback in the connect form.
- [ ] accepts only Stripe and Revolut payment pages over https (look-alikes, user info, ports refused).
- [ ] accepts the test double pages only when a payment double is configured.

### Unit: PDF and safety (`pdf.test.ts`, `template-safety.test.ts`)

- [ ] renders a multi-page VAT invoice with the statutory details.
- [ ] accepts the sample template.
- [ ] refuses a Word file that unpacks to more than 50 MB (zip bomb).
- [ ] refuses files over 10 MB.
- [ ] removes fetching relationships and INCLUDE fields, keeps hyperlinks and local images.
- [ ] leaves an ordinary template unchanged.
- [ ] refuses a non-numeric callback timestamp, which would otherwise never expire.

### End to end: quotes (`inv1-quote-to-invoice.mjs`, 7 checks)

- [ ] quote lines filled from price list and totals calculated.
- [ ] line descriptions came from products.
- [ ] sending a quote numbers it and stores the PDF.
- [ ] accepting the quote creates a draft invoice with the same lines and totals.
- [ ] issuing numbers the invoice, sets dates and stores the PDF.
- [ ] quote and invoice PDFs are on the client company card.
- [ ] quote and invoice PDFs are on the contact card.

### End to end: rules (`inv2-rules.mjs`, 9 checks)

- [ ] VAT invoice without a customer address is held back as Draft with the reason.
- [ ] reverse charge invoice shows VAT but the total excludes it.
- [ ] credit note gets its own CN- sequence and references the original.
- [ ] a full credit note voids the original invoice.
- [ ] daily run creates and issues the recurring invoice with the client PDF.
- [ ] the recurring schedule moves to next month.
- [ ] running the daily job twice the same day does not duplicate.
- [ ] an unpaid invoice past its due date becomes Overdue.
- [ ] marking Paid records the payment date and amount.

### End to end: not VAT registered (`inv3-non-vat.mjs`, 3 checks)

- [ ] price list VAT is ignored for a business that is not VAT registered.
- [ ] non-VAT invoice issues with the non-VAT template to a private client.
- [ ] invoice PDF is on the client person card.

### End to end: delivery (`inv4-delivery.mjs`, 17 checks)

- [ ] issuing sends the invoice by email from our server.
- [ ] email names the business as sender, replies go to the business, subject carries the number.
- [ ] email has the invoice PDF attached.
- [ ] email is DKIM-signed by our mail server.
- [ ] WhatsApp hand-off is accepted with the gateway message id.
- [ ] gateway receives a signed request with the document, amount, PDF link and callback URL.
- [ ] PDF link given to the gateway downloads the PDF.
- [ ] signed delivered and read callbacks update the delivery.
- [ ] invoice records when it was last sent.
- [ ] forged status callback is refused and changes nothing.
- [ ] without WhatsApp consent nothing is sent and the reason is logged; the invoice stays issued.
- [ ] a mailbox that is not connected is refused with the reason.
- [ ] a signed-in user sends from the connected mailbox.
- [ ] mailbox email reaches the client from the business address with the PDF.
- [ ] automatic sends with no signed-in user fall back to our server and say so.
- [ ] with send-on-issue off, issuing sends nothing.
- [ ] daily run marks the invoice overdue and emails a reminder.

### End to end: templates (`inv5-templates.mjs`, 10 checks)

- [ ] Word template: read as a VAT invoice with merge tags, ready.
- [ ] Word template with a typo needs attention and says why.
- [ ] PDF letterhead: measured header and footer, any document, ready.
- [ ] scanned PDF is read with OCR and classified as a VAT credit note.
- [ ] fillable PDF form: fields read as tags, 3 line rows, ready.
- [ ] a client with its own template gets it.
- [ ] highest priority wins among general templates.
- [ ] a document with more lines than the form holds goes to the next template (Word, via LibreOffice).
- [ ] a credit note gets the credit note template, not the invoice ones.
- [ ] with no matching template the built-in UK layout is used.

### End to end: payments (`inv6-payments.mjs`, 12 checks, against the payment double)

- [ ] the connect page refuses a callback that is not the platform's own.
- [ ] a key Stripe refuses is not stored, and the page is told so.
- [ ] a valid Stripe key connects through the custom connection flow.
- [ ] a member who is not an admin cannot connect the payment account.
- [ ] issuing creates a single-use Stripe link for what is owed.
- [ ] the invoice email has a Pay now button with the link.
- [ ] asking again reuses the open link.
- [ ] after a part payment the link is replaced by one for the rest, and the old one is closed.
- [ ] the pay-now link can be sent on its own.
- [ ] a completed Stripe payment marks the invoice paid and closes the link.
- [ ] with Revolut, issuing creates a Merchant API order for what is owed.
- [ ] a completed Revolut order marks the invoice paid.

### End to end: AI (`mcp-invoice.mjs`) and gateway side (WhatsApp app suite)

- [ ] an AI assistant can create and issue an invoice through MCP.
- [ ] the gateway refuses bad or stale signatures (401) and status callbacks to other hosts (400).
- [ ] `invoice.send` goes out once with the default template mapping; a repeated delivery id answers the same message id.
- [ ] an event whose template is not approved is refused with the reason (422).
- [ ] a delivery update is forwarded, signed, to the calling app's status callback.

The same folder also holds `setup-verify.mjs` (5 checks on setup-by-prompt, not this app).

## 6. Integrations and exact contracts

### Stripe (pay-now links)

- Key: the client's own restricted key (`rk_live_...`, `rk_test_...` to try) with **Write** on Payment Links, Prices and
  Products and **Read** on Checkout Sessions, nothing else; a secret key (`sk_...`) is also accepted. Format
  `^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$`; test mode when it contains `_test_`. Validated with
  `GET /v1/payment_links?limit=1` before storing.
- Base `https://api.stripe.com` (`STRIPE_API_URL` override, tests only); Bearer auth; form-encoded bracketed keys; 20 s.
- Create `POST /v1/payment_links`: `line_items[0][price_data][currency]=gbp`, `[unit_amount]=<owed pence>`,
  `[product_data][name]=Invoice <number> from <business>`, `line_items[0][quantity]=1`,
  `restrictions[completed_sessions][limit]=1`, `metadata[invoiceId]`, `metadata[invoiceNumber]`,
  `after_completion[type]=hosted_confirmation` with a thank-you `custom_message`. Header `Idempotency-Key: <fresh UUID
  per attempt>`. Keep `id` and `url`.
- Close `POST /v1/payment_links/<id>` with `active=false` (errors ignored).
- Payment detection by polling: `GET /v1/checkout/sessions?payment_link=<id>&status=complete&limit=1`; paid when
  `payment_status=paid`, amount `amount_total`.
- Hosts allowed in messages: `buy.stripe.com`, `checkout.stripe.com`.
- Tested only against our double; confirm live Payment Links accept inline `price_data`.

### Revolut Merchant API

- Key: Merchant API secret key (Production, or Sandbox to try). Format `^[A-Za-z0-9_-]{20,}$`; test mode if it contains
  `sandbox`. Validated with `GET /api/orders?limit=1`.
- Base `https://merchant.revolut.com`, sandbox `https://sandbox-merchant.revolut.com` (`REVOLUT_API_URL`, server-wide).
  Headers `Authorization: Bearer <key>`, `Revolut-Api-Version: 2026-04-20`, `Accept: application/json`; 20 s.
- Create `POST /api/orders` `{ amount: <owed pence>, currency: "GBP", description, merchant_order_data: { reference:
  <invoice number> }, metadata: { invoiceId } }`; keep `id` and `checkout_url`. No idempotency key.
- Detection by polling `GET /api/orders/<id>`: paid when `state` is `completed`, amount `amount`.
- Close `POST /api/orders/<id>/cancel` when replacing or when the invoice stopped being payable; not after payment.
- Hosts allowed: `checkout.revolut.com`, `sandbox-checkout.revolut.com`.

### Connecting a payment account

- One connection per provider per tenant (`stripe-account`, `revolut-account`), stored encrypted.
- An admin presses Connect; the platform redirects to `GET /s/payments/connect?provider=STRIPE|REVOLUT&callback=<url>`,
  which answers 400 unless the callback has the platform's origin, path `/auth/apps/custom/callback` and a `state`. The
  page explains the key, posts `secretKey` to the callback, computes the first 16 hex characters of SHA-256 of the key
  in the browser and asks `POST /s/payments/connect-status` `{ provider, fingerprint }` (up to 6 times, 1 s apart) for
  `{ connected }`. Pages are `noindex`, `no-referrer`, `no-store`.
- The callback validates the key with the provider, then stores account id `<provider>-<fingerprint>`, label
  "`<Provider> [test ]key ending <last 4>`" and the key. An invalid key stores nothing.

### SMTP and business mailbox

- Our server: `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_SECURITY` (`TLS`, `STARTTLS`, or `NONE` only on a private
  network), optional `SMTP_USERNAME`, `SMTP_PASSWORD`, and `SMTP_FROM_ADDRESS`. Missing host or from address fails the
  delivery with the reason. Our relay signs with DKIM.
- Business mailbox: the tenant's connected Google, Microsoft or IMAP/SMTP account whose address equals the profile's
  (case-insensitive), sending as the signed-in person with the PDF and the contact as timeline target. The rebuild needs
  its own mailbox connections to keep this.

### Gotenberg (document conversion)

- `POST <DOCUMENT_CONVERTER_URL>/forms/libreoffice/convert`, multipart field `files` with `document.docx` (references
  stripped); the body is the PDF; 60 s. The converter has no internet access.

### WhatsApp gateway (documents)

- `POST <WHATSAPP_GATEWAY_URL>`; a value starting with `/` is resolved against the sending tenant's own address
  (`/s/whatsapp/gateway` reaches that tenant's WhatsApp app). 30 s.
- Headers `X-InventiveCRM-Timestamp: <unix seconds>` and `X-InventiveCRM-Signature: sha256=<hex HMAC-SHA256 of
  "<timestamp>.<raw body>" with WHATSAPP_GATEWAY_SECRET>`.
- Body `{ event, deliveryId, business: { name, replyEmail }, recipient: { name, phone, whatsappOptIn: true }, document: {
  type, number, total: { amountPence, currency, formatted }, amountDue: {...}, issueDate, dueDate, validUntil, pdf: {
  url, filename } | null, paymentUrl | null }, statusCallbackUrl }`.
- Events: `invoice.send`, `credit_note.send`, `quote.send`, `invoice.overdue_reminder`, `invoice.payment_link`.
  `amountDue` is the owed amount on invoices, the total otherwise; `paymentUrl` only for a valid open link matching it;
  `pdf.url` is a signed, time-limited link the gateway downloads at once and does not store.
- Answer: 2xx `{ "messageId" }` accepted; anything else, optional `{ "error" }`, fails the delivery. The gateway answers
  within 30 s, refuses bad signatures or timestamps over 5 minutes old, and treats a repeated `deliveryId` as the same
  message. On our gateway the templates are `invoice_ready`, `credit_note_ready`, `quote_ready`, `invoice_overdue`,
  `invoice_payment_link`, filled by parameter name.
- Status callback `POST <tenant>/s/whatsapp/status`, signed the same way, `{ deliveryId, messageId?, status:
  sent|delivered|read|failed, error? }`. Bad signature, non-numeric timestamp or unknown status: error answer, no change.
- `campaign.message` shares endpoint and signature (part 2b).

### Where credentials and settings go

| Item | Where |
|---|---|
| Stripe key, Revolut key | per-tenant connection, encrypted, admins only; never a server variable |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USERNAME`, `SMTP_FROM_ADDRESS` | server-wide |
| `SMTP_PASSWORD`, `WHATSAPP_GATEWAY_SECRET` | server-wide secrets (the gateway secret also signs Campaign Studio and Feedback) |
| `DOCUMENT_CONVERTER_URL` | server-wide; without it Word templates are never Ready |
| `WHATSAPP_GATEWAY_URL` | server-wide, a path |
| `STRIPE_API_URL`, `REVOLUT_API_URL` | server-wide, optional (test doubles, Revolut sandbox) |
| Business mailbox | the person's connected account |

## 7. Settings and configuration

- Per tenant: the business profile (section 3), one payment connection, document templates; per contact **Send
  documents by** and **Agreed to WhatsApp messages**; per client company its VAT number; per invoice template, terms and
  recurrence.
- Server-wide: the variables in section 6.

| Schedule or limit | Value |
|---|---|
| Daily job | 06:00 server time, 5 min limit |
| Reconcile | minutes 7 and 37 (was every 10 min), 5 min limit, 4 min budget, pages of 50 |
| Issue and send handlers | 3 min; unfinished documents released after 15 min |
| Template check | 2 min |
| Sends | 5 per document, 300 per tenant, any 24 hours |
| Templates | 10 MB, 50 MB unpacked, A3, 10 MP |
| Numbering | 20 clash retries |
| Reads per document | 200 lines, 100 credit notes; 200 templates considered |

## 8. Notes for the rebuild

**Keep**

- Integer pence, per-rate VAT on summed nets, the checks as tested rules, the worked example as a fixture.
- Database uniqueness for numbers (per tenant, deleted included) and repeat keys; claim before slow work; conditional
  updates as claims for overdue, link payments and schedule moves.
- Frozen issued totals, corrections only by credit note, "Issues to fix" on the record.
- One owed-amount function for emails, WhatsApp, reminders and links.
- Polling reconcile with stamped, ordered pages; a fresh idempotency key per link attempt; the latest attempt wins.
- Delivery records per attempt, forward-only statuses, send limits, the signed gateway contract with per-tenant paths.
- Template rules without AI, the safety limits and the built-in fallback.

**Do differently**

- Issue through an explicit job with a lease and states (claimed, rendered, filed, sent) rather than reacting to a
  status field, so a lost event or timeout resumes instead of being released by a sweep.
- Record payments as rows (date, amount, method, reference), not one running figure.
- Store and trust the URL the provider returned (fixes custom-domain links); store which payment key is active; send
  Revolut an idempotency key.
- One business profile row per tenant; keep the recurrence anchor day; page daily batches to completion; restrict the
  daily-run and reconcile routes to admins and the scheduler.
