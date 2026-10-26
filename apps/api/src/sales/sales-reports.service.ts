import { BadRequestException, Injectable } from '@nestjs/common';
import { sql, SQL } from 'drizzle-orm';
import { fromCents, toCents } from '../accounting/money.js';
import { type AuthContext } from '../common/auth-context.js';
import { DbService, Tx } from '../db/db.service.js';
import { tenants } from '../db/schema.js';
import { CashbookQuery, ProfitQuery, SalesRangeQuery } from './sales.dto.js';

const c = (v: unknown) => fromCents(toCents(String(v ?? '0')));
const pct = (profit: number, revenue: number) => (revenue ? ((profit / revenue) * 100).toFixed(1) : null);

/**
 * Sales reports. Everything counts completed sales, with returns subtracted;
 * voided sales and open quotations are left out. Money is in the base currency
 * and excludes VAT unless a column says otherwise.
 */
@Injectable()
export class SalesReportsService {
  constructor(private readonly dbs: DbService) {}

  private async tz(tx: Tx) {
    const [t] = await tx.select({ tz: tenants.timezone }).from(tenants).limit(1);
    return t?.tz ?? 'UTC';
  }

  private check(from: string, to: string) {
    if (from > to) throw new BadRequestException('The start date must be before the end date');
  }

  /** Completed sales and returns in the period (s), with sign = −1 for returns. */
  private salesIn(tz: string, q: SalesRangeQuery): SQL {
    return sql`s.status = 'completed' AND s.type IN ('sale', 'return')
      AND (s.sold_at AT TIME ZONE ${tz})::date BETWEEN ${q.from}::date AND ${q.to}::date
      ${q.storeId ? sql`AND s.store_id = ${q.storeId}` : sql``}`;
  }

  /** Revenue, cost and profit grouped by item, category, cashier or store. */
  profitability(ctx: AuthContext, q: ProfitQuery) {
    this.check(q.from, q.to);
    return this.dbs.withTenant(ctx, async (tx) => {
      const tz = await this.tz(tx);
      const dims: Record<ProfitQuery['by'], { key: SQL; label: SQL; join: SQL }> = {
        item: { key: sql`l.variant_id`, label: sql`max(l.product_name) || CASE WHEN max(l.variant_name) <> 'Default' THEN ' · ' || max(l.variant_name) ELSE '' END`, join: sql`` },
        category: { key: sql`p.category_id`, label: sql`coalesce(max(c.name), 'No category')`, join: sql`JOIN product_variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id LEFT JOIN categories c ON c.id = p.category_id` },
        cashier: { key: sql`s.salesperson_id`, label: sql`coalesce(max(u.full_name), 'Unknown')`, join: sql`LEFT JOIN users u ON u.id = s.salesperson_id` },
        store: { key: sql`s.store_id`, label: sql`max(st.name)`, join: sql`JOIN stores st ON st.id = s.store_id` },
      };
      const d = dims[q.by];
      const sign = sql`CASE WHEN s.type = 'return' THEN -1 ELSE 1 END`;
      const res = await tx.execute(sql`
        SELECT ${d.key}::text AS id, ${d.label} AS name,
               sum(${sign} * l.quantity * l.units_per_pack)::text AS qty,
               count(DISTINCT s.id) FILTER (WHERE s.type = 'sale')::int AS sales,
               sum(${sign} * l.net_base)::text AS revenue,
               sum(${sign} * l.tax_base)::text AS tax,
               sum(${sign} * l.cost_base)::text AS cost
        FROM sale_lines l JOIN sales s ON s.id = l.sale_id ${d.join}
        WHERE ${this.salesIn(tz, q)}
        GROUP BY ${d.key}
        ORDER BY sum(${sign} * l.net_base) DESC`);
      const rows = (res.rows as any[]).map((r) => {
        const revenue = Number(r.revenue);
        const profit = revenue - Number(r.cost);
        return { id: r.id, name: r.name, quantity: Number(r.qty).toFixed(3), sales: r.sales, revenue: c(r.revenue), tax: c(r.tax), cost: c(r.cost), profit: profit.toFixed(2), margin: pct(profit, revenue) };
      });
      const tot = (k: 'revenue' | 'cost' | 'tax') => rows.reduce((t, r) => t + Math.round(Number(r[k]) * 100), 0) / 100;
      const revenue = tot('revenue');
      const profit = revenue - tot('cost');
      return {
        by: q.by,
        from: q.from,
        to: q.to,
        rows,
        totals: { revenue: revenue.toFixed(2), cost: tot('cost').toFixed(2), tax: tot('tax').toFixed(2), profit: profit.toFixed(2), margin: pct(profit, revenue) },
      };
    });
  }

  /** VAT on sales by tax rate and item. */
  salesTax(ctx: AuthContext, q: SalesRangeQuery) {
    this.check(q.from, q.to);
    return this.dbs.withTenant(ctx, async (tx) => {
      const tz = await this.tz(tx);
      const sign = sql`CASE WHEN s.type = 'return' THEN -1 ELSE 1 END`;
      const res = await tx.execute(sql`
        SELECT coalesce(l.tax_rate_name, 'No tax') AS rate_name, l.variant_id,
               max(l.product_name) AS product_name, max(l.variant_name) AS variant_name,
               sum(${sign} * l.quantity * l.units_per_pack)::text AS qty, sum(${sign} * l.net_base)::text AS net, sum(${sign} * l.tax_base)::text AS tax
        FROM sale_lines l JOIN sales s ON s.id = l.sale_id
        WHERE ${this.salesIn(tz, q)}
        GROUP BY coalesce(l.tax_rate_name, 'No tax'), l.variant_id
        ORDER BY 1, max(l.product_name)`);
      const groups = new Map<string, any>();
      for (const r of res.rows as any[]) {
        const g = groups.get(r.rate_name) ?? { rateName: r.rate_name, items: [], net: 0, tax: 0 };
        g.items.push({ variantId: r.variant_id, name: r.variant_name !== 'Default' ? `${r.product_name} · ${r.variant_name}` : r.product_name, quantity: Number(r.qty).toFixed(3), net: c(r.net), tax: c(r.tax), gross: (Number(r.net) + Number(r.tax)).toFixed(2) });
        g.net += Math.round(Number(r.net) * 100);
        g.tax += Math.round(Number(r.tax) * 100);
        groups.set(r.rate_name, g);
      }
      const list = [...groups.values()].map((g) => ({ ...g, net: (g.net / 100).toFixed(2), tax: (g.tax / 100).toFixed(2), gross: ((g.net + g.tax) / 100).toFixed(2) }));
      const sumOf = (k: 'net' | 'tax') => list.reduce((t, g) => t + Math.round(Number(g[k]) * 100), 0) / 100;
      return { from: q.from, to: q.to, groups: list, totals: { net: sumOf('net').toFixed(2), tax: sumOf('tax').toFixed(2), gross: (sumOf('net') + sumOf('tax')).toFixed(2) } };
    });
  }

  /** VAT on purchases: supplier bill lines and expenses. */
  purchasesTax(ctx: AuthContext, q: SalesRangeQuery) {
    this.check(q.from, q.to);
    return this.dbs.withTenant(ctx, async (tx) => {
      const res = await tx.execute(sql`
        SELECT * FROM (
          SELECT b.date::text AS date, b.number, sp.name AS supplier, bl.description, a.name AS account,
                 coalesce(t.name, 'No tax') AS rate_name, bl.net_base::text AS net, bl.tax_base::text AS tax
          FROM bill_lines bl JOIN bills b ON b.id = bl.bill_id JOIN suppliers sp ON sp.id = b.supplier_id
          JOIN accounts a ON a.id = bl.account_id LEFT JOIN tax_rates t ON t.id = bl.tax_rate_id
          WHERE b.status = 'posted' AND b.date BETWEEN ${q.from} AND ${q.to}
          UNION ALL
          SELECT e.date::text, e.number, coalesce(sp.name, e.payee, '—'), e.description, a.name,
                 coalesce(t.name, 'No tax'), e.net_base::text, e.tax_base::text
          FROM expenses e LEFT JOIN suppliers sp ON sp.id = e.supplier_id
          JOIN accounts a ON a.id = e.account_id LEFT JOIN tax_rates t ON t.id = e.tax_rate_id
          WHERE e.status = 'posted' AND e.date BETWEEN ${q.from} AND ${q.to}
        ) x ORDER BY date, number`);
      const rows = (res.rows as any[]).map((r) => ({ date: r.date, number: r.number, supplier: r.supplier, description: r.description, account: r.account, rateName: r.rate_name, net: c(r.net), tax: c(r.tax), gross: (Number(r.net) + Number(r.tax)).toFixed(2) }));
      const sumOf = (k: 'net' | 'tax') => rows.reduce((t, r) => t + Math.round(Number(r[k]) * 100), 0) / 100;
      return { from: q.from, to: q.to, rows, totals: { net: sumOf('net').toFixed(2), tax: sumOf('tax').toFixed(2), gross: (sumOf('net') + sumOf('tax')).toFixed(2) } };
    });
  }

  /** Per day: number of sales and returns, takings with and without VAT, and how people paid. */
  dailySales(ctx: AuthContext, q: SalesRangeQuery) {
    this.check(q.from, q.to);
    return this.dbs.withTenant(ctx, async (tx) => {
      const tz = await this.tz(tx);
      const day = sql`(s.sold_at AT TIME ZONE ${tz})::date`;
      const sign = sql`CASE WHEN s.type = 'return' THEN -1 ELSE 1 END`;
      const totals = await tx.execute(sql`
        SELECT ${day}::text AS day,
               count(*) FILTER (WHERE s.type = 'sale')::int AS sales,
               count(*) FILTER (WHERE s.type = 'return')::int AS returns,
               sum(${sign} * s.total_base)::text AS gross,
               sum(${sign} * (s.total_base - (SELECT coalesce(sum(l.tax_base), 0) FROM sale_lines l WHERE l.sale_id = s.id)))::text AS net,
               sum(${sign} * s.cost_base)::text AS cost
        FROM sales s WHERE ${this.salesIn(tz, q)}
        GROUP BY 1 ORDER BY 1`);
      const methods = await tx.execute(sql`
        SELECT ${day}::text AS day, p.method, sum(p.amount_base)::text AS amount
        FROM sale_payments p JOIN sales s ON s.id = p.sale_id
        WHERE ${this.salesIn(tz, q)}
        GROUP BY 1, 2`);
      const byDay = new Map<string, Record<string, string>>();
      for (const m of methods.rows as any[]) byDay.set(m.day, { ...byDay.get(m.day), [m.method]: c(m.amount) });
      const rows = (totals.rows as any[]).map((r) => ({
        day: r.day,
        sales: r.sales,
        returns: r.returns,
        gross: c(r.gross),
        net: c(r.net),
        tax: (Number(r.gross) - Number(r.net)).toFixed(2),
        profit: (Number(r.net) - Number(r.cost)).toFixed(2),
        cash: byDay.get(r.day)?.cash ?? '0.00',
        card: byDay.get(r.day)?.card ?? '0.00',
        mobile: byDay.get(r.day)?.mobile ?? '0.00',
        bank: byDay.get(r.day)?.bank ?? '0.00',
      }));
      const keys = ['gross', 'net', 'tax', 'profit', 'cash', 'card', 'mobile', 'bank'] as const;
      const totalsRow = Object.fromEntries(keys.map((k) => [k, (rows.reduce((t, r) => t + Math.round(Number(r[k]) * 100), 0) / 100).toFixed(2)]));
      return { from: q.from, to: q.to, rows, totals: { ...totalsRow, sales: rows.reduce((t, r) => t + r.sales, 0), returns: rows.reduce((t, r) => t + r.returns, 0) } };
    });
  }

  /** Every return in the period, with what came back and why. */
  returns(ctx: AuthContext, q: SalesRangeQuery) {
    this.check(q.from, q.to);
    return this.dbs.withTenant(ctx, async (tx) => {
      const tz = await this.tz(tx);
      const res = await tx.execute(sql`
        SELECT s.id, s.number, s.sold_at, s.customer_name, s.note AS reason, s.currency_code, s.total::text AS total, s.total_base::text AS total_base,
               o.number AS original_number, o.id AS original_id, st.name AS store_name, u.full_name AS by_name,
               (SELECT string_agg(l.product_name || coalesce(' (' || l.pack_name || ')', '') || ' × ' || trim(trailing '.' FROM trim(trailing '0' FROM l.quantity::text)), ', ') FROM sale_lines l WHERE l.sale_id = s.id) AS items,
               (SELECT p.method FROM sale_payments p WHERE p.sale_id = s.id LIMIT 1) AS method
        FROM sales s
        JOIN stores st ON st.id = s.store_id
        LEFT JOIN sales o ON o.id = s.original_sale_id
        LEFT JOIN users u ON u.id = s.salesperson_id
        WHERE s.type = 'return' AND s.status = 'completed'
          AND (s.sold_at AT TIME ZONE ${tz})::date BETWEEN ${q.from}::date AND ${q.to}::date
          ${q.storeId ? sql`AND s.store_id = ${q.storeId}` : sql``}
        ORDER BY s.sold_at DESC`);
      const rows = (res.rows as any[]).map((r) => ({
        id: r.id,
        number: r.number,
        soldAt: r.sold_at,
        customerName: r.customer_name,
        reason: r.reason,
        currencyCode: r.currency_code,
        total: c(r.total),
        totalBase: c(r.total_base),
        originalNumber: r.original_number,
        originalId: r.original_id,
        storeName: r.store_name,
        by: r.by_name,
        items: r.items,
        method: r.method,
      }));
      return { from: q.from, to: q.to, rows, totalBase: (rows.reduce((t, r) => t + Math.round(Number(r.totalBase) * 100), 0) / 100).toFixed(2) };
    });
  }

  /** Cash in each store's tills right now, per currency: cash taken, less refunds and cash sent away, plus cash received. */
  cashBalance(ctx: AuthContext) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const res = await tx.execute(sql`
        WITH moves AS (
          SELECT s.store_id, p.currency_code, (p.amount - p.change) AS amount
          FROM sale_payments p JOIN sales s ON s.id = p.sale_id
          WHERE p.method = 'cash' AND s.status = 'completed'
          UNION ALL SELECT store_id, currency_code, -amount FROM cash_transfers
          UNION ALL SELECT to_store_id, currency_code, amount FROM cash_transfers WHERE to_store_id IS NOT NULL
        )
        SELECT st.id AS store_id, st.name AS store_name, m.currency_code, sum(m.amount)::text AS balance
        FROM moves m JOIN stores st ON st.id = m.store_id
        GROUP BY st.id, st.name, m.currency_code
        ORDER BY st.name, m.currency_code`);
      const stores = new Map<string, { storeId: string; storeName: string; balances: { currencyCode: string; balance: string }[] }>();
      for (const r of res.rows as any[]) {
        const s = stores.get(r.store_id) ?? { storeId: r.store_id, storeName: r.store_name, balances: [] as { currencyCode: string; balance: string }[] };
        s.balances.push({ currencyCode: r.currency_code, balance: c(r.balance) });
        stores.set(r.store_id, s);
      }
      const totals = new Map<string, number>();
      for (const r of res.rows as any[]) totals.set(r.currency_code, (totals.get(r.currency_code) ?? 0) + Math.round(Number(r.balance) * 100));
      return { stores: [...stores.values()], totals: [...totals.entries()].map(([currencyCode, v]) => ({ currencyCode, balance: (v / 100).toFixed(2) })) };
    });
  }

  /** One store's cash, one currency: every cash movement in the period with a running balance. */
  cashbook(ctx: AuthContext, q: CashbookQuery) {
    this.check(q.from, q.to);
    return this.dbs.withTenant(ctx, async (tx) => {
      const tz = await this.tz(tx);
      const [t] = await tx.select({ base: tenants.baseCurrency }).from(tenants).limit(1);
      const currency = q.currencyCode ?? t.base;
      const moves = sql`
        SELECT s.sold_at AS at, s.id AS ref_id, s.number, CASE WHEN s.type = 'return' THEN 'Refund' ELSE 'Cash sale' END AS kind,
               s.customer_name AS detail, (p.amount - p.change) AS amount
        FROM sale_payments p JOIN sales s ON s.id = p.sale_id
        WHERE p.method = 'cash' AND s.status = 'completed' AND s.store_id = ${q.storeId} AND p.currency_code = ${currency}
        UNION ALL
        SELECT ct.created_at, ct.id, ct.number, 'Cash sent', coalesce(a.name, st2.name), -ct.amount
        FROM cash_transfers ct LEFT JOIN accounts a ON a.id = ct.to_account_id LEFT JOIN stores st2 ON st2.id = ct.to_store_id
        WHERE ct.store_id = ${q.storeId} AND ct.currency_code = ${currency}
        UNION ALL
        SELECT ct.created_at, ct.id, ct.number, 'Cash received', st1.name, ct.amount
        FROM cash_transfers ct JOIN stores st1 ON st1.id = ct.store_id
        WHERE ct.to_store_id = ${q.storeId} AND ct.currency_code = ${currency}`;
      const opening = await tx.execute(sql`SELECT coalesce(sum(amount), 0)::text AS v FROM (${moves}) m WHERE (m.at AT TIME ZONE ${tz})::date < ${q.from}::date`);
      const res = await tx.execute(sql`
        SELECT * FROM (${moves}) m
        WHERE (m.at AT TIME ZONE ${tz})::date BETWEEN ${q.from}::date AND ${q.to}::date
        ORDER BY m.at, m.number`);
      let balance = toCents((opening.rows[0] as { v: string }).v);
      const open = balance;
      let cashIn = 0n;
      let cashOut = 0n;
      const rows = (res.rows as any[]).map((r) => {
        const a = toCents(String(r.amount));
        balance += a;
        if (a > 0n) cashIn += a;
        else cashOut -= a;
        return { at: r.at, refId: r.ref_id, number: r.number, kind: r.kind, detail: r.detail, in: a > 0n ? fromCents(a) : null, out: a < 0n ? fromCents(-a) : null, balance: fromCents(balance) };
      });
      return { from: q.from, to: q.to, currencyCode: currency, opening: fromCents(open), cashIn: fromCents(cashIn), cashOut: fromCents(cashOut), closing: fromCents(balance), rows };
    });
  }
}
