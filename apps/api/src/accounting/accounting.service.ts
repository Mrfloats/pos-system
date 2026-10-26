import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, SQL, sql } from 'drizzle-orm';
import { AuditService } from '../common/audit.service.js';
import { ADMINS, type AuthContext } from '../common/auth-context.js';
import { found, likeEscape } from '../common/validation.js';
import { DbService, Tx } from '../db/db.service.js';
import { accounts, journalEntries, journalLines, tenants, users } from '../db/schema.js';
import { CloseBooksDto, CreateAccountDto, CreateJournalDto, JournalQuery, ReverseDto, UpdateAccountDto } from './accounting.dto.js';
import type { AccountType } from './chart.js';
import { LedgerService } from './ledger.service.js';
import { fromCents, toCents } from './money.js';

/** Balance in the account's normal direction: assets and expenses grow with debits, the rest with credits. */
export const natural = (type: AccountType, debit: bigint, credit: bigint) =>
  type === 'asset' || type === 'expense' ? debit - credit : credit - debit;

/** Entries made by documents are undone by voiding the document, so the two never disagree. */
const VOID_INSTEAD: Record<string, string> = {
  invoice: 'Void the invoice instead',
  invoice_payment: 'Void the payment instead',
  bill: 'Void the bill instead',
  bill_payment: 'Void the payment instead',
  expense: 'Void the expense instead',
  stock: 'Correct the stock with an adjustment instead',
  sale: 'Void the sale or record a return instead',
  sale_return: 'Void the return instead',
  cash_transfer: 'This is a cash transfer from a till; record a new transfer to correct it',
};

@Injectable()
export class AccountingService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
  ) {}

  // ----- Chart of accounts ------------------------------------------------------------

  listAccounts(ctx: AuthContext) {
    return this.dbs.withTenant(ctx, async (tx) => {
      await this.ledger.systemAccounts(tx, ctx);
      const rows = await tx.select().from(accounts).orderBy(asc(accounts.code));
      const balances = await this.ledger.balances(tx);
      return rows.map((a) => {
        const b = balances.get(a.id) ?? { debit: 0n, credit: 0n };
        return { ...a, balance: fromCents(natural(a.type, b.debit, b.credit)), hasActivity: balances.has(a.id) };
      });
    });
  }

  createAccount(ctx: AuthContext, dto: CreateAccountDto) {
    if (dto.isBank && dto.type !== 'asset') throw new BadRequestException('Only asset accounts can hold money');
    return this.dbs.withTenant(ctx, async (tx) => {
      await this.ledger.systemAccounts(tx, ctx);
      const [row] = await tx
        .insert(accounts)
        .values({ ...dto, code: dto.code.toUpperCase(), tenantId: ctx.tenantId, isBank: dto.isBank ?? false })
        .returning();
      await this.audit.log(tx, ctx, 'create', 'Account', row.id, dto);
      return row;
    });
  }

  updateAccount(ctx: AuthContext, id: string, dto: UpdateAccountDto) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const [a] = await tx.select().from(accounts).where(eq(accounts.id, id)).limit(1);
      found(a, 'Account');
      if (a.systemKey && dto.active === false) throw new BadRequestException(`"${a.name}" is used automatically and can't be switched off`);
      if (a.systemKey && dto.isBank !== undefined && dto.isBank !== a.isBank) {
        throw new BadRequestException(`"${a.name}" is used automatically; its type can't change`);
      }
      if (dto.isBank && a.type !== 'asset') throw new BadRequestException('Only asset accounts can hold money');
      if (dto.active === false) {
        const b = (await this.ledger.balances(tx)).get(id);
        if (b && b.debit !== b.credit) {
          throw new BadRequestException(`"${a.name}" still has a balance. Move it to another account before switching this one off`);
        }
      }
      const changes = { ...dto, ...(dto.code ? { code: dto.code.toUpperCase() } : {}) };
      const [row] = await tx.update(accounts).set(changes).where(eq(accounts.id, id)).returning();
      await this.audit.log(tx, ctx, 'update', 'Account', id, changes);
      return row;
    });
  }

  // ----- Journal entries -------------------------------------------------------------------

  listJournals(ctx: AuthContext, q: JournalQuery) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const where: (SQL | undefined)[] = [];
      if (q.from) where.push(gte(journalEntries.date, q.from));
      if (q.to) where.push(lte(journalEntries.date, q.to));
      if (q.source) where.push(eq(journalEntries.source, q.source));
      if (q.accountId) {
        where.push(sql`EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.entry_id = "journal_entries"."id" AND jl.account_id = ${q.accountId})`);
      }
      if (q.search) {
        const p = likeEscape(q.search);
        where.push(or(ilike(journalEntries.number, p), ilike(journalEntries.description, p), ilike(journalEntries.reference, p)));
      }
      const condition = and(...where);
      const [{ total }] = await tx.select({ total: count() }).from(journalEntries).where(condition);
      const entries = await tx
        .select({ entry: journalEntries, createdByName: users.fullName })
        .from(journalEntries)
        .leftJoin(users, eq(users.id, journalEntries.createdBy))
        .where(condition)
        .orderBy(desc(journalEntries.date), desc(journalEntries.number))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
      const items = await this.withLines(tx, entries);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  getJournal(ctx: AuthContext, id: string) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const rows = await tx
        .select({ entry: journalEntries, createdByName: users.fullName })
        .from(journalEntries)
        .leftJoin(users, eq(users.id, journalEntries.createdBy))
        .where(eq(journalEntries.id, id))
        .limit(1);
      found(rows[0], 'Journal entry');
      return (await this.withLines(tx, rows))[0];
    });
  }

  private async withLines(
    tx: Tx,
    entries: { entry: typeof journalEntries.$inferSelect; createdByName: string | null }[],
  ) {
    const ids = entries.map((e) => e.entry.id);
    if (!ids.length) return [];
    const lines = await tx
      .select({ line: journalLines, accountCode: accounts.code, accountName: accounts.name })
      .from(journalLines)
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(inArray(journalLines.entryId, ids))
      .orderBy(desc(journalLines.debit), asc(accounts.code));
    const reversals = await tx
      .select({ reversesId: journalEntries.reversesId, number: journalEntries.number })
      .from(journalEntries)
      .where(inArray(journalEntries.reversesId, ids));
    const reversedBy = new Map(reversals.map((r) => [r.reversesId, r.number]));
    return entries.map(({ entry, createdByName }) => ({
      ...entry,
      createdByName,
      reversedBy: reversedBy.get(entry.id) ?? null,
      lines: lines
        .filter((l) => l.line.entryId === entry.id)
        .map((l) => ({ ...l.line, accountCode: l.accountCode, accountName: l.accountName })),
    }));
  }

  createJournal(ctx: AuthContext, dto: CreateJournalDto) {
    return this.dbs.withTenant(ctx, async (tx) => {
      await this.ledger.systemAccounts(tx, ctx);
      await this.ledger.assertPostable(tx, dto.lines.map((l) => l.accountId));
      const lines = dto.lines.map((l) => {
        const debit = toCents(l.debit ?? '0');
        const credit = toCents(l.credit ?? '0');
        if ((debit > 0n) === (credit > 0n)) throw new BadRequestException('Each line needs either a debit or a credit amount');
        return { accountId: l.accountId, debit, credit, memo: l.memo ?? null };
      });
      const je = await this.ledger.post(tx, ctx, {
        date: dto.date,
        description: dto.description,
        source: dto.opening ? 'opening' : 'manual',
        reference: dto.reference ?? null,
        lines,
      });
      await this.audit.log(tx, ctx, 'create', 'Journal entry', je.id, { number: je.number, date: dto.date });
      return je;
    }).then((je) => this.getJournal(ctx, je.id));
  }

  reverseJournal(ctx: AuthContext, id: string, dto: ReverseDto) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const [je] = await tx.select().from(journalEntries).where(eq(journalEntries.id, id)).limit(1);
      found(je, 'Journal entry');
      const instead = VOID_INSTEAD[je.source];
      if (instead) throw new BadRequestException(`This entry was made by a ${je.source.replace('_', ' ')}. ${instead}`);
      const rev = await this.ledger.reverse(tx, ctx, id, { date: dto.date });
      await this.audit.log(tx, ctx, 'reverse', 'Journal entry', id, { number: je.number, reversal: rev.number });
      return rev;
    }).then((rev) => this.getJournal(ctx, rev.id));
  }

  // ----- Closing periods ---------------------------------------------------------------------

  periods(ctx: AuthContext) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const b = await this.ledger.books(tx);
      return { baseCurrency: b.baseCurrency, booksClosedThrough: b.booksClosedThrough, today: await this.ledger.today(tx) };
    });
  }

  /** Locks every day up to `through`. Moving the date back (reopening) is for owners and admins only. */
  closeBooks(ctx: AuthContext, dto: CloseBooksDto) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const b = await this.ledger.books(tx);
      const through = dto.through ?? null;
      const reopening = b.booksClosedThrough && (!through || through < b.booksClosedThrough);
      if (reopening && !ADMINS.includes(ctx.role)) {
        throw new ForbiddenException('Only an owner or admin can reopen a closed period');
      }
      if (through && through >= (await this.ledger.today(tx))) {
        throw new BadRequestException('You can only close days that have already ended');
      }
      await tx.update(tenants).set({ booksClosedThrough: through }).where(eq(tenants.id, ctx.tenantId));
      await this.audit.log(tx, ctx, reopening ? 'reopen_books' : 'close_books', 'Books', null, {
        from: b.booksClosedThrough,
        to: through,
      });
      return { baseCurrency: b.baseCurrency, booksClosedThrough: through, today: await this.ledger.today(tx) };
    });
  }
}
