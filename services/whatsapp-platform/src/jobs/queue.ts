import type { TenantClient } from '../db/pool.ts';
import { newId } from '../shared/ids.ts';

export type JobKind = 'conversation.ready' | 'event.deliver';

export const enqueueJob = async (
  client: TenantClient,
  job: { kind: JobKind; payload: Record<string, unknown>; idempotencyKey: string; runAt: Date; maxAttempts?: number },
): Promise<string | undefined> => {
  const result = await client.query<{ id: string }>(
    `INSERT INTO jobs (id, tenant_id, kind, payload, idempotency_key, run_at, max_attempts)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
     RETURNING id`,
    [newId('job'), client.tenantId, job.kind, job.payload, job.idempotencyKey, job.runAt, job.maxAttempts ?? 3],
  );
  return result.rows[0]?.id;
};
