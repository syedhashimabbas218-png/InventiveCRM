import type { TokenKey } from '../crypto/token-cipher.ts';
import type { Database } from '../db/pool.ts';
import { createDeliveryHandler } from '../events/subscriptions.ts';
import { createReadyForReplyHandler } from '../events/ready-for-reply.ts';
import type { EventBus } from '../interfaces/event-bus.ts';
import type { JobKind } from '../jobs/queue.ts';
import type { JobHandler } from '../jobs/worker.ts';
import type { Clock } from '../shared/clock.ts';

export const createJobHandlers = (deps: {
  database: Database;
  clock: Clock;
  eventBus: EventBus;
  tokenKeys: readonly TokenKey[];
}): Record<JobKind, JobHandler> => ({
  'conversation.ready': createReadyForReplyHandler(deps),
  'event.deliver': createDeliveryHandler(deps),
});
