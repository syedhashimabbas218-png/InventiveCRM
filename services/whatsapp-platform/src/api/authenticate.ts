import { createHash } from 'node:crypto';
import type { Database } from '../db/pool.ts';
import type { ActorType, Envelope } from '../envelope/envelope.ts';

export type Credential = { credentialId: string; tenantId: string; actorTypes: ActorType[] };

export const hashApiToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export const authenticateBearer = async (database: Database, header: string | undefined): Promise<Credential | undefined> => {
  const match = /^Bearer ([A-Za-z0-9_\-.]{20,200})$/.exec(header ?? '');
  if (!match?.[1]) return undefined;
  const result = await database.query<{ credential_id: string; tenant_id: string; actor_types: ActorType[] }>(
    'SELECT * FROM authenticate_api_token($1)',
    [hashApiToken(match[1])],
  );
  const row = result.rows[0];
  return row ? { credentialId: row.credential_id, tenantId: row.tenant_id, actorTypes: row.actor_types } : undefined;
};

// The tenant always comes from the credential; the envelope may only repeat it.
export const authorizeEnvelope = (credential: Credential, envelope: Envelope<unknown>): string | undefined => {
  if (envelope.tenant_id !== credential.tenantId) return 'tenant_mismatch';
  if (!credential.actorTypes.includes(envelope.actor.type)) return 'actor_not_allowed';
  return undefined;
};
