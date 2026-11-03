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

## 2. Status callback (WhatsApp service to app)

`POST {statusCallbackUrl}`, signed the same way with the same secret and headers.

```json
{ "deliveryId": "c78d3c20-3c61-4b14-af39-d3d30816ea87", "messageId": "wamid....", "status": "delivered" }
```

`status` is `sent`, `delivered`, `read` or `failed` (map Meta's webhook statuses one to one). Add `"error": "..."` with `failed`. Updates only move a Delivery forward (Sent, then Delivered, then Read), so out-of-order callbacks are safe. A bad signature gets a non-2xx answer and changes nothing.

## 3. What stays in the WhatsApp service

Meta Business verification and the WABA, phone numbers per business (or one shared number), approved templates for each `event`, the 24-hour customer-service window, opt-out keywords (STOP), retries and rate limits. There is no opt-out callback yet: when a client opts out, untick **Agreed to WhatsApp messages** on the contact.
