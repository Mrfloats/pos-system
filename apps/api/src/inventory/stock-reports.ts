import { BadRequestException, Controller, Get, Injectable, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';
import { sql, SQL } from 'drizzle-orm';
import { type AuthContext, Ctx, Roles, STOCK_WRITERS } from '../common/auth-context.js';
import { likeEscape, Trim } from '../common/validation.js';
import { DbService, Tx } from '../db/db.service.js';
import { tenants } from '../db/schema.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const IsDay = () => Matches(DAY, { message: 'dates must look like 2026-10-31' });

class StockFilter {
  /** Leave out for all stores together. */
  @IsOptional() @IsUUID() storeId?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsString() @Trim() search?: string;
}

export class ValuationQuery extends StockFilter {
  /** Stock as it stood at the end of this day. Leave out for now. */
  @IsOptional() @IsDay() asOf?: string;
}

export class RangeStockQuery extends StockFilter {
  @IsDay() from: string;
  @IsDay() to: string;
}

const MOVEMENT_TYPES = ['opening', 'receive', 'sale', 'return', 'adjustment', 'transfer_in', 'transfer_out', 'waste'] as const;

export class LedgerQuery extends RangeStockQuery {
  @IsOptional() @IsIn(MOVEMENT_TYPES) type?: (typeof MOVEMENT_TYPES)[number];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) pageSize = 100;
}

export class ItemLedgerQuery {
  @IsUUID() variantId: string;
  @IsOptional() @IsUUID() storeId?: string;
  @IsDay() from: string;
  @IsDay() to: string;
}

/**
 * Stock reports, read straight from the stock ledger. Quantities are summed
 * from movements; values use each item's cost price (the same standard cost
 * the general ledger uses). Days are the business's own calendar days.
 */
@Injectable()
export class StockReportsService {
  constructor(private readonly dbs: DbService) {}

  private async tz(tx: Tx) {
    const [t] = await tx.select({ tz: tenants.timezone }).from(tenants).limit(1);
    return t?.tz ?? 'UTC';
  }

  /** Conditions on product (p), variant (v) and movement (m) shared by every report. */
  private filters(q: StockFilter): SQL[] {
    const where: SQL[] = [sql`p.track_stock`];
    if (q.categoryId) where.push(sql`p.category_id = ${q.categoryId}`);
    if (q.search) where.push(sql`(p.name ILIKE ${likeEscape(q.search)} OR v.sku ILIKE ${likeEscape(q.search)} OR v.barcode = ${q.search})`);
    return where;
  }

  private range(from: string, to: string) {
    if (from > to) throw new BadRequestException('The start date must be before the end date');
  }

  /** Quantity and value of stock per item, now or at the end of a past day. */
  valuation(ctx: AuthContext, q: ValuationQuery) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const tz = await this.tz(tx);
      const moveFilter = [sql`m.variant_id = v.id`];
      if (q.storeId) moveFilter.push(sql`m.store_id = ${q.storeId}`);
      if (q.asOf) moveFilter.push(sql`(m.created_at AT TIME ZONE ${tz})::date <= ${q.asOf}::date`);
      const res = await tx.execute(sql`
        SELECT v.id AS variant_id, p.name AS product_name, v.name AS variant_name, v.sku, c.name AS category,
               coalesce(v.cost_price, 0)::text AS unit_cost,
               coalesce(sum(m.quantity), 0)::text AS qty,
               round(coalesce(sum(m.quantity), 0) * coalesce(v.cost_price, 0), 2)::text AS value
        FROM product_variants v
        JOIN products p ON p.id = v.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN stock_movements m ON ${sql.join(moveFilter, sql` AND `)}
        WHERE ${sql.join(this.filters(q), sql` AND `)}
        GROUP BY v.id, p.name, c.name
        HAVING coalesce(sum(m.quantity), 0) <> 0
        ORDER BY c.name NULLS LAST, p.name, v.name
        LIMIT 5000`);
      const rows = (res.rows as any[]).map((r) => ({
        variantId: r.variant_id,
        productName: r.product_name,
        variantName: r.variant_name,
        sku: r.sku,
        category: r.category,
        unitCost: r.unit_cost,
        quantity: r.qty,
        value: r.value,
      }));
      const totalValue = rows.reduce((t, r) => t + Math.round(Number(r.value) * 100), 0) / 100;
      return { asOf: q.asOf ?? null, rows, totalValue: totalValue.toFixed(2), items: rows.length };
    });
  }

  /** Every stock movement in a period, newest first. */
  ledger(ctx: AuthContext, q: LedgerQuery) {
    this.range(q.from, q.to);
    return this.dbs.withTenant(ctx, async (tx) => {
      const tz = await this.tz(tx);
      const where = [...this.filters(q), sql`(m.created_at AT TIME ZONE ${tz})::date BETWEEN ${q.from}::date AND ${q.to}::date`];
      if (q.storeId) where.push(sql`m.store_id = ${q.storeId}`);
      if (q.type) where.push(sql`m.type = ${q.type}`);
      const base = sql`
        FROM stock_movements m
        JOIN product_variants v ON v.id = m.variant_id
        JOIN products p ON p.id = v.product_id
        JOIN stores s ON s.id = m.store_id
        LEFT JOIN users u ON u.id = m.created_by
        WHERE ${sql.join(where, sql` AND `)}`;
      const totalRes = await tx.execute(sql`SELECT count(*)::int AS n ${base}`);
      const res = await tx.execute(sql`
        SELECT m.id, m.created_at, m.type, m.quantity::text AS qty, m.reference, m.note,
               coalesce(m.unit_cost, v.cost_price)::text AS unit_cost,
               p.name AS product_name, v.name AS variant_name, v.sku, s.name AS store_name, u.full_name AS user_name
        ${base}
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`);
      return {
        items: (res.rows as any[]).map((r) => ({
          id: r.id,
          createdAt: r.created_at,
          type: r.type,
          quantity: r.qty,
          unitCost: r.unit_cost,
          value: r.unit_cost ? (Number(r.qty) * Number(r.unit_cost)).toFixed(2) : null,
          reference: r.reference,
          note: r.note,
          productName: r.product_name,
          variantName: r.variant_name,
          sku: r.sku,
          storeName: r.store_name,
          userName: r.user_name,
        })),
        total: (totalRes.rows[0] as { n: number }).n,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  /** One item's movements in a period with a running balance. */
  itemLedger(ctx: AuthContext, q: ItemLedgerQuery) {
    this.range(q.from, q.to);
    return this.dbs.withTenant(ctx, async (tx) => {
      const tz = await this.tz(tx);
      const store = q.storeId ? sql`AND m.store_id = ${q.storeId}` : sql``;
      const day = sql`(m.created_at AT TIME ZONE ${tz})::date`;
      const item = await tx.execute(sql`
        SELECT p.name AS product_name, v.name AS variant_name, v.sku, v.barcode, coalesce(v.cost_price, 0)::text AS unit_cost
        FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ${q.variantId}`);
      const info = item.rows[0] as any;
      if (!info) throw new BadRequestException('Unknown product variant');
      const opening = await tx.execute(sql`
        SELECT coalesce(sum(m.quantity), 0)::text AS qty FROM stock_movements m
        WHERE m.variant_id = ${q.variantId} ${store} AND ${day} < ${q.from}::date`);
      const res = await tx.execute(sql`
        SELECT m.id, m.created_at, m.type, m.quantity::text AS qty, m.reference, m.note, s.name AS store_name, u.full_name AS user_name
        FROM stock_movements m
        JOIN stores s ON s.id = m.store_id
        LEFT JOIN users u ON u.id = m.created_by
        WHERE m.variant_id = ${q.variantId} ${store} AND ${day} BETWEEN ${q.from}::date AND ${q.to}::date
        ORDER BY m.created_at, m.id`);
      let balance = Number((opening.rows[0] as { qty: string }).qty);
      const openingQty = balance;
      let qtyIn = 0;
      let qtyOut = 0;
      const lines = (res.rows as any[]).map((r) => {
        const n = Number(r.qty);
        balance += n;
        if (n > 0) qtyIn += n;
        else qtyOut -= n;
        return {
          id: r.id,
          createdAt: r.created_at,
          type: r.type,
          quantityIn: n > 0 ? r.qty : null,
          quantityOut: n < 0 ? String(-n) : null,
          balance: balance.toFixed(3),
          reference: r.reference,
          note: r.note,
          storeName: r.store_name,
          userName: r.user_name,
        };
      });
      return {
        item: { productName: info.product_name, variantName: info.variant_name, sku: info.sku, barcode: info.barcode, unitCost: info.unit_cost },
        from: q.from,
        to: q.to,
        opening: openingQty.toFixed(3),
        totalIn: qtyIn.toFixed(3),
        totalOut: qtyOut.toFixed(3),
        closing: balance.toFixed(3),
        closingValue: (balance * Number(info.unit_cost)).toFixed(2),
        lines,
      };
    });
  }

  /** Per item for a period: opening, what came in and went out by kind, and closing. */
  itemSummary(ctx: AuthContext, q: RangeStockQuery) {
    this.range(q.from, q.to);
    return this.dbs.withTenant(ctx, async (tx) => {
      const tz = await this.tz(tx);
      const day = sql`(m.created_at AT TIME ZONE ${tz})::date`;
      const inRange = sql`${day} BETWEEN ${q.from}::date AND ${q.to}::date`;
      const sumIf = (cond: SQL) => sql`coalesce(sum(m.quantity) FILTER (WHERE ${inRange} AND ${cond}), 0)`;
      const moveFilter = [sql`m.variant_id = v.id`, sql`${day} <= ${q.to}::date`];
      if (q.storeId) moveFilter.push(sql`m.store_id = ${q.storeId}`);
      const res = await tx.execute(sql`
        SELECT * FROM (
          SELECT v.id AS variant_id, p.name AS product_name, v.name AS variant_name, v.sku, c.name AS category,
                 coalesce(v.cost_price, 0) AS unit_cost,
                 coalesce(sum(m.quantity) FILTER (WHERE ${day} < ${q.from}::date), 0) AS opening,
                 ${sumIf(sql`m.type IN ('opening', 'receive', 'return')`)} AS received,
                 ${sumIf(sql`m.type = 'transfer_in'`)} AS transfers_in,
                 ${sumIf(sql`m.type = 'sale'`)} AS sold,
                 ${sumIf(sql`m.type = 'transfer_out'`)} AS transfers_out,
                 ${sumIf(sql`m.type IN ('adjustment', 'waste')`)} AS adjusted,
                 coalesce(sum(m.quantity), 0) AS closing,
                 count(m.id) FILTER (WHERE ${inRange}) AS moves
          FROM product_variants v
          JOIN products p ON p.id = v.product_id
          LEFT JOIN categories c ON c.id = p.category_id
          LEFT JOIN stock_movements m ON ${sql.join(moveFilter, sql` AND `)}
          WHERE ${sql.join(this.filters(q), sql` AND `)}
          GROUP BY v.id, p.name, c.name
        ) t
        WHERE moves > 0 OR opening <> 0
        ORDER BY category NULLS LAST, product_name, variant_name
        LIMIT 5000`);
      const f = (v: unknown) => Number(v).toFixed(3);
      const rows = (res.rows as any[]).map((r) => ({
        variantId: r.variant_id,
        productName: r.product_name,
        variantName: r.variant_name,
        sku: r.sku,
        category: r.category,
        opening: f(r.opening),
        received: f(r.received),
        transfersIn: f(r.transfers_in),
        // Outgoing quantities are shown as positive numbers.
        sold: f(-Number(r.sold)),
        transfersOut: f(-Number(r.transfers_out)),
        adjusted: f(r.adjusted),
        closing: f(r.closing),
        closingValue: (Number(r.closing) * Number(r.unit_cost)).toFixed(2),
      }));
      const totalValue = rows.reduce((t, r) => t + Math.round(Number(r.closingValue) * 100), 0) / 100;
      return { from: q.from, to: q.to, rows, totalClosingValue: totalValue.toFixed(2) };
    });
  }
}

@ApiTags('inventory')
@ApiBearerAuth()
// Costs and values are for people who manage stock or the books, not the till.
@Roles(...STOCK_WRITERS, 'accountant')
@Controller('inventory/reports')
export class StockReportsController {
  constructor(private readonly svc: StockReportsService) {}

  @Get('valuation')
  valuation(@Ctx() ctx: AuthContext, @Query() q: ValuationQuery) {
    return this.svc.valuation(ctx, q);
  }

  @Get('ledger')
  ledger(@Ctx() ctx: AuthContext, @Query() q: LedgerQuery) {
    return this.svc.ledger(ctx, q);
  }

  @Get('item-ledger')
  itemLedger(@Ctx() ctx: AuthContext, @Query() q: ItemLedgerQuery) {
    return this.svc.itemLedger(ctx, q);
  }

  @Get('item-summary')
  itemSummary(@Ctx() ctx: AuthContext, @Query() q: RangeStockQuery) {
    return this.svc.itemSummary(ctx, q);
  }
}
