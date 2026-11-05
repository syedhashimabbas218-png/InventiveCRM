import { withTenant, type Database } from '../db/pool.ts';
import type { Actor } from '../envelope/envelope.ts';

export type AuditEntry = {
  tenantId: string;
  actor: Actor;
  correlationId: string;
  action: string;
  target?: string;
  decision: 'allowed' | 'denied' | 'error';
  details?: Record<string, unknown>;
  occurredAt: Date;
};

export const writeAudit = async (database: Database, entry: AuditEntry): Promise<void> => {
  await withTenant(database, entry.tenantId, (client) =>
    client.query(
      `INSERT INTO audit_log (tenant_id, occurred_at, actor_type, actor_id, correlation_id, action, target, decision, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entry.tenantId,
        entry.occurredAt,
        entry.actor.type,
        entry.actor.id,
        entry.correlationId,
        entry.action,
        entry.target ?? null,
        entry.decision,
        entry.details ?? {},
      ],
    ),
  );
};
