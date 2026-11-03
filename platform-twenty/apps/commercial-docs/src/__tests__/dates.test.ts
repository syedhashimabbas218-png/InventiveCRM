import { describe, expect, it } from 'vitest';

import { addDays, addMonths, nextRecurrenceDate } from 'src/lib/dates';

describe('dates', () => {
  it('adds days across month ends', () => expect(addDays('2026-01-25', 30)).toBe('2026-02-24'));
  it('clamps monthly repeats to the month end', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  });
  it('steps recurring invoices by frequency and interval', () => {
    expect(nextRecurrenceDate('2026-11-03', 'WEEKLY', 2)).toBe('2026-11-17');
    expect(nextRecurrenceDate('2026-11-03', 'MONTHLY', 1)).toBe('2026-12-03');
    expect(nextRecurrenceDate('2026-11-30', 'QUARTERLY', 1)).toBe('2027-02-28');
    expect(nextRecurrenceDate('2026-11-03', 'YEARLY', 1)).toBe('2027-11-03');
  });
});
