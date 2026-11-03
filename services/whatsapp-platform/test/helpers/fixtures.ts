import { newId } from '../../src/shared/ids.ts';
import type { Database } from '../../src/db/pool.ts';

export type SeededTenant = {
  tenantId: string;
  whatsappAccountId: string;
  phoneNumberId: string;
};

// Provisioning runs as the owner role; the app role cannot create tenants.
export const seedTenant = async (owner: Database, name: string): Promise<SeededTenant> => {
  const tenantId = newId('tnt');
  const whatsappAccountId = newId('wac');
  const phoneNumberId = `pn${Math.floor(Math.random() * 1e12)}`;
  await owner.query('INSERT INTO tenants (id, name) VALUES ($1, $2)', [tenantId, name]);
  await owner.query('INSERT INTO tenant_settings (tenant_id) VALUES ($1)', [tenantId]);
  await owner.query(
    `INSERT INTO whatsapp_accounts (id, tenant_id, waba_id, phone_number_id, display_phone_number, connection_route)
     VALUES ($1, $2, $3, $4, $5, 'B')`,
    [whatsappAccountId, tenantId, `waba_${tenantId}`, phoneNumberId, '+447700900000'],
  );
  return { tenantId, whatsappAccountId, phoneNumberId };
};
