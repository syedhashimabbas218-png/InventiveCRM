import pg from 'pg';

export type Database = pg.Pool;
export type TenantClient = pg.PoolClient & { readonly tenantId: string };

// pg emits 'error' when the server drops an idle pooled connection (restart, failover); unhandled, that kills the process.
export const createDatabase = (
  connectionString: string,
  onIdleClientError: (error: Error) => void = (error) => console.error('idle database connection lost', error.message),
): Database => {
  const pool = new pg.Pool({ connectionString, max: 10 });
  pool.on('error', onIdleClientError);
  return pool;
};

// Every tenant-scoped query runs inside this transaction so RLS sees app.tenant_id.
// Queries must still filter on tenant_id explicitly; RLS is the second line of defence.
export const withTenant = async <TResult>(
  database: Database,
  tenantId: string,
  work: (client: TenantClient) => Promise<TResult>,
): Promise<TResult> => {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await work(Object.assign(client, { tenantId }));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};
