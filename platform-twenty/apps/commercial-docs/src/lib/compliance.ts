import { type InvoiceTemplate, type VatRate } from 'src/constants/enums';

export type Address = {
  addressStreet1?: string | null;
  addressStreet2?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressPostcode?: string | null;
  addressCountry?: string | null;
};

export type BusinessProfile = {
  id: string;
  legalName: string | null;
  tradingName: string | null;
  legalStructure: string | null;
  companyNumber: string | null;
  registeredIn: string | null;
  registeredOfficeAddress: string | null;
  businessAddress: Address | null;
  vatRegistered: boolean | null;
  vatNumber: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  sortCode: string | null;
  accountNumber: string | null;
  iban: string | null;
  bic: string | null;
  invoicePrefix: string | null;
  quotePrefix: string | null;
  creditNotePrefix: string | null;
  nextInvoiceNumber: number | null;
  nextQuoteNumber: number | null;
  nextCreditNoteNumber: number | null;
  numberPadding: number | null;
  defaultPaymentTermsDays: number | null;
  quoteValidityDays: number | null;
  vatRounding: string | null;
  paymentInstructions: string | null;
  invoiceFooter: string | null;
  includeLatePaymentNotice: boolean | null;
};

export type Customer = { name: string; address: Address | null; vatNumber: string | null; email: string | null };

export type DocumentLine = { description: string | null; quantity: number | null; vatRate: VatRate | null };

// GB VAT numbers: GB + 9 or 12 digits, or GBGD/GBHA + 3 digits for government departments and health authorities.
const UK_VAT_NUMBER = /^(GB)?(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/;
const COMPANY_NUMBER = /^((SC|NI|OC|SO|NC|R0)\d{6}|\d{8})$/;

export const normaliseVatNumber = (value: string | null | undefined) =>
  (value ?? '').replace(/\s+/g, '').toUpperCase();

export const formatAddress = (address: Address | null | undefined): string[] =>
  [
    address?.addressStreet1,
    address?.addressStreet2,
    address?.addressCity,
    address?.addressState,
    address?.addressPostcode,
    address?.addressCountry,
  ].filter((part): part is string => Boolean(part && part.trim()));

const hasAddress = (address: Address | null | undefined) =>
  Boolean(address?.addressStreet1?.trim() && address?.addressPostcode?.trim());

const sellerIssues = (profile: BusinessProfile | null): string[] => {
  if (!profile) return ['Create a Business profile with your business details before issuing documents.'];
  const issues: string[] = [];
  if (!profile.legalName?.trim()) issues.push('Business profile: legal name is missing.');
  if (!hasAddress(profile.businessAddress)) issues.push('Business profile: business address (street and postcode) is missing.');
  const isCompany = profile.legalStructure === 'LIMITED_COMPANY' || profile.legalStructure === 'LLP';
  if (isCompany) {
    // Companies Act 2006 and the Company, LLP and Business (Names and Trading Disclosures) Regulations 2015.
    if (!COMPANY_NUMBER.test((profile.companyNumber ?? '').replace(/\s+/g, '').toUpperCase()))
      issues.push('Business profile: a valid Companies House registration number is required for a company or LLP.');
    if (!profile.registeredIn) issues.push('Business profile: place of registration (e.g. England and Wales) is required.');
    if (!profile.registeredOfficeAddress?.trim()) issues.push('Business profile: registered office address is required.');
  }
  return issues;
};

export const checkInvoice = ({
  profile,
  template,
  kind,
  customer,
  lines,
  supplyDate,
  creditedInvoiceNumber,
}: {
  profile: BusinessProfile | null;
  template: InvoiceTemplate;
  kind: 'INVOICE' | 'CREDIT_NOTE';
  customer: Customer | null;
  lines: DocumentLine[];
  supplyDate: string | null;
  creditedInvoiceNumber: string | null;
}): string[] => {
  const issues = sellerIssues(profile);
  const vatRegistered = Boolean(profile?.vatRegistered);
  const isVatTemplate = template !== 'UK_NON_VAT_INVOICE';

  if (!customer?.name?.trim()) issues.push('Link the invoice to a client company or person.');
  if (isVatTemplate && !hasAddress(customer?.address))
    issues.push("A VAT invoice must show the customer's address: add it to the client's company record.");
  if (lines.length === 0) issues.push('Add at least one line.');
  lines.forEach((line, index) => {
    if (!line.description?.trim()) issues.push(`Line ${index + 1}: description is missing.`);
    if (!line.quantity || line.quantity <= 0) issues.push(`Line ${index + 1}: quantity must be greater than zero.`);
  });

  if (isVatTemplate) {
    if (!vatRegistered) issues.push('This template is for VAT-registered businesses. Use "UK invoice (not VAT registered)" or tick VAT registered in the Business profile.');
    if (!UK_VAT_NUMBER.test(normaliseVatNumber(profile?.vatNumber)))
      issues.push('Business profile: a valid UK VAT registration number is required on a VAT invoice.');
    if (!supplyDate) issues.push('Set the time of supply (tax point) date.');
    lines.forEach((line, index) => {
      if (!line.vatRate || line.vatRate === 'NO_VAT')
        issues.push(`Line ${index + 1}: choose a VAT rate (20%, 5%, 0%, exempt or outside the scope).`);
    });
  } else {
    if (vatRegistered) issues.push('A VAT-registered business must issue VAT invoices. Choose a VAT invoice template.');
    lines.forEach((line, index) => {
      if (line.vatRate && line.vatRate !== 'NO_VAT')
        issues.push(`Line ${index + 1}: a business that is not VAT registered cannot charge VAT. Set the VAT rate to "No VAT".`);
    });
  }

  if (template === 'UK_REVERSE_CHARGE_INVOICE') {
    if (!UK_VAT_NUMBER.test(normaliseVatNumber(customer?.vatNumber)))
      issues.push("Domestic reverse charge: the customer's VAT number is required. Add it to the client's company record.");
    lines.forEach((line, index) => {
      if (line.vatRate !== 'STANDARD_20' && line.vatRate !== 'REDUCED_5')
        issues.push(`Line ${index + 1}: reverse charge applies to standard or reduced-rated construction services.`);
    });
  }

  if (kind === 'CREDIT_NOTE' && !creditedInvoiceNumber)
    issues.push('A credit note must reference the invoice it credits: set Credited invoice.');

  return issues;
};

export const checkQuote = ({
  profile,
  customer,
  lines,
}: {
  profile: BusinessProfile | null;
  customer: Customer | null;
  lines: DocumentLine[];
}): string[] => {
  const issues = sellerIssues(profile);
  if (!customer?.name?.trim()) issues.push('Link the quote to a client company or person.');
  if (lines.length === 0) issues.push('Add at least one line.');
  lines.forEach((line, index) => {
    if (!line.description?.trim()) issues.push(`Line ${index + 1}: description is missing.`);
    if (!line.quantity || line.quantity <= 0) issues.push(`Line ${index + 1}: quantity must be greater than zero.`);
  });
  return issues;
};
