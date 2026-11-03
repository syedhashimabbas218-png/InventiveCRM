import { describe, expect, it } from 'vitest';

import { type BusinessProfile, checkInvoice } from 'src/lib/compliance';

const address = { addressStreet1: '1 High Street', addressCity: 'Leeds', addressPostcode: 'LS1 1AA', addressCountry: 'United Kingdom' };

const profile = (overrides: Partial<BusinessProfile> = {}): BusinessProfile =>
  ({
    id: 'p',
    legalName: 'Bright Electrical Ltd',
    legalStructure: 'LIMITED_COMPANY',
    companyNumber: '12345678',
    registeredIn: 'ENGLAND_AND_WALES',
    registeredOfficeAddress: '1 High Street, Leeds LS1 1AA',
    businessAddress: address,
    vatRegistered: true,
    vatNumber: 'GB123456789',
    ...overrides,
  }) as BusinessProfile;

const customer = { name: 'Acme Plumbing', address, vatNumber: 'GB987654321', email: null };
const lines = [{ description: 'Rewire', quantity: 1, vatRate: 'STANDARD_20' as const }];
const base = { kind: 'INVOICE' as const, customer, lines, supplyDate: '2026-11-03', creditedInvoiceNumber: null };

describe('UK invoice checks', () => {
  it('accepts a complete VAT invoice', () => {
    expect(checkInvoice({ ...base, profile: profile(), template: 'UK_VAT_INVOICE' })).toEqual([]);
  });

  it('requires company number, registered office and a valid VAT number', () => {
    const issues = checkInvoice({
      ...base,
      profile: profile({ companyNumber: null, registeredOfficeAddress: null, vatNumber: 'GB12' }),
      template: 'UK_VAT_INVOICE',
    });
    expect(issues.join('\n')).toMatch(/Companies House registration number/);
    expect(issues.join('\n')).toMatch(/registered office/);
    expect(issues.join('\n')).toMatch(/valid UK VAT registration number/);
  });

  it('stops a business that is not VAT registered from charging VAT', () => {
    const issues = checkInvoice({
      ...base,
      profile: profile({ vatRegistered: false, vatNumber: null, legalStructure: 'SOLE_TRADER' }),
      template: 'UK_NON_VAT_INVOICE',
    });
    expect(issues).toEqual(['Line 1: a business that is not VAT registered cannot charge VAT. Set the VAT rate to "No VAT".']);
  });

  it("requires the customer's VAT number for the domestic reverse charge", () => {
    const issues = checkInvoice({
      ...base,
      customer: { ...customer, vatNumber: null },
      profile: profile(),
      template: 'UK_REVERSE_CHARGE_INVOICE',
    });
    expect(issues.join('\n')).toMatch(/customer's VAT number is required/);
  });

  it('requires a credit note to reference the invoice it credits', () => {
    const issues = checkInvoice({ ...base, kind: 'CREDIT_NOTE', profile: profile(), template: 'UK_VAT_INVOICE' });
    expect(issues).toEqual(['A credit note must reference the invoice it credits: set Credited invoice.']);
  });
});
