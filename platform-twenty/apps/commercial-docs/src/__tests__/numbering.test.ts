import { describe, expect, it } from 'vitest';

import { claimSequenceNumber, isUniqueViolation } from 'src/lib/numbering';

const duplicate = () => new Error('GraphQL error: A duplicate entry was detected.');

describe('document numbering', () => {
  it('recognises a unique clash and nothing else', () => {
    expect(isUniqueViolation(duplicate())).toBe(true);
    expect(isUniqueViolation(new Error('duplicate key value violates unique constraint "IDX_x"'))).toBe(true);
    expect(isUniqueViolation(new Error('Twenty did not answer: timeout'))).toBe(false);
    expect(isUniqueViolation('duplicate')).toBe(false);
  });

  it('claims the first free number', async () => {
    const claimed: number[] = [];
    const result = await claimSequenceNumber({ start: 7, findFree: async (from) => from, claim: async (sequence) => (claimed.push(sequence), true) });
    expect(result).toBe(7);
    expect(claimed).toEqual([7]);
  });

  it('moves past a number another document took between the check and the write', async () => {
    const taken = new Set([7, 8]);
    const tried: number[] = [];
    const result = await claimSequenceNumber({
      start: 7,
      findFree: async (from) => from,
      claim: async (sequence) => {
        tried.push(sequence);
        if (taken.has(sequence)) throw duplicate();
        return true;
      },
    });
    expect(result).toBe(9);
    expect(tried).toEqual([7, 8, 9]);
  });

  it('starts the next search after the clashing number, not after the counter', async () => {
    const searchedFrom: number[] = [];
    await claimSequenceNumber({
      start: 1,
      findFree: async (from) => (searchedFrom.push(from), Math.max(from, 12)),
      claim: async (sequence) => {
        if (sequence === 12) throw duplicate();
        return true;
      },
    });
    expect(searchedFrom).toEqual([1, 13]);
  });

  it('gives up after a bounded number of clashes', async () => {
    let attempts = 0;
    const claim = async () => {
      attempts += 1;
      throw duplicate();
    };
    await expect(claimSequenceNumber({ start: 1, findFree: async (from) => from, claim, maxAttempts: 3 })).rejects.toThrow(/No free number/);
    expect(attempts).toBe(3);
  });

  it('passes other errors through without retrying', async () => {
    let attempts = 0;
    const claim = async () => {
      attempts += 1;
      throw new Error('Twenty did not answer');
    };
    await expect(claimSequenceNumber({ start: 1, findFree: async (from) => from, claim })).rejects.toThrow('Twenty did not answer');
    expect(attempts).toBe(1);
  });

  it('reports a record that another run has already numbered', async () => {
    expect(await claimSequenceNumber({ start: 1, findFree: async (from) => from, claim: async () => false })).toBeNull();
  });
});
