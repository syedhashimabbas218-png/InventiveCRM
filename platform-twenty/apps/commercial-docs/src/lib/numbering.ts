export const isUniqueViolation = (error: unknown) => error instanceof Error && /duplicate|unique constraint/i.test(error.message);

export const MAX_NUMBER_ATTEMPTS = 20;

// Numbers are unique fields, so the write is the claim: a clash means another document took that number after
// `findFree` saw it free, and the next one is tried. `claim` resolves false when the record already holds a number.
export const claimSequenceNumber = async ({
  start,
  findFree,
  claim,
  maxAttempts = MAX_NUMBER_ATTEMPTS,
}: {
  start: number;
  findFree: (from: number) => Promise<number>;
  claim: (sequence: number) => Promise<boolean>;
  maxAttempts?: number;
}): Promise<number | null> => {
  let from = start;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const sequence = await findFree(from);
    try {
      return (await claim(sequence)) ? sequence : null;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      from = sequence + 1;
    }
  }
  throw new Error(`No free number was found after ${maxAttempts} tries. Check the next number in the Business profile.`);
};
