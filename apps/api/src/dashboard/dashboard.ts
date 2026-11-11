import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { sql } from 'drizzle-orm';
import { fromCents, toCents } from '../accounting/money.js';
import { type AuthContext, Ctx, MANAGERS, Roles } from '../common/auth-context.js';
import { assertOwned } from '../common/ownership.js';
import { Can } from '../common/permissions.js';
import { DbService } from '../db/db.service.js';
import { stores, tenants } from '../db/schema.js';

export class DashboardQuery {
  /** Leave out for every store together. */
  @IsOptional() @IsUUID() storeId?: string;
}

const money = (v: unknown) => fromCents(toCents(String(v ?? '0')));
/** Change from `before` to `now` as a percentage, or null when there is nothing to compare with. */
const change = (now: bigint, before: bigint) => (before === 0n ? null : Number(((now - before) * 1000n) / before) / 10);

/**
 * The owner's view of today, in one call for the phone app: takings, number of
 * sales and the average basket, how that compares with yesterday and the same
 * day last week, the last eight days, today's best sellers and what is running
 * low. Money is in the base currency, VAT included, returns taken off.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly dbs: DbService) {}

  summary(ctx: AuthContext, q: DashboardQuery) {
    return this.dbs.withTenant(ctx, async (tx) => {
      if (q.storeId) await assertOwned(tx, stores, [q.storeId], 'store');
      const [t] = await tx.select({ tz: tenants.timezone, currency: tenants.baseCurrency }).from(tenants).limit(1);
      const tz = t?.tz ?? 'UTC';
      const inStore = q.storeId ? sql`AND s.store_id = ${q.storeId}` : sql``;
      const day = sql`(s.sold_at AT TIME ZONE ${tz})::date`;
      const today = sql`(now() AT TIME ZONE ${tz})::date`;
      const sign = sql`CASE WHEN s.type = 'return' THEN -1 ELSE 1 END`;
      const counted = sql`s.status = 'completed' AND s.type IN ('sale', 'return') ${inStore}`;

      const days = await tx.execute(sql`
        SELECT d::date::text AS day,
               count(s.id) FILTER (WHERE s.type = 'sale')::int AS sales,
               count(s.id) FILTER (WHERE s.type = 'return')::int AS returns,
               coalesce(sum(${sign} * s.total_base), 0)::text AS gross,
               coalesce(sum(s.total_base) FILTER (WHERE s.type = 'sale'), 0)::text AS sold
        FROM generate_series(${today} - 7, ${today}, interval '1 day') d
        LEFT JOIN sales s ON ${day} = d::date AND ${counted}
        GROUP BY d ORDER BY d`);
      const trend = (days.rows as any[]).map((r) => ({ day: r.day as string, sales: r.sales as number, returns: r.returns as number, gross: money(r.gross), sold: toCents(String(r.sold)) }));
      const now = trend[trend.length - 1];
      const yesterday = trend[trend.length - 2];
      const lastWeek = trend[0];
      const cents = (d: { gross: string }) => toCents(d.gross);

      const top = await tx.execute(sql`
        SELECT l.variant_id,
               max(l.product_name) || CASE WHEN max(l.variant_name) <> 'Default' THEN ' · ' || max(l.variant_name) ELSE '' END AS name,
               sum(${sign} * l.quantity * l.units_per_pack)::text AS quantity,
               sum(${sign} * (l.net_base + l.tax_base))::text AS revenue
        FROM sale_lines l JOIN sales s ON s.id = l.sale_id
        WHERE ${counted} AND ${day} = ${today}
        GROUP BY l.variant_id
        HAVING sum(${sign} * l.quantity * l.units_per_pack) > 0
        ORDER BY sum(${sign} * (l.net_base + l.tax_base)) DESC, 2
        LIMIT 5`);

      // A refund's payment is already stored as money going out.
      const methods = await tx.execute(sql`
        SELECT p.method, sum(p.amount_base)::text AS amount
        FROM sale_payments p JOIN sales s ON s.id = p.sale_id
        WHERE ${counted} AND ${day} = ${today}
        GROUP BY p.method ORDER BY sum(p.amount_base) DESC`);

      // At or below the reorder level: in the chosen store, or in all stores added together.
      const low = await tx.execute(sql`
        WITH levels AS (
          SELECT v.id AS variant_id, p.name || CASE WHEN v.name <> 'Default' THEN ' · ' || v.name ELSE '' END AS name,
                 v.reorder_level, coalesce(sum(m.quantity), 0) AS on_hand
          FROM product_variants v
          JOIN products p ON p.id = v.product_id
          LEFT JOIN stock_movements m ON m.variant_id = v.id ${q.storeId ? sql`AND m.store_id = ${q.storeId}` : sql``}
          WHERE p.track_stock AND p.active AND v.active AND v.reorder_level IS NOT NULL
          GROUP BY v.id, p.id
        )
        SELECT variant_id, name, reorder_level::text, on_hand::text, count(*) OVER ()::int AS total
        FROM levels WHERE on_hand <= reorder_level
        ORDER BY on_hand - reorder_level, name
        LIMIT 5`);

      const [{ waiting }] = (
        await tx.execute(sql`SELECT count(*)::int AS waiting FROM sale_requests WHERE status = 'pending' ${q.storeId ? sql`AND store_id = ${q.storeId}` : sql``}`)
      ).rows as { waiting: number }[];

      return {
        date: now.day,
        /** Refund and void requests waiting for someone to decide. */
        pendingRequests: waiting,
        currencyCode: t?.currency ?? 'USD',
        storeId: q.storeId ?? null,
        today: {
          gross: now.gross,
          sales: now.sales,
          returns: now.returns,
          /** What a sale came to on average (returns left out). */
          averageBasket: now.sales ? fromCents(now.sold / BigInt(now.sales)) : '0.00',
        },
        yesterday: { gross: yesterday.gross, sales: yesterday.sales, changePercent: change(cents(now), cents(yesterday)) },
        lastWeek: { day: lastWeek.day, gross: lastWeek.gross, sales: lastWeek.sales, changePercent: change(cents(now), cents(lastWeek)) },
        trend: trend.map(({ sold: _sold, ...d }) => d),
        topProducts: (top.rows as any[]).map((r) => ({ variantId: r.variant_id, name: r.name, quantity: Number(r.quantity).toFixed(3), revenue: money(r.revenue) })),
        paymentMethods: (methods.rows as any[]).map((r) => ({ method: r.method, amount: money(r.amount) })),
        lowStock: {
          total: ((low.rows[0] as any)?.total as number | undefined) ?? 0,
          items: (low.rows as any[]).map((r) => ({ variantId: r.variant_id, name: r.name, onHand: r.on_hand, reorderLevel: r.reorder_level })),
        },
      };
    });
  }
}

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}

  @Roles(...MANAGERS)
  @Can('dashboard.view')
  @Get()
  summary(@Ctx() ctx: AuthContext, @Query() q: DashboardQuery) {
    return this.svc.summary(ctx, q);
  }
}

@Module({ controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
