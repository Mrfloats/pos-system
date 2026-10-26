# Putting Floatly online

This runs all of Floatly on one Linux server with Docker: the website, the API, the database, automatic HTTPS and nightly backups. One command starts it; the same command updates it.

```
Internet ──HTTPS──▶ Caddy ──/api/*──▶ API (2+ copies) ──▶ PostgreSQL ◀── nightly backup
                         └─ everything else ─▶ Website
```

There are three ways to run it:

- **Option A — a rented server** (steps 1–7 below): always on, the long-term home.
- **Option B — this computer, through a Cloudflare Tunnel** (free; see below): good for starting out with your first few businesses.
- **Option C — Vercel and Neon** (see the end of this guide): no server to look after; the website and API run on Vercel and the database on Neon.

# Option A: a rented server

## 1. Get a server

Any provider with Ubuntu 24.04 works. A good start for a few dozen businesses:

| Provider | Plan | About |
| --- | --- | --- |
| Hetzner Cloud | CX32 (4 CPU, 8 GB) | €7 / month |
| DigitalOcean | Basic 4 GB / 2 CPU | $24 / month |
| Contabo | Cloud VPS 10 | €5 / month |

Pick a data centre close to your customers (Johannesburg and Frankfurt are closest to Zimbabwe on most providers). Add your SSH key when you create it.

## 2. Point your domain at it

In your domain's DNS settings add an **A record**:

| Name | Type | Value |
| --- | --- | --- |
| `@` (or `app` for app.yourdomain.com) | A | your server's IP address |

Wait until `ping yourdomain.com` shows the server's IP (minutes to a few hours). Caddy needs this to get the HTTPS certificate.

## 3. Install Docker on the server

```bash
ssh root@YOUR_SERVER_IP
curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

## 4. Copy Floatly to the server

From this computer, in the project folder (PowerShell):

```powershell
scp -r apps docker docker-compose.prod.yml package.json package-lock.json .dockerignore .env.production.example root@YOUR_SERVER_IP:/opt/floatly/
```

(Better long-term: put the project in a private GitHub repository and `git clone` it on the server, so updates are a `git pull`.)

## 5. Fill in the settings

On the server:

```bash
cd /opt/floatly
cp .env.production.example .env.production
openssl rand -hex 24   # run 3 times: one for each password
openssl rand -hex 32   # once more: the JWT_SECRET
nano .env.production
```

Set `DOMAIN` to your domain (no `https://`), paste the generated values, save. Keep a copy of this file somewhere safe: without the passwords you can't read the backups.

## 6. Start it

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

The first build takes a few minutes. The API sets up the database by itself. Then open `https://yourdomain.com` — you should see the sign-in page with a padlock.

## 7. Create your Floatly admin login

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec api \
  node dist/db/platform-admin.js you@yourdomain.com "a-long-password" "Your Name"
```

Sign in at `https://yourdomain.com/platform/login`. Set your plan prices under **Plans** before telling anyone to sign up.

## Everyday tasks

All from `/opt/floatly` on the server. To save typing, `alias fl='docker compose -f docker-compose.prod.yml --env-file .env.production'`.

| Task | Command |
| --- | --- |
| See what's running | `fl ps` |
| Follow the logs | `fl logs -f api` (or `web`, `caddy`) |
| Update to a new version | copy the new files (or `git pull`), then `fl up -d --build` |
| Restart | `fl restart` |
| List backups | `fl exec backup ls -lh /backups` |
| Copy a backup to this computer | `docker cp $(fl ps -q backup):/backups/FILE.sql.gz .` then `scp` it down |
| Restore a backup | `gunzip -c FILE.sql.gz \| fl exec -T postgres psql -U postgres -d pos` (into an empty database) |

Backups run every night and are kept for 14 days on the same server. **Copy them somewhere else regularly** (your computer, Google Drive, an S3 bucket): if the server is lost, so are backups kept only on it.

## Handling more businesses

- **More API copies:** set `API_REPLICAS` in `.env.production` to about one per CPU core, then `fl up -d`. Caddy shares requests between them automatically.
- **A bigger server:** most providers resize in a few clicks; then raise `API_REPLICAS`.
- **Busy shops:** all tills in one shop share an internet address. `RATE_LIMIT` (default 1200 requests a minute per address) protects the server; raise it if a large shop is ever refused. Till PIN sign-ins have their own limit, `TILL_RATE_LIMIT` (default 30 a minute per address).
- Measured on a laptop (Docker Desktop, 4 API copies): 2,000 requests from 100 simultaneous clients, all successful, about 190 a second — enough for several hundred busy tills. A Linux server does better.
- Much later: move the database to a managed PostgreSQL service and run the API on two servers behind a load balancer. Nothing in the code needs to change for that.

## Security checklist

- [ ] Every password in `.env.production` is long and random, and the file is not in Git.
- [ ] `API_DOCS=false` (the default) so the API's documentation isn't public.
- [ ] Only ports 22, 80 and 443 are open (`ufw status`). The database has no public port.
- [ ] Backups are copied off the server.
- [ ] Confirm tax rates with ZIMRA before businesses rely on the VAT reports.

# Option B: this computer, through a Cloudflare Tunnel (free)

Floatly runs on this Windows computer in Docker; Cloudflare connects your domain to it from the outside and provides HTTPS. No router changes, no fixed IP, no cost.

**While this computer is off, asleep or offline, Floatly is offline for every business.** Use it to start; move to Option A before shops depend on it daily. Moving is one backup file.

## B0. No domain yet? Start free right now

No domain and no Cloudflare account needed. In the project folder (PowerShell or Command Prompt):

```
.\floatly.cmd start
```

The first start builds everything (a few minutes) and ends with:

```
Floatly is online at:  https://some-random-words.trycloudflare.com
```

Open that address on any phone or computer. Create your admin login and sign in at that address + `/platform/login`:

```
.\floatly.cmd admin you@example.com a-long-password "Your Name"
```

**The free address changes every time Floatly restarts** (computer restart, `floatly stop`/`start`, Docker restart). Run `.\floatly.cmd address` to see the current one, and send it to your businesses again. Cloudflare provides these addresses for testing, with no promise they stay up. When you're ready for a fixed address, get a domain (below) — your data stays; only the address changes.

## Getting a domain

A domain costs roughly US$10 a year for `.com` (check current prices):

- **Cloudflare Registrar** — sells domains at cost, and the domain is on Cloudflare straight away, so you can skip step B1. In the Cloudflare dashboard: **Domain Registration → Register Domains**, search for a name (e.g. `floatlyapp.com`), pay by card.
- **A `.co.zw` domain** — from a Zimbabwean registrar (ask your internet provider, or search "co.zw domain registration"). Then do step B1 to move it onto Cloudflare.

Then follow B1–B4 to switch from the free address to your domain.

## B1. Put your domain on Cloudflare (once)

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up).
2. **Add a domain** → type your domain → choose the **Free** plan.
3. Cloudflare shows two **nameservers**. At the company you bought the domain from, replace its nameservers with those two. (For a `.co.zw` domain, ask your registrar to change them.)
4. Wait for Cloudflare's email saying the domain is active (usually under an hour, sometimes up to a day).

## B2. Create the tunnel (once)

1. In Cloudflare: **Zero Trust** (left menu) → **Networks** → **Tunnels** → **Create a tunnel** → **Cloudflared** → name it `floatly`.
2. On the "Install connector" page choose **Docker**. Copy the long token after `--token` (starts with `eyJ`). You don't need to run the command shown.
3. **Next** → add a **Public hostname**:
   - Subdomain: empty (or `app`), Domain: your domain
   - Service: **HTTP** → `caddy:80`
4. Save.

## B3. Fill in the settings

`.env.production` in the project folder already has strong passwords. Open it in Notepad and fill in the two empty lines:

```
DOMAIN=yourdomain.com          (or app.yourdomain.com, matching step B2)
TUNNEL_TOKEN=eyJ...            (the token from step B2)
```

## B4. Start it

In the project folder (PowerShell or Command Prompt):

```
.\floatly.cmd start
```

The first start builds everything (a few minutes). Then open `https://yourdomain.com` from any device. Create your admin login:

```
.\floatly.cmd admin you@yourdomain.com a-long-password "Your Name"
```

and sign in at `https://yourdomain.com/platform/login`.

| Task | Command |
| --- | --- |
| Stop / start | `.\floatly.cmd stop` / `.\floatly.cmd start` |
| See what's running | `.\floatly.cmd status` |
| Logs | `.\floatly.cmd logs` (or `logs cloudflared`, `logs api`) |
| Backups | `.\floatly.cmd backups` |
| After changing the code | `.\floatly.cmd start` (rebuilds) |

This online copy has its **own database**, separate from the demo one you use for development (`npm run dev:api` / `dev:web` keep working alongside it).

## B5. Keep this computer serving

- **Docker Desktop → Settings → General → "Start Docker Desktop when you sign in"**: on. Floatly's containers restart by themselves when Docker starts.
- **Never sleep while plugged in:** Settings → System → Power → Screen and sleep → "When plugged in, put my device to sleep after" → **Never** (or run `powercfg /change standby-timeout-ac 0`).
- **Power cuts:** a UPS or inverter for the computer *and* the router.
- **Windows updates** restart the computer: set active hours so restarts happen at night.
- **Copy backups off this computer** (`.\floatly.cmd backups`, then `docker cp`): if the laptop is lost or broken, its data goes with it.

# Option C: Vercel and Neon

```
Browser ──▶ Vercel: website (floatly-web)
        └─▶ Vercel: API (floatly-api, one function) ──▶ Neon: PostgreSQL
```

Vercel runs the website and the API (as a serverless function, Frankfurt region); Neon runs the database (Frankfurt). Nothing runs on this computer, and there is nothing to keep switched on.

**Know before you start:**

- **Vercel's free Hobby plan is for personal, non-commercial use only.** Testing is fine on it; once businesses pay you for Floatly, Vercel requires the **Pro** plan (US$20 a month per team member; check vercel.com/pricing).
- **Neon's free plan** has a small storage and compute allowance and pauses the database after a few idle minutes; the first request after a pause takes a second or two longer. Check neon.tech/pricing for current limits.
- The API starts afresh after it has been idle, so the first request after a quiet spell is slower (a few seconds). Busy periods are not affected.
- `.vercel.app` addresses are fixed: they don't change when you redeploy. You can add your own domain later in each Vercel project's **Settings → Domains**.

## C1. Accounts (once)

1. **Neon:** sign up at [neon.tech](https://neon.tech) → **Create project** → name `floatly`, region **AWS Europe Central 1 (Frankfurt)**. On the project dashboard click **Connect**, switch **Connection pooling** off, and copy the connection string (`postgresql://neondb_owner:…@ep-….neon.tech/neondb?sslmode=require…`).
2. **Vercel:** sign up at [vercel.com](https://vercel.com/signup) (Hobby), then on this computer: `npx vercel login`.

Don't use the "Neon" button in Vercel's Storage tab for this: it would set `DATABASE_URL` to the owner login, which the API refuses (it must be the restricted `pos_app` role, see below).

## C2. Prepare the database (once)

In the project folder (PowerShell), with the Neon connection string:

```powershell
npm.cmd run build -w apps/api
$env:MIGRATION_DATABASE_URL = "postgresql://neondb_owner:...neon.tech/neondb?sslmode=require"
node apps/api/dist/db/setup-hosted.js      # creates pos_app; prints DATABASE_URL and MIGRATION_DATABASE_URL
node apps/api/dist/db/migrate.js           # creates the tables
node apps/api/dist/db/platform-admin.js you@example.com "a-long-password" "Your Name"
```

Keep the two printed lines: they hold the database passwords.

## C3. Create the two Vercel projects (once)

```powershell
npx vercel project create floatly-api
npx vercel project update floatly-api --root-directory apps/api --node-version 24.x --yes
npx vercel project create floatly-web
npx vercel project update floatly-web --root-directory apps/backoffice --framework nextjs --node-version 24.x --yes
```

Settings for each (Vercel dashboard → project → **Settings → Environment Variables**, Production):

| Project | Name | Value |
| --- | --- | --- |
| floatly-api | `DATABASE_URL` | from C2 (the `pos_app` one, with `-pooler` in the address) |
| floatly-api | `MIGRATION_DATABASE_URL` | from C2 (the owner one) |
| floatly-api | `JWT_SECRET` | a long random value (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) |
| floatly-api | `CORS_ORIGINS` | the website's address, e.g. `https://floatly-web.vercel.app` |
| floatly-api | `API_DOCS` | `false` |
| floatly-api | `RATE_LIMIT` | `1200` |
| floatly-web | `NEXT_PUBLIC_API_URL` | the API's address + `/api/v1`, e.g. `https://floatly-api.vercel.app/api/v1` |

Then create `.env.vercel` in the project folder (it is never uploaded) with the ids from each project's **Settings → General** and your team id from **Team Settings**:

```
VERCEL_ORG_ID=team_...
API_PROJECT_ID=prj_...
WEB_PROJECT_ID=prj_...
MIGRATION_DATABASE_URL=postgresql://neondb_owner:...
```

## C4. Put it online

```
.\floatly-cloud.cmd deploy
```

The API's build also applies any new database migrations. Open the website's address; sign in to the console at that address + `/platform/login`.

| Task | Command |
| --- | --- |
| After changing the code | `.\floatly-cloud.cmd deploy` (or `deploy api` / `deploy web`) |
| Add a Floatly admin | `.\floatly-cloud.cmd admin you@example.com "a-long-password" "Your Name"` |
| Logs | Vercel dashboard → project → **Logs** |
| Backups | Neon keeps a restore history (short on the free plan): Neon dashboard → **Backup & Restore**. For a copy of your own: `pg_dump` with the owner connection string. |

If the website shows "Failed to fetch", `CORS_ORIGINS` on floatly-api doesn't match the website's address exactly (no `/` at the end); fix it and run `.\floatly-cloud.cmd deploy api`.
