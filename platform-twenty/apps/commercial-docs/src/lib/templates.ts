import { REGISTERED_IN, VAT_RATES, type InvoiceTemplate, type VatRate } from 'src/constants/enums';
import { type BusinessProfile, type Customer, formatAddress, normaliseVatNumber } from 'src/lib/compliance';
import { formatUkDate } from 'src/lib/dates';
import { type DocumentTotals, formatGbp } from 'src/lib/money';
import { type PdfLine, type PdfModel } from 'src/lib/pdf';

export type TemplateLine = {
  description: string;
  quantity: number;
  unit: string | null;
  unitPricePence: number;
  vatRate: VatRate;
};

const VAT_SHORT_LABEL: Record<VatRate, string> = {
  STANDARD_20: '20%',
  REDUCED_5: '5%',
  ZERO: '0%',
  EXEMPT: 'Exempt',
  OUTSIDE_SCOPE: 'O/S',
  NO_VAT: '',
};

const formatVatNumber = (value: string | null) => {
  const vat = normaliseVatNumber(value).replace(/^GB/, '');
  return /^\d{9}$/.test(vat) ? `GB ${vat.slice(0, 3)} ${vat.slice(3, 7)} ${vat.slice(7)}` : `GB${vat}`;
};

const sellerLines = (profile: BusinessProfile, { showVat }: { showVat: boolean }) => {
  const tradingAs =
    profile.tradingName && profile.tradingName !== profile.legalName ? [`Trading as ${profile.tradingName}`] : [];
  return [
    profile.legalName ?? '',
    ...tradingAs,
    ...formatAddress(profile.businessAddress),
    ...[profile.email, profile.phone, profile.website].filter((value): value is string => Boolean(value)),
    ...(showVat && profile.vatNumber ? [`VAT registration no. ${formatVatNumber(profile.vatNumber)}`] : []),
  ];
};

const partyValues = (profile: BusinessProfile, customer: Customer, showVat: boolean) => ({
  sellerName: profile.legalName ?? '',
  sellerTradingName: profile.tradingName || profile.legalName || '',
  sellerAddress: formatAddress(profile.businessAddress).join('\n'),
  sellerVatNumber: showVat && profile.vatNumber ? formatVatNumber(profile.vatNumber) : '',
  sellerEmail: profile.email ?? '',
  sellerPhone: profile.phone ?? '',
  sellerWebsite: profile.website ?? '',
  customerName: customer.name,
  customerAddress: formatAddress(customer.address).join('\n'),
  customerVatNumber: customer.vatNumber ? formatVatNumber(customer.vatNumber) : '',
});

const footerLines = (profile: BusinessProfile) => {
  const lines: string[] = [];
  const isCompany = profile.legalStructure === 'LIMITED_COMPANY' || profile.legalStructure === 'LLP';
  if (isCompany && profile.companyNumber) {
    const place = REGISTERED_IN[profile.registeredIn as keyof typeof REGISTERED_IN] ?? profile.registeredIn ?? '';
    lines.push(`${profile.legalName}. Registered in ${place}, company number ${profile.companyNumber.toUpperCase()}.`);
    if (profile.registeredOfficeAddress) lines.push(`Registered office: ${profile.registeredOfficeAddress.replace(/\n/g, ', ')}`);
  }
  if (profile.invoiceFooter) lines.push(profile.invoiceFooter);
  return lines;
};

const paymentLines = (profile: BusinessProfile, reference: string, dueDate: string | null) => {
  const lines: string[] = [];
  if (dueDate) lines.push(`Payment due by ${formatUkDate(dueDate)}. Please quote reference ${reference}.`);
  if (profile.accountNumber && profile.sortCode)
    lines.push(
      `Bank transfer to ${profile.bankAccountName || profile.legalName}${profile.bankName ? `, ${profile.bankName}` : ''}: sort code ${profile.sortCode}, account number ${profile.accountNumber}.`,
    );
  if (profile.iban) lines.push(`IBAN ${profile.iban}${profile.bic ? `, BIC ${profile.bic}` : ''}.`);
  if (profile.paymentInstructions) lines.push(profile.paymentInstructions);
  return lines;
};

const tableLines = (lines: TemplateLine[], totals: DocumentTotals, showVat: boolean): PdfLine[] =>
  lines.map((line, index) => ({
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    unitPricePence: line.unitPricePence,
    vatLabel: showVat ? VAT_SHORT_LABEL[line.vatRate] : null,
    netPence: totals.lines[index].netPence,
  }));

const vatSummaryRows = (totals: DocumentTotals, { reverseCharge }: { reverseCharge: boolean }): [string, string][] => {
  const rows: [string, string][] = [['Total excluding VAT', formatGbp(totals.subtotalPence)]];
  for (const row of totals.breakdown) {
    if (VAT_RATES[row.vatRate].basisPoints > 0)
      rows.push([
        `${reverseCharge ? 'Reverse charge VAT' : 'VAT'} ${VAT_SHORT_LABEL[row.vatRate]} on ${formatGbp(row.netPence)}`,
        formatGbp(row.vatPence),
      ]);
    else rows.push([`${VAT_RATES[row.vatRate].label} supplies`, formatGbp(row.netPence)]);
  }
  rows.push([reverseCharge ? 'VAT to be accounted for by customer' : 'Total VAT', formatGbp(totals.vatPence)]);
  return rows;
};

export const buildInvoicePdfModel = ({
  profile,
  template,
  kind,
  number,
  customer,
  issueDate,
  supplyDate,
  dueDate,
  purchaseOrderNumber,
  quoteNumber,
  creditedInvoiceNumber,
  notes,
  lines,
  totals,
}: {
  profile: BusinessProfile;
  template: InvoiceTemplate;
  kind: 'INVOICE' | 'CREDIT_NOTE';
  number: string;
  customer: Customer;
  issueDate: string;
  supplyDate: string | null;
  dueDate: string | null;
  purchaseOrderNumber: string | null;
  quoteNumber?: string | null;
  creditedInvoiceNumber: string | null;
  notes: string | null;
  lines: TemplateLine[];
  totals: DocumentTotals;
}): PdfModel => {
  const showVat = template !== 'UK_NON_VAT_INVOICE';
  const reverseCharge = template === 'UK_REVERSE_CHARGE_INVOICE';
  const isCreditNote = kind === 'CREDIT_NOTE';
  const title = isCreditNote ? 'CREDIT NOTE' : showVat ? 'VAT INVOICE' : 'INVOICE';

  const metaRows: [string, string][] = [
    [isCreditNote ? 'Credit note number' : 'Invoice number', number],
    [isCreditNote ? 'Credit note date' : 'Invoice date', formatUkDate(issueDate)],
  ];
  if (showVat && supplyDate) metaRows.push(['Time of supply (tax point)', formatUkDate(supplyDate)]);
  if (isCreditNote && creditedInvoiceNumber) metaRows.push(['Credits invoice', creditedInvoiceNumber]);
  if (!isCreditNote && dueDate) metaRows.push(['Payment due', formatUkDate(dueDate)]);
  if (purchaseOrderNumber) metaRows.push(['Your order reference', purchaseOrderNumber]);
  if (quoteNumber) metaRows.push(['Quote reference', quoteNumber]);

  const customerLines = [customer.name, ...formatAddress(customer.address)];
  if (reverseCharge && customer.vatNumber) customerLines.push(`VAT registration no. ${formatVatNumber(customer.vatNumber)}`);

  const notices: string[] = [];
  if (reverseCharge)
    notices.push(
      'Reverse charge: customer to account for VAT to HMRC. This supply is subject to the VAT domestic reverse charge for building and construction services (section 55A VAT Act 1994).',
    );
  if (!showVat) notices.push('This business is not registered for VAT. No VAT has been charged.');
  if (isCreditNote) notices.push(`This credit note reduces the amount owed on invoice ${creditedInvoiceNumber ?? ''}.`.trim());
  if (!isCreditNote && profile.includeLatePaymentNotice)
    notices.push(
      'We reserve the right to claim interest and compensation for late payment under the Late Payment of Commercial Debts (Interest) Act 1998.',
    );

  return {
    title,
    number,
    sellerLines: sellerLines(profile, { showVat }),
    customerHeading: isCreditNote ? 'CREDIT TO' : 'BILL TO',
    customerLines,
    metaRows,
    showVatColumn: showVat,
    lines: tableLines(lines, totals, showVat),
    summaryRows: showVat ? vatSummaryRows(totals, { reverseCharge }) : [],
    totalRow: [isCreditNote ? 'Total credit' : 'Total due', formatGbp(totals.totalPence)],
    notices,
    notes,
    paymentLines: isCreditNote ? [] : paymentLines(profile, number, dueDate),
    footerLines: footerLines(profile),
    values: {
      ...partyValues(profile, customer, showVat),
      documentTitle: title,
      documentNumber: number,
      issueDate: formatUkDate(issueDate),
      supplyDate: showVat ? formatUkDate(supplyDate) : '',
      dueDate: isCreditNote ? '' : formatUkDate(dueDate),
      validUntil: '',
      purchaseOrderNumber: purchaseOrderNumber ?? '',
      quoteNumber: quoteNumber ?? '',
      creditedInvoiceNumber: creditedInvoiceNumber ?? '',
      subtotal: formatGbp(totals.subtotalPence),
      vatTotal: showVat ? formatGbp(totals.vatPence) : '',
    },
  };
};

export const buildQuotePdfModel = ({
  profile,
  number,
  customer,
  issueDate,
  validUntil,
  title,
  notes,
  terms,
  lines,
  totals,
}: {
  profile: BusinessProfile;
  number: string;
  customer: Customer;
  issueDate: string;
  validUntil: string | null;
  title: string | null;
  notes: string | null;
  terms: string | null;
  lines: TemplateLine[];
  totals: DocumentTotals;
}): PdfModel => {
  const showVat = Boolean(profile.vatRegistered);
  const metaRows: [string, string][] = [
    ['Quote number', number],
    ['Date', formatUkDate(issueDate)],
  ];
  if (validUntil) metaRows.push(['Valid until', formatUkDate(validUntil)]);
  if (title) metaRows.push(['For', title]);

  return {
    title: 'QUOTATION',
    number,
    sellerLines: sellerLines(profile, { showVat }),
    customerHeading: 'PREPARED FOR',
    customerLines: [customer.name, ...formatAddress(customer.address)],
    metaRows,
    showVatColumn: showVat,
    lines: tableLines(lines, totals, showVat),
    summaryRows: showVat ? vatSummaryRows(totals, { reverseCharge: false }) : [],
    totalRow: [showVat ? 'Total including VAT' : 'Total', formatGbp(totals.totalPence)],
    notices: [
      validUntil
        ? `This quotation is valid until ${formatUkDate(validUntil)}. Prices are in pounds sterling${showVat ? ' and VAT is shown at the current rates' : ''}.`
        : 'Prices are in pounds sterling.',
      ...(showVat ? [] : ['This business is not registered for VAT. No VAT will be charged.']),
    ],
    notes: [notes, terms].filter(Boolean).join('\n\n') || null,
    paymentLines: [],
    footerLines: footerLines(profile),
    values: {
      ...partyValues(profile, customer, showVat),
      documentTitle: 'QUOTATION',
      documentNumber: number,
      issueDate: formatUkDate(issueDate),
      supplyDate: '',
      dueDate: '',
      validUntil: formatUkDate(validUntil),
      purchaseOrderNumber: '',
      quoteNumber: number,
      creditedInvoiceNumber: '',
      subtotal: formatGbp(totals.subtotalPence),
      vatTotal: showVat ? formatGbp(totals.vatPence) : '',
    },
  };
};
