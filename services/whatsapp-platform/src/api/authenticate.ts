import { createHash } from 'node:crypto';
import type { Database } from '../db/pool.ts';
import type { ActorType } from '../envelope/envelope.ts';
import type { Caller } from '../operations/operations.ts';

export const hashApiToken = (token: string): string => createHash('sha256').update(token).digest('hex');

// The tenant always comes from the credential; request bodies may only repeat it.
export const authenticateBearer = async (database: Database, header: string | undefined): Promise<Caller | undefined> => {
  const match = /^Bearer ([A-Za-z0-9_\-.]{20,200})$/.exec(header ?? '');
  if (!match?.[1]) return undefined;
  const result = await database.query<{ credential_id: string; tenant_id: string; actor_types: ActorType[] }>(
    'SELECT * FROM authenticate_api_token($1)',
    [hashApiToken(match[1])],
  );
  const row = result.rows[0];
  return row ? { credentialId: row.credential_id, tenantId: row.tenant_id, actorTypes: row.actor_types } : undefined;
};
