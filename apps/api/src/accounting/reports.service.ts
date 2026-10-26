import { BadRequestException, Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { type AuthContext } from '../common/auth-context.js';
import { found } from '../common/validation.js';
import { DbService, Tx } from '../db/db.service.js';
import { accounts } from '../db/schema.js';
import { natural } from './accounting.service.js';
import type { AccountType } from './chart.js';
import { LedgerService } from './ledger.service.js';
import { fromCents, sum, toCents } from './money.js';

type Account = typeof accounts.$inferSelect;
interface Row {
  id: string;
  code: string;
  name: string;
  amount: string;
}

/**
 * Financial statements, all in the base currency and all read straight from
 * the general ledger, so every report agrees with every other.
 *
 * Profit is never "closed" into retained earnings with an entry; the balance
 * sheet instead shows the profit earned to date as its own equity line.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly dbs: DbService,
    private readonly ledger: LedgerService,
  ) {}

  private async setup(tx: Tx, ctx: AuthContext) {
    await this.ledger.systemAccounts(tx, ctx);
    const list = await tx.select().from(accounts).orderBy(asc(accounts.code));
    const books = await this.ledger.books(tx);
    return { list, books, today: await this.ledger.today(tx) };
  }

  private rows(list: Account[], balances: Map<string, { debit: bigint; credit: bigint }>, pick: (a: Account) => boolean) {
    const out: (Row & { cents: bigint })[] = [];
    for (const a of list.filter(pick)) {
      const b = balances.get(a.id);
      if (!b) continue;
      const cents = natural(a.type, b.debit, b.credit);
      if (cents === 0n) continue;
      out.push({ id: a.id, code: a.code, name: a.name, amount: fromCents(cents), cents });
    }
    return out;
  }

  private section(title: string, rows: (Row & { cents: bigint })[]) {
    const total = sum(rows.map((r) => r.cents));
    return { title, rows: rows.map(({ cents: _c, ...r }) => r), total: fromCents(total), cents: total };
  }

  trialBalance(ctx: AuthContext, asOf?: string) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const { list, books, today } = await this.setup(tx, ctx);
      const date = asOf ?? today;
      const balances = await this.ledger.balances(tx, { through: date });
      const rows = list
        .filter((a) => balances.has(a.id))
        .map((a) => {
          const b = balances.get(a.id)!;
          const net = b.debit - b.credit;
          return { id: a.id, code: a.code, name: a.name, type: a.type, net };
        })
        .filter((r) => r.net !== 0n);
      const debit = sum(rows.filter((r) => r.net > 0n).map((r) => r.net));
      const credit = -sum(rows.filter((r) => r.net < 0n).map((r) => r.net));
      return {
        asOf: date,
        currency: books.baseCurrency,
        rows: rows.map(({ net, ...r }) => ({ ...r, debit: net > 0n ? fromCents(net) : null, credit: net < 0n ? fromCents(-net) : null })),
        totalDebit: fromCents(debit),
        totalCredit: fromCents(credit),
        balanced: debit === credit,
      };
    });
  }

  /** Income less costs over a period. Expense accounts with codes starting 5 count as cost of sales. */
  profitAndLoss(ctx: AuthContext, from: string, to: string) {
    if (from > to) throw new BadRequestException('The start date must be before the end date');
    return this.dbs.withTenant(ctx, async (tx) => {
      const { list, books } = await this.setup(tx, ctx);
      const balances = await this.ledger.balances(tx, { from, through: to });
      const income = this.section('Income', this.rows(list, balances, (a) => a.type === 'income'));
      const costOfSales = this.section('Cost of sales', this.rows(list, balances, (a) => a.type === 'expense' && a.code.startsWith('5')));
      const expenses = this.section('Expenses', this.rows(list, balances, (a) => a.type === 'expense' && !a.code.startsWith('5')));
      const gross = income.cents - costOfSales.cents;
      const net = gross - expenses.cents;
      const strip = ({ cents: _c, ...s }: ReturnType<ReportsService['section']>) => s;
      return {
        from,
        to,
        currency: books.baseCurrency,
        sections: [strip(income), strip(costOfSales), strip(expenses)],
        grossProfit: fromCents(gross),
        netProfit: fromCents(net),
      };
    });
  }

  balanceSheet(ctx: AuthContext, asOf?: string) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const { list, books, today } = await this.setup(tx, ctx);
      const date = asOf ?? today;
      const balances = await this.ledger.balances(tx, { through: date });
      const assets = this.section('Assets', this.rows(list, balances, (a) => a.type === 'asset'));
      const liabilities = this.section('Liabilities', this.rows(list, balances, (a) => a.type === 'liability'));
      const equityRows = this.rows(list, balances, (a) => a.type === 'equity');
      const profit = sum(
        list
          .filter((a) => a.type === 'income' || a.type === 'expense')
          .map((a) => {
            const b = balances.get(a.id);
            return b ? b.credit - b.debit : 0n;
          }),
      );
      if (profit !== 0n) equityRows.push({ id: 'profit', code: '', name: 'Profit to date', amount: fromCents(profit), cents: profit });
      const equity = this.section('Equity', equityRows);
      const strip = ({ cents: _c, ...s }: ReturnType<ReportsService['section']>) => s;
      return {
        asOf: date,
        currency: books.baseCurrency,
        sections: [strip(assets), strip(liabilities), strip(equity)],
        totalAssets: assets.total,
        totalLiabilitiesAndEquity: fromCents(liabilities.cents + equity.cents),
        balanced: assets.cents === liabilities.cents + equity.cents,
      };
    });
  }

  /** Every posting to one account over a period, with a running balance. */
  generalLedger(ctx: AuthContext, accountId: string, from: string, to: string) {
    if (from > to) throw new BadRequestException('The start date must be before the end date');
    return this.dbs.withTenant(ctx, async (tx) => {
      const { books } = await this.setup(tx, ctx);
      const [a] = await tx.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
      found(a, 'Account');
      const before = await tx.execute(sql`
        SELECT coalesce(sum(l.debit), 0)::text AS debit, coalesce(sum(l.credit), 0)::text AS credit
        FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
        WHERE l.account_id = ${accountId} AND e.date < ${from}`);
      const b0 = before.rows[0] as { debit: string; credit: string };
      const opening = natural(a.type as AccountType, toCents(b0.debit), toCents(b0.credit));
      const res = await tx.execute(sql`
        SELECT e.id AS entry_id, e.number, e.date::text AS date, e.description, e.source, e.reference,
               l.debit::text AS debit, l.credit::text AS credit, l.memo, l.currency_code, l.foreign_amount::text AS foreign_amount
        FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
        WHERE l.account_id = ${accountId} AND e.date >= ${from} AND e.date <= ${to}
        ORDER BY e.date, e.number, l.id`);
      let running = opening;
      const lines = (res.rows as any[]).map((r) => {
        running += natural(a.type as AccountType, toCents(r.debit), toCents(r.credit));
        return {
          entryId: r.entry_id,
          number: r.number,
          date: r.date,
          description: r.memo ? `${r.description} · ${r.memo}` : r.description,
          source: r.source,
          reference: r.reference,
          debit: toCents(r.debit) ? r.debit : null,
          credit: toCents(r.credit) ? r.credit : null,
          currencyCode: r.currency_code,
          foreignAmount: r.foreign_amount,
          balance: fromCents(running),
        };
      });
      return {
        account: a,
        from,
        to,
        currency: books.baseCurrency,
        openingBalance: fromCents(opening),
        closingBalance: fromCents(running),
        lines,
      };
    });
  }

  /** VAT on sales and purchases over a period, by tax rate, for the ZIMRA VAT return. */
  vat(ctx: AuthContext, from: string, to: string) {
    if (from > to) throw new BadRequestException('The start date must be before the end date');
    return this.dbs.withTenant(ctx, async (tx) => {
      const { books } = await this.setup(tx, ctx);
      const res = await tx.execute(sql`
        WITH lines AS (
          SELECT 'sales' AS side, l.tax_rate_id, l.net_base, l.tax_base
          FROM invoice_lines l JOIN invoices d ON d.id = l.invoice_id
          WHERE d.status = 'posted' AND d.date BETWEEN ${from} AND ${to}
          UNION ALL
          SELECT 'purchases', l.tax_rate_id, l.net_base, l.tax_base
          FROM bill_lines l JOIN bills d ON d.id = l.bill_id
          WHERE d.status = 'posted' AND d.date BETWEEN ${from} AND ${to}
          UNION ALL
          SELECT 'purchases', e.tax_rate_id, e.net_base, e.tax_base
          FROM expenses e
          WHERE e.status = 'posted' AND e.date BETWEEN ${from} AND ${to}
        )
        SELECT side, coalesce(t.name, 'No tax') AS rate_name, t.rate::text AS rate,
               sum(net_base)::text AS net, sum(tax_base)::text AS tax
        FROM lines LEFT JOIN tax_rates t ON t.id = lines.tax_rate_id
        GROUP BY side, t.name, t.rate
        ORDER BY side DESC, t.rate DESC NULLS LAST`);
      const rows = (res.rows as any[]).map((r) => ({ side: r.side as 'sales' | 'purchases', rateName: r.rate_name, rate: r.rate, net: r.net, tax: r.tax }));
      const output = sum(rows.filter((r) => r.side === 'sales').map((r) => toCents(r.tax)));
      const input = sum(rows.filter((r) => r.side === 'purchases').map((r) => toCents(r.tax)));
      return {
        from,
        to,
        currency: books.baseCurrency,
        sales: rows.filter((r) => r.side === 'sales'),
        purchases: rows.filter((r) => r.side === 'purchases'),
        outputTax: fromCents(output),
        inputTax: fromCents(input),
        netPayable: fromCents(output - input),
      };
    });
  }

  /** Who owes what (receivables) or what is owed (payables), by how overdue it is. */
  aged(ctx: AuthContext, kind: 'receivables' | 'payables', asOf?: string) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const { books, today } = await this.setup(tx, ctx);
      const date = asOf ?? today;
      const [doc, party, fk, payFk] =
        kind === 'receivables' ? ['invoices', 'customers', 'customer_id', 'invoice_id'] : ['bills', 'suppliers', 'supplier_id', 'bill_id'];
      const res = await tx.execute(sql`
        SELECT p.id AS party_id, p.name AS party_name, d.id, d.number, d.date::text AS date, d.due_date::text AS due_date,
               d.currency_code, d.total::text AS total,
               (d.total - coalesce((SELECT sum(x.amount) FROM payments x
                  WHERE x.${sql.raw(payFk)} = d.id AND x.status = 'posted' AND x.date <= ${date}), 0))::text AS balance,
               (d.total_base - coalesce((SELECT sum(x.cleared_base) FROM payments x
                  WHERE x.${sql.raw(payFk)} = d.id AND x.status = 'posted' AND x.date <= ${date}), 0))::text AS balance_base,
               (${date}::date - d.due_date) AS days_overdue
        FROM ${sql.raw(doc)} d JOIN ${sql.raw(party)} p ON p.id = d.${sql.raw(fk)}
        WHERE d.status = 'posted' AND d.date <= ${date}
        ORDER BY p.name, d.due_date`);
      const buckets = ['current', '1-30', '31-60', '61-90', '90+'] as const;
      const bucket = (days: number) => (days <= 0 ? 'current' : days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+');
      const parties = new Map<string, { id: string; name: string; totals: Record<string, bigint>; documents: any[] }>();
      for (const r of res.rows as any[]) {
        const base = toCents(r.balance_base);
        if (toCents(r.balance) <= 0n) continue;
        const b = bucket(Number(r.days_overdue));
        const p = parties.get(r.party_id) ?? {
          id: r.party_id,
          name: r.party_name,
          totals: Object.fromEntries(buckets.map((k) => [k, 0n])),
          documents: [] as any[],
        };
        p.totals[b] += base;
        p.documents.push({
          id: r.id,
          number: r.number,
          date: r.date,
          dueDate: r.due_date,
          currencyCode: r.currency_code,
          total: r.total,
          balance: r.balance,
          balanceBase: fromCents(base),
          daysOverdue: Math.max(0, Number(r.days_overdue)),
          bucket: b,
        });
        parties.set(r.party_id, p);
      }
      const list = [...parties.values()];
      const fmt = (t: Record<string, bigint>) => ({
        ...Object.fromEntries(buckets.map((k) => [k, fromCents(t[k])])),
        total: fromCents(sum(buckets.map((k) => t[k]))),
      });
      const grand = Object.fromEntries(buckets.map((k) => [k, sum(list.map((p) => p.totals[k]))]));
      return {
        kind,
        asOf: date,
        currency: books.baseCurrency,
        buckets,
        parties: list.map((p) => ({ id: p.id, name: p.name, ...fmt(p.totals), documents: p.documents })),
        totals: fmt(grand),
      };
    });
  }

  /** The numbers for the Accounts overview. */
  summary(ctx: AuthContext) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const { list, books, today } = await this.setup(tx, ctx);
      const all = await this.ledger.balances(tx, { through: today });
      const monthStart = `${today.slice(0, 8)}01`;
      const month = await this.ledger.balances(tx, { from: monthStart, through: today });
      const bal = (a: Account, m = all) => {
        const b = m.get(a.id);
        return b ? natural(a.type, b.debit, b.credit) : 0n;
      };
      const byKey = (k: string) => list.find((a) => a.systemKey === k)!;
      const income = sum(list.filter((a) => a.type === 'income').map((a) => bal(a, month)));
      const expense = sum(list.filter((a) => a.type === 'expense').map((a) => bal(a, month)));
      const overdue = async (doc: 'invoices' | 'bills', fk: string) => {
        const r = await tx.execute(sql`
          SELECT count(*)::int AS n, coalesce(sum(d.total_base - coalesce((SELECT sum(x.cleared_base) FROM payments x
            WHERE x.${sql.raw(fk)} = d.id AND x.status = 'posted'), 0)), 0)::text AS amount
          FROM ${sql.raw(doc)} d
          WHERE d.status = 'posted' AND d.due_date < ${today}
            AND d.total > coalesce((SELECT sum(x.amount) FROM payments x WHERE x.${sql.raw(fk)} = d.id AND x.status = 'posted'), 0)`);
        const row = r.rows[0] as { n: number; amount: string };
        return { count: row.n, amount: fromCents(toCents(row.amount)) };
      };
      return {
        currency: books.baseCurrency,
        today,
        booksClosedThrough: books.booksClosedThrough,
        moneyAccounts: list
          .filter((a) => a.isBank && a.active)
          .map((a) => ({ id: a.id, code: a.code, name: a.name, balance: fromCents(bal(a)) })),
        receivables: fromCents(bal(byKey('receivables'))),
        payables: fromCents(bal(byKey('payables'))),
        vatOwed: fromCents(bal(byKey('vat_output')) - bal(byKey('vat_input'))),
        stockValue: fromCents(bal(byKey('inventory'))),
        overdueInvoices: await overdue('invoices', 'invoice_id'),
        overdueBills: await overdue('bills', 'bill_id'),
        thisMonth: { from: monthStart, to: today, income: fromCents(income), expenses: fromCents(expense), profit: fromCents(income - expense) },
      };
    });
  }
}
