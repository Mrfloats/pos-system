/**
 * Applies database migrations (drizzle/*.sql) as the table owner.
 *
 *   node dist/db/migrate.js        (production: run before the API starts)
 *
 * Uses MIGRATION_DATABASE_URL. Safe to run on every start: migrations that are
 * already applied are skipped, and API copies starting together wait for each
 * other (an advisory lock; it is released when the connection closes).
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL is not set');
  // One connection, holding a lock: when several API copies start together, they take turns.
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query('SELECT pg_advisory_lock(hashtext($1))', ['floatly:migrations']);
    await migrate(drizzle(pool), { migrationsFolder: process.env.MIGRATIONS_DIR ?? './drizzle' });
    console.log('Database is up to date.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migrations failed:', err);
  process.exit(1);
});
