/**
 * Prepares a hosted PostgreSQL database (Neon, Supabase, RDS…) for Floatly, once:
 * creates the restricted pos_app role the API runs as and prints the connection strings to use.
 *
 *   MIGRATION_DATABASE_URL="postgres://owner:…@host/db" node dist/db/setup-hosted.js
 *
 * MIGRATION_DATABASE_URL is the provider's own (owner) connection string. Hosted databases
 * don't run docker/postgres/init*.sql, so this does its job: the provider's owner role plays
 * pos_owner (owns the tables, runs migrations) and pos_app is created here. If pos_app already
 * exists its password is left alone unless POS_APP_PASSWORD is set.
 */
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';

/** Neon's pooled address is the same host with "-pooler" after the endpoint id. */
function pooledHost(host: string) {
  return /^ep-[^.]+\.[^.]+.*\.neon\.tech$/.test(host) && !host.split('.')[0].endsWith('-pooler')
    ? host.replace('.', '-pooler.')
    : host;
}

/** CREATE/ALTER ROLE can't take $1 parameters. */
const literal = (s: string) => `'${s.replaceAll("'", "''")}'`;

async function main() {
  const ownerUrl = process.env.MIGRATION_DATABASE_URL;
  if (!ownerUrl) throw new Error('MIGRATION_DATABASE_URL is not set');
  const pool = new Pool({ connectionString: ownerUrl, max: 1 });
  try {
    const { rows: me } = await pool.query<{ db: string; owner: string }>('SELECT current_database() AS db, current_user AS owner');
    const { rowCount } = await pool.query("SELECT 1 FROM pg_roles WHERE rolname = 'pos_app'");
    let password = process.env.POS_APP_PASSWORD;
    if (!rowCount) {
      password ??= randomBytes(24).toString('hex');
      await pool.query(`CREATE ROLE pos_app LOGIN PASSWORD ${literal(password)}`);
      console.log('Created the pos_app role.');
    } else if (password) {
      await pool.query(`ALTER ROLE pos_app PASSWORD ${literal(password)}`);
      console.log('pos_app already existed; its password was changed.');
    } else {
      console.log('pos_app already exists; its password was left as it is (set POS_APP_PASSWORD to change it).');
    }
    await pool.query(`GRANT CONNECT ON DATABASE "${me[0].db}" TO pos_app`);

    const appUrl = new URL(ownerUrl);
    appUrl.username = 'pos_app';
    appUrl.password = password ?? 'THE_POS_APP_PASSWORD';
    appUrl.hostname = pooledHost(appUrl.hostname);
    const directUrl = new URL(ownerUrl);
    directUrl.hostname = directUrl.hostname.replace('-pooler.', '.');
    console.log(`\nTables will belong to "${me[0].owner}". Use these settings:\n`);
    console.log(`DATABASE_URL=${appUrl}`);
    console.log(`MIGRATION_DATABASE_URL=${directUrl}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
