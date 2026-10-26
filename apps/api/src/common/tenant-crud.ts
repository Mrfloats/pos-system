import { and, asc, eq, ilike, or, SQL, sql } from 'drizzle-orm';
import { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import { DbService, Tx } from '../db/db.service.js';
import { AuditService } from './audit.service.js';
import { type AuthContext } from './auth-context.js';
import { found, likeEscape } from './validation.js';

type TenantTable = PgTable & { id: AnyPgColumn; tenantId: AnyPgColumn };

interface Options {
  /** Name used in audit logs and "not found" messages. */
  entity: string;
  /** Columns searched by ?search= */
  searchColumns?: AnyPgColumn[];
  orderBy?: AnyPgColumn[];
}

/**
 * Create / read / update / delete for simple tenant-owned tables (stores,
 * categories, tax rates…). Every call runs inside DbService.withTenant, so
 * row-level security guarantees it only ever touches the caller's tenant.
 */
export class TenantCrud<T extends TenantTable> {
  constructor(
    protected readonly dbs: DbService,
    protected readonly audit: AuditService,
    protected readonly table: T,
    protected readonly opts: Options,
  ) {}

  list(ctx: AuthContext, filters: { search?: string; where?: SQL[] } = {}): Promise<T['$inferSelect'][]> {
    const conditions: (SQL | undefined)[] = [...(filters.where ?? [])];
    if (filters.search && this.opts.searchColumns?.length) {
      const pattern = likeEscape(filters.search);
      conditions.push(or(...this.opts.searchColumns.map((c) => ilike(c, pattern))));
    }
    const orderBy = (this.opts.orderBy ?? []).map((c) => asc(c));
    return this.dbs.withTenant(ctx, (tx) =>
      (tx.select().from(this.table as PgTable) as any)
        .where(conditions.length ? and(...conditions) : sql`true`)
        .orderBy(...orderBy),
    );
  }

  async get(ctx: AuthContext, id: string): Promise<T['$inferSelect']> {
    return this.dbs.withTenant(ctx, (tx) => this.getIn(tx, id));
  }

  async getIn(tx: Tx, id: string): Promise<T['$inferSelect']> {
    const rows = await (tx.select().from(this.table as PgTable) as any)
      .where(eq(this.table.id, id))
      .limit(1);
    return found(rows[0], this.opts.entity);
  }

  create(ctx: AuthContext, data: Partial<T['$inferInsert']>): Promise<T['$inferSelect']> {
    return this.dbs.withTenant(ctx, async (tx) => {
      const [row] = await (tx.insert(this.table) as any)
        .values({ ...data, tenantId: ctx.tenantId })
        .returning();
      await this.audit.log(tx, ctx, 'create', this.opts.entity, row.id, data);
      return row;
    });
  }

  update(ctx: AuthContext, id: string, data: Partial<T['$inferInsert']>): Promise<T['$inferSelect']> {
    return this.dbs.withTenant(ctx, async (tx) => {
      const { tenantId: _ignored, id: _id, ...changes } = data as Record<string, unknown>;
      if (!Object.keys(changes).length) return this.getIn(tx, id);
      const rows = await (tx.update(this.table) as any)
        .set(changes)
        .where(eq(this.table.id, id))
        .returning();
      const row = found(rows[0], this.opts.entity);
      await this.audit.log(tx, ctx, 'update', this.opts.entity, id, changes);
      return row;
    });
  }

  remove(ctx: AuthContext, id: string): Promise<{ id: string }> {
    return this.dbs.withTenant(ctx, async (tx) => {
      const rows = await (tx.delete(this.table) as any)
        .where(eq(this.table.id, id))
        .returning({ id: this.table.id });
      found(rows[0], this.opts.entity);
      await this.audit.log(tx, ctx, 'delete', this.opts.entity, id);
      return { id };
    });
  }
}
