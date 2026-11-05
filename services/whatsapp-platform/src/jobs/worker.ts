import { withTenant, type Database } from '../db/pool.ts';
import type { Clock } from '../shared/clock.ts';
import type { JobKind } from './queue.ts';

export type DequeuedJob = {
  id: string;
  tenant_id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

export type JobHandler = (job: DequeuedJob) => Promise<{ retryAt?: Date } | void>;

const RETRY_BACKOFF_MS = 30_000;

export const runDueJobs = async (
  deps: { database: Database; clock: Clock },
  handlers: Partial<Record<JobKind, JobHandler>>,
  options: { batchSize: number; lockSeconds: number },
): Promise<number> => {
  const now = deps.clock();
  await deps.database.query('SELECT fail_abandoned_jobs($1)', [now]);
  const jobs = (
    await deps.database.query<DequeuedJob>('SELECT * FROM dequeue_jobs($1, $2, $3)', [now, options.batchSize, options.lockSeconds])
  ).rows;

  for (const job of jobs) {
    const finish = (sql: string, values: unknown[]) =>
      withTenant(deps.database, job.tenant_id, (client) => client.query(sql, [job.tenant_id, job.id, ...values]));
    try {
      const handler = handlers[job.kind];
      if (!handler) throw new Error(`no handler for ${job.kind}`);
      const result = await handler(job);
      if (result?.retryAt) {
        // A planned wait (grace period) is not a failed attempt.
        await finish("UPDATE jobs SET status = 'queued', run_at = $3, attempts = attempts - 1, locked_until = NULL WHERE tenant_id = $1 AND id = $2", [
          result.retryAt,
        ]);
      } else {
        await finish("UPDATE jobs SET status = 'done', locked_until = NULL WHERE tenant_id = $1 AND id = $2", []);
      }
    } catch (error) {
      const message = (error as Error).message.slice(0, 500);
      if (job.attempts >= job.max_attempts) {
        await finish("UPDATE jobs SET status = 'failed', last_error = $3, locked_until = NULL WHERE tenant_id = $1 AND id = $2", [message]);
      } else {
        await finish(
          "UPDATE jobs SET status = 'queued', last_error = $3, run_at = $4, locked_until = NULL WHERE tenant_id = $1 AND id = $2",
          [message, new Date(deps.clock().getTime() + RETRY_BACKOFF_MS * job.attempts)],
        );
      }
    }
  }
  return jobs.length;
};
