export const VAT_RATES = {
  STANDARD_20: { label: 'Standard 20%', basisPoints: 2000, color: 'blue' },
  REDUCED_5: { label: 'Reduced 5%', basisPoints: 500, color: 'sky' },
  ZERO: { label: 'Zero-rated 0%', basisPoints: 0, color: 'green' },
  EXEMPT: { label: 'Exempt', basisPoints: 0, color: 'gray' },
  OUTSIDE_SCOPE: { label: 'Outside the scope of VAT', basisPoints: 0, color: 'gray' },
  NO_VAT: { label: 'No VAT (not VAT registered)', basisPoints: 0, color: 'gray' },
} as const;

export type VatRate = keyof typeof VAT_RATES;

export const INVOICE_TEMPLATES = {
  UK_VAT_INVOICE: 'UK VAT invoice',
  UK_NON_VAT_INVOICE: 'UK invoice (not VAT registered)',
  UK_REVERSE_CHARGE_INVOICE: 'UK VAT invoice: domestic reverse charge (CIS)',
} as const;

export type InvoiceTemplate = keyof typeof INVOICE_TEMPLATES;

export const INVOICE_KINDS = { INVOICE: 'Invoice', CREDIT_NOTE: 'Credit note' } as const;

export const INVOICE_STATUSES = {
  DRAFT: { label: 'Draft', color: 'gray' },
  ISSUED: { label: 'Issued', color: 'blue' },
  PART_PAID: { label: 'Part paid', color: 'orange' },
  PAID: { label: 'Paid', color: 'green' },
  OVERDUE: { label: 'Overdue', color: 'red' },
  VOID: { label: 'Void', color: 'gray' },
} as const;

export const QUOTE_STATUSES = {
  DRAFT: { label: 'Draft', color: 'gray' },
  SENT: { label: 'Sent', color: 'blue' },
  ACCEPTED: { label: 'Accepted', color: 'green' },
  DECLINED: { label: 'Declined', color: 'red' },
  EXPIRED: { label: 'Expired', color: 'orange' },
  CONVERTED: { label: 'Converted to invoice', color: 'purple' },
} as const;

export const RECURRENCE_FREQUENCIES = {
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  YEARLY: 'Yearly',
} as const;

export type RecurrenceFrequency = keyof typeof RECURRENCE_FREQUENCIES;

export const LEGAL_STRUCTURES = {
  SOLE_TRADER: 'Sole trader',
  PARTNERSHIP: 'Partnership',
  LIMITED_COMPANY: 'Limited company',
  LLP: 'Limited liability partnership',
} as const;

export const REGISTERED_IN = {
  ENGLAND_AND_WALES: 'England and Wales',
  SCOTLAND: 'Scotland',
  NORTHERN_IRELAND: 'Northern Ireland',
} as const;

export const VAT_ROUNDING = {
  NEAREST_PENNY: 'Round to nearest penny',
  ROUND_DOWN: 'Round down to the penny',
} as const;

export type VatRounding = keyof typeof VAT_ROUNDING;

type OptionColor = 'blue' | 'sky' | 'green' | 'gray' | 'orange' | 'red' | 'purple';

export const selectOptions = (entries: Record<string, string | { label: string; color?: string }>) =>
  Object.entries(entries).map(([value, entry], position) => ({
    value,
    label: typeof entry === 'string' ? entry : entry.label,
    color: (typeof entry === 'string' ? 'gray' : (entry.color ?? 'gray')) as OptionColor,
    position,
  }));
