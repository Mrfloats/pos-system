import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Who is acting. Set on every authenticated request by the auth guard. */
export interface TenantContext {
  tenantId: string;
  userId?: string | null;
}

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  readonly pool: Pool;
  /**
   * Raw handle. Only use it for global tables (users) or health checks —
   * tenant tables return nothing here because no tenant is set.
   */
  readonly db: Db;

  constructor(config: ConfigService) {
    this.pool = new Pool({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
      max: Number(config.get('DATABASE_POOL_SIZE') ?? 10),
    });
    this.db = drizzle(this.pool, { schema });
  }

  /**
   * Runs `fn` in a transaction scoped to one tenant. Postgres row-level
   * security then hides every other tenant's rows, even if a query forgets a
   * `WHERE tenant_id = …`.
   */
  withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.tenant_id', ${ctx.tenantId}, true), set_config('app.user_id', ${ctx.userId ?? ''}, true)`,
      );
      return fn(tx);
    });
  }

  /** Transaction with only the user set: lets a user read their own memberships across tenants. */
  withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
      return fn(tx);
    });
  }

  /**
   * Refuses to start when DATABASE_URL is a role that row-level security doesn't apply to
   * (a superuser, a BYPASSRLS role or the tables' owner), e.g. a hosting provider's default
   * connection string pasted in place of the restricted pos_app one.
   */
  async onModuleInit() {
    const { rows } = await this.pool.query<{ role: string; bypasses: boolean }>(
      `SELECT current_user AS role,
              r.rolsuper OR r.rolbypassrls OR coalesce(pg_has_role(t.tableowner, 'MEMBER'), false) AS bypasses
         FROM pg_roles r LEFT JOIN pg_tables t ON t.schemaname = 'public' AND t.tablename = 'tenants'
        WHERE r.rolname = current_user`,
    );
    if (rows[0]?.bypasses) {
      throw new Error(
        `DATABASE_URL connects as "${rows[0].role}", which is not subject to row-level security. Use the restricted pos_app role (MIGRATION_DATABASE_URL is for the owner).`,
      );
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
