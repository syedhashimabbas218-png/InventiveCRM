import { handleWebhook } from 'src/lib/events';
import { type EventPage, InventiveChatError, type InventiveChatContext, latestEventCursor, type ParsedWebhook, parseWebhook, readEvents, withRetry } from 'src/lib/inventivechat';
import { type ChangeSet } from 'src/lib/realtime';
import { messagesByInventiveChatIds } from 'src/lib/records';
import { canMoveStatus } from 'src/lib/rules';
import { leaseCatchUp, type Settings, updateSettings } from 'src/lib/settings';

const PAGE_SIZE = 100;
// The feed shares the key's limit (20 a second) with sends, so paging leaves most of it free.
const PAGE_GAP_MS = 200;

export type CatchUpOutcome = { applied: number; duplicates: number; ignored: number; pages: number; caughtUp: boolean } | { skipped: string };

const expiredProblem = (since: string | null) =>
  `WhatsApp events ${since ? `after ${since} ` : ''}were kept by InventiveChat for 7 days only, so some may be missing from the CRM. Check InventiveChat for messages from that time.`;

// Most events reach the CRM by webhook as well, so one lookup per page finds the messages already recorded at that
// status instead of running the handlers for each.
const alreadyApplied = async (events: ParsedWebhook[]) => {
  const ids = [...new Set(events.flatMap(({ event }) => (event.kind === 'message' ? [event.message.messageId] : [])))];
  const recorded = new Map((await messagesByInventiveChatIds(ids)).map((row) => [row.inventiveChatMessageId, row]));
  return ({ event }: ParsedWebhook) => {
    if (event.kind !== 'message') return false;
    const row = recorded.get(event.message.messageId);
    return Boolean(row?.conversationId) && (event.message.status === null || !canMoveStatus(row?.status ?? null, event.message.status));
  };
};

// Webhooks stop after about a day; the feed keeps every event for 7 days, so a CRM that was unreachable reads what it
// missed from where it stopped, through the webhook handlers. A run that stops halfway through a page keeps the
// position of the last event it applied, so the next run never repeats work it already did.
export const catchUp = async (settings: Settings, context: InventiveChatContext, deadline: number, changes: ChangeSet): Promise<CatchUpOutcome> => {
  const started = Date.now();
  if (!(await leaseCatchUp(settings.id, new Date(started).toISOString(), new Date(deadline + 60_000).toISOString()))) return { skipped: 'another run is catching up' };
  const outcome = { applied: 0, duplicates: 0, ignored: 0, pages: 0, caughtUp: false };
  try {
    // A connection without a position (connected before the feed existed, or the feed did not answer then) starts now.
    if (!settings.eventCursor) {
      await updateSettings(settings.id, { eventCursor: await withRetry(() => latestEventCursor(context), deadline), eventsCheckedAt: new Date().toISOString() });
      return { ...outcome, caughtUp: true };
    }
    let cursor: string | null = settings.eventCursor;
    let problem: string | null = null;
    while (Date.now() < deadline) {
      if (outcome.pages > 0) await new Promise((resolve) => setTimeout(resolve, PAGE_GAP_MS));
      let page: EventPage;
      try {
        page = await withRetry(() => readEvents(context, cursor, PAGE_SIZE), deadline);
      } catch (error) {
        if (!(error instanceof InventiveChatError && error.code === 'cursor_expired')) throw error;
        problem = expiredProblem(settings.eventsCheckedAt);
        cursor = null;
        page = await withRetry(() => readEvents(context, null, PAGE_SIZE), deadline);
      }
      const events = page.events.map((entry) => ({ cursor: entry.cursor, event: parseWebhook(entry.envelope) }));
      const isApplied = await alreadyApplied(events.flatMap(({ event }) => (event ? [event] : [])));
      let reached: string | null = null;
      for (const { cursor: position, event } of events) {
        if (Date.now() >= deadline) {
          if (reached) await updateSettings(settings.id, { eventCursor: reached, ...(problem ? { eventsProblem: problem } : {}) });
          return outcome;
        }
        reached = position;
        if (!event || event.tenantId !== settings.tenantId) outcome.ignored += 1;
        else if (isApplied(event)) outcome.duplicates += 1;
        else {
          await handleWebhook(event, settings, changes);
          outcome.applied += 1;
        }
      }
      outcome.pages += 1;
      cursor = page.nextCursor ?? cursor;
      const done = !page.hasMore;
      await updateSettings(settings.id, { eventCursor: cursor, ...(done ? { eventsCheckedAt: new Date().toISOString() } : {}), ...(problem ? { eventsProblem: problem } : {}) });
      if (done) {
        outcome.caughtUp = true;
        break;
      }
    }
    return outcome;
  } finally {
    await updateSettings(settings.id, { catchUpLeaseUntil: null }).catch(() => undefined);
  }
};
