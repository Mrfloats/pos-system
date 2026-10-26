import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// Migrations run as the table owner (pos_owner), not as the API's runtime role.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.MIGRATION_DATABASE_URL ?? 'postgres://pos_owner:pos_owner@localhost:5432/pos',
  },
  entities: { roles: { provider: '', exclude: [] } },
  strict: true,
  verbose: true,
});
