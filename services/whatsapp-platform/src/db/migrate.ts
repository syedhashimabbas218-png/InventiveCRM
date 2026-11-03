import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const MIGRATIONS_DIRECTORY = path.join(import.meta.dirname, '..', '..', 'migrations');

export const runMigrations = async (ownerConnectionString: string): Promise<string[]> => {
  const client = new pg.Client({ connectionString: ownerConnectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const files = (await readdir(MIGRATIONS_DIRECTORY)).filter((file) => file.endsWith('.sql')).sort();
    for (const file of files) {
      const already = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (already.rowCount) {
        continue;
      }
      const sql = await readFile(path.join(MIGRATIONS_DIRECTORY, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${(error as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
  return applied;
};
