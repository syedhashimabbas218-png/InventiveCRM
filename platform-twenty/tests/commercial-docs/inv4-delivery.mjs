// Sending documents: email from our mail server (checked in Mailpit), the WhatsApp hand-off with signed status
// callbacks (checked against mock-whatsapp-gateway.mjs), missing consent, an unconnected client mailbox and overdue reminders.
// Usage: node inv4-delivery.mjs <key file> <workspace url, e.g. http://acme.localhost:3000> <gateway log file> <user token file> <mailbox>
// The user token belongs to a member who connected <mailbox> (IMAP/SMTP) in Settings > Accounts; GREENMAIL_API reads what it sent.
import { readFileSync } from 'node:fs';

import { assert, client, sleep, summary, waitFor } from './inv-lib.mjs';

const [keyFile, workspaceUrl, gatewayLog, userTokenFile, mailbox] = process.argv.slice(2);
const userToken = readFileSync(userTokenFile, 'utf8').trim();
const GREENMAIL = process.env.GREENMAIL_API || 'http://127.0.0.1:8180';
const { gql, key } = client(keyFile);
const MAILPIT = process.env.MAILPIT_URL || 'http://127.0.0.1:8025';
const run = Date.now().toString(36);

const route = async (path, body, headers = { Authorization: `Bearer ${key}` }) => {
  const response = await fetch(`${workspaceUrl}/s${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) };
};

const mailTo = async (address) => {
  const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`)).json();
  return Promise.all(list.messages.map(async (message) => (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json()));
};

const gatewayEntries = () => readFileSync(gatewayLog, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));

const profile = (await gql(`{ businessProfiles(first: 1, orderBy: [{ createdAt: AscNullsFirst }]) { edges { node { id tradingName legalName } } } }`)).businessProfiles.edges[0].node;
const businessName = profile.tradingName || profile.legalName;
const setProfile = (data) => gql(`mutation($id: UUID!, $data: BusinessProfileUpdateInput!) { updateBusinessProfile(id: $id, data: $data) { id } }`, { id: profile.id, data });
await setProfile({ sendOnIssue: true, sendOverdueReminders: false, emailSendingMethod: 'OUR_SERVER', clientMailbox: '' });

// A VAT invoice needs the customer's address, which lives on the billed company.
const createClient = async (data) => {
  const { createCompany } = await gql(`mutation($data: CompanyCreateInput!) { createCompany(data: $data) { id } }`, {
    data: { name: `${data.name.lastName} Lettings ${run}`, address: { addressStreet1: '12 Park Row', addressCity: 'Leeds', addressPostcode: 'LS1 5HD', addressCountry: 'United Kingdom' } },
  });
  const { createPerson } = await gql(`mutation($data: PersonCreateInput!) { createPerson(data: $data) { id } }`, { data });
  return { personId: createPerson.id, companyId: createCompany.id };
};

const createInvoice = async ({ personId, companyId }, extra = {}) => {
  const { createInvoice } = await gql(`mutation($data: InvoiceCreateInput!) { createInvoice(data: $data) { id } }`, { data: { name: 'Draft', personId, companyId, ...extra } });
  await gql(`mutation($data: [InvoiceLineCreateInput!]!) { createInvoiceLines(data: $data) { id } }`, {
    data: [{ invoiceId: createInvoice.id, description: 'Boiler service', quantity: 1, unitPrice: { amountMicros: 95_000_000, currencyCode: 'GBP' }, vatRate: 'STANDARD_20' }],
  });
  return createInvoice.id;
};

const issue = async (id) => {
  await waitFor('totals', async () => {
    const invoice = (await gql(`query($id: UUID!) { invoices(filter: { id: { eq: $id } }) { edges { node { total { amountMicros } } } } }`, { id })).invoices.edges[0].node;
    return Number(invoice.total?.amountMicros) > 0;
  });
  await gql(`mutation($id: UUID!) { updateInvoice(id: $id, data: { status: ISSUED }) { id } }`, { id });
  const issued = await waitFor('issued', async () => {
    const invoice = (await gql(`query($id: UUID!) { invoices(filter: { id: { eq: $id } }) { edges { node { invoiceNumber status complianceIssues pdf { label } } } } }`, { id })).invoices.edges[0].node;
    return invoice.pdf?.length || invoice.complianceIssues ? invoice : null;
  });
  if (!issued.invoiceNumber) throw new Error(`Invoice not issued: ${issued.complianceIssues}`);
  return issued;
};

const deliveriesOf = async (invoiceId) =>
  (await gql(`query($id: UUID!) { documentDeliveries(filter: { invoiceId: { eq: $id } }, orderBy: [{ createdAt: AscNullsFirst }]) { edges { node { id name channel method recipient status errorMessage providerMessageId sentAt } } } }`, { id: invoiceId }))
    .documentDeliveries.edges.map((edge) => edge.node);

// 1. Issue an invoice for a contact who wants email and WhatsApp.
const email = `sam.${run}@example.test`;
const sam = await createClient({
  name: { firstName: 'Sam', lastName: 'Patel' },
  emails: { primaryEmail: email },
  phones: { primaryPhoneNumber: '07700900123', primaryPhoneCallingCode: '+44', primaryPhoneCountryCode: 'GB' },
  preferredChannel: 'EMAIL_AND_WHATSAPP',
  whatsappOptIn: true,
});
const first = await issue(await createInvoice(sam));
const firstId = (await gql(`query($n: String!) { invoices(filter: { invoiceNumber: { eq: $n } }) { edges { node { id lastSentAt } } } }`, { n: first.invoiceNumber })).invoices.edges[0].node;
const sent = await waitFor('two deliveries', async () => {
  const deliveries = await deliveriesOf(firstId.id);
  return deliveries.length === 2 && deliveries.every((delivery) => delivery.status !== 'QUEUED') ? deliveries : null;
});
const emailDelivery = sent.find((delivery) => delivery.channel === 'EMAIL');
assert('issuing sends the invoice by email from our server', emailDelivery?.status === 'SENT' && emailDelivery.method === 'InventiveCRM mail server', JSON.stringify(emailDelivery));

const mails = await waitFor('email in Mailpit', async () => ((await mailTo(email)).length ? mailTo(email) : null));
const mail = mails[0];
assert(
  'email names the business as sender, replies go to the business, subject carries the number',
  mail.From.Name === `${businessName} via InventiveCRM` && mail.Subject === `Invoice ${first.invoiceNumber} from ${businessName}` && mail.ReplyTo?.[0]?.Address === 'accounts@acmeplumbing.test',
  `${mail.From.Name} <${mail.From.Address}> reply-to ${mail.ReplyTo?.[0]?.Address}: ${mail.Subject}`,
);
assert('email has the invoice PDF attached', mail.Attachments.some((file) => file.FileName === `Invoice ${first.invoiceNumber}.pdf` && file.ContentType === 'application/pdf'), mail.Attachments.map((file) => `${file.FileName} ${file.Size}B`).join(', '));
const headers = await (await fetch(`${MAILPIT}/api/v1/message/${mail.ID}/headers`)).json();
assert('email is DKIM-signed by our mail server', Boolean(headers['Dkim-Signature']?.[0]?.includes('d=inventiveweb.test')), headers['Dkim-Signature']?.[0]?.slice(0, 60));

const whatsapp = sent.find((delivery) => delivery.channel === 'WHATSAPP');
assert('WhatsApp hand-off is accepted with the gateway message id', whatsapp?.status !== 'FAILED' && whatsapp?.providerMessageId?.startsWith('wamid.') && whatsapp.recipient === '+447700900123', JSON.stringify(whatsapp));
const handOff = gatewayEntries().find((entry) => entry.received?.deliveryId === whatsapp?.id)?.received;
assert(
  'gateway receives a signed request with the document, amount, PDF link and callback URL',
  handOff?.event === 'invoice.send' && handOff.document.number === first.invoiceNumber && handOff.document.total.formatted === '£114.00' && handOff.document.pdf?.url?.startsWith('http') && handOff.statusCallbackUrl?.endsWith('/s/whatsapp/status'),
  JSON.stringify({ event: handOff?.event, number: handOff?.document.number, total: handOff?.document.total, callback: handOff?.statusCallbackUrl }),
);
const pdf = handOff?.document.pdf?.url ? await fetch(handOff.document.pdf.url) : null;
assert('PDF link given to the gateway downloads the PDF', pdf?.ok && (await pdf.arrayBuffer()).byteLength > 1000, String(pdf?.status));
const read = await waitFor('read callback', async () => ((await deliveriesOf(firstId.id)).find((delivery) => delivery.channel === 'WHATSAPP' && delivery.status === 'READ') ?? null), 30000).catch(() => null);
assert('signed delivered and read callbacks update the delivery', Boolean(read), JSON.stringify(gatewayEntries().filter((entry) => entry.deliveryId === whatsapp?.id)));
const invoiceAfter = (await gql(`query($id: UUID!) { invoices(filter: { id: { eq: $id } }) { edges { node { lastSentAt } } } }`, { id: firstId.id })).invoices.edges[0].node;
assert('invoice records when it was last sent', Boolean(invoiceAfter.lastSentAt), invoiceAfter.lastSentAt);

// 2. Callbacks that are not signed with the shared secret are refused.
const forged = await route('/whatsapp/status', { deliveryId: whatsapp?.id, status: 'failed', error: 'forged' }, { 'X-InventiveCRM-Timestamp': String(Math.floor(Date.now() / 1000)), 'X-InventiveCRM-Signature': 'sha256=00' });
await sleep(1500);
const afterForged = (await deliveriesOf(firstId.id)).find((delivery) => delivery.channel === 'WHATSAPP');
assert('forged status callback is refused and changes nothing', forged.status >= 400 && afterForged.status === 'READ', `HTTP ${forged.status}, status ${afterForged.status}`);

// 3. No WhatsApp consent: logged as failed with the reason, nothing handed off.
const noConsent = await createClient({ name: { firstName: 'Lee', lastName: 'Jones' }, phones: { primaryPhoneNumber: '07700900456', primaryPhoneCallingCode: '+44' }, preferredChannel: 'WHATSAPP', whatsappOptIn: false });
const second = await issue(await createInvoice(noConsent));
const secondId = (await gql(`query($n: String!) { invoices(filter: { invoiceNumber: { eq: $n } }) { edges { node { id status } } } }`, { n: second.invoiceNumber })).invoices.edges[0].node;
const refused = await waitFor('failed delivery', async () => (await deliveriesOf(secondId.id)).find((delivery) => delivery.status === 'FAILED') ?? null);
assert('without WhatsApp consent nothing is sent and the reason is logged; the invoice stays issued', refused.channel === 'WHATSAPP' && /not agreed to WhatsApp/.test(refused.errorMessage) && secondId.status === 'ISSUED' && !gatewayEntries().some((entry) => entry.received?.deliveryId === refused.id), refused.errorMessage);

// 4. The business's own mailbox.
const asUser = { Authorization: `Bearer ${userToken}`, Origin: new URL(workspaceUrl).origin };
await setProfile({ emailSendingMethod: 'CLIENT_MAILBOX', clientMailbox: 'nobody@acmeplumbing.test' });
const unconnected = await route('/documents/send', { invoiceId: firstId.id, channels: ['EMAIL'] }, asUser);
assert('a mailbox that is not connected is refused with the reason', unconnected.body?.success === false && /nobody@acmeplumbing.test is not connected/.test(unconnected.body.message), JSON.stringify(unconnected.body));

await setProfile({ clientMailbox: mailbox });
const viaMailbox = await route('/documents/send', { invoiceId: firstId.id, channels: ['EMAIL'] }, asUser);
const mailboxDelivery = (await deliveriesOf(firstId.id)).filter((delivery) => delivery.channel === 'EMAIL').at(-1);
assert('a signed-in user sends from the connected mailbox', viaMailbox.body?.success === true && mailboxDelivery.method === `Mailbox ${mailbox}`, `${JSON.stringify(viaMailbox.body)} ${mailboxDelivery.method}`);
const received = await waitFor('mail in the mailbox server', async () => {
  const response = await fetch(`${GREENMAIL}/api/user/${encodeURIComponent(email)}/messages/INBOX/`);
  const messages = response.ok ? await response.json() : [];
  return messages.find((message) => message.subject === `Invoice ${first.invoiceNumber} from ${businessName}`) ?? null;
}, 30000).catch(() => null);
const mime = received?.mimeMessage ?? '';
assert('mailbox email reaches the client from the business address with the PDF', new RegExp(`^From:.*${mailbox}`, 'm').test(mime) && mime.includes(`Invoice ${first.invoiceNumber}.pdf`), mime.split(/\r?\n/).filter((line) => /^(From|To|Subject):|filename=/i.test(line.trim())).join(' | ') || 'not received');

const automatic = await route('/documents/send', { invoiceId: firstId.id, channels: ['EMAIL'] });
const automaticDelivery = (await deliveriesOf(firstId.id)).filter((delivery) => delivery.channel === 'EMAIL').at(-1);
assert('automatic sends with no signed-in user fall back to our server and say so', automatic.body?.success === true && automaticDelivery.method.startsWith('InventiveCRM mail server (automatic send'), automaticDelivery.method);
await setProfile({ emailSendingMethod: 'OUR_SERVER', clientMailbox: '' });

// 5. Overdue reminders from the daily run.
await setProfile({ sendOnIssue: false, sendOverdueReminders: true });
const lateEmail = `pat.${run}@example.test`;
const late = await createClient({ name: { firstName: 'Pat', lastName: 'Evans' }, emails: { primaryEmail: lateEmail }, preferredChannel: 'EMAIL' });
const third = await issue(await createInvoice(late, { issueDate: '2026-09-01', supplyDate: '2026-09-01', dueDate: '2026-10-01' }));
const thirdId = (await gql(`query($n: String!) { invoices(filter: { invoiceNumber: { eq: $n } }) { edges { node { id } } } }`, { n: third.invoiceNumber })).invoices.edges[0].node.id;
await sleep(3000);
assert('with send-on-issue off, issuing sends nothing', (await deliveriesOf(thirdId)).length === 0 && (await mailTo(lateEmail)).length === 0);
const daily = await route('/billing/daily-run', { date: '2026-11-03' });
const reminder = await waitFor('reminder email', async () => (await mailTo(lateEmail))[0] ?? null, 30000).catch(() => null);
assert('daily run marks the invoice overdue and emails a reminder', daily.status === 200 && reminder?.Subject === `Reminder: invoice ${third.invoiceNumber} from ${businessName} is overdue`, `${JSON.stringify(daily.body)} ${reminder?.Subject}`);
await setProfile({ sendOnIssue: true, sendOverdueReminders: false });

summary();
