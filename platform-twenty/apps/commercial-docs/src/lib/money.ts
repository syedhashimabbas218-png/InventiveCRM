import { VAT_RATES, type VatRate, type VatRounding } from 'src/constants/enums';

// Twenty CURRENCY fields store amountMicros; all arithmetic here is in integer pence.
const MICROS_PER_PENNY = 10_000;

export const microsToPence = (amountMicros: number | string | null | undefined): number =>
  Math.round(Number(amountMicros ?? 0) / MICROS_PER_PENNY);

export const penceToMicros = (pence: number): number => pence * MICROS_PER_PENNY;

export const gbp = (pence: number) => ({ amountMicros: penceToMicros(pence), currencyCode: 'GBP' });

const roundHalfUp = (value: number): number =>
  value >= 0 ? Math.floor(value + 0.5 + 1e-9) : -Math.floor(-value + 0.5 + 1e-9);

export type LineInput = {
  quantity: number;
  unitPricePence: number;
  discountPercent: number;
  vatRate: VatRate;
};

export const computeLineNetPence = ({ quantity, unitPricePence, discountPercent }: LineInput): number =>
  roundHalfUp(quantity * unitPricePence * (1 - (discountPercent || 0) / 100));

export const computeVatPence = (netPence: number, vatRate: VatRate, rounding: VatRounding): number => {
  const raw = (netPence * VAT_RATES[vatRate].basisPoints) / 10_000;
  return rounding === 'ROUND_DOWN' ? Math.trunc(raw + (raw >= 0 ? 1e-9 : -1e-9)) : roundHalfUp(raw);
};

export type VatBreakdownRow = { vatRate: VatRate; netPence: number; vatPence: number };

export type DocumentTotals = {
  lines: { netPence: number; vatPence: number }[];
  breakdown: VatBreakdownRow[];
  subtotalPence: number;
  vatPence: number;
  totalPence: number;
};

// VAT is calculated per rate on the summed net amounts, as HMRC allows for invoice-level calculation.
// With reverse charge the VAT is shown for the customer to account for, but not added to the amount payable.
export const computeTotals = (
  lines: LineInput[],
  { rounding, reverseCharge }: { rounding: VatRounding; reverseCharge: boolean },
): DocumentTotals => {
  const computedLines = lines.map((line) => {
    const netPence = computeLineNetPence(line);
    return { netPence, vatPence: computeVatPence(netPence, line.vatRate, rounding) };
  });

  const netByRate = new Map<VatRate, number>();
  lines.forEach((line, index) => {
    netByRate.set(line.vatRate, (netByRate.get(line.vatRate) ?? 0) + computedLines[index].netPence);
  });

  const breakdown = [...netByRate.entries()].map(([vatRate, netPence]) => ({
    vatRate,
    netPence,
    vatPence: computeVatPence(netPence, vatRate, rounding),
  }));

  const subtotalPence = breakdown.reduce((sum, row) => sum + row.netPence, 0);
  const vatPence = breakdown.reduce((sum, row) => sum + row.vatPence, 0);

  return {
    lines: computedLines,
    breakdown,
    subtotalPence,
    vatPence,
    totalPence: subtotalPence + (reverseCharge ? 0 : vatPence),
  };
};

export const formatGbp = (pence: number): string => {
  const sign = pence < 0 ? '-' : '';
  const absolute = Math.abs(pence);
  const pounds = Math.floor(absolute / 100).toLocaleString('en-GB');
  return `${sign}£${pounds}.${String(absolute % 100).padStart(2, '0')}`;
};
