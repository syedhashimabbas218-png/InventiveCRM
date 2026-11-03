import { randomBytes } from 'node:crypto';
import { hashApiToken } from '../../src/api/authenticate.ts';
import { encryptToken, type TokenKey } from '../../src/crypto/token-cipher.ts';
import type { Database } from '../../src/db/pool.ts';
import { newId } from '../../src/shared/ids.ts';

export type SeededTenant = {
  tenantId: string;
  whatsappAccountId: string;
  phoneNumberId: string;
  wabaId: string;
  businessNumber: string;
  accessToken: string;
  apiToken: string;
  inboxToken: string;
};

let sequence = 0;

const createCredential = async (owner: Database, tenantId: string, label: string, actorTypes: string[]) => {
  const token = `wa_${randomBytes(24).toString('hex')}`;
  await owner.query(
    'INSERT INTO api_credentials (id, tenant_id, token_sha256, label, actor_types) VALUES ($1, $2, $3, $4, $5)',
    [newId('wac').replace('wac_', 'cred_'), tenantId, hashApiToken(token), label, actorTypes],
  );
  return token;
};

// Provisioning runs as the owner role; the app role cannot create tenants.
export const seedTenant = async (
  owner: Database,
  name: string,
  options: { route?: 'A' | 'B' | 'C'; tokenKey?: TokenKey } = {},
): Promise<SeededTenant> => {
  sequence += 1;
  const tenantId = newId('tnt');
  const whatsappAccountId = newId('wac');
  const phoneNumberId = `${process.pid}${Date.now() % 1e6}${sequence}`;
  const wabaId = `waba${phoneNumberId}`;
  const businessNumber = `4477009${String(sequence).padStart(5, '0')}`;
  const accessToken = `EAAG${randomBytes(16).toString('hex')}`;
  const encrypted = options.tokenKey ? encryptToken(options.tokenKey, tenantId, accessToken) : undefined;
  await owner.query('INSERT INTO tenants (id, name) VALUES ($1, $2)', [tenantId, name]);
  await owner.query('INSERT INTO tenant_settings (tenant_id) VALUES ($1)', [tenantId]);
  await owner.query(
    `INSERT INTO whatsapp_accounts (id, tenant_id, waba_id, phone_number_id, display_phone_number, connection_route,
                                    access_token_ciphertext, access_token_key_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      whatsappAccountId,
      tenantId,
      wabaId,
      phoneNumberId,
      businessNumber,
      options.route ?? 'B',
      encrypted?.ciphertext ?? null,
      encrypted?.keyId ?? null,
    ],
  );
  const apiToken = await createCredential(owner, tenantId, 'n8n connector', ['agent', 'system']);
  const inboxToken = await createCredential(owner, tenantId, 'owner inbox', ['user']);
  return { tenantId, whatsappAccountId, phoneNumberId, wabaId, businessNumber, accessToken, apiToken, inboxToken };
};
