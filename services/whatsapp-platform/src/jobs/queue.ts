import type { TenantClient } from '../db/pool.ts';
import { newId } from '../shared/ids.ts';

export type JobKind = 'agent.turn' | 'reminder.send';

export const enqueueJob = async (
  client: TenantClient,
  job: { kind: JobKind; payload: Record<string, unknown>; idempotencyKey: string; runAt: Date },
): Promise<string | undefined> => {
  const result = await client.query<{ id: string }>(
    `INSERT INTO jobs (id, tenant_id, kind, payload, idempotency_key, run_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
     RETURNING id`,
    [newId('job'), client.tenantId, job.kind, job.payload, job.idempotencyKey, job.runAt],
  );
  return result.rows[0]?.id;
};
