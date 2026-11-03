import { type InvoiceTemplate, type RecurrenceFrequency, type VatRate, type VatRounding } from 'src/constants/enums';
import { IDS } from 'src/constants/ids';
import { gql, nodes, uploadFile } from 'src/lib/api';
import { type Address, type BusinessProfile, type Customer, checkInvoice, checkQuote } from 'src/lib/compliance';
import { addDays, nextRecurrenceDate, todayInLondon } from 'src/lib/dates';
import { computeLineNetPence, computeTotals, computeVatPence, gbp, microsToPence } from 'src/lib/money';
import { renderPdf } from 'src/lib/pdf';
import { buildInvoicePdfModel, buildQuotePdfModel, type TemplateLine } from 'src/lib/templates';

const ATTACHMENT_FILE_FIELD_UNIVERSAL_IDENTIFIER = '20202020-15db-460e-8166-c7b5d87ad4be';

type Money = { amountMicros: number | string | null; currencyCode: string | null } | null;

type LineRecord = {
  id: string;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: Money;
  vatRate: VatRate | null;
  discountPercent: number | null;
  netAmount: Money;
  vatAmount: Money;
  lineOrder: number | null;
  productId: string | null;
};

type CompanyRecord = { id: string; name: string | null; address: Address | null; vatNumber: string | null } | null;
type PersonRecord = {
  id: string;
  name: { firstName: string | null; lastName: string | null } | null;
  emails: { primaryEmail: string | null } | null;
  company: CompanyRecord;
} | null;

const MONEY = 'amountMicros currencyCode';
const ADDRESS = 'addressStreet1 addressStreet2 addressCity addressState addressPostcode addressCountry';
const LINE_FIELDS = `id description quantity unit unitPrice { ${MONEY} } vatRate discountPercent netAmount { ${MONEY} } vatAmount { ${MONEY} } lineOrder productId`;
const PARTY_FIELDS = `company { id name address { ${ADDRESS} } vatNumber } person { id name { firstName lastName } emails { primaryEmail } company { id name address { ${ADDRESS} } vatNumber } }`;

export const loadProfile = async (): Promise<BusinessProfile | null> => {
  const data = await gql<{ businessProfiles: { edges: { node: BusinessProfile }[] } }>(`{
    businessProfiles(first: 1, orderBy: [{ createdAt: AscNullsFirst }]) { edges { node {
      id legalName tradingName legalStructure companyNumber registeredIn registeredOfficeAddress businessAddress { ${ADDRESS} }
      vatRegistered vatNumber email phone website bankName bankAccountName sortCode accountNumber iban bic
      invoicePrefix quotePrefix creditNotePrefix nextInvoiceNumber nextQuoteNumber nextCreditNoteNumber numberPadding
      defaultPaymentTermsDays quoteValidityDays vatRounding paymentInstructions invoiceFooter includeLatePaymentNotice
    } } }
  }`);
  return nodes(data.businessProfiles)[0] ?? null;
};

const roundingOf = (profile: BusinessProfile | null): VatRounding =>
  profile?.vatRounding === 'ROUND_DOWN' ? 'ROUND_DOWN' : 'NEAREST_PENNY';

const customerOf = (company: CompanyRecord, person: PersonRecord): Customer | null => {
  const personName = [person?.name?.firstName, person?.name?.lastName].filter(Boolean).join(' ');
  const billingCompany = company ?? person?.company ?? null;
  if (!billingCompany && !personName) return null;
  const name = billingCompany?.name
    ? personName
      ? `${billingCompany.name} (attn. ${personName})`
      : billingCompany.name
    : personName;
  return {
    name,
    address: billingCompany?.address ?? null,
    vatNumber: billingCompany?.vatNumber || null,
    email: person?.emails?.primaryEmail ?? null,
  };
};

const sortedLines = (lines: LineRecord[]) =>
  [...lines].sort((first, second) => (first.lineOrder ?? 0) - (second.lineOrder ?? 0));

const toCalculationLine = (line: LineRecord) => ({
  quantity: Number(line.quantity ?? 0),
  unitPricePence: microsToPence(line.unitPrice?.amountMicros),
  discountPercent: Number(line.discountPercent ?? 0),
  vatRate: (line.vatRate ?? 'STANDARD_20') as VatRate,
});

const toTemplateLine = (line: LineRecord): TemplateLine => ({
  description: line.description ?? '',
  quantity: Number(line.quantity ?? 0),
  unit: line.unit,
  unitPricePence: microsToPence(line.unitPrice?.amountMicros),
  vatRate: (line.vatRate ?? 'STANDARD_20') as VatRate,
});

// Twenty TEXT fields are '' when empty, so text fallbacks use || rather than ??.
const formatNumber = (prefix: string | null, next: number | null, padding: number | null, fallbackPrefix: string) =>
  `${prefix || fallbackPrefix}${String(next ?? 1).padStart(padding ?? 4, '0')}`;

const sameMoney = (money: Money, pence: number) => microsToPence(money?.amountMicros) === pence && money?.currencyCode === 'GBP';

// ---------- Line maintenance ----------

type LineKind = 'invoiceLine' | 'quoteLine';

const PARENT = {
  invoiceLine: { parentField: 'invoiceId', parent: 'invoice' },
  quoteLine: { parentField: 'quoteId', parent: 'quote' },
} as const;

const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

// Fills a line from its product, stores its own net and VAT, and refreshes the parent totals.
// Writes only when a value changes, so the database events it causes settle after one round.
export const refreshLine = async (kind: LineKind, lineId: string, parentIdHint?: string | null) => {
  const { parentField } = PARENT[kind];
  const data = await gql<Record<string, { edges: { node: LineRecord & Record<string, string | null> }[] }>>(
    `query($id: UUID!) { ${kind}s(filter: { id: { eq: $id } }) { edges { node { ${LINE_FIELDS} ${parentField} } } } }`,
    { id: lineId },
  );
  const line = nodes(data[`${kind}s`])[0];
  const parentId = (line?.[parentField] as string | null | undefined) ?? parentIdHint ?? null;

  if (line) {
    const updates: Record<string, unknown> = {};
    if (line.productId && (!line.description || !line.unitPrice?.amountMicros)) {
      const productData = await gql<{ products: { edges: { node: { name: string | null; description: string | null; unitPrice: Money; vatRate: VatRate | null; unit: string | null } }[] } }>(
        `query($id: UUID!) { products(filter: { id: { eq: $id } }) { edges { node { name description unitPrice { ${MONEY} } vatRate unit } } } }`,
        { id: line.productId },
      );
      const product = nodes(productData.products)[0];
      if (product) {
        if (!line.description) updates.description = product.description || product.name;
        if (!line.unitPrice?.amountMicros && product.unitPrice) updates.unitPrice = gbp(microsToPence(product.unitPrice.amountMicros));
        if (!line.vatRate && product.vatRate) updates.vatRate = product.vatRate;
        if (!line.unit && product.unit) updates.unit = product.unit;
        Object.assign(line, {
          description: updates.description ?? line.description,
          unitPrice: updates.unitPrice ?? line.unitPrice,
          vatRate: updates.vatRate ?? line.vatRate,
          unit: updates.unit ?? line.unit,
        });
      }
    }
    if (line.quantity === null) updates.quantity = 1;
    const profile = await loadProfile();
    // A business that is not VAT registered never charges VAT, whatever the price list says.
    const vatRate: VatRate = profile && !profile.vatRegistered ? 'NO_VAT' : (line.vatRate ?? 'STANDARD_20');
    if (line.vatRate !== vatRate) updates.vatRate = vatRate;
    const calculation = toCalculationLine({ ...line, vatRate, quantity: line.quantity ?? 1 });
    const netPence = computeLineNetPence(calculation);
    const vatPence = computeVatPence(netPence, calculation.vatRate, roundingOf(profile));
    if (!sameMoney(line.netAmount, netPence)) updates.netAmount = gbp(netPence);
    if (!sameMoney(line.vatAmount, vatPence)) updates.vatAmount = gbp(vatPence);
    if (Object.keys(updates).length > 0)
      await gql(`mutation($id: UUID!, $data: ${capitalise(kind)}UpdateInput!) { update${capitalise(kind)}(id: $id, data: $data) { id } }`, {
        id: lineId,
        data: updates,
      });
  }

  if (parentId) {
    if (kind === 'invoiceLine') await refreshInvoiceTotals(parentId);
    else await refreshQuoteTotals(parentId);
  }
};

// ---------- Invoices ----------

type InvoiceRecord = {
  id: string;
  name: string | null;
  invoiceNumber: string | null;
  kind: 'INVOICE' | 'CREDIT_NOTE' | null;
  status: string | null;
  template: InvoiceTemplate | null;
  issueDate: string | null;
  supplyDate: string | null;
  dueDate: string | null;
  paymentTermsDays: number | null;
  purchaseOrderNumber: string | null;
  notes: string | null;
  subtotal: Money;
  vatTotal: Money;
  total: Money;
  amountPaid: Money;
  isRecurring: boolean | null;
  recurrenceFrequency: RecurrenceFrequency | null;
  recurrenceInterval: number | null;
  nextRecurrenceDate: string | null;
  recurrenceEndDate: string | null;
  autoIssueRecurring: boolean | null;
  issuedAt: string | null;
  companyId: string | null;
  personId: string | null;
  creditedInvoiceId: string | null;
  creditedInvoice: { id: string; invoiceNumber: string | null; total: Money } | null;
  sourceQuote: { quoteNumber: string | null } | null;
  company: CompanyRecord;
  person: PersonRecord;
  lines: { edges: { node: LineRecord }[] };
};

const INVOICE_FIELDS = `id name invoiceNumber kind status template issueDate supplyDate dueDate paymentTermsDays purchaseOrderNumber notes
  subtotal { ${MONEY} } vatTotal { ${MONEY} } total { ${MONEY} } amountPaid { ${MONEY} }
  isRecurring recurrenceFrequency recurrenceInterval nextRecurrenceDate recurrenceEndDate autoIssueRecurring issuedAt
  companyId personId creditedInvoiceId creditedInvoice { id invoiceNumber total { ${MONEY} } } sourceQuote { quoteNumber }
  ${PARTY_FIELDS} lines(first: 200) { edges { node { ${LINE_FIELDS} } } }`;

export const loadInvoice = async (id: string): Promise<InvoiceRecord | null> => {
  const data = await gql<{ invoices: { edges: { node: InvoiceRecord }[] } }>(
    `query($id: UUID!) { invoices(filter: { id: { eq: $id } }) { edges { node { ${INVOICE_FIELDS} } } } }`,
    { id },
  );
  return nodes(data.invoices)[0] ?? null;
};

const updateInvoice = (id: string, data: Record<string, unknown>) =>
  gql(`mutation($id: UUID!, $data: InvoiceUpdateInput!) { updateInvoice(id: $id, data: $data) { id } }`, { id, data });

const invoiceTotals = (invoice: InvoiceRecord, profile: BusinessProfile | null) =>
  computeTotals(sortedLines(nodes(invoice.lines)).map(toCalculationLine), {
    rounding: roundingOf(profile),
    reverseCharge: invoice.template === 'UK_REVERSE_CHARGE_INVOICE',
  });

export const refreshInvoiceTotals = async (invoiceId: string) => {
  const [invoice, profile] = await Promise.all([loadInvoice(invoiceId), loadProfile()]);
  if (!invoice) return;
  const totals = invoiceTotals(invoice, profile);
  const updates: Record<string, unknown> = {};
  if (!sameMoney(invoice.subtotal, totals.subtotalPence)) updates.subtotal = gbp(totals.subtotalPence);
  if (!sameMoney(invoice.vatTotal, totals.vatPence)) updates.vatTotal = gbp(totals.vatPence);
  if (!sameMoney(invoice.total, totals.totalPence)) updates.total = gbp(totals.totalPence);
  if (Object.keys(updates).length > 0) await updateInvoice(invoiceId, updates);
};

const NUMBERING = {
  INVOICE: { counter: 'nextInvoiceNumber', prefix: 'invoicePrefix', fallback: 'INV-', object: 'invoices', field: 'invoiceNumber' },
  CREDIT_NOTE: { counter: 'nextCreditNoteNumber', prefix: 'creditNotePrefix', fallback: 'CN-', object: 'invoices', field: 'invoiceNumber' },
  QUOTE: { counter: 'nextQuoteNumber', prefix: 'quotePrefix', fallback: 'QUO-', object: 'quotes', field: 'quoteNumber' },
} as const;

// Picks the next unused number without consuming it, so a failed issue never leaves a gap in the sequence.
const peekNumber = async (profile: BusinessProfile, kind: keyof typeof NUMBERING) => {
  const config = NUMBERING[kind];
  let next = (profile[config.counter] as number | null) ?? 1;
  for (;;) {
    const number = formatNumber(profile[config.prefix] as string | null, next, profile.numberPadding, config.fallback);
    const data = await gql<Record<string, { edges: unknown[] }>>(
      `query($number: String!) { ${config.object}(filter: { ${config.field}: { eq: $number } }, first: 1) { edges { node { id } } } }`,
      { number },
    );
    if (data[config.object].edges.length === 0) return { number, next };
    next += 1;
  }
};

const commitNumber = (profile: BusinessProfile, kind: keyof typeof NUMBERING, used: number) =>
  gql(`mutation($id: UUID!, $data: BusinessProfileUpdateInput!) { updateBusinessProfile(id: $id, data: $data) { id } }`, {
    id: profile.id,
    data: { [NUMBERING[kind].counter]: used + 1 },
  });

const attachToClientCard = async ({
  bytes,
  filename,
  companyId,
  personId,
}: {
  bytes: Uint8Array;
  filename: string;
  companyId: string | null;
  personId: string | null;
}) => {
  const targets: Record<string, string>[] = [];
  if (companyId) targets.push({ targetCompanyId: companyId });
  if (personId) targets.push({ targetPersonId: personId });
  for (const target of targets) {
    const file = await uploadFile({ bytes, filename, fieldUniversalIdentifier: ATTACHMENT_FILE_FIELD_UNIVERSAL_IDENTIFIER });
    await gql(`mutation($data: AttachmentCreateInput!) { createAttachment(data: $data) { id } }`, {
      data: { name: filename, file: [{ fileId: file.id, label: filename }], ...target },
    });
  }
};

// Runs when an invoice moves to Issued: checks UK requirements, numbers it, freezes totals,
// renders the PDF and files it on the invoice and on the client's company and contact records.
export const issueInvoice = async (invoiceId: string): Promise<{ issued: boolean; issues: string[]; number?: string }> => {
  const [invoice, profile] = await Promise.all([loadInvoice(invoiceId), loadProfile()]);
  if (!invoice) return { issued: false, issues: ['Invoice not found.'] };
  // Issued invoices are frozen: corrections go through a credit note, never a silent re-issue.
  if (invoice.issuedAt) return { issued: true, issues: [], number: invoice.invoiceNumber || undefined };

  const kind = invoice.kind === 'CREDIT_NOTE' ? 'CREDIT_NOTE' : 'INVOICE';
  const template: InvoiceTemplate =
    invoice.template ?? (profile?.vatRegistered ? 'UK_VAT_INVOICE' : 'UK_NON_VAT_INVOICE');
  const lines = sortedLines(nodes(invoice.lines));
  const customer = customerOf(invoice.company, invoice.person);
  const today = todayInLondon();
  const issueDate = invoice.issueDate ?? today;
  const supplyDate = invoice.supplyDate ?? issueDate;

  const issues = checkInvoice({
    profile,
    template,
    kind,
    customer,
    lines,
    supplyDate,
    creditedInvoiceNumber: invoice.creditedInvoice?.invoiceNumber || null,
  });
  if (issues.length > 0 || !profile || !customer) {
    await updateInvoice(invoiceId, { status: 'DRAFT', complianceIssues: issues.join('\n') });
    return { issued: false, issues };
  }

  const paymentTermsDays = invoice.paymentTermsDays ?? profile.defaultPaymentTermsDays ?? 30;
  const dueDate = invoice.dueDate ?? addDays(issueDate, paymentTermsDays);
  const reserved = invoice.invoiceNumber ? null : await peekNumber(profile, kind);
  const number = invoice.invoiceNumber || reserved?.number || '';
  const totals = computeTotals(lines.map(toCalculationLine), {
    rounding: roundingOf(profile),
    reverseCharge: template === 'UK_REVERSE_CHARGE_INVOICE',
  });

  const bytes = await renderPdf(
    buildInvoicePdfModel({
      profile,
      template,
      kind,
      number,
      customer,
      issueDate,
      supplyDate,
      dueDate: kind === 'INVOICE' ? dueDate : null,
      purchaseOrderNumber: invoice.purchaseOrderNumber,
      quoteNumber: invoice.sourceQuote?.quoteNumber || null,
      creditedInvoiceNumber: invoice.creditedInvoice?.invoiceNumber || null,
      notes: invoice.notes,
      lines: lines.map(toTemplateLine),
      totals,
    }),
  );
  const filename = `${kind === 'CREDIT_NOTE' ? 'Credit note' : 'Invoice'} ${number}.pdf`;
  const invoiceFile = await uploadFile({ bytes, filename, fieldUniversalIdentifier: IDS.invoice.fields.pdf });
  const companyId = invoice.companyId ?? invoice.person?.company?.id ?? null;

  await updateInvoice(invoiceId, {
    invoiceNumber: number,
    name: `${number} - ${customer.name}`,
    template,
    issueDate,
    supplyDate,
    dueDate: kind === 'INVOICE' ? dueDate : null,
    paymentTermsDays,
    subtotal: gbp(totals.subtotalPence),
    vatTotal: gbp(totals.vatPence),
    total: gbp(totals.totalPence),
    pdf: [{ fileId: invoiceFile.id, label: filename }],
    complianceIssues: '',
    issuedAt: new Date().toISOString(),
  });
  if (reserved) await commitNumber(profile, kind, reserved.next);
  await attachToClientCard({ bytes, filename, companyId, personId: invoice.personId });

  if (kind === 'CREDIT_NOTE' && invoice.creditedInvoice) {
    const creditedTotal = microsToPence(invoice.creditedInvoice.total?.amountMicros);
    if (creditedTotal > 0 && totals.totalPence >= creditedTotal) await updateInvoice(invoice.creditedInvoice.id, { status: 'VOID' });
  }
  return { issued: true, issues: [], number };
};

// ---------- Quotes ----------

type QuoteRecord = {
  id: string;
  name: string | null;
  quoteNumber: string | null;
  status: string | null;
  issueDate: string | null;
  validUntil: string | null;
  title: string | null;
  notes: string | null;
  terms: string | null;
  subtotal: Money;
  vatTotal: Money;
  total: Money;
  sentAt: string | null;
  companyId: string | null;
  personId: string | null;
  company: CompanyRecord;
  person: PersonRecord;
  lines: { edges: { node: LineRecord }[] };
};

const QUOTE_FIELDS = `id name quoteNumber status issueDate validUntil title notes terms subtotal { ${MONEY} } vatTotal { ${MONEY} } total { ${MONEY} }
  sentAt companyId personId ${PARTY_FIELDS} lines(first: 200) { edges { node { ${LINE_FIELDS} } } }`;

export const loadQuote = async (id: string): Promise<QuoteRecord | null> => {
  const data = await gql<{ quotes: { edges: { node: QuoteRecord }[] } }>(
    `query($id: UUID!) { quotes(filter: { id: { eq: $id } }) { edges { node { ${QUOTE_FIELDS} } } } }`,
    { id },
  );
  return nodes(data.quotes)[0] ?? null;
};

const updateQuote = (id: string, data: Record<string, unknown>) =>
  gql(`mutation($id: UUID!, $data: QuoteUpdateInput!) { updateQuote(id: $id, data: $data) { id } }`, { id, data });

const quoteTotals = (quote: QuoteRecord, profile: BusinessProfile | null) =>
  computeTotals(
    sortedLines(nodes(quote.lines)).map((line) => ({
      ...toCalculationLine(line),
      vatRate: profile?.vatRegistered ? toCalculationLine(line).vatRate : ('NO_VAT' as VatRate),
    })),
    { rounding: roundingOf(profile), reverseCharge: false },
  );

export const refreshQuoteTotals = async (quoteId: string) => {
  const [quote, profile] = await Promise.all([loadQuote(quoteId), loadProfile()]);
  if (!quote) return;
  const totals = quoteTotals(quote, profile);
  const updates: Record<string, unknown> = {};
  if (!sameMoney(quote.subtotal, totals.subtotalPence)) updates.subtotal = gbp(totals.subtotalPence);
  if (!sameMoney(quote.vatTotal, totals.vatPence)) updates.vatTotal = gbp(totals.vatPence);
  if (!sameMoney(quote.total, totals.totalPence)) updates.total = gbp(totals.totalPence);
  if (Object.keys(updates).length > 0) await updateQuote(quoteId, updates);
};

export const sendQuote = async (quoteId: string): Promise<{ sent: boolean; issues: string[]; number?: string }> => {
  const [quote, profile] = await Promise.all([loadQuote(quoteId), loadProfile()]);
  if (!quote) return { sent: false, issues: ['Quote not found.'] };
  if (quote.sentAt) return { sent: true, issues: [], number: quote.quoteNumber || undefined };
  const lines = sortedLines(nodes(quote.lines));
  const customer = customerOf(quote.company, quote.person);
  const issues = checkQuote({ profile, customer, lines });
  if (issues.length > 0 || !profile || !customer) {
    await updateQuote(quoteId, { status: 'DRAFT', complianceIssues: issues.join('\n') });
    return { sent: false, issues };
  }

  const issueDate = quote.issueDate ?? todayInLondon();
  const validUntil = quote.validUntil ?? addDays(issueDate, profile.quoteValidityDays ?? 30);
  const reserved = quote.quoteNumber ? null : await peekNumber(profile, 'QUOTE');
  const number = quote.quoteNumber || reserved?.number || '';
  const totals = quoteTotals(quote, profile);
  const bytes = await renderPdf(
    buildQuotePdfModel({
      profile,
      number,
      customer,
      issueDate,
      validUntil,
      title: quote.title,
      notes: quote.notes,
      terms: quote.terms,
      lines: lines.map((line) => ({ ...toTemplateLine(line), vatRate: profile.vatRegistered ? toTemplateLine(line).vatRate : 'NO_VAT' })),
      totals,
    }),
  );
  const filename = `Quote ${number}.pdf`;
  const quoteFile = await uploadFile({ bytes, filename, fieldUniversalIdentifier: IDS.quote.fields.pdf });
  await updateQuote(quoteId, {
    quoteNumber: number,
    name: `${number} - ${customer.name}`,
    issueDate,
    validUntil,
    subtotal: gbp(totals.subtotalPence),
    vatTotal: gbp(totals.vatPence),
    total: gbp(totals.totalPence),
    pdf: [{ fileId: quoteFile.id, label: filename }],
    complianceIssues: '',
    sentAt: new Date().toISOString(),
  });
  if (reserved) await commitNumber(profile, 'QUOTE', reserved.next);
  await attachToClientCard({
    bytes,
    filename,
    companyId: quote.companyId ?? quote.person?.company?.id ?? null,
    personId: quote.personId,
  });
  return { sent: true, issues: [], number };
};

const copyLines = async (
  lines: LineRecord[],
  target: { invoiceId: string },
) => {
  if (lines.length === 0) return;
  await gql(`mutation($data: [InvoiceLineCreateInput!]!) { createInvoiceLines(data: $data) { id } }`, {
    data: sortedLines(lines).map((line, index) => ({
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice ? gbp(microsToPence(line.unitPrice.amountMicros)) : null,
      vatRate: line.vatRate,
      discountPercent: line.discountPercent,
      lineOrder: line.lineOrder ?? index,
      productId: line.productId,
      invoiceId: target.invoiceId,
    })),
  });
};

// An accepted quote becomes a draft invoice with the same client and lines, and the quote is marked converted.
export const convertQuoteToInvoice = async (quoteId: string): Promise<{ invoiceId: string } | null> => {
  const [quote, profile] = await Promise.all([loadQuote(quoteId), loadProfile()]);
  if (!quote) return null;
  const existing = await gql<{ invoices: { edges: { node: { id: string } }[] } }>(
    `query($id: UUID!) { invoices(filter: { sourceQuoteId: { eq: $id } }, first: 1) { edges { node { id } } } }`,
    { id: quoteId },
  );
  const alreadyConverted = nodes(existing.invoices)[0];
  if (alreadyConverted) return { invoiceId: alreadyConverted.id };

  const { createInvoice } = await gql<{ createInvoice: { id: string } }>(
    `mutation($data: InvoiceCreateInput!) { createInvoice(data: $data) { id } }`,
    {
      data: {
        name: `Draft from ${quote.quoteNumber || 'quote'}`,
        kind: 'INVOICE',
        status: 'DRAFT',
        template: profile?.vatRegistered ? 'UK_VAT_INVOICE' : 'UK_NON_VAT_INVOICE',
        companyId: quote.companyId,
        personId: quote.personId,
        sourceQuoteId: quote.id,
        notes: quote.notes,
      },
    },
  );
  await copyLines(nodes(quote.lines), { invoiceId: createInvoice.id });
  await refreshInvoiceTotals(createInvoice.id);
  await updateQuote(quoteId, { status: 'CONVERTED' });
  return { invoiceId: createInvoice.id };
};

// ---------- Daily run: recurring invoices and overdue status ----------

export const runRecurringInvoices = async (today: string = todayInLondon()) => {
  const data = await gql<{ invoices: { edges: { node: InvoiceRecord }[] } }>(
    `query($today: Date!) { invoices(filter: { isRecurring: { eq: true }, nextRecurrenceDate: { lte: $today } }, first: 100) { edges { node { ${INVOICE_FIELDS} } } } }`,
    { today },
  );
  const created: string[] = [];
  for (const template of nodes(data.invoices)) {
    if (!template.recurrenceFrequency || !template.nextRecurrenceDate) continue;
    if (template.recurrenceEndDate && template.nextRecurrenceDate > template.recurrenceEndDate) {
      await updateInvoice(template.id, { isRecurring: false });
      continue;
    }
    const runDate = template.nextRecurrenceDate;
    const { createInvoice } = await gql<{ createInvoice: { id: string } }>(
      `mutation($data: InvoiceCreateInput!) { createInvoice(data: $data) { id } }`,
      {
        data: {
          name: `Recurring from ${template.invoiceNumber || template.name || 'invoice'}`,
          kind: 'INVOICE',
          status: 'DRAFT',
          template: template.template,
          companyId: template.companyId,
          personId: template.personId,
          recurringParentId: template.id,
          issueDate: runDate,
          supplyDate: runDate,
          paymentTermsDays: template.paymentTermsDays,
          purchaseOrderNumber: template.purchaseOrderNumber,
          notes: template.notes,
          isRecurring: false,
        },
      },
    );
    await copyLines(nodes(template.lines), { invoiceId: createInvoice.id });
    await refreshInvoiceTotals(createInvoice.id);
    // Setting the status fires the same issue handler a user triggers, which runs the UK checks and files the PDF.
    if (template.autoIssueRecurring !== false) await updateInvoice(createInvoice.id, { status: 'ISSUED' });

    const next = nextRecurrenceDate(runDate, template.recurrenceFrequency, template.recurrenceInterval ?? 1);
    const finished = Boolean(template.recurrenceEndDate && next > template.recurrenceEndDate);
    await updateInvoice(template.id, { nextRecurrenceDate: finished ? null : next, isRecurring: !finished });
    created.push(createInvoice.id);
  }
  return created;
};

export const markOverdueInvoices = async (today: string = todayInLondon()) => {
  const data = await gql<{ invoices: { edges: { node: { id: string } }[] } }>(
    `query($today: Date!) { invoices(filter: { status: { in: [ISSUED, PART_PAID] }, kind: { eq: INVOICE }, dueDate: { lt: $today } }, first: 200) { edges { node { id } } } }`,
    { today },
  );
  for (const invoice of nodes(data.invoices)) await updateInvoice(invoice.id, { status: 'OVERDUE' });
  return nodes(data.invoices).length;
};
