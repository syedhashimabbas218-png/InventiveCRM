// Net Promoter Score: 9-10 promoters, 7-8 passives, 0-6 detractors; NPS = % promoters - % detractors.
export type NpsGroup = 'PROMOTER' | 'PASSIVE' | 'DETRACTOR';

export const npsGroup = (score: number): NpsGroup => (score >= 9 ? 'PROMOTER' : score >= 7 ? 'PASSIVE' : 'DETRACTOR');

export const npsSummary = (scores: number[]) => {
  const counts = { PROMOTER: 0, PASSIVE: 0, DETRACTOR: 0 };
  for (const score of scores) counts[npsGroup(score)] += 1;
  const total = scores.length;
  return {
    total,
    promoters: counts.PROMOTER,
    passives: counts.PASSIVE,
    detractors: counts.DETRACTOR,
    nps: total === 0 ? null : Math.round(((counts.PROMOTER - counts.DETRACTOR) / total) * 100),
  };
};

export const isValidScore = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 10;

export const shouldAlert = (score: number, alertBelowScore: number | null | undefined) => score <= (alertBelowScore ?? 6);

// Review links go only to happy customers and only to a real https address.
export const reviewLinkFor = (score: number, promoterScore: number | null | undefined, url: string | null | undefined) => {
  if (score < (promoterScore ?? 9) || !url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
};
