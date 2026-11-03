export const ROUND_ROBIN_STRATEGIES = ['EQUAL', 'WEIGHTED', 'LEAST_RECENT', 'LEAST_BOOKED', 'PRIORITY', 'FIRST_AVAILABLE'] as const;
export type RoundRobinStrategy = (typeof ROUND_ROBIN_STRATEGIES)[number];

// Fairness inputs come from the advisor's own bookings in the fairness window. Cancelled bookings are not counted,
// so a cancelled assignment goes back into the pool; no-shows and completed bookings count.
export type AssignmentCandidate = {
  advisorId: string;
  name: string;
  weight: number;
  priority: number;
  assignedCount: number;
  lastAssignedAt: number | null;
  upcomingBookedMinutes: number;
  earliestStart?: number | null;
};

type Comparator = (a: AssignmentCandidate, b: AssignmentCandidate) => number;

const byCount: Comparator = (a, b) => a.assignedCount - b.assignedCount;
const byWeightedCount: Comparator = (a, b) => a.assignedCount / Math.max(a.weight, 0.01) - b.assignedCount / Math.max(b.weight, 0.01);
const byLeastRecent: Comparator = (a, b) => (a.lastAssignedAt ?? -Infinity) - (b.lastAssignedAt ?? -Infinity);
const byLoad: Comparator = (a, b) => a.upcomingBookedMinutes - b.upcomingBookedMinutes;
const byPriority: Comparator = (a, b) => b.priority - a.priority;
const byEarliest: Comparator = (a, b) => (a.earliestStart ?? Infinity) - (b.earliestStart ?? Infinity);
const byId: Comparator = (a, b) => a.advisorId.localeCompare(b.advisorId);

const ORDER: Record<RoundRobinStrategy, Comparator[]> = {
  EQUAL: [byCount, byLeastRecent, byId],
  WEIGHTED: [byWeightedCount, byLeastRecent, byId],
  LEAST_RECENT: [byLeastRecent, byCount, byId],
  LEAST_BOOKED: [byLoad, byLeastRecent, byId],
  PRIORITY: [byPriority, byCount, byLeastRecent, byId],
  FIRST_AVAILABLE: [byEarliest, byCount, byLeastRecent, byId],
};

const REASON: Record<RoundRobinStrategy, (winner: AssignmentCandidate) => string> = {
  EQUAL: (winner) => `fewest bookings in the fairness window (${winner.assignedCount})`,
  WEIGHTED: (winner) => `lowest bookings per weight (${winner.assignedCount} / ${winner.weight})`,
  LEAST_RECENT: (winner) => (winner.lastAssignedAt ? `least recently assigned (${new Date(winner.lastAssignedAt).toISOString()})` : 'never assigned before'),
  LEAST_BOOKED: (winner) => `lightest upcoming workload (${winner.upcomingBookedMinutes} minutes)`,
  PRIORITY: (winner) => `highest priority (${winner.priority})`,
  FIRST_AVAILABLE: (winner) => `earliest availability${winner.earliestStart ? ` (${new Date(winner.earliestStart).toISOString()})` : ''}`,
};

// Candidates must already be the advisors free for the chosen slot; this only decides who gets it.
export const rankCandidates = (candidates: AssignmentCandidate[], strategy: RoundRobinStrategy) => {
  const comparators = ORDER[strategy];
  return [...candidates]
    .filter((candidate) => strategy !== 'WEIGHTED' || candidate.weight > 0)
    .sort((a, b) => {
      for (const compare of comparators) {
        const result = compare(a, b);
        if (result !== 0) return result;
      }
      return 0;
    });
};

export const pickAdvisor = (candidates: AssignmentCandidate[], strategy: RoundRobinStrategy) => {
  const [winner, ...rest] = rankCandidates(candidates, strategy);
  if (!winner) return null;
  return { winner, fallbacks: rest, reason: `${strategy}: ${winner.name}, ${REASON[strategy](winner)}; ${candidates.length} eligible` };
};
