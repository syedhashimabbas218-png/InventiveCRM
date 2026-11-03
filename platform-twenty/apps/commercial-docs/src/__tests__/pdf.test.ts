import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { type BusinessProfile } from 'src/lib/compliance';
import { computeTotals } from 'src/lib/money';
import { renderPdf } from 'src/lib/pdf';
import { buildInvoicePdfModel } from 'src/lib/templates';

describe('invoice PDF', () => {
  it('renders a multi-page VAT invoice with the statutory details', async () => {
    const profile = {
      legalName: 'Bright Electrical Ltd',
      legalStructure: 'LIMITED_COMPANY',
      companyNumber: '12345678',
      registeredIn: 'ENGLAND_AND_WALES',
      registeredOfficeAddress: '1 High Street, Leeds LS1 1AA',
      businessAddress: { addressStreet1: '1 High Street', addressPostcode: 'LS1 1AA' },
      vatRegistered: true,
      vatNumber: 'GB123456789',
      sortCode: '12-34-56',
      accountNumber: '12345678',
      includeLatePaymentNotice: true,
    } as BusinessProfile;
    const lines = Array.from({ length: 60 }, (_, index) => ({
      description: `Item ${index + 1}: supply and fit consumer unit with surge protection and RCBOs, including testing and certification`,
      quantity: 1,
      unit: 'job',
      unitPricePence: 12_500,
      vatRate: 'STANDARD_20' as const,
    }));
    const totals = computeTotals(lines.map((line) => ({ ...line, discountPercent: 0 })), { rounding: 'NEAREST_PENNY', reverseCharge: false });
    const model = buildInvoicePdfModel({
      profile,
      template: 'UK_VAT_INVOICE',
      kind: 'INVOICE',
      number: 'INV-0001',
      customer: { name: 'Acme Plumbing', address: { addressStreet1: '2 Low Road', addressPostcode: 'M1 1AA' }, vatNumber: null, email: null },
      issueDate: '2026-11-03',
      supplyDate: '2026-11-02',
      dueDate: '2026-12-03',
      purchaseOrderNumber: 'PO-77',
      creditedInvoiceNumber: null,
      notes: 'Thank you for your business.',
      lines,
      totals,
    });
    expect(model.title).toBe('VAT INVOICE');
    expect(model.sellerLines).toContain('VAT registration no. GB 123 4567 89');
    expect(model.metaRows).toContainEqual(['Time of supply (tax point)', '2 November 2026']);
    expect(model.footerLines[0]).toBe('Bright Electrical Ltd. Registered in England and Wales, company number 12345678.');
    const bytes = await renderPdf(model);
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });
});
