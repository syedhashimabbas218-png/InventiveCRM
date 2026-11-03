import { haversineKm, type Point } from 'src/engine/geo';
import { MINUTE } from 'src/engine/time';

export type Stop = { start: number; end: number; location: Point | null };

export type TravelEstimate = { minutes: number; verified: boolean };

// Used only when the router cannot answer: straight-line distance, a detour factor and a slow urban speed, so the
// estimate errs long. Results are marked unverified and the appointment records that.
export const fallbackTravelMinutes = (from: Point, to: Point) => Math.ceil(((haversineKm(from, to) * 1.4) / 30) * 60);

export const travelFeasibility = ({
  slot,
  previous,
  next,
  toCustomer,
  fromCustomer,
  bufferMinutes,
}: {
  slot: { start: number; end: number };
  previous: Stop | null;
  next: Stop | null;
  toCustomer: TravelEstimate | null;
  fromCustomer: TravelEstimate | null;
  bufferMinutes: number;
}) => {
  const buffer = bufferMinutes * MINUTE;
  if (previous && toCustomer && previous.end + toCustomer.minutes * MINUTE + buffer > slot.start)
    return { feasible: false, verified: toCustomer.verified, reason: `needs ${toCustomer.minutes} min to arrive from the previous stop` };
  if (next && fromCustomer && slot.end + fromCustomer.minutes * MINUTE + buffer > next.start)
    return { feasible: false, verified: fromCustomer.verified, reason: `needs ${fromCustomer.minutes} min to reach the next appointment` };
  const verified = (toCustomer?.verified ?? true) && (fromCustomer?.verified ?? true);
  return { feasible: true, verified, reason: verified ? 'travel checked with routing' : 'travel estimated (routing unavailable)' };
};

// The stops either side of a slot within the same working window; the advisor starts the window at their base.
export const neighbouringStops = (slot: { start: number; end: number }, bookings: Stop[], window: { start: number }, base: Point | null) => {
  const sorted = [...bookings].sort((a, b) => a.start - b.start);
  const previous = sorted.filter((booking) => booking.end <= slot.start && booking.end > window.start).at(-1) ?? { start: window.start, end: window.start, location: base };
  const next = sorted.find((booking) => booking.start >= slot.end) ?? null;
  return { previous, next };
};
