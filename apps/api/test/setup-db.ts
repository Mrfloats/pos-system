import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

/**
 * Prepares the test database: applies migrations (as the owner role) and
 * empties every table. Tests then run the API as the restricted pos_app role,
 * exactly like production.
 */
export async function resetTestDatabase() {
  const ownerUrl =
    process.env.TEST_MIGRATION_DATABASE_URL ?? 'postgres://pos_owner:pos_owner@localhost:5432/pos_test';
  const pool = new Pool({ connectionString: ownerUrl });
  try {
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
    const { rows } = await pool.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public'`,
    );
    if (rows.length) {
      await pool.query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(', ')} cascade`);
    }
    // Put back the starting plans the migrations add (truncate removed them).
    const migration = readFileSync('./drizzle/0012_subscription_rules.sql', 'utf8');
    await pool.query(migration.slice(migration.indexOf('INSERT INTO plans')));
  } finally {
    await pool.end();
  }
}
