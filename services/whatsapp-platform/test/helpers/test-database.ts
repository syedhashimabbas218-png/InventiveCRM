import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../src/db/migrate.ts';
import { createDatabase, type Database } from '../../src/db/pool.ts';

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://wa_owner:wa_owner@localhost:5432/postgres';
const APP_ROLE_PASSWORD = 'wa_app_test';
const ROLE_SETUP_LOCK = 724_001;

export type TestDatabase = {
  name: string;
  ownerUrl: string;
  app: Database;
  owner: Database;
  drop: () => Promise<void>;
};

const withUrlDatabase = (url: string, databaseName: string, user?: string, password?: string): string => {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  if (user) parsed.username = user;
  if (password) parsed.password = password;
  return parsed.toString();
};

// Roles are cluster-wide and test files run in parallel processes, so role setup is serialised.
const ensureAppRole = async (admin: pg.Client): Promise<void> => {
  await admin.query('SELECT pg_advisory_lock($1)', [ROLE_SETUP_LOCK]);
  try {
    const existing = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = 'wa_app'");
    if (!existing.rowCount) {
      await admin.query('CREATE ROLE wa_app NOLOGIN NOSUPERUSER NOBYPASSRLS');
    }
    await admin.query(`ALTER ROLE wa_app LOGIN PASSWORD '${APP_ROLE_PASSWORD}'`);
  } finally {
    await admin.query('SELECT pg_advisory_unlock($1)', [ROLE_SETUP_LOCK]);
  }
};

export const createTestDatabase = async (): Promise<TestDatabase> => {
  const name = `wa_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await ensureAppRole(admin);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }

  const ownerUrl = withUrlDatabase(ADMIN_URL, name);
  await runMigrations(ownerUrl);

  const app = createDatabase(withUrlDatabase(ADMIN_URL, name, 'wa_app', APP_ROLE_PASSWORD));
  const owner = createDatabase(ownerUrl);

  return {
    name,
    ownerUrl,
    app,
    owner,
    drop: async () => {
      await app.end();
      await owner.end();
      const cleanup = new pg.Client({ connectionString: ADMIN_URL });
      await cleanup.connect();
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await cleanup.end();
      }
    },
  };
};
