import { BadRequestException, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, SQL, sql } from 'drizzle-orm';
import { AuditService } from '../common/audit.service.js';
import { type AuthContext } from '../common/auth-context.js';
import { assertOwned } from '../common/ownership.js';
import { TenantCrud } from '../common/tenant-crud.js';
import { found, likeEscape, Page } from '../common/validation.js';
import { DbService, Tx } from '../db/db.service.js';
import {
  accounts,
  billLines,
  bills,
  customers,
  expenses,
  invoiceLines,
  invoices,
  payments,
  stockMovements,
  suppliers,
  taxRates,
} from '../db/schema.js';
import {
  CreateBillDto,
  CreateExpenseDto,
  CreateInvoiceDto,
  CreateTransferDto,
  DocumentQuery,
  ExpenseQuery,
  PaymentDto,
} from './accounting.dto.js';
import { LedgerService } from './ledger.service.js';
import { formatFixed, fromCents, lineAmounts, parseFixed, sum, toBase, toCents } from './money.js';

type DocKind = 'invoice' | 'bill';

/**
 * Everything that differs between a customer invoice and a supplier bill.
 * The two mirror each other: an invoice debits what customers owe us and
 * credits income; a bill credits what we owe suppliers and debits costs.
 */
const KIND = {
  invoice: {
    table: invoices,
    lines: invoiceLines,
    lineFk: invoiceLines.invoiceId,
    paymentFk: payments.invoiceId,
    label: 'Invoice',
    prefix: 'INV',
    paymentPrefix: 'RCT',
    paymentKind: 'invoice_receipt' as const,
    control: 'receivables' as const,
    tax: 'vat_output' as const,
    /** +1: the control account is debited when the document is posted. */
    side: 1n,
  },
  bill: {
    table: bills,
    lines: billLines,
    lineFk: billLines.billId,
    paymentFk: payments.billId,
    label: 'Bill',
    prefix: 'BILL',
    paymentPrefix: 'PAY',
    paymentKind: 'bill_payment' as const,
    control: 'payables' as const,
    tax: 'vat_input' as const,
    side: -1n,
  },
};

const addDays = (day: string, days: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

@Injectable()
export class SuppliersService extends TenantCrud<typeof suppliers> {
  constructor(dbs: DbService, audit: AuditService) {
    super(dbs, audit, suppliers, { entity: 'Supplier', orderBy: [suppliers.name] });
  }

  page(ctx: AuthContext, q: { search?: string; page: number; pageSize: number }): Promise<Page<any>> {
    return this.dbs.withTenant(ctx, async (tx) => {
      const where = q.search
        ? or(ilike(suppliers.name, likeEscape(q.search)), ilike(suppliers.phone, likeEscape(q.search)), ilike(suppliers.tin, likeEscape(q.search)))
        : undefined;
      const [{ total }] = await tx.select({ total: count() }).from(suppliers).where(where);
      const items = await tx
        .select({
          supplier: suppliers,
          // In the base currency, so bills in different currencies add up.
          owed: sql<string>`coalesce((
            SELECT sum(b.total_base - coalesce((SELECT sum(p.cleared_base) FROM payments p WHERE p.bill_id = b.id AND p.status = 'posted'), 0))
            FROM bills b WHERE b.supplier_id = "suppliers"."id" AND b.status = 'posted'
          ), 0)::text`,
        })
        .from(suppliers)
        .where(where)
        .orderBy(asc(suppliers.name))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
      return { items: items.map((i) => ({ ...i.supplier, owed: fromCents(toCents(i.owed)) })), total, page: q.page, pageSize: q.pageSize };
    });
  }
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
  ) {}

  // ----- Shared helpers ------------------------------------------------------------

  /** The currency and rate a document uses. The base currency always has rate 1. */
  resolveCurrency(tx: Tx, code: string | undefined, rate: string | undefined) {
    return this.ledger.resolveCurrency(tx, code, rate);
  }

  /** Balance still owed on each document, in its own currency. */
  private paidSql(kind: DocKind) {
    return sql<string>`coalesce((SELECT sum(p.amount) FROM payments p WHERE p.${sql.raw(kind === 'invoice' ? 'invoice_id' : 'bill_id')} = ${sql.raw(kind === 'invoice' ? '"invoices"."id"' : '"bills"."id"')} AND p.status = 'posted'), 0)`;
  }

  // ----- Invoices and bills ---------------------------------------------------------

  listDocuments(ctx: AuthContext, kind: DocKind, q: DocumentQuery) {
    const k = KIND[kind];
    const t = k.table;
    return this.dbs.withTenant(ctx, async (tx) => {
      const today = await this.ledger.today(tx);
      const paid = this.paidSql(kind);
      const where: (SQL | undefined)[] = [];
      if (q.from) where.push(gte(t.date, q.from));
      if (q.to) where.push(lte(t.date, q.to));
      if (kind === 'invoice' && q.customerId) where.push(eq(invoices.customerId, q.customerId));
      if (kind === 'bill' && q.supplierId) where.push(eq(bills.supplierId, q.supplierId));
      if (kind === 'bill' && q.purchases) where.push(sql`${bills.storeId} IS NOT NULL`);
      if (q.status === 'void') where.push(eq(t.status, 'void'));
      if (q.status === 'paid') where.push(and(eq(t.status, 'posted'), sql`${t.total} - ${paid} <= 0`));
      if (q.status === 'unpaid') where.push(and(eq(t.status, 'posted'), sql`${t.total} - ${paid} > 0`));
      if (q.status === 'overdue') where.push(and(eq(t.status, 'posted'), sql`${t.total} - ${paid} > 0`, sql`${t.dueDate} < ${today}`));
      const party = kind === 'invoice' ? customers : suppliers;
      const partyFk = kind === 'invoice' ? invoices.customerId : bills.supplierId;
      if (q.search) {
        const p = likeEscape(q.search);
        where.push(
          or(
            ilike(t.number, p),
            ilike(party.name, p),
            ...(kind === 'bill' ? [ilike(bills.supplierReference, p)] : []),
          ),
        );
      }
      const condition = and(...where);
      const [{ total }] = await tx
        .select({ total: count() })
        .from(t as typeof invoices)
        .innerJoin(party as typeof customers, eq(party.id, partyFk))
        .where(condition);
      const rows = await tx
        .select({
          doc: t as typeof invoices,
          partyName: party.name,
          paid: sql<string>`${paid}::text`,
          storeName: kind === 'bill' ? sql<string | null>`(SELECT st.name FROM stores st WHERE st.id = "bills"."store_id")` : sql<null>`NULL`,
        })
        .from(t as typeof invoices)
        .innerJoin(party as typeof customers, eq(party.id, partyFk))
        .where(condition)
        .orderBy(desc(t.date), desc(t.number))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
      return {
        items: rows.map((r) => this.withStatus({ ...r.doc, partyName: r.partyName, storeName: r.storeName }, r.paid, today)),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  private withStatus<T extends { total: string; status: string; dueDate: string }>(doc: T, paid: string, today: string) {
    const balance = toCents(doc.total) - toCents(paid);
    const state =
      doc.status === 'void'
        ? 'void'
        : balance <= 0n
          ? 'paid'
          : doc.dueDate < today
            ? 'overdue'
            : toCents(paid) > 0n
              ? 'part_paid'
              : 'unpaid';
    return { ...doc, amountPaid: fromCents(toCents(paid)), balance: fromCents(balance > 0n ? balance : 0n), state };
  }

  getDocument(ctx: AuthContext, kind: DocKind, id: string) {
    return this.dbs.withTenant(ctx, (tx) => this.getDocumentIn(tx, kind, id));
  }

  private async getDocumentIn(tx: Tx, kind: DocKind, id: string) {
    const k = KIND[kind];
    const [doc] = await tx
      .select()
      .from(k.table as typeof invoices)
      .where(eq(k.table.id, id))
      .limit(1);
    found(doc, k.label);
    const lines = await tx
      .select({ line: k.lines as typeof invoiceLines, accountName: accounts.name, accountCode: accounts.code, taxRateName: taxRates.name })
      .from(k.lines as typeof invoiceLines)
      .innerJoin(accounts, eq(accounts.id, k.lines.accountId))
      .leftJoin(taxRates, eq(taxRates.id, k.lines.taxRateId))
      .where(eq(k.lineFk, id))
      .orderBy(asc(k.lines.sortOrder));
    const docPayments = await tx
      .select({ payment: payments, accountName: accounts.name })
      .from(payments)
      .innerJoin(accounts, eq(accounts.id, payments.accountId))
      .where(eq(k.paymentFk, id))
      .orderBy(asc(payments.date), asc(payments.number));
    const partyId = kind === 'invoice' ? (doc as typeof invoices.$inferSelect).customerId : (doc as unknown as typeof bills.$inferSelect).supplierId;
    const party = kind === 'invoice' ? customers : suppliers;
    const [p] = await tx.select().from(party as typeof customers).where(eq(party.id, partyId)).limit(1);
    const paid = sum(docPayments.filter((x) => x.payment.status === 'posted').map((x) => toCents(x.payment.amount)));
    const storeId = kind === 'bill' ? (doc as unknown as typeof bills.$inferSelect).storeId : null;
    const [store] = storeId ? ((await tx.execute(sql`SELECT name FROM stores WHERE id = ${storeId}`)).rows as { name: string }[]) : [];
    return {
      ...this.withStatus(doc, fromCents(paid), await this.ledger.today(tx)),
      party: p,
      storeName: store?.name ?? null,
      lines: lines.map((l) => ({ ...l.line, accountName: l.accountName, accountCode: l.accountCode, taxRateName: l.taxRateName })),
      payments: docPayments.map((x) => ({ ...x.payment, accountName: x.accountName })),
    };
  }

  createInvoice(ctx: AuthContext, dto: CreateInvoiceDto) {
    return this.createDocument(ctx, 'invoice', dto);
  }

  createBill(ctx: AuthContext, dto: CreateBillDto) {
    return this.createDocument(ctx, 'bill', dto);
  }

  private createDocument(ctx: AuthContext, kind: DocKind, dto: CreateInvoiceDto | CreateBillDto) {
    return this.dbs.withTenant(ctx, async (tx) => this.getDocumentIn(tx, kind, await this.createDocumentIn(tx, ctx, kind, dto)));
  }

  /**
   * Posts an invoice or bill inside the caller's transaction and returns its id.
   * Purchases pass the store and, per line, the item received.
   */
  async createDocumentIn(
    tx: Tx,
    ctx: AuthContext,
    kind: DocKind,
    dto: CreateInvoiceDto | CreateBillDto,
    extra: { storeId?: string; variantIds?: (string | null)[] } = {},
  ): Promise<string> {
    const k = KIND[kind];
    {
      await this.ledger.assertOpenPeriod(tx, dto.date);
      const acc = await this.ledger.systemAccounts(tx, ctx);

      // The customer or supplier
      let party: { name: string; creditLimit?: string | null; paymentTermsDays?: number };
      if (kind === 'invoice') {
        const [c] = await tx.select().from(customers).where(eq(customers.id, (dto as CreateInvoiceDto).customerId)).limit(1);
        if (!c) throw new BadRequestException('Unknown customer');
        party = c;
      } else {
        const [s] = await tx.select().from(suppliers).where(eq(suppliers.id, (dto as CreateBillDto).supplierId)).limit(1);
        if (!s) throw new BadRequestException('Unknown supplier');
        party = s;
      }

      const { currencyCode, rate, isBase } = await this.resolveCurrency(tx, dto.currencyCode, dto.rate);
      const lineAccountIds = dto.lines.map((l) => {
        if (l.accountId) return l.accountId;
        if (kind === 'invoice') return acc.sales;
        throw new BadRequestException('Choose an account for every bill line');
      });
      await this.ledger.assertPostable(tx, lineAccountIds, { allowBank: false });
      const rateIds = [...new Set(dto.lines.map((l) => l.taxRateId).filter((v): v is string => !!v))];
      const rates = new Map(
        rateIds.length ? (await tx.select().from(taxRates).where(inArray(taxRates.id, rateIds))).map((r) => [r.id, r]) : [],
      );
      if (rates.size !== rateIds.length) throw new BadRequestException('Unknown tax rate');

      const inclusive = dto.taxInclusive ?? false;
      const lines = dto.lines.map((l, i) => {
        const quantity = l.quantity ?? '1';
        if (toCents(quantity) <= 0n) throw new BadRequestException('Quantities must be more than zero');
        const { net, tax } = lineAmounts({
          quantity,
          unitPrice: l.unitPrice,
          taxPercent: l.taxRateId ? rates.get(l.taxRateId)!.rate : null,
          inclusive,
        });
        return {
          accountId: lineAccountIds[i],
          description: l.description,
          quantity,
          unitPrice: l.unitPrice,
          taxRateId: l.taxRateId ?? null,
          net,
          tax,
          netBase: isBase ? net : toBase(net, rate),
          taxBase: isBase ? tax : toBase(tax, rate),
          sortOrder: i,
        };
      });
      const subtotal = sum(lines.map((l) => l.net));
      const taxTotal = sum(lines.map((l) => l.tax));
      const total = subtotal + taxTotal;
      const totalBase = sum(lines.map((l) => l.netBase + l.taxBase));
      if (total <= 0n) throw new BadRequestException(`${k.label} total must be more than zero`);

      if (kind === 'invoice' && party.creditLimit != null) {
        await this.assertCreditLimit(tx, (dto as CreateInvoiceDto).customerId, party.name, toCents(party.creditLimit), totalBase);
      }

      const number = await this.ledger.nextNumber(tx, ctx.tenantId, kind, k.prefix);
      const dueDate = dto.dueDate ?? (kind === 'bill' ? addDays(dto.date, party.paymentTermsDays ?? 30) : dto.date);
      if (dueDate < dto.date) throw new BadRequestException('The due date cannot be before the date');

      const [doc] = await (tx.insert(k.table) as any)
        .values({
          tenantId: ctx.tenantId,
          number,
          date: dto.date,
          dueDate,
          currencyCode,
          rate,
          taxInclusive: inclusive,
          subtotal: fromCents(subtotal),
          taxTotal: fromCents(taxTotal),
          total: fromCents(total),
          totalBase: fromCents(totalBase),
          notes: dto.notes ?? null,
          createdBy: ctx.userId,
          ...(kind === 'invoice'
            ? { customerId: (dto as CreateInvoiceDto).customerId }
            : {
                supplierId: (dto as CreateBillDto).supplierId,
                supplierReference: (dto as CreateBillDto).supplierReference ?? null,
                storeId: extra.storeId ?? null,
              }),
        })
        .returning();
      await (tx.insert(k.lines) as any).values(
        lines.map((l, i) => ({
          ...l,
          ...(kind === 'bill' ? { variantId: extra.variantIds?.[i] ?? null } : {}),
          tenantId: ctx.tenantId,
          [kind === 'invoice' ? 'invoiceId' : 'billId']: doc.id,
          net: fromCents(l.net),
          tax: fromCents(l.tax),
          netBase: fromCents(l.netBase),
          taxBase: fromCents(l.taxBase),
        })),
      );

      // Invoice: Dr receivables / Cr income, Cr VAT owed. Bill: the mirror image.
      const fx = (cents: bigint) => (isBase ? {} : { currencyCode, foreignAmount: cents, rate });
      const s = k.side;
      const je = await this.ledger.post(tx, ctx, {
        date: dto.date,
        description: `${k.label} ${number} · ${party.name}`,
        source: kind,
        sourceId: doc.id,
        reference: kind === 'bill' ? ((dto as CreateBillDto).supplierReference ?? number) : number,
        lines: [
          { accountId: acc[k.control], debit: s * totalBase, ...fx(total) },
          ...lines.map((l) => ({ accountId: l.accountId, debit: -s * l.netBase, memo: l.description, ...fx(l.net) })),
          { accountId: acc[k.tax], debit: -s * sum(lines.map((l) => l.taxBase)), ...fx(taxTotal) },
        ],
      });
      await (tx.update(k.table) as any).set({ journalEntryId: je.id }).where(eq(k.table.id, doc.id));
      await this.audit.log(tx, ctx, 'create', k.label, doc.id, { number, total: fromCents(total), currencyCode });
      return doc.id as string;
    }
  }

  private async assertCreditLimit(tx: Tx, customerId: string, name: string, limit: bigint, adding: bigint) {
    const res = await tx.execute(sql`
      SELECT coalesce(sum(i.total_base), 0) - coalesce((
        SELECT sum(p.cleared_base) FROM payments p JOIN invoices i2 ON i2.id = p.invoice_id
        WHERE i2.customer_id = ${customerId} AND i2.status = 'posted' AND p.status = 'posted'
      ), 0) AS owed
      FROM invoices i WHERE i.customer_id = ${customerId} AND i.status = 'posted'`);
    const owed = toCents(String((res.rows[0] as { owed: string }).owed));
    if (owed + adding > limit) {
      throw new BadRequestException(
        `${name} would owe ${fromCents(owed + adding)}, over their credit limit of ${fromCents(limit)}. Take a payment first or raise the limit`,
      );
    }
  }

  /** Cancels an invoice or bill with a reversing entry. Payments against it must be voided first. */
  voidDocument(ctx: AuthContext, kind: DocKind, id: string) {
    const k = KIND[kind];
    return this.dbs.withTenant(ctx, async (tx) => {
      const [doc] = await tx
        .select()
        .from(k.table as typeof invoices)
        .where(eq(k.table.id, id))
        .limit(1);
      found(doc, k.label);
      if (doc.status === 'void') throw new BadRequestException(`This ${k.label.toLowerCase()} is already void`);
      const [live] = await tx
        .select({ n: count() })
        .from(payments)
        .where(and(eq(k.paymentFk, id), eq(payments.status, 'posted')));
      if (live.n > 0) throw new BadRequestException(`Void the payments on this ${k.label.toLowerCase()} first`);
      if (doc.journalEntryId) await this.ledger.reverse(tx, ctx, doc.journalEntryId, { description: `${k.label} ${doc.number} voided` });
      if (kind === 'bill' && (doc as unknown as typeof bills.$inferSelect).storeId) {
        const received = await tx
          .select()
          .from(stockMovements)
          .where(and(eq(stockMovements.reference, doc.number), eq(stockMovements.type, 'receive')));
        if (received.length) {
          await tx.insert(stockMovements).values(
            received.map((m) => ({
              tenantId: ctx.tenantId,
              storeId: m.storeId,
              variantId: m.variantId,
              quantity: formatFixed(-parseFixed(m.quantity, 3), 3),
              type: 'receive' as const,
              unitCost: m.unitCost,
              reference: `${doc.number} void`,
              note: 'Purchase voided',
              createdBy: ctx.userId,
            })),
          );
        }
      }
      await (tx.update(k.table) as any).set({ status: 'void' }).where(eq(k.table.id, id));
      await this.audit.log(tx, ctx, 'void', k.label, id, { number: doc.number });
      return this.getDocumentIn(tx, kind, id);
    });
  }

  /** Money received for an invoice, or paid against a bill. */
  pay(ctx: AuthContext, kind: DocKind, id: string, dto: PaymentDto) {
    return this.dbs.withTenant(ctx, async (tx) => {
      await this.payIn(tx, ctx, kind, id, dto);
      return this.getDocumentIn(tx, kind, id);
    });
  }

  /** Records a payment inside the caller's transaction. */
  async payIn(tx: Tx, ctx: AuthContext, kind: DocKind, id: string, dto: PaymentDto) {
    const k = KIND[kind];
    {
      const [doc] = await tx
        .select()
        .from(k.table as typeof invoices)
        .where(eq(k.table.id, id))
        .limit(1);
      found(doc, k.label);
      if (doc.status === 'void') throw new BadRequestException(`This ${k.label.toLowerCase()} is void`);
      if (dto.date < doc.date) throw new BadRequestException(`The payment date cannot be before the ${k.label.toLowerCase()} date`);
      const bank = await this.ledger.assertBankAccount(tx, dto.accountId);
      const acc = await this.ledger.systemAccounts(tx, ctx);

      const prior = await tx
        .select({ amount: payments.amount, clearedBase: payments.clearedBase })
        .from(payments)
        .where(and(eq(k.paymentFk, id), eq(payments.status, 'posted')));
      const balance = toCents(doc.total) - sum(prior.map((p) => toCents(p.amount)));
      const amount = toCents(dto.amount);
      if (amount <= 0n) throw new BadRequestException('Amount must be more than zero');
      if (amount > balance) {
        throw new BadRequestException(`That's more than the ${fromCents(balance)} ${doc.currencyCode} still owed`);
      }

      const { rate, isBase } = await this.resolveCurrency(tx, doc.currencyCode, dto.rate);
      const amountBase = isBase ? amount : toBase(amount, rate);
      // The last payment clears exactly what's left, so no rounding crumbs stay on the books.
      const clearedBase =
        amount === balance
          ? toCents(doc.totalBase) - sum(prior.map((p) => toCents(p.clearedBase)))
          : isBase
            ? amount
            : toBase(amount, doc.rate);
      const gain = k.side * (amountBase - clearedBase); // positive = exchange gain

      const number = await this.ledger.nextNumber(tx, ctx.tenantId, k.paymentKind, k.paymentPrefix);
      const [payment] = await tx
        .insert(payments)
        .values({
          tenantId: ctx.tenantId,
          number,
          kind: k.paymentKind,
          [kind === 'invoice' ? 'invoiceId' : 'billId']: id,
          accountId: bank.id,
          date: dto.date,
          currencyCode: doc.currencyCode,
          rate,
          amount: fromCents(amount),
          amountBase: fromCents(amountBase),
          clearedBase: fromCents(clearedBase),
          reference: dto.reference ?? null,
          createdBy: ctx.userId,
        })
        .returning();

      const fx = isBase ? {} : { currencyCode: doc.currencyCode, foreignAmount: amount, rate };
      const s = k.side;
      const je = await this.ledger.post(tx, ctx, {
        date: dto.date,
        description: `${kind === 'invoice' ? 'Payment received for' : 'Payment of'} ${doc.number}`,
        source: kind === 'invoice' ? 'invoice_payment' : 'bill_payment',
        sourceId: payment.id,
        reference: dto.reference ?? number,
        lines: [
          { accountId: bank.id, debit: s * amountBase, ...fx },
          { accountId: acc[k.control], debit: -s * clearedBase, ...fx },
          { accountId: acc.fx, debit: -gain, memo: gain > 0n ? 'Exchange gain' : 'Exchange loss' },
        ],
      });
      await tx.update(payments).set({ journalEntryId: je.id }).where(eq(payments.id, payment.id));
      await this.audit.log(tx, ctx, 'create', 'Payment', payment.id, { number, document: doc.number, amount: dto.amount });
    }
  }

  voidPayment(ctx: AuthContext, id: string) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const [p] = await tx.select().from(payments).where(eq(payments.id, id)).limit(1);
      found(p, 'Payment');
      if (p.status === 'void') throw new BadRequestException('This payment is already void');
      if (p.journalEntryId) await this.ledger.reverse(tx, ctx, p.journalEntryId, { description: `Payment ${p.number} voided` });
      await tx.update(payments).set({ status: 'void' }).where(eq(payments.id, id));
      await this.audit.log(tx, ctx, 'void', 'Payment', id, { number: p.number });
      const kind: DocKind = p.invoiceId ? 'invoice' : 'bill';
      return this.getDocumentIn(tx, kind, (p.invoiceId ?? p.billId)!);
    });
  }

  // ----- Expenses ------------------------------------------------------------------

  listExpenses(ctx: AuthContext, q: ExpenseQuery) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const where: (SQL | undefined)[] = [];
      if (q.from) where.push(gte(expenses.date, q.from));
      if (q.to) where.push(lte(expenses.date, q.to));
      if (q.accountId) where.push(eq(expenses.accountId, q.accountId));
      if (q.search) {
        const p = likeEscape(q.search);
        where.push(or(ilike(expenses.description, p), ilike(expenses.payee, p), ilike(expenses.number, p), ilike(expenses.reference, p)));
      }
      const condition = and(...where);
      const [{ total }] = await tx.select({ total: count() }).from(expenses).where(condition);
      const paidFrom = sql<string>`(SELECT a.name FROM accounts a WHERE a.id = "expenses"."paid_from_account_id")`;
      const rows = await tx
        .select({ expense: expenses, accountName: accounts.name, paidFromName: paidFrom, supplierName: suppliers.name })
        .from(expenses)
        .innerJoin(accounts, eq(accounts.id, expenses.accountId))
        .leftJoin(suppliers, eq(suppliers.id, expenses.supplierId))
        .where(condition)
        .orderBy(desc(expenses.date), desc(expenses.number))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
      return {
        items: rows.map((r) => ({ ...r.expense, accountName: r.accountName, paidFromName: r.paidFromName, supplierName: r.supplierName })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  createExpense(ctx: AuthContext, dto: CreateExpenseDto) {
    return this.dbs.withTenant(ctx, async (tx) => {
      await this.ledger.assertOpenPeriod(tx, dto.date);
      const acc = await this.ledger.systemAccounts(tx, ctx);
      await this.ledger.assertPostable(tx, [dto.accountId], { allowBank: false });
      const bank = await this.ledger.assertBankAccount(tx, dto.paidFromAccountId);
      await assertOwned(tx, suppliers, [dto.supplierId], 'supplier');
      const { currencyCode, rate, isBase } = await this.resolveCurrency(tx, dto.currencyCode, dto.rate);

      let taxPercent: string | null = null;
      if (dto.taxRateId) {
        const [r] = await tx.select().from(taxRates).where(eq(taxRates.id, dto.taxRateId)).limit(1);
        if (!r) throw new BadRequestException('Unknown tax rate');
        taxPercent = r.rate;
      }
      const { net, tax } = lineAmounts({ quantity: '1', unitPrice: dto.total, taxPercent, inclusive: true });
      if (net + tax <= 0n) throw new BadRequestException('Amount must be more than zero');
      const netBase = isBase ? net : toBase(net, rate);
      const taxBase = isBase ? tax : toBase(tax, rate);

      const number = await this.ledger.nextNumber(tx, ctx.tenantId, 'expense', 'EXP');
      const [e] = await tx
        .insert(expenses)
        .values({
          tenantId: ctx.tenantId,
          number,
          date: dto.date,
          accountId: dto.accountId,
          paidFromAccountId: bank.id,
          supplierId: dto.supplierId ?? null,
          payee: dto.payee ?? null,
          description: dto.description,
          reference: dto.reference ?? null,
          currencyCode,
          rate,
          taxRateId: dto.taxRateId ?? null,
          total: fromCents(net + tax),
          net: fromCents(net),
          tax: fromCents(tax),
          netBase: fromCents(netBase),
          taxBase: fromCents(taxBase),
          createdBy: ctx.userId,
        })
        .returning();
      const fx = (cents: bigint) => (isBase ? {} : { currencyCode, foreignAmount: cents, rate });
      const je = await this.ledger.post(tx, ctx, {
        date: dto.date,
        description: `${dto.description}${dto.payee ? ` · ${dto.payee}` : ''}`,
        source: 'expense',
        sourceId: e.id,
        reference: dto.reference ?? number,
        lines: [
          { accountId: dto.accountId, debit: netBase, ...fx(net) },
          { accountId: acc.vat_input, debit: taxBase, ...fx(tax) },
          { accountId: bank.id, credit: netBase + taxBase, ...fx(net + tax) },
        ],
      });
      const [saved] = await tx.update(expenses).set({ journalEntryId: je.id }).where(eq(expenses.id, e.id)).returning();
      await this.audit.log(tx, ctx, 'create', 'Expense', e.id, { number, total: dto.total, currencyCode });
      return saved;
    });
  }

  voidExpense(ctx: AuthContext, id: string) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const [e] = await tx.select().from(expenses).where(eq(expenses.id, id)).limit(1);
      found(e, 'Expense');
      if (e.status === 'void') throw new BadRequestException('This expense is already void');
      if (e.journalEntryId) await this.ledger.reverse(tx, ctx, e.journalEntryId, { description: `Expense ${e.number} voided` });
      const [saved] = await tx.update(expenses).set({ status: 'void' }).where(eq(expenses.id, id)).returning();
      await this.audit.log(tx, ctx, 'void', 'Expense', id, { number: e.number });
      return saved;
    });
  }

  // ----- Transfers between money accounts -------------------------------------------------

  transfer(ctx: AuthContext, dto: CreateTransferDto) {
    if (dto.fromAccountId === dto.toAccountId) throw new BadRequestException('Choose two different accounts');
    return this.dbs.withTenant(ctx, async (tx) => {
      const from = await this.ledger.assertBankAccount(tx, dto.fromAccountId);
      const to = await this.ledger.assertBankAccount(tx, dto.toAccountId);
      const amount = toCents(dto.amount);
      if (amount <= 0n) throw new BadRequestException('Amount must be more than zero');
      const je = await this.ledger.post(tx, ctx, {
        date: dto.date,
        description: dto.description ?? `Transfer from ${from.name} to ${to.name}`,
        source: 'transfer',
        reference: dto.reference ?? null,
        lines: [
          { accountId: to.id, debit: amount },
          { accountId: from.id, credit: amount },
        ],
      });
      await this.audit.log(tx, ctx, 'create', 'Transfer', je.id, dto);
      return je;
    });
  }
}
