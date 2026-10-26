import { BadRequestException, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { type AuthContext } from '../common/auth-context.js';
import { found } from '../common/validation.js';
import { Tx } from '../db/db.service.js';
import { accounts, currencies, documentCounters, journalEntries, journalLines, productVariants, tenants } from '../db/schema.js';
import { CONTROL_ACCOUNTS, DEFAULT_CHART, type SystemKey } from './chart.js';
import { divRound, fromCents, parseFixed, sum, toCents } from './money.js';

type Source = (typeof journalEntries.$inferInsert)['source'];

export interface PostLine {
  accountId: string;
  /** Base-currency cents. Give one of debit / credit; a negative debit is posted as a credit. */
  debit?: bigint;
  credit?: bigint;
  memo?: string | null;
  currencyCode?: string | null;
  /** Cents in `currencyCode`, when that isn't the base currency. */
  foreignAmount?: bigint | null;
  rate?: string | null;
}

export interface PostEntry {
  date: string;
  description: string;
  source: Source;
  sourceId?: string | null;
  reference?: string | null;
  reversesId?: string | null;
  lines: PostLine[];
}

/** What a stock movement needs for valuation. */
export interface StockMovementForPosting {
  variantId: string;
  quantity: string;
  type: string;
  unitCost: string | null;
}

/**
 * The only way anything is written to the general ledger. Checks that each
 * entry balances and falls in an open period, numbers it, and keeps the chart
 * of accounts in place. Always called inside the caller's withTenant
 * transaction, so a document and its journal entry commit together or not at all.
 */
@Injectable()
export class LedgerService {
  /** Business settings that accounting depends on. */
  async books(tx: Tx) {
    const [t] = await tx
      .select({
        baseCurrency: tenants.baseCurrency,
        timezone: tenants.timezone,
        booksClosedThrough: tenants.booksClosedThrough,
      })
      .from(tenants)
      .limit(1);
    return found(t, 'Business');
  }

  /** Today's date (YYYY-MM-DD) in the business's own time zone. */
  async today(tx: Tx) {
    const { timezone } = await this.books(tx);
    return localDate(timezone);
  }

  /** The currency and rate a document uses. The base currency always has rate 1. */
  async resolveCurrency(tx: Tx, code: string | undefined, rate: string | undefined) {
    const { baseCurrency } = await this.books(tx);
    const currencyCode = code ?? baseCurrency;
    if (currencyCode === baseCurrency) {
      if (rate && toCents(rate) !== 100n) throw new BadRequestException(`The rate for ${baseCurrency}, the base currency, is always 1`);
      return { currencyCode, rate: '1', isBase: true };
    }
    const [c] = await tx.select().from(currencies).where(eq(currencies.code, currencyCode)).limit(1);
    if (!c?.active) throw new BadRequestException(`${currencyCode} is not one of your currencies. Add it in Settings first`);
    return { currencyCode, rate: rate ?? c.rateToBase, isBase: false };
  }

  async assertOpenPeriod(tx: Tx, date: string) {
    const { booksClosedThrough } = await this.books(tx);
    if (booksClosedThrough && date <= booksClosedThrough) {
      throw new BadRequestException(
        `The books are closed up to ${booksClosedThrough}. Use a later date, or reopen the period first`,
      );
    }
  }

  /** Next running number for a document kind, e.g. INV-00042. Safe under concurrent requests. */
  async nextNumber(tx: Tx, tenantId: string, kind: string, prefix: string) {
    const [row] = await tx
      .insert(documentCounters)
      .values({ tenantId, kind, lastNumber: 1 })
      .onConflictDoUpdate({
        target: [documentCounters.tenantId, documentCounters.kind],
        set: { lastNumber: sql`${documentCounters.lastNumber} + 1` },
      })
      .returning({ n: documentCounters.lastNumber });
    return `${prefix}-${String(row.n).padStart(5, '0')}`;
  }

  /**
   * The ids of the accounts the API posts to automatically. Creates the
   * standard chart the first time it's needed, so businesses that existed
   * before accounting was added get one too.
   */
  async systemAccounts(tx: Tx, ctx: Pick<AuthContext, 'tenantId' | 'userId'>): Promise<Record<SystemKey, string>> {
    const read = async () => {
      const rows = await tx
        .select({ id: accounts.id, key: accounts.systemKey })
        .from(accounts)
        .where(isNotNull(accounts.systemKey));
      return Object.fromEntries(rows.map((r) => [r.key, r.id])) as Record<SystemKey, string>;
    };
    let map = await read();
    const wanted = DEFAULT_CHART.filter((a) => a.systemKey).map((a) => a.systemKey!);
    if (wanted.every((k) => map[k])) return map;

    // Only one request per business sets up the chart.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ctx.tenantId + ':chart'}))`);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(accounts);
    await tx
      .insert(accounts)
      .values(DEFAULT_CHART.map((a) => ({ ...a, tenantId: ctx.tenantId, isBank: a.isBank ?? false })))
      .onConflictDoNothing();
    map = await read();
    if (n === 0) await this.postExistingStock(tx, ctx, map);
    return map;
  }

  /** Accounts that exist, are active, and may take postings from people (not control accounts). */
  async assertPostable(tx: Tx, ids: string[], opts: { allowControl?: boolean; allowBank?: boolean } = {}) {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map<string, typeof accounts.$inferSelect>();
    const rows = await tx.select().from(accounts).where(inArray(accounts.id, unique));
    if (rows.length !== unique.length) throw new BadRequestException('Unknown account');
    for (const a of rows) {
      if (!a.active) throw new BadRequestException(`The account "${a.name}" is inactive`);
      if (!opts.allowControl && CONTROL_ACCOUNTS.includes(a.systemKey as SystemKey)) {
        throw new BadRequestException(
          `"${a.name}" is kept by invoices, bills and payments. Record those instead of posting to it directly`,
        );
      }
      if (opts.allowBank === false && a.isBank) {
        throw new BadRequestException(`"${a.name}" is a money account. Record a payment or transfer instead`);
      }
    }
    return new Map(rows.map((r) => [r.id, r]));
  }

  async assertBankAccount(tx: Tx, id: string) {
    const [a] = await tx.select().from(accounts).where(eq(accounts.id, id)).limit(1);
    if (!a) throw new BadRequestException('Unknown account');
    if (!a.isBank) throw new BadRequestException(`"${a.name}" is not a cash, bank or mobile money account`);
    if (!a.active) throw new BadRequestException(`The account "${a.name}" is inactive`);
    return a;
  }

  async post(tx: Tx, ctx: Pick<AuthContext, 'tenantId' | 'userId'>, entry: PostEntry) {
    const lines = entry.lines
      .map((l) => {
        const net = (l.debit ?? 0n) - (l.credit ?? 0n);
        return { ...l, debit: net > 0n ? net : 0n, credit: net < 0n ? -net : 0n };
      })
      .filter((l) => l.debit !== 0n || l.credit !== 0n);
    if (lines.length < 2) throw new BadRequestException('A journal entry needs at least two non-zero lines');
    const debits = sum(lines.map((l) => l.debit));
    const credits = sum(lines.map((l) => l.credit));
    if (debits !== credits) {
      throw new BadRequestException(`Debits (${fromCents(debits)}) and credits (${fromCents(credits)}) must be equal`);
    }
    await this.assertOpenPeriod(tx, entry.date);

    const number = await this.nextNumber(tx, ctx.tenantId, 'journal', 'JE');
    const [je] = await tx
      .insert(journalEntries)
      .values({
        tenantId: ctx.tenantId,
        number,
        date: entry.date,
        description: entry.description,
        source: entry.source,
        sourceId: entry.sourceId ?? null,
        reference: entry.reference ?? null,
        reversesId: entry.reversesId ?? null,
        createdBy: ctx.userId,
      })
      .returning();
    await tx.insert(journalLines).values(
      lines.map((l) => ({
        tenantId: ctx.tenantId,
        entryId: je.id,
        accountId: l.accountId,
        debit: fromCents(l.debit),
        credit: fromCents(l.credit),
        memo: l.memo ?? null,
        currencyCode: l.foreignAmount != null ? (l.currencyCode ?? null) : null,
        foreignAmount: l.foreignAmount != null ? fromCents(l.foreignAmount < 0n ? -l.foreignAmount : l.foreignAmount) : null,
        rate: l.foreignAmount != null ? (l.rate ?? null) : null,
      })),
    );
    return je;
  }

  /**
   * Cancels an entry with an equal and opposite one. Dated on the original
   * day when that period is still open, otherwise today.
   */
  async reverse(tx: Tx, ctx: Pick<AuthContext, 'tenantId' | 'userId'>, entryId: string, opts: { date?: string; description?: string } = {}) {
    const [je] = await tx.select().from(journalEntries).where(eq(journalEntries.id, entryId)).limit(1);
    if (!je) throw new BadRequestException('Journal entry not found');
    if (je.reversesId) throw new BadRequestException('A reversing entry cannot itself be reversed. Post a new entry instead');
    const [already] = await tx
      .select({ number: journalEntries.number })
      .from(journalEntries)
      .where(eq(journalEntries.reversesId, je.id))
      .limit(1);
    if (already) throw new BadRequestException(`This entry was already reversed by ${already.number}`);

    const lines = await tx.select().from(journalLines).where(eq(journalLines.entryId, je.id));
    const { booksClosedThrough, timezone } = await this.books(tx);
    const date = opts.date ?? (booksClosedThrough && je.date <= booksClosedThrough ? localDate(timezone) : je.date);
    return this.post(tx, ctx, {
      date,
      description: opts.description ?? `Reversal of ${je.number}: ${je.description}`,
      source: 'reversal',
      sourceId: je.sourceId,
      reference: je.number,
      reversesId: je.id,
      lines: lines.map((l) => ({
        accountId: l.accountId,
        debit: toCents(l.credit),
        credit: toCents(l.debit),
        memo: l.memo,
        currencyCode: l.currencyCode,
        foreignAmount: l.foreignAmount != null ? toCents(l.foreignAmount) : null,
        rate: l.rate,
      })),
    });
  }

  /**
   * Values stock movements at cost and posts them: goods received against
   * "Stock received, not yet billed", opening stock against opening balances,
   * and waste or count differences against stock losses. Transfers between
   * stores don't change the value of stock, so they post nothing.
   */
  async postStockMovements(
    tx: Tx,
    ctx: Pick<AuthContext, 'tenantId' | 'userId'>,
    movements: StockMovementForPosting[],
    opts: { description: string; reference?: string | null },
  ) {
    if (!movements.length) return null;
    const ids = [...new Set(movements.map((m) => m.variantId))];
    const costs = new Map(
      (
        await tx
          .select({ id: productVariants.id, cost: productVariants.costPrice })
          .from(productVariants)
          .where(inArray(productVariants.id, ids))
      ).map((r) => [r.id, r.cost]),
    );

    const counterpart: Partial<Record<string, SystemKey>> = {
      opening: 'opening_balance',
      receive: 'grni',
      adjustment: 'stock_loss',
      waste: 'stock_loss',
    };
    const change = new Map<SystemKey, bigint>();
    for (const m of movements) {
      const key = counterpart[m.type];
      if (!key) continue;
      const cost = m.unitCost ?? costs.get(m.variantId);
      if (!cost) continue;
      const value = divRound(parseFixed(m.quantity, 3) * toCents(cost), 1000n);
      change.set(key, (change.get(key) ?? 0n) + value);
    }
    const total = sum([...change.values()]);
    if (![...change.values()].some((v) => v !== 0n)) return null;

    const acc = await this.systemAccounts(tx, ctx);
    return this.post(tx, ctx, {
      date: await this.today(tx),
      description: opts.description,
      source: 'stock',
      reference: opts.reference ?? null,
      lines: [
        { accountId: acc.inventory, debit: total },
        ...[...change.entries()].map(([key, v]) => ({ accountId: acc[key], credit: v })),
      ],
    });
  }

  /** When the chart is first created, brings the value of stock already on hand into the books. */
  private async postExistingStock(tx: Tx, ctx: Pick<AuthContext, 'tenantId' | 'userId'>, acc: Record<SystemKey, string>) {
    const res = await tx.execute(sql`
      SELECT coalesce(round(sum(m.quantity * coalesce(v.cost_price, 0)), 2), 0)::text AS value
      FROM stock_movements m JOIN product_variants v ON v.id = m.variant_id`);
    const value = toCents((res.rows[0] as { value: string }).value);
    if (value <= 0n) return;
    const { booksClosedThrough, timezone } = await this.books(tx);
    const today = localDate(timezone);
    if (booksClosedThrough && today <= booksClosedThrough) return;
    await this.post(tx, ctx, {
      date: today,
      description: 'Value of stock on hand when the accounts were set up',
      source: 'opening',
      lines: [
        { accountId: acc.inventory, debit: value },
        { accountId: acc.opening_balance, credit: value },
      ],
    });
  }

  /** Balance of each account (debits − credits, in cents) up to and including a date. */
  async balances(tx: Tx, opts: { through?: string; from?: string } = {}) {
    const where = [sql`true`];
    if (opts.through) where.push(sql`e.date <= ${opts.through}`);
    if (opts.from) where.push(sql`e.date >= ${opts.from}`);
    const res = await tx.execute(sql`
      SELECT l.account_id, sum(l.debit)::text AS debit, sum(l.credit)::text AS credit
      FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE ${and(...where)}
      GROUP BY l.account_id`);
    return new Map(
      (res.rows as { account_id: string; debit: string; credit: string }[]).map((r) => [
        r.account_id,
        { debit: toCents(r.debit), credit: toCents(r.credit) },
      ]),
    );
  }
}

/** YYYY-MM-DD for "now" in a time zone. */
export function localDate(timezone: string, at = new Date()) {
  try {
    return at.toLocaleDateString('en-CA', { timeZone: timezone });
  } catch {
    return at.toISOString().slice(0, 10);
  }
}
