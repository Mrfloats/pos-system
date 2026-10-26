import { BadRequestException, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, or, SQL, sql } from 'drizzle-orm';
import { v5 as uuidv5 } from 'uuid';
import { LedgerService } from '../accounting/ledger.service.js';
import { fromCents, toBase, toCents } from '../accounting/money.js';
import { AuditService } from '../common/audit.service.js';
import { type AuthContext } from '../common/auth-context.js';
import { assertOwned } from '../common/ownership.js';
import { TenantCrud } from '../common/tenant-crud.js';
import { found, likeEscape } from '../common/validation.js';
import { DbService, Tx } from '../db/db.service.js';
import {
  accounts,
  cashTransfers,
  customerGroups,
  customers,
  devices,
  priceLists,
  productVariants,
  shifts,
  stores,
  tenants,
  users,
} from '../db/schema.js';
import {
  CashTransferDto,
  CashTransferQuery,
  CloseShiftDto,
  CustomerGroupDto,
  ImportSalesDto,
  OpenShiftDto,
  ShiftQuery,
  UpdateCustomerGroupDto,
} from './sales.dto.js';
import { SalesService } from './sales.service.js';

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

/** Validates a { currency: amount } map such as an opening float or a cash count. */
function cashMap(input: Record<string, string> | undefined, what: string) {
  const out: Record<string, string> = {};
  for (const [code, value] of Object.entries(input ?? {})) {
    if (!/^[A-Z]{3}$/.test(code)) throw new BadRequestException(`${what}: "${code}" is not a currency code`);
    const v = String(value).trim();
    if (!MONEY.test(v)) throw new BadRequestException(`${what}: "${v}" is not an amount`);
    out[code] = fromCents(toCents(v));
  }
  return out;
}

/** Fixed namespace for import ids, so the same file imported twice records each sale once. */
const IMPORT_NAMESPACE = '6f7c1d6e-3a52-4b0e-9a49-2d4f1c9b8e10';

@Injectable()
export class CustomerGroupsService extends TenantCrud<typeof customerGroups> {
  constructor(dbs: DbService, audit: AuditService) {
    super(dbs, audit, customerGroups, { entity: 'Customer group', orderBy: [customerGroups.name] });
  }

  listWithCounts(ctx: AuthContext) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const rows = await tx
        .select({ group: customerGroups, members: sql<number>`(SELECT count(*)::int FROM customers c WHERE c.group_id = "customer_groups"."id")` })
        .from(customerGroups)
        .orderBy(asc(customerGroups.name));
      return rows.map((r) => ({ ...r.group, members: r.members }));
    });
  }

  override async create(ctx: AuthContext, dto: CustomerGroupDto) {
    await this.dbs.withTenant(ctx, (tx) => assertOwned(tx, priceLists, [dto.priceListId], 'price list'));
    return super.create(ctx, dto);
  }

  override async update(ctx: AuthContext, id: string, dto: UpdateCustomerGroupDto) {
    await this.dbs.withTenant(ctx, (tx) => assertOwned(tx, priceLists, [dto.priceListId], 'price list'));
    return super.update(ctx, id, dto);
  }
}

@Injectable()
export class SalesOpsService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly salesSvc: SalesService,
  ) {}

  private async tz(tx: Tx) {
    const [t] = await tx.select({ tz: tenants.timezone }).from(tenants).limit(1);
    return t?.tz ?? 'UTC';
  }

  // ----- Shifts -----------------------------------------------------------------------

  openShift(ctx: AuthContext, dto: OpenShiftDto) {
    return this.dbs.withTenant(ctx, async (tx) => {
      await assertOwned(tx, stores, [dto.storeId], 'store');
      await assertOwned(tx, devices, [dto.deviceId], 'till');
      const [already] = await tx
        .select({ number: shifts.number })
        .from(shifts)
        .where(and(eq(shifts.storeId, dto.storeId), eq(shifts.cashierId, ctx.userId), sql`${shifts.closedAt} IS NULL`))
        .limit(1);
      if (already) throw new BadRequestException(`You already have shift ${already.number} open in this store`);
      const number = await this.ledger.nextNumber(tx, ctx.tenantId, 'shift', 'SH');
      const [s] = await tx
        .insert(shifts)
        .values({ tenantId: ctx.tenantId, number, storeId: dto.storeId, deviceId: dto.deviceId ?? null, cashierId: ctx.userId, openingFloat: cashMap(dto.openingFloat, 'Opening float') })
        .returning();
      await this.audit.log(tx, ctx, 'open', 'Shift', s.id, { number });
      return this.shiftIn(tx, s.id);
    });
  }

  closeShift(ctx: AuthContext, id: string, dto: CloseShiftDto) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const [s] = await tx.select().from(shifts).where(eq(shifts.id, id)).limit(1);
      found(s, 'Shift');
      if (s.closedAt) throw new BadRequestException(`Shift ${s.number} is already closed`);
      await tx.update(shifts).set({ closedAt: new Date(), countedCash: cashMap(dto.countedCash, 'Cash count'), note: dto.note ?? null }).where(eq(shifts.id, id));
      await this.audit.log(tx, ctx, 'close', 'Shift', id, { number: s.number });
      return this.shiftIn(tx, id);
    });
  }

  listShifts(ctx: AuthContext, q: ShiftQuery) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const tz = await this.tz(tx);
      const where: (SQL | undefined)[] = [];
      if (q.storeId) where.push(eq(shifts.storeId, q.storeId));
      if (q.from) where.push(sql`(${shifts.openedAt} AT TIME ZONE ${tz})::date >= ${q.from}::date`);
      if (q.to) where.push(sql`(${shifts.openedAt} AT TIME ZONE ${tz})::date <= ${q.to}::date`);
      if (q.state === 'open') where.push(sql`${shifts.closedAt} IS NULL`);
      if (q.state === 'closed') where.push(sql`${shifts.closedAt} IS NOT NULL`);
      const condition = and(...where);
      const [{ total }] = await tx.select({ total: count() }).from(shifts).where(condition);
      const ids = await tx
        .select({ id: shifts.id })
        .from(shifts)
        .where(condition)
        .orderBy(desc(shifts.openedAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
      const items = [];
      for (const { id } of ids) items.push(await this.shiftIn(tx, id));
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  getShift(ctx: AuthContext, id: string) {
    return this.dbs.withTenant(ctx, (tx) => this.shiftIn(tx, id));
  }

  /**
   * A shift with its cash-up: for each currency, float + cash taken − cash
   * refunded − cash transferred out = expected, against what was counted.
   */
  private async shiftIn(tx: Tx, id: string) {
    const [row] = await tx
      .select({ shift: shifts, storeName: stores.name, deviceName: devices.name, cashier: users.fullName })
      .from(shifts)
      .innerJoin(stores, eq(stores.id, shifts.storeId))
      .leftJoin(devices, eq(devices.id, shifts.deviceId))
      .leftJoin(users, eq(users.id, shifts.cashierId))
      .where(eq(shifts.id, id))
      .limit(1);
    found(row, 'Shift');
    const pay = await tx.execute(sql`
      SELECT p.method, p.currency_code, sum(p.amount - p.change)::text AS amount, count(DISTINCT s.id)::int AS n
      FROM sale_payments p JOIN sales s ON s.id = p.sale_id
      WHERE s.shift_id = ${id} AND s.status = 'completed'
      GROUP BY p.method, p.currency_code`);
    const totals = await tx.execute(sql`
      SELECT count(*) FILTER (WHERE type = 'sale')::int AS sales, count(*) FILTER (WHERE type = 'return')::int AS returns,
             coalesce(sum(CASE WHEN type = 'return' THEN -total_base ELSE total_base END), 0)::text AS net_base
      FROM sales WHERE shift_id = ${id} AND status = 'completed'`);
    const drops = await tx.execute(sql`
      SELECT currency_code, sum(amount)::text AS amount FROM cash_transfers WHERE shift_id = ${id} GROUP BY currency_code`);

    const cash = new Map<string, { float: bigint; taken: bigint; out: bigint }>();
    const slot = (c: string) => cash.get(c) ?? cash.set(c, { float: 0n, taken: 0n, out: 0n }).get(c)!;
    for (const [c, v] of Object.entries(row.shift.openingFloat ?? {})) slot(c).float = toCents(v);
    const other: { method: string; currencyCode: string; amount: string }[] = [];
    for (const r of pay.rows as { method: string; currency_code: string; amount: string }[]) {
      if (r.method === 'cash') slot(r.currency_code).taken += toCents(r.amount);
      else other.push({ method: r.method, currencyCode: r.currency_code, amount: fromCents(toCents(r.amount)) });
    }
    for (const r of drops.rows as { currency_code: string; amount: string }[]) slot(r.currency_code).out += toCents(r.amount);
    for (const c of Object.keys(row.shift.countedCash ?? {})) slot(c);

    const t = totals.rows[0] as { sales: number; returns: number; net_base: string };
    return {
      ...row.shift,
      storeName: row.storeName,
      deviceName: row.deviceName,
      cashier: row.cashier,
      salesCount: t.sales,
      returnsCount: t.returns,
      netSalesBase: fromCents(toCents(t.net_base)),
      nonCash: other,
      cash: [...cash.entries()].map(([currencyCode, v]) => {
        const expected = v.float + v.taken - v.out;
        const countedRaw = row.shift.countedCash?.[currencyCode];
        const counted = countedRaw !== undefined ? toCents(countedRaw) : null;
        return {
          currencyCode,
          openingFloat: fromCents(v.float),
          cashTaken: fromCents(v.taken),
          transferredOut: fromCents(v.out),
          expected: fromCents(expected),
          counted: counted === null ? null : fromCents(counted),
          variance: counted === null ? null : fromCents(counted - expected),
        };
      }),
    };
  }

  // ----- Cash transfers -------------------------------------------------------------------

  /** Cash out of a store's till: banked (posted to the books) or sent to another store's till. */
  createTransfer(ctx: AuthContext, dto: CashTransferDto) {
    if (!dto.toAccountId === !dto.toStoreId) throw new BadRequestException('Send the cash either to an account or to another store');
    if (dto.toStoreId === dto.storeId) throw new BadRequestException('Choose a different store to send the cash to');
    return this.dbs.withTenant(ctx, async (tx) => {
      await assertOwned(tx, stores, [dto.storeId, dto.toStoreId], 'store');
      const tz = await this.tz(tx);
      const { currencyCode, rate, isBase } = await this.ledger.resolveCurrency(tx, dto.currencyCode, dto.rate);
      const amount = toCents(dto.amount);
      if (amount <= 0n) throw new BadRequestException('Amount must be more than zero');
      const amountBase = isBase ? amount : toBase(amount, rate);
      let shiftId: string | null = null;
      if (dto.shiftId) {
        const [s] = await tx.select().from(shifts).where(eq(shifts.id, dto.shiftId)).limit(1);
        if (!s || s.storeId !== dto.storeId) throw new BadRequestException('Unknown shift for this store');
        if (s.closedAt) throw new BadRequestException(`Shift ${s.number} is closed`);
        shiftId = s.id;
      }
      const number = await this.ledger.nextNumber(tx, ctx.tenantId, 'cash_transfer', 'CT');
      let journalEntryId: string | null = null;
      if (dto.toAccountId) {
        const to = await this.ledger.assertBankAccount(tx, dto.toAccountId);
        const acc = await this.ledger.systemAccounts(tx, ctx);
        if (to.id === acc.cash) throw new BadRequestException('Choose the account the cash went into, such as the bank');
        const [store] = await tx.select({ name: stores.name }).from(stores).where(eq(stores.id, dto.storeId));
        const je = await this.ledger.post(tx, ctx, {
          date: new Date().toLocaleDateString('en-CA', { timeZone: tz }),
          description: `Cash from ${store.name} to ${to.name}`,
          source: 'cash_transfer',
          reference: dto.reference ?? number,
          lines: [
            { accountId: to.id, debit: amountBase, ...(isBase ? {} : { currencyCode, foreignAmount: amount, rate }) },
            { accountId: acc.cash, credit: amountBase, ...(isBase ? {} : { currencyCode, foreignAmount: amount, rate }) },
          ],
        });
        journalEntryId = je.id;
      }
      const [t] = await tx
        .insert(cashTransfers)
        .values({
          tenantId: ctx.tenantId,
          number,
          storeId: dto.storeId,
          shiftId,
          toAccountId: dto.toAccountId ?? null,
          toStoreId: dto.toStoreId ?? null,
          currencyCode,
          rate,
          amount: fromCents(amount),
          amountBase: fromCents(amountBase),
          reference: dto.reference ?? null,
          note: dto.note ?? null,
          journalEntryId,
          createdBy: ctx.userId,
        })
        .returning();
      await this.audit.log(tx, ctx, 'create', 'Cash transfer', t.id, { number, amount: dto.amount, currencyCode });
      return t;
    });
  }

  listTransfers(ctx: AuthContext, q: CashTransferQuery) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const tz = await this.tz(tx);
      const where: (SQL | undefined)[] = [];
      if (q.storeId) where.push(or(eq(cashTransfers.storeId, q.storeId), eq(cashTransfers.toStoreId, q.storeId)));
      if (q.from) where.push(sql`(${cashTransfers.createdAt} AT TIME ZONE ${tz})::date >= ${q.from}::date`);
      if (q.to) where.push(sql`(${cashTransfers.createdAt} AT TIME ZONE ${tz})::date <= ${q.to}::date`);
      if (q.search) where.push(or(ilike(cashTransfers.number, likeEscape(q.search)), ilike(cashTransfers.reference, likeEscape(q.search))));
      const condition = and(...where);
      const [{ total }] = await tx.select({ total: count() }).from(cashTransfers).where(condition);
      const rows = await tx
        .select({
          t: cashTransfers,
          fromStore: stores.name,
          toStore: sql<string | null>`(SELECT s2.name FROM stores s2 WHERE s2.id = "cash_transfers"."to_store_id")`,
          toAccount: accounts.name,
          by: users.fullName,
        })
        .from(cashTransfers)
        .innerJoin(stores, eq(stores.id, cashTransfers.storeId))
        .leftJoin(accounts, eq(accounts.id, cashTransfers.toAccountId))
        .leftJoin(users, eq(users.id, cashTransfers.createdBy))
        .where(condition)
        .orderBy(desc(cashTransfers.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
      return {
        items: rows.map((r) => ({ ...r.t, fromStore: r.fromStore, toStore: r.toStore, toAccount: r.toAccount, createdByName: r.by })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  // ----- Import ------------------------------------------------------------------------------

  /**
   * Imports sales from another system or a spreadsheet. Rows sharing a
   * reference become one sale, paid in full. Each sale is saved on its own,
   * so one bad sale doesn't stop the rest, and importing the same file again
   * skips the sales already imported.
   */
  async importSales(ctx: AuthContext, dto: ImportSalesDto) {
    const groups = new Map<string, ImportSalesDto['rows']>();
    for (const r of dto.rows) groups.set(r.reference, [...(groups.get(r.reference) ?? []), r]);
    const result = { imported: 0, skipped: 0, errors: [] as { reference: string; message: string }[] };

    for (const [reference, rows] of groups) {
      const clientId = uuidv5(`${ctx.tenantId}:${reference}`, IMPORT_NAMESPACE);
      try {
        const outcome = await this.dbs.withTenant(ctx, async (tx) => {
          const [dupe] = await tx.execute(sql`SELECT 1 FROM sales WHERE client_id = ${clientId} LIMIT 1`).then((r) => r.rows);
          if (dupe) return 'skipped' as const;
          const first = rows[0];
          const [store] = await tx.select({ id: stores.id }).from(stores).where(ilike(stores.code, first.store)).limit(1);
          if (!store) throw new Error(`Unknown store code "${first.store}"`);
          const codes = [...new Set(rows.map((r) => r.item))];
          const variants = await tx
            .select({ id: productVariants.id, sku: productVariants.sku, barcode: productVariants.barcode })
            .from(productVariants)
            .where(or(inArray(productVariants.sku, codes), inArray(productVariants.barcode, codes)));
          const lines = rows.map((r) => {
            const v = variants.find((x) => x.sku?.toLowerCase() === r.item.toLowerCase() || x.barcode === r.item);
            if (!v) throw new Error(`Unknown item "${r.item}"`);
            return { variantId: v.id, quantity: r.quantity, unitPrice: r.unitPrice };
          });
          let customerId: string | undefined;
          if (first.customer) {
            const [c] = await tx.select({ id: customers.id }).from(customers).where(ilike(customers.name, first.customer)).limit(1);
            customerId = c?.id;
          }
          await this.salesSvc.completeSale(
            tx,
            ctx,
            {
              storeId: store.id,
              customerId,
              customerName: first.customer,
              currencyCode: first.currencyCode,
              lines,
              soldAt: first.date,
              note: `Imported ${reference}`,
              clientId,
            },
            { payInFull: first.paymentMethod ?? 'cash' },
          );
          return 'imported' as const;
        });
        result[outcome] += 1;
      } catch (e) {
        result.errors.push({ reference, message: e instanceof Error ? e.message : 'Could not import' });
      }
    }
    return result;
  }
}
