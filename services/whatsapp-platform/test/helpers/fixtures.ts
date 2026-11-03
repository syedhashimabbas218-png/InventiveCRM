import { newId } from '../../src/shared/ids.ts';
import type { Database } from '../../src/db/pool.ts';

export type SeededTenant = {
  tenantId: string;
  whatsappAccountId: string;
  phoneNumberId: string;
  wabaId: string;
  businessNumber: string;
};

let sequence = 0;

// Provisioning runs as the owner role; the app role cannot create tenants.
export const seedTenant = async (
  owner: Database,
  name: string,
  options: { route?: 'A' | 'B' | 'C' } = {},
): Promise<SeededTenant> => {
  sequence += 1;
  const tenantId = newId('tnt');
  const whatsappAccountId = newId('wac');
  const phoneNumberId = `${process.pid}${Date.now() % 1e6}${sequence}`;
  const wabaId = `waba${phoneNumberId}`;
  const businessNumber = `4477009${String(sequence).padStart(5, '0')}`;
  await owner.query('INSERT INTO tenants (id, name) VALUES ($1, $2)', [tenantId, name]);
  await owner.query('INSERT INTO tenant_settings (tenant_id) VALUES ($1)', [tenantId]);
  await owner.query(
    `INSERT INTO whatsapp_accounts (id, tenant_id, waba_id, phone_number_id, display_phone_number, connection_route)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [whatsappAccountId, tenantId, wabaId, phoneNumberId, businessNumber, options.route ?? 'B'],
  );
  return { tenantId, whatsappAccountId, phoneNumberId, wabaId, businessNumber };
};
