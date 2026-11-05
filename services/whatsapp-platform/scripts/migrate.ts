import { runMigrations } from '../src/db/migrate.ts';

const connectionString = process.env.DATABASE_OWNER_URL;
if (!connectionString) {
  console.error('DATABASE_OWNER_URL is not set');
  process.exit(1);
}

const applied = await runMigrations(connectionString);
console.log(applied.length ? `applied: ${applied.join(', ')}` : 'nothing to apply');
