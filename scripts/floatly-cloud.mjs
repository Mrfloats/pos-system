/**
 * Floatly on Vercel (website and API) with a Neon database. Settings come from .env.vercel
 * in the project folder (never uploaded or shared). See DEPLOY.md, option C.
 *
 *   floatly-cloud deploy           put the current code online (API first, then website)
 *   floatly-cloud deploy api|web   just one of them
 *   floatly-cloud admin EMAIL PASSWORD "Your Name"   create (or grant) a Floatly admin login
 *   floatly-cloud admin EMAIL --revoke               remove it
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const settingsFile = join(root, '.env.vercel');
if (!existsSync(settingsFile)) fail('.env.vercel is missing. See DEPLOY.md, option C.');
const settings = Object.fromEntries(
  readFileSync(settingsFile, 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function need(name) {
  if (!settings[name]) fail(`${name} is empty in .env.vercel.`);
  return settings[name];
}

function run(command, args, env = {}, shell = false) {
  const r = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell, env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function deploy(which) {
  const project = { api: 'API_PROJECT_ID', web: 'WEB_PROJECT_ID' }[which];
  console.log(`\n=== Putting the ${which === 'api' ? 'API' : 'website'} online ===`);
  // Run from the project folder: each Vercel project knows which app folder (Root Directory) to build.
  run('npx', ['--yes', 'vercel@65', 'deploy', '--prod', '--yes'], { VERCEL_ORG_ID: need('VERCEL_ORG_ID'), VERCEL_PROJECT_ID: need(project) }, true);
}

const [command, ...args] = process.argv.slice(2);
if (command === 'deploy') {
  const which = args[0] ?? 'all';
  if (!['all', 'api', 'web'].includes(which)) fail('Use: floatly-cloud deploy [api|web]');
  if (which !== 'web') deploy('api');
  if (which !== 'api') deploy('web');
} else if (command === 'admin') {
  if (!args[0]) fail('Use: floatly-cloud admin EMAIL PASSWORD "Your Name"   (or EMAIL --revoke)');
  run('npm', ['run', 'build', '-w', 'apps/api', '--silent'], {}, true);
  run(process.execPath, ['apps/api/dist/db/platform-admin.js', ...args], { MIGRATION_DATABASE_URL: need('MIGRATION_DATABASE_URL') });
} else {
  fail('Use: floatly-cloud deploy [api|web]  |  floatly-cloud admin EMAIL PASSWORD "Your Name"');
}
