/**
 * Gives someone access to the platform console (every business on Floatly).
 *
 *   npm run platform:admin -w apps/api -- you@example.com "a long password" "Your Name"
 *   npm run platform:admin -w apps/api -- you@example.com --revoke
 *
 * An existing login keeps its password and businesses (a name, if given, is
 * updated); a new email gets a login with the password given. Runs as the database owner role
 * (MIGRATION_DATABASE_URL), because the API's own role is not allowed to grant
 * platform access.
 */
import { hash } from '@node-rs/argon2';
import { Pool } from 'pg';
import { v7 as uuidv7 } from 'uuid';

async function main() {
  const [emailArg, second, name] = process.argv.slice(2);
  if (!emailArg) {
    console.error('Usage: npm run platform:admin -w apps/api -- <email> [password] [full name]   (or <email> --revoke)');
    process.exit(1);
  }
  const email = emailArg.trim().toLowerCase();
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL is not set');
  const pool = new Pool({ connectionString: url });
  try {
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
    if (second === '--revoke') {
      if (!rows[0]) throw new Error(`No login for ${email}`);
      await pool.query('UPDATE users SET is_platform_admin = false, updated_at = now() WHERE id = $1', [rows[0].id]);
      console.log(`Platform access removed from ${email}`);
      return;
    }
    if (rows[0]) {
      await pool.query('UPDATE users SET is_platform_admin = true, full_name = coalesce($2, full_name), updated_at = now() WHERE id = $1', [rows[0].id, name?.trim() || null]);
      console.log(`${email} can now sign in to the platform console with their existing password.`);
    } else {
      if (!second || second.length < 8) throw new Error('A new login needs a password of at least 8 characters');
      await pool.query(
        'INSERT INTO users (id, email, password_hash, full_name, is_platform_admin) VALUES ($1, $2, $3, $4, true)',
        [uuidv7(), email, await hash(second), name?.trim() || 'Floatly admin'],
      );
      console.log(`Created platform login ${email}.`);
    }
    console.log('Sign in at <your site>/platform/login (http://localhost:3000 on this computer).');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
