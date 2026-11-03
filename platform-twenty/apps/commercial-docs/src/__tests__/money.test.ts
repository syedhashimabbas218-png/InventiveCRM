import { describe, expect, it } from 'vitest';

import { computeTotals, formatGbp, microsToPence, penceToMicros } from 'src/lib/money';

describe('money', () => {
  it('converts between micros and pence without drift', () => {
    expect(microsToPence(123_450_000)).toBe(12_345);
    expect(penceToMicros(12_345)).toBe(123_450_000);
  });

  it('totals a mixed-rate VAT invoice per rate', () => {
    const totals = computeTotals(
      [
        { quantity: 3, unitPricePence: 4_500, discountPercent: 0, vatRate: 'STANDARD_20' },
        { quantity: 1, unitPricePence: 1_999, discountPercent: 10, vatRate: 'STANDARD_20' },
        { quantity: 2, unitPricePence: 1_250, discountPercent: 0, vatRate: 'REDUCED_5' },
        { quantity: 1, unitPricePence: 800, discountPercent: 0, vatRate: 'ZERO' },
      ],
      { rounding: 'NEAREST_PENNY', reverseCharge: false },
    );
    // 13500 + 1799 (19.99 less 10% = 17.991, rounds to 17.99) = 15299 at 20% -> 3059.8 -> 3060
    expect(totals.lines.map((line) => line.netPence)).toEqual([13_500, 1_799, 2_500, 800]);
    expect(totals.breakdown).toEqual([
      { vatRate: 'STANDARD_20', netPence: 15_299, vatPence: 3_060 },
      { vatRate: 'REDUCED_5', netPence: 2_500, vatPence: 125 },
      { vatRate: 'ZERO', netPence: 800, vatPence: 0 },
    ]);
    expect(totals.subtotalPence).toBe(18_599);
    expect(totals.vatPence).toBe(3_185);
    expect(totals.totalPence).toBe(21_784);
  });

  it('rounds VAT down when the business chooses to', () => {
    const totals = computeTotals([{ quantity: 1, unitPricePence: 15_299, discountPercent: 0, vatRate: 'STANDARD_20' }], {
      rounding: 'ROUND_DOWN',
      reverseCharge: false,
    });
    expect(totals.vatPence).toBe(3_059);
  });

  it('shows but does not charge VAT under the domestic reverse charge', () => {
    const totals = computeTotals([{ quantity: 1, unitPricePence: 100_000, discountPercent: 0, vatRate: 'STANDARD_20' }], {
      rounding: 'NEAREST_PENNY',
      reverseCharge: true,
    });
    expect(totals.vatPence).toBe(20_000);
    expect(totals.totalPence).toBe(100_000);
  });

  it('formats pounds sterling', () => {
    expect(formatGbp(123_456_78)).toBe('£123,456.78');
    expect(formatGbp(-505)).toBe('-£5.05');
  });
});
