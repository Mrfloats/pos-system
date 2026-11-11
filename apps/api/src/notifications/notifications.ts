import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { sql } from 'drizzle-orm';
import { fromCents, toCents } from '../accounting/money.js';
import { type AuthContext, Ctx, MANAGERS, Roles } from '../common/auth-context.js';
import { assertOwned } from '../common/ownership.js';
import { can, Can } from '../common/permissions.js';
import { DbService } from '../db/db.service.js';
import { stores, tenants } from '../db/schema.js';

export class NotificationQuery {
  /** Leave out for every store. */
  @IsOptional() @IsUUID() storeId?: string;
}

/** Where tapping a notification goes in the app. */
export interface NotificationLink {
  to: 'low_stock' | 'request' | 'sale' | 'daily_report';
  id?: string;
}

export interface Notification {
  /** Stable, so the app can tell which ones it has shown before. */
  id: string;
  kind: 'low_stock' | 'request' | 'large_refund' | 'void' | 'end_of_day';
  title: string;
  body: string;
  /** When it happened (or, for low stock, when the last of those items moved). */
  at: string;
  /** Worth a look soon: shown in the warning colour. */
  attention: boolean;
  link: NotificationLink;
}

/** Refunds over this many average sales are "large". */
const LARGE_REFUND_TIMES = 3;
/** How far back voids and large refunds are shown. */
const RECENT_DAYS = 7;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What an owner or manager should know about, worked out from the records each
 * time (nothing is stored): items running low, refund and void requests
 * waiting, large refunds and voids in the last week, and yesterday's takings.
 * The app polls it and remembers which ones it has shown.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly dbs: DbService) {}

  list(ctx: AuthContext, q: NotificationQuery) {
    return this.dbs.withTenant(ctx, async (tx) => {
      if (q.storeId) await assertOwned(tx, stores, [q.storeId], 'store');
      const [t] = await tx.select({ tz: tenants.timezone, currency: tenants.baseCurrency }).from(tenants).limit(1);
      const tz = t?.tz ?? 'UTC';
      const inStore = (col: string) => (q.storeId ? sql`AND ${sql.raw(col)} = ${q.storeId}` : sql``);
      const items: Notification[] = [];
      const money = (v: string) => `${t?.currency ?? ''} ${fromCents(toCents(v))}`.trim();

      // ----- Low stock, store by store (a shop running out matters even when the warehouse has plenty),
      // counting only stores that keep the item. One notification, naming the worst few.
      const low = await tx.execute(sql`
        WITH levels AS (
          SELECT v.id, st.name AS store_name, p.name || CASE WHEN v.name <> 'Default' THEN ' · ' || v.name ELSE '' END AS name,
                 v.reorder_level, sum(m.quantity) AS on_hand, max(m.created_at) AS moved_at
          FROM product_variants v
          JOIN products p ON p.id = v.product_id
          JOIN stock_movements m ON m.variant_id = v.id
          JOIN stores st ON st.id = m.store_id AND st.active
          WHERE p.track_stock AND p.active AND v.active AND v.reorder_level IS NOT NULL ${inStore('st.id')}
          GROUP BY v.id, p.id, st.id
        )
        SELECT name, store_name, count(*) OVER ()::int AS total, max(moved_at) OVER () AS latest
        FROM levels WHERE on_hand <= reorder_level
        ORDER BY on_hand - reorder_level, name LIMIT 3`);
      const lowRows = low.rows as { name: string; store_name: string; total: number; latest: Date | string | null }[];
      if (lowRows.length) {
        const total = lowRows[0].total;
        const names = lowRows.map((r) => (q.storeId ? r.name : `${r.name} at ${r.store_name}`)).join(', ');
        items.push({
          // Changes when the number of items does, so a new one shows as new.
          id: `low-stock-${q.storeId ?? 'all'}-${total}`,
          kind: 'low_stock',
          title: `${plural(total, 'item')} running low`,
          body: total > lowRows.length ? `${names} and ${total - lowRows.length} more` : names,
          at: new Date(lowRows[0].latest ?? Date.now()).toISOString(),
          attention: true,
          link: { to: 'low_stock' },
        });
      }

      // ----- Refund and void requests waiting (for those who decide them).
      if (can(ctx, 'returns.approve')) {
        const waiting = await tx.execute(sql`
          SELECT r.id, r.kind, r.amount::text AS amount, r.currency_code, r.reason, r.created_at, s.number, u.full_name
          FROM sale_requests r JOIN sales s ON s.id = r.sale_id LEFT JOIN users u ON u.id = r.requested_by
          WHERE r.status = 'pending' ${inStore('r.store_id')}
          ORDER BY r.created_at DESC LIMIT 20`);
        for (const r of waiting.rows as any[]) {
          items.push({
            id: `request-${r.id}`,
            kind: 'request',
            title: `${r.full_name ?? 'A cashier'} asks to ${r.kind === 'refund' ? `refund ${r.currency_code} ${r.amount}` : 'void'} on ${r.number}`,
            body: `"${r.reason}"`,
            at: new Date(r.created_at).toISOString(),
            attention: true,
            link: { to: 'request', id: r.id },
          });
        }
      }

      // ----- Large refunds: more than a few average sales.
      const large = await tx.execute(sql`
        WITH avg_sale AS (
          SELECT avg(total_base) AS v FROM sales
          WHERE type = 'sale' AND status = 'completed' AND sold_at > now() - interval '30 days' ${inStore('store_id')}
        )
        SELECT s.id, s.number, s.total_base::text AS total, s.note, s.sold_at, u.full_name, st.name AS store_name, o.number AS original
        FROM sales s
        JOIN stores st ON st.id = s.store_id
        LEFT JOIN users u ON u.id = s.salesperson_id
        LEFT JOIN sales o ON o.id = s.original_sale_id, avg_sale
        WHERE s.type = 'return' AND s.status = 'completed' AND s.sold_at > now() - make_interval(days => ${RECENT_DAYS})
          AND avg_sale.v > 0 AND s.total_base >= avg_sale.v * ${LARGE_REFUND_TIMES} ${inStore('s.store_id')}
        ORDER BY s.sold_at DESC LIMIT 20`);
      for (const r of large.rows as any[]) {
        items.push({
          id: `refund-${r.id}`,
          kind: 'large_refund',
          title: `Large refund: ${money(r.total)} on ${r.original ?? 'a sale'}`,
          body: `${r.full_name ?? 'Someone'} at ${r.store_name}${r.note ? `: "${r.note}"` : ''}`,
          at: new Date(r.sold_at).toISOString(),
          attention: true,
          link: { to: 'sale', id: r.id },
        });
      }

      // ----- Voids, from the audit trail (it says who).
      const voids = await tx.execute(sql`
        SELECT a.id, a.entity, a.entity_id, a.created_at, a.data->>'number' AS number, a.data->>'total' AS total, u.full_name
        FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.action = 'void' AND a.entity IN ('Sale', 'Sale return') AND a.created_at > now() - make_interval(days => ${RECENT_DAYS})
          ${inStore('a.store_id')}
        ORDER BY a.created_at DESC LIMIT 20`);
      for (const r of voids.rows as any[]) {
        items.push({
          id: `void-${r.id}`,
          kind: 'void',
          title: `${r.entity === 'Sale' ? 'Sale' : 'Refund'} ${r.number ?? ''} voided`.replace('  ', ' '),
          body: `By ${r.full_name ?? 'someone'}${r.total ? ` · ${money(r.total)}` : ''}`,
          at: new Date(r.created_at).toISOString(),
          attention: false,
          link: { to: 'sale', id: r.entity_id },
        });
      }

      // ----- Yesterday's takings, ready first thing in the morning.
      const eod = await tx.execute(sql`
        WITH days AS (
          SELECT (now() AT TIME ZONE ${tz})::date - 1 AS yesterday, (now() AT TIME ZONE ${tz})::date - 8 AS week_before
        )
        SELECT days.yesterday::text AS day,
               ((date_trunc('day', now() AT TIME ZONE ${tz})) AT TIME ZONE ${tz}) AS morning,
               count(s.id) FILTER (WHERE s.type = 'sale' AND (s.sold_at AT TIME ZONE ${tz})::date = days.yesterday)::int AS sales,
               coalesce(sum(CASE WHEN s.type = 'return' THEN -s.total_base ELSE s.total_base END) FILTER (WHERE (s.sold_at AT TIME ZONE ${tz})::date = days.yesterday), 0)::text AS gross,
               coalesce(sum(CASE WHEN s.type = 'return' THEN -s.total_base ELSE s.total_base END) FILTER (WHERE (s.sold_at AT TIME ZONE ${tz})::date = days.week_before), 0)::text AS week_before
        FROM days LEFT JOIN sales s ON s.status = 'completed' AND s.type IN ('sale', 'return')
          AND s.sold_at > now() - interval '10 days' ${inStore('s.store_id')}
        GROUP BY days.yesterday, days.week_before`);
      const e = eod.rows[0] as { day: string; morning: Date | string; sales: number; gross: string; week_before: string } | undefined;
      if (e) {
        const now = toCents(e.gross);
        const before = toCents(e.week_before);
        const change = before === 0n ? '' : ` · ${now >= before ? 'up' : 'down'} ${Math.abs(Number(((now - before) * 1000n) / before) / 10)}% on the week before`;
        const weekday = new Date(`${e.day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
        items.push({
          id: `eod-${e.day}`,
          kind: 'end_of_day',
          title: `${weekday}'s takings: ${money(e.gross)}`,
          body: e.sales === 0 ? 'No sales' : `${plural(e.sales, 'sale')}${change}`,
          at: new Date(e.morning).toISOString(),
          attention: false,
          link: { to: 'daily_report' },
        });
      }

      items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
      return { items, generatedAt: new Date().toISOString() };
    });
  }
}

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Roles(...MANAGERS)
  @Can('dashboard.view')
  @Get()
  list(@Ctx() ctx: AuthContext, @Query() q: NotificationQuery) {
    return this.svc.list(ctx, q);
  }
}

@Module({ controllers: [NotificationsController], providers: [NotificationsService] })
export class NotificationsModule {}
