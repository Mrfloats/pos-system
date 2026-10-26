# API

NestJS + PostgreSQL (Drizzle ORM). See the root README for setup.

| Command | What it does |
| --- | --- |
| `npm run start:dev` | Run with auto-reload on http://localhost:4000 |
| `npm run db:generate` | Create a migration from changes to `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations (as `pos_owner`) |
| `npm run db:seed` | Load demo businesses |
| `npm run test:e2e` | End-to-end tests against the `pos_test` database |
| `npm run typecheck` | TypeScript check |

Interactive API documentation is served at http://localhost:4000/api/docs.

Every request runs inside `DbService.withTenant()`, which sets `app.tenant_id` for the transaction so PostgreSQL row-level security only exposes that business's rows.
