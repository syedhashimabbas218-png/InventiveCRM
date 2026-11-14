# WhatsApp hand-off contract

The Quotes & Invoices app does not send WhatsApp messages itself. It hands each document to our WhatsApp service (the WABA integration), which owns the Meta connection, phone numbers, message templates and opt-out handling, then reports back what happened. This file is the contract between the two. `tests/commercial-docs/mock-whatsapp-gateway.mjs` is a working reference implementation of the service side.

## 1. Send request (app to WhatsApp service)

`POST {WHATSAPP_GATEWAY_URL}` with `Content-Type: application/json`.

```json
{
  "event": "invoice.send",
  "deliveryId": "c78d3c20-3c61-4b14-af39-d3d30816ea87",
  "business": { "name": "Acme Plumbing & Heating", "replyEmail": "accounts@acmeplumbing.test" },
  "recipient": { "name": "Sam Patel", "phone": "+447700900123", "whatsappOptIn": true },
  "document": {
    "type": "INVOICE",
    "number": "ACME-0016",
    "total": { "amountPence": 11400, "currency": "GBP", "formatted": "£114.00" },
    "issueDate": "2026-11-03",
    "dueDate": "2026-11-17",
    "validUntil": null,
    "pdf": { "url": "https://acme.crm.inventiveweb.studio/file/...", "filename": "Invoice ACME-0016.pdf" }
  },
  "statusCallbackUrl": "https://acme.crm.inventiveweb.studio/s/whatsapp/status"
}
```

| Field | Notes |
|---|---|
| `event` | `invoice.send`, `credit_note.send`, `quote.send` or `invoice.overdue_reminder`. Pick the Meta template from this |
| `deliveryId` | Our record id. Echo it in every callback |
| `recipient.phone` | E.164. Only sent when the contact has agreed to WhatsApp messages |
| `document.pdf.url` | Signed, time-limited link. Download it straight away and upload it to Meta as the document header; do not store the link |
| `statusCallbackUrl` | Per workspace. Post status updates here |

Headers:

| Header | Value |
|---|---|
| `X-InventiveCRM-Timestamp` | Unix seconds |
| `X-InventiveCRM-Signature` | `sha256=` + hex HMAC-SHA256 of `"{timestamp}.{raw body}"` with `WHATSAPP_GATEWAY_SECRET` |

The service must reject a request with a wrong signature or a timestamp more than 5 minutes old, and compare signatures in constant time.

Response: any 2xx with `{ "messageId": "wamid...." }` means accepted (the Delivery becomes **Sent**). Any other status, with an optional `{ "error": "..." }`, marks the Delivery **Failed** with that reason. Answer within 30 seconds; queue the Meta call if it may be slower.

## 1a. Other events from other apps

The same endpoint, headers and signature receive events from the other InventiveCRM apps. Each needs its own approved
Meta template in InventiveChat.

| Event | App | Payload (besides `event`, `deliveryId`, `business`, `recipient`) |
|---|---|---|
| `feedback.survey` | Feedback | `survey: { url, question }`. A utility template with the question and a button to `url`. No status callback is required |
| `invoice.payment_link` | Quotes & Invoices | The same `document` object as `invoice.send`, with `document.paymentUrl` set. A utility template ("pay invoice … online") with a button to `paymentUrl`. Status callbacks as for documents |

### `campaign.message` (Campaign Studio)

Marketing campaigns arrive in batches of up to 100 and have their own shape: no `deliveryId`, `business` or `recipient`.

```json
{
  "event": "campaign.message",
  "campaignId": "8e76131c-88c2-41cd-8c79-e881a8f193bb",
  "batchId": "8e76131c-88c2-41cd-8c79-e881a8f193bb:4f1c0a52-7d0e-4c5e-9a43-0b6f8c2d9e11",
  "template": { "name": "spring_offer", "language": "en_GB" },
  "messages": [
    { "recipientId": "21bc1b08-4524-4ef2-b0fc-ba5818be5044", "to": "+447700900111", "variables": ["Ann", "20%"], "optOutUrl": "https://.../s/campaigns/unsubscribe/..." }
  ],
  "statusCallbackUrl": "https://acme.crm.inventiveweb.studio/s/campaigns/whatsapp/status"
}
```

`template.name` is a Meta-approved marketing template; `variables` fill `{{1}}`, `{{2}}`, … in order. Answer 200 with
the messages you accepted: `{ "accepted": [{ "recipientId": "…", "messageId": "wamid…" }] }`. Messages left out are
marked failed. Campaign Studio only sends to contacts with **Agreed to marketing on WhatsApp** ticked.

A batch whose request timed out is sent again with the same `batchId`. Remember accepted `batchId`s for at least a
day and answer a repeat with the original `accepted` list instead of sending again; never send one `recipientId` twice.

Status callbacks go to `statusCallbackUrl`, signed as above:
`{ "recipientId": "…", "status": "delivered" | "read" | "failed" | "opted_out", "error": "…" }`. Send `opted_out` when
the contact replies STOP or blocks the number: the app adds them to the do-not-contact list and removes their consent.

Every `document` object also carries `paymentUrl` (null when the invoice has no open pay-now link); templates for
`invoice.send` and `invoice.overdue_reminder` may show it as a button.

## 2. Status callback (WhatsApp service to app)

`POST {statusCallbackUrl}`, signed the same way with the same secret and headers.

```json
{ "deliveryId": "c78d3c20-3c61-4b14-af39-d3d30816ea87", "messageId": "wamid....", "status": "delivered" }
```

`status` is `sent`, `delivered`, `read` or `failed` (map Meta's webhook statuses one to one). Add `"error": "..."` with `failed`. Updates only move a Delivery forward (Sent, then Delivered, then Read), so out-of-order callbacks are safe. A bad signature gets a non-2xx answer and changes nothing.

## 3. What stays in the WhatsApp service

Meta Business verification and the WABA, phone numbers per business (or one shared number), approved templates for each `event`, the 24-hour customer-service window, opt-out keywords (STOP), retries and rate limits. For documents there is no opt-out callback: when a client opts out, untick **Agreed to WhatsApp messages** on the contact. Campaign opt-outs use the `opted_out` status above.
