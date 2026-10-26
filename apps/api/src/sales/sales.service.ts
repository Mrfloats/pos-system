import { BadRequestException, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, or, SQL, sql } from 'drizzle-orm';
import type { SystemKey } from '../accounting/chart.js';
import { LedgerService, localDate } from '../accounting/ledger.service.js';
import { divRound, formatFixed, fromCents, parseFixed, sum, toBase, toCents } from '../accounting/money.js';
import { AuditService } from '../common/audit.service.js';
import { type AuthContext } from '../common/auth-context.js';
import { assertOwned } from '../common/ownership.js';
import { found, likeEscape } from '../common/validation.js';
import { DbService, Tx } from '../db/db.service.js';
import {
  customerGroups,
  customers,
  devices,
  memberships,
  modifierGroups,
  modifiers,
  productComponents,
  productModifierGroups,
  productPackagings,
  products,
  productVariants,
  saleLines,
  salePayments,
  sales,
  shifts,
  stockMovements,
  storePrices,
  stores,
  taxRates,
  tenants,
  type SoldModifier,
  users,
} from '../db/schema.js';
import {
  ConvertQuotationDto,
  CreateQuotationDto,
  CreateReturnDto,
  CreateSaleDto,
  KitchenQuery,
  KitchenUpdateDto,
  PaymentMethod,
  PreviewSaleDto,
  SalePaymentDto,
  SaleQuery,
} from './sales.dto.js';

type Ctx = Pick<AuthContext, 'tenantId' | 'userId'>;

/** Where each way of paying lands in the books. */
export const METHOD_ACCOUNT: Record<PaymentMethod, SystemKey> = {
  cash: 'cash',
  card: 'bank',
  bank: 'bank',
  mobile: 'mobile_money',
};

const PREFIX = { sale: ['sale', 'S'], return: ['sale_return', 'R'], quotation: ['quotation', 'Q'] } as const;

interface PricedLine {
  variantId: string;
  productName: string;
  variantName: string;
  packagingId: string | null;
  packName: string | null;
  /** Stock units in one of `quantity`, e.g. "24.000" for a case. */
  unitsPerPack: string;
  modifiers: SoldModifier[] | null;
  quantity: string;
  unitPrice: bigint;
  discount: bigint;
  taxRateId: string | null;
  taxRateName: string | null;
  net: bigint;
  tax: bigint;
  total: bigint;
  netBase: bigint;
  taxBase: bigint;
  costBase: bigint;
  kitchenStation: string | null;
  note: string | null;
}

interface Movement {
  variantId: string;
  quantity: bigint; // thousandths, signed
  unitCost: string | null;
}

type ChoiceRow = {
  modifier: typeof modifiers.$inferSelect;
  group: typeof modifierGroups.$inferSelect;
  cost: string | null;
  trackStock: boolean | null;
};

/**
 * The choices made on one item: each must be offered for it, and no group may have
 * more than it allows. When choices were sent at all, every required group must be answered.
 */
function choicesFor(productId: string, productName: string, ids: string[] | undefined, chosen: Map<string, ChoiceRow>, offered: { productId: string; group: typeof modifierGroups.$inferSelect }[]) {
  if (!ids) return [];
  const groups = offered.filter((o) => o.productId === productId).map((o) => o.group);
  const picks = ids.map((id) => chosen.get(id)!);
  for (const p of picks) {
    if (!groups.some((g) => g.id === p.group.id)) throw new BadRequestException(`"${p.modifier.name}" isn't a choice for "${productName}"`);
  }
  for (const g of groups) {
    const n = picks.filter((p) => p.group.id === g.id).length;
    if (n < g.minSelect) throw new BadRequestException(`Choose ${g.minSelect === 1 ? 'one' : g.minSelect} for "${g.name}" on "${productName}"`);
    if (n > g.maxSelect) throw new BadRequestException(`Choose at most ${g.maxSelect} for "${g.name}" on "${productName}"`);
  }
  return picks;
}

/** Base → sale currency: base × rate. */
const fromBase = (cents: bigint, rate: string) => divRound(cents * parseFixed(rate, 6), 1_000_000n);

@Injectable()
export class SalesService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
  ) {}

  private async tenantInfo(tx: Tx) {
    const [t] = await tx.select({ tz: tenants.timezone, vatNumber: tenants.vatNumber }).from(tenants).limit(1);
    return { tz: t?.tz ?? 'UTC', fiscal: t?.vatNumber ? ('pending' as const) : ('not_required' as const) };
  }

  // ----- Pricing --------------------------------------------------------------------

  /**
   * Works out every line: price (store price if set, converted to the sale
   * currency), discount (customer group's if none given), VAT (inclusive or not,
   * per the tax rate), base-currency values and cost. Also returns the stock to
   * take out — recipe ingredients for menu items and bundles.
   */
  private async priceLines(
    tx: Tx,
    input: { storeId: string; customerId?: string | null; lines: CreateSaleDto['lines'] },
    currency: { rate: string; isBase: boolean },
  ) {
    const ids = [...new Set(input.lines.map((l) => l.variantId))];
    const variants = await tx
      .select({
        id: productVariants.id,
        name: productVariants.name,
        price: productVariants.price,
        costPrice: productVariants.costPrice,
        active: productVariants.active,
        productId: products.id,
        productName: products.name,
        productActive: products.active,
        trackStock: products.trackStock,
        taxRateId: products.taxRateId,
        kitchenStation: products.kitchenStation,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(inArray(productVariants.id, ids));
    if (variants.length !== ids.length) throw new BadRequestException('Unknown product');
    const byId = new Map(variants.map((v) => [v.id, v]));

    const overrides = new Map(
      (
        await tx
          .select({ variantId: storePrices.variantId, price: storePrices.price })
          .from(storePrices)
          .where(and(eq(storePrices.storeId, input.storeId), inArray(storePrices.variantId, ids)))
      ).map((r) => [r.variantId, r.price]),
    );

    const rateIds = [...new Set(variants.map((v) => v.taxRateId).filter((v): v is string => !!v))];
    const rates = new Map(rateIds.length ? (await tx.select().from(taxRates).where(inArray(taxRates.id, rateIds))).map((r) => [r.id, r]) : []);

    let groupPct = 0n;
    if (input.customerId) {
      const [g] = await tx
        .select({ pct: customerGroups.discountPercent })
        .from(customers)
        .innerJoin(customerGroups, eq(customerGroups.id, customers.groupId))
        .where(eq(customers.id, input.customerId))
        .limit(1);
      if (g) groupPct = toCents(g.pct);
    }

    const recipe = await tx
      .select({
        parentId: productComponents.parentVariantId,
        componentId: productComponents.componentVariantId,
        quantity: productComponents.quantity,
        cost: productVariants.costPrice,
        trackStock: products.trackStock,
      })
      .from(productComponents)
      .innerJoin(productVariants, eq(productVariants.id, productComponents.componentVariantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(inArray(productComponents.parentVariantId, ids));

    // Packs being sold (a case of 24…).
    const packIds = [...new Set(input.lines.map((l) => l.packagingId).filter((v): v is string => !!v))];
    const packs = new Map(packIds.length ? (await tx.select().from(productPackagings).where(inArray(productPackagings.id, packIds))).map((p) => [p.id, p]) : []);

    // Choices made (sides, extras), their groups, and which groups each item offers.
    const modifierIds = [...new Set(input.lines.flatMap((l) => l.modifierIds ?? []))];
    const chosen = new Map<string, ChoiceRow>(
      modifierIds.length
        ? (
            await tx
              .select({ modifier: modifiers, group: modifierGroups, cost: productVariants.costPrice, trackStock: products.trackStock })
              .from(modifiers)
              .innerJoin(modifierGroups, eq(modifierGroups.id, modifiers.groupId))
              .leftJoin(productVariants, eq(productVariants.id, modifiers.variantId))
              .leftJoin(products, eq(products.id, productVariants.productId))
              .where(inArray(modifiers.id, modifierIds))
          ).map((r) => [r.modifier.id, r])
        : [],
    );
    if (chosen.size !== modifierIds.length) throw new BadRequestException('Unknown choice');
    const offered = input.lines.some((l) => l.modifierIds)
      ? await tx
          .select({ productId: productModifierGroups.productId, group: modifierGroups })
          .from(productModifierGroups)
          .innerJoin(modifierGroups, eq(modifierGroups.id, productModifierGroups.groupId))
          .where(inArray(productModifierGroups.productId, [...new Set(variants.map((v) => v.productId))]))
      : [];

    const movements: Movement[] = [];
    const lines: PricedLine[] = input.lines.map((l) => {
      const v = byId.get(l.variantId)!;
      if (!v.active || !v.productActive) throw new BadRequestException(`"${v.productName}" is no longer on sale`);
      const q = parseFixed(l.quantity, 3);
      if (q <= 0n) throw new BadRequestException('Quantities must be more than zero');

      const pack = l.packagingId ? packs.get(l.packagingId) : undefined;
      if (l.packagingId && pack?.variantId !== v.id) throw new BadRequestException(`That pack isn't one of "${v.productName}"`);
      const picks = choicesFor(v.productId, v.productName, l.modifierIds, chosen, offered);
      if (pack && picks.length) throw new BadRequestException('Choices can only be added to single items, not packs');
      // Stock units in one of `quantity`, in thousandths: 24000 for a case of 24.
      const perPack = pack ? parseFixed(pack.quantity, 3) : 1000n;
      const units = divRound(q * perPack, 1000n);

      // A pack has its own price, else it is the item's price times the units in it.
      const shelf = toCents(overrides.get(v.id) ?? v.price);
      const baseUnit = pack
        ? pack.price !== null
          ? toCents(pack.price)
          : divRound(shelf * perPack, 1000n)
        : shelf + sum(picks.map((p) => toCents(p.modifier.priceDelta)));
      const unitPrice = l.unitPrice !== undefined ? toCents(l.unitPrice) : currency.isBase ? baseUnit : fromBase(baseUnit, currency.rate);
      const gross = divRound(q * unitPrice, 1000n);
      const discount = l.discount !== undefined ? toCents(l.discount) : groupPct ? divRound(gross * groupPct, 10_000n) : 0n;
      if (discount > gross) throw new BadRequestException(`The discount on "${v.productName}" is more than the line`);
      const amount = gross - discount;

      const taxRate = v.taxRateId ? rates.get(v.taxRateId) : undefined;
      const pct = taxRate ? toCents(taxRate.rate) : 0n;
      let net = amount;
      let tax = 0n;
      if (pct) {
        if (taxRate!.inclusive) {
          tax = divRound(amount * pct, 10_000n + pct);
          net = amount - tax;
        } else {
          tax = divRound(amount * pct, 10_000n);
        }
      }

      // Cost and stock, in stock units: a recipe's ingredients, or the item itself; plus what the extras use.
      const parts = recipe.filter((r) => r.parentId === v.id);
      let costBase = 0n;
      if (parts.length) {
        for (const p of parts) {
          const used = divRound(units * parseFixed(p.quantity, 3), 1000n);
          costBase += divRound(used * toCents(p.cost ?? '0'), 1000n);
          if (p.trackStock) movements.push({ variantId: p.componentId, quantity: -used, unitCost: p.cost });
        }
      } else if (v.trackStock) {
        costBase = divRound(units * toCents(v.costPrice ?? '0'), 1000n);
        movements.push({ variantId: v.id, quantity: -units, unitCost: v.costPrice });
      }
      for (const p of picks) {
        if (!p.modifier.variantId) continue;
        costBase += divRound(q * toCents(p.cost ?? '0'), 1000n);
        if (p.trackStock) movements.push({ variantId: p.modifier.variantId, quantity: -q, unitCost: p.cost });
      }

      return {
        variantId: v.id,
        productName: v.productName,
        variantName: v.name,
        packagingId: pack?.id ?? null,
        packName: pack?.name ?? null,
        unitsPerPack: formatFixed(perPack, 3),
        modifiers: picks.length
          ? picks.map((p) => ({
              id: p.modifier.id,
              name: p.modifier.name,
              groupName: p.group.name,
              priceDelta: p.modifier.priceDelta,
              variantId: p.modifier.variantId,
              unitCost: p.modifier.variantId ? (p.cost ?? '0') : null,
            }))
          : null,
        quantity: formatFixed(q, 3),
        unitPrice,
        discount,
        taxRateId: taxRate?.id ?? null,
        taxRateName: taxRate?.name ?? null,
        net,
        tax,
        total: net + tax,
        netBase: currency.isBase ? net : toBase(net, currency.rate),
        taxBase: currency.isBase ? tax : toBase(tax, currency.rate),
        costBase,
        kitchenStation: v.kitchenStation,
        note: l.note ?? null,
      };
    });
    return { lines, movements };
  }

  /**
   * Turns what the customer handed over into payment rows. Any currency the
   * business accepts can be used, split across methods. Cash may be more than
   * due: the difference is change, given in that cash payment's currency.
   * The amounts kept always add up exactly to the sale total in base currency.
   */
  private async settle(tx: Tx, payments: SalePaymentDto[], sale: { currencyCode: string; rate: string; totalBase: bigint }) {
    if (!payments.length) throw new BadRequestException('Add how the customer paid');
    const rows = [];
    for (const p of payments) {
      const code = p.currencyCode ?? sale.currencyCode;
      const { rate, isBase } = await this.ledger.resolveCurrency(tx, code, p.rate ?? (code === sale.currencyCode ? sale.rate : undefined));
      const amount = toCents(p.amount);
      if (amount <= 0n) throw new BadRequestException('Payment amounts must be more than zero');
      rows.push({ ...p, currencyCode: code, rate, isBase, amount, change: 0n, keptBase: isBase ? amount : toBase(amount, rate) });
    }
    const paid = sum(rows.map((r) => r.keptBase));
    let excess = paid - sale.totalBase;
    if (excess < -1n) throw new BadRequestException(`Payment is short by ${fromCents(-excess)} (base currency)`);
    if (excess > 1n) {
      const cash = [...rows].reverse().find((r) => r.method === 'cash');
      if (!cash) throw new BadRequestException('Only cash can be more than the amount due');
      const change = cash.isBase ? excess : fromBase(excess, cash.rate);
      if (change > cash.amount) throw new BadRequestException('The change is more than the cash handed over');
      cash.change = change;
      cash.keptBase -= excess;
      excess = 0n;
    }
    // A cent of rounding between currencies is absorbed by the last payment.
    rows[rows.length - 1].keptBase -= sum(rows.map((r) => r.keptBase)) - sale.totalBase;
    return rows;
  }

  /** Prices a basket without saving it, so a till or the backoffice can show the exact total. */
  preview(ctx: AuthContext, dto: PreviewSaleDto) {
    return this.dbs.withTenant(ctx, async (tx) => {
      await assertOwned(tx, stores, [dto.storeId], 'store');
      await assertOwned(tx, customers, [dto.customerId], 'customer');
      const { currencyCode, rate, isBase } = await this.ledger.resolveCurrency(tx, dto.currencyCode, dto.rate);
      const { lines } = dto.lines.length ? await this.priceLines(tx, dto, { rate, isBase }) : { lines: [] };
      return {
        currencyCode,
        rate,
        lines: lines.map((l) => ({
          variantId: l.variantId,
          unitPrice: fromCents(l.unitPrice),
          discount: fromCents(l.discount),
          net: fromCents(l.net),
          tax: fromCents(l.tax),
          total: fromCents(l.total),
          taxRateName: l.taxRateName,
        })),
        subtotal: fromCents(sum(lines.map((l) => divRound(parseFixed(l.quantity, 3) * l.unitPrice, 1000n)))),
        discountTotal: fromCents(sum(lines.map((l) => l.discount))),
        taxTotal: fromCents(sum(lines.map((l) => l.tax))),
        total: fromCents(sum(lines.map((l) => l.total))),
        totalBase: fromCents(sum(lines.map((l) => l.netBase + l.taxBase))),
      };
    });
  }

  // ----- Creating sales -----------------------------------------------------------------

  private async findOpenShift(tx: Tx, ctx: Ctx, storeId: string, shiftId?: string) {
    if (shiftId) {
      const [s] = await tx.select().from(shifts).where(eq(shifts.id, shiftId)).limit(1);
      if (!s) throw new BadRequestException('Unknown shift');
      if (s.closedAt) throw new BadRequestException(`Shift ${s.number} is closed`);
      if (s.storeId !== storeId) throw new BadRequestException('That shift is for another store');
      return s.id;
    }
    const [s] = await tx
      .select({ id: shifts.id })
      .from(shifts)
      .where(and(eq(shifts.storeId, storeId), eq(shifts.cashierId, ctx.userId!), sql`${shifts.closedAt} IS NULL`))
      .orderBy(desc(shifts.openedAt))
      .limit(1);
    return s?.id ?? null;
  }

  createSale(ctx: AuthContext, dto: CreateSaleDto) {
    return this.dbs.withTenant(ctx, async (tx) => {
      if (dto.clientId) {
        const [dupe] = await tx.select({ id: sales.id }).from(sales).where(eq(sales.clientId, dto.clientId)).limit(1);
        if (dupe) return this.getIn(tx, dupe.id);
      }
      const id = await this.completeSale(tx, ctx, dto);
      return this.getIn(tx, id);
    });
  }

  /** Records a paid sale: stock out, money in, journal entry. Returns the sale id. */
  async completeSale(tx: Tx, ctx: Ctx, dto: CreateSaleDto, opts: { fromQuotationId?: string; payInFull?: PaymentMethod } = {}) {
    await assertOwned(tx, stores, [dto.storeId], 'store');
    await assertOwned(tx, customers, [dto.customerId], 'customer');
    await assertOwned(tx, devices, [dto.deviceId], 'till');
    if (dto.salespersonId) {
      const [m] = await tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.userId, dto.salespersonId)).limit(1);
      if (!m) throw new BadRequestException('Unknown salesperson');
    }
    const info = await this.tenantInfo(tx);
    const soldAt = dto.soldAt ? new Date(dto.soldAt) : new Date();
    const day = localDate(info.tz, soldAt);
    await this.ledger.assertOpenPeriod(tx, day);

    const { currencyCode, rate, isBase } = await this.ledger.resolveCurrency(tx, dto.currencyCode, dto.rate);
    const { lines, movements } = await this.priceLines(tx, dto, { rate, isBase });
    const total = sum(lines.map((l) => l.total));
    const totalBase = sum(lines.map((l) => l.netBase + l.taxBase));
    const costBase = sum(lines.map((l) => l.costBase));
    // Imported sales are paid in full by one method.
    const given = opts.payInFull ? [{ method: opts.payInFull, amount: fromCents(total) }] : (dto.payments ?? []);
    const pays = await this.settle(tx, given, { currencyCode, rate, totalBase });
    // A sale joins the cashier's open shift only when it happens now; imported or
    // later-synced sales carry their own date and name their shift explicitly if they have one.
    const shiftId = dto.shiftId || !dto.soldAt ? await this.findOpenShift(tx, ctx, dto.storeId, dto.shiftId) : null;
    const customerName = await this.customerName(tx, dto.customerId, dto.customerName);

    const number = await this.ledger.nextNumber(tx, ctx.tenantId, PREFIX.sale[0], PREFIX.sale[1]);
    const [sale] = await tx
      .insert(sales)
      .values({
        tenantId: ctx.tenantId,
        number,
        type: 'sale',
        status: 'completed',
        storeId: dto.storeId,
        deviceId: dto.deviceId ?? null,
        shiftId,
        appVersion: dto.appVersion ?? null,
        customerId: dto.customerId ?? null,
        customerName,
        salespersonId: dto.salespersonId ?? ctx.userId,
        originalSaleId: opts.fromQuotationId ?? null,
        soldAt,
        currencyCode,
        rate,
        subtotal: fromCents(sum(lines.map((l) => divRound(parseFixed(l.quantity, 3) * l.unitPrice, 1000n)))),
        discountTotal: fromCents(sum(lines.map((l) => l.discount))),
        taxTotal: fromCents(sum(lines.map((l) => l.tax))),
        total: fromCents(total),
        totalBase: fromCents(totalBase),
        costBase: fromCents(costBase),
        itemCount: formatFixed(sum(lines.map((l) => parseFixed(l.quantity, 3))), 3),
        fiscalStatus: info.fiscal,
        note: dto.note ?? null,
        clientId: dto.clientId ?? null,
        createdBy: ctx.userId,
      })
      .returning();

    await tx.insert(saleLines).values(lines.map((l, i) => this.lineRow(ctx, sale.id, l, i, true)));
    await tx.insert(salePayments).values(
      pays.map((p) => ({
        tenantId: ctx.tenantId,
        saleId: sale.id,
        method: p.method,
        currencyCode: p.currencyCode,
        rate: p.rate,
        amount: fromCents(p.amount),
        change: fromCents(p.change),
        amountBase: fromCents(p.keptBase),
        reference: p.reference ?? null,
      })),
    );
    await this.moveStock(tx, ctx, dto.storeId, movements, 'sale', number, dto.deviceId);

    const acc = await this.ledger.systemAccounts(tx, ctx);
    const je = await this.ledger.post(tx, ctx, {
      date: day,
      description: `Sale ${number} · ${customerName}`,
      source: 'sale',
      sourceId: sale.id,
      reference: number,
      lines: [
        ...pays.map((p) => ({
          accountId: acc[METHOD_ACCOUNT[p.method]],
          debit: p.keptBase,
          memo: `${p.method} ${p.currencyCode}`,
          ...(p.isBase ? {} : { currencyCode: p.currencyCode, foreignAmount: p.amount - p.change, rate: p.rate }),
        })),
        { accountId: acc.sales, credit: sum(lines.map((l) => l.netBase)) },
        { accountId: acc.vat_output, credit: sum(lines.map((l) => l.taxBase)) },
        { accountId: acc.cogs, debit: costBase },
        { accountId: acc.inventory, credit: costBase },
      ],
    });
    await tx.update(sales).set({ journalEntryId: je.id }).where(eq(sales.id, sale.id));
    await this.audit.log(tx, ctx, 'create', 'Sale', sale.id, { number, total: fromCents(total), currencyCode });
    return sale.id;
  }

  private lineRow(ctx: Ctx, saleId: string, l: PricedLine, i: number, kitchen: boolean, originalLineId: string | null = null) {
    return {
      tenantId: ctx.tenantId,
      saleId,
      variantId: l.variantId,
      originalLineId,
      productName: l.productName,
      variantName: l.variantName,
      packagingId: l.packagingId,
      packName: l.packName,
      unitsPerPack: l.unitsPerPack,
      modifiers: l.modifiers,
      quantity: l.quantity,
      unitPrice: fromCents(l.unitPrice),
      discount: fromCents(l.discount),
      taxRateId: l.taxRateId,
      taxRateName: l.taxRateName,
      net: fromCents(l.net),
      tax: fromCents(l.tax),
      total: fromCents(l.total),
      netBase: fromCents(l.netBase),
      taxBase: fromCents(l.taxBase),
      costBase: fromCents(l.costBase),
      kitchenStation: l.kitchenStation,
      kitchenStatus: kitchen && l.kitchenStation ? ('pending' as const) : null,
      note: l.note,
      sortOrder: i,
    };
  }

  private async customerName(tx: Tx, customerId?: string | null, given?: string) {
    if (customerId) {
      const [c] = await tx.select({ name: customers.name }).from(customers).where(eq(customers.id, customerId)).limit(1);
      if (c) return c.name;
    }
    return given || 'Cash Customer';
  }

  private async moveStock(tx: Tx, ctx: Ctx, storeId: string, moves: Movement[], type: 'sale' | 'return', reference: string, deviceId?: string | null) {
    const merged = new Map<string, Movement>();
    for (const m of moves) {
      const cur = merged.get(m.variantId);
      merged.set(m.variantId, cur ? { ...cur, quantity: cur.quantity + m.quantity } : { ...m });
    }
    const rows = [...merged.values()].filter((m) => m.quantity !== 0n);
    if (!rows.length) return;
    await tx.insert(stockMovements).values(
      rows.map((m) => ({
        tenantId: ctx.tenantId,
        storeId,
        variantId: m.variantId,
        quantity: formatFixed(m.quantity, 3),
        type,
        unitCost: m.unitCost,
        reference,
        deviceId: deviceId ?? null,
        createdBy: ctx.userId,
      })),
    );
  }

  // ----- Quotations ------------------------------------------------------------------

  createQuotation(ctx: AuthContext, dto: CreateQuotationDto) {
    return this.dbs.withTenant(ctx, async (tx) => {
      await assertOwned(tx, stores, [dto.storeId], 'store');
      await assertOwned(tx, customers, [dto.customerId], 'customer');
      const { currencyCode, rate, isBase } = await this.ledger.resolveCurrency(tx, dto.currencyCode, dto.rate);
      const { lines } = await this.priceLines(tx, dto, { rate, isBase });
      const number = await this.ledger.nextNumber(tx, ctx.tenantId, PREFIX.quotation[0], PREFIX.quotation[1]);
      const [q] = await tx
        .insert(sales)
        .values({
          tenantId: ctx.tenantId,
          number,
          type: 'quotation',
          status: 'open',
          storeId: dto.storeId,
          customerId: dto.customerId ?? null,
          customerName: await this.customerName(tx, dto.customerId, dto.customerName),
          salespersonId: dto.salespersonId ?? ctx.userId,
          currencyCode,
          rate,
          subtotal: fromCents(sum(lines.map((l) => divRound(parseFixed(l.quantity, 3) * l.unitPrice, 1000n)))),
          discountTotal: fromCents(sum(lines.map((l) => l.discount))),
          taxTotal: fromCents(sum(lines.map((l) => l.tax))),
          total: fromCents(sum(lines.map((l) => l.total))),
          totalBase: fromCents(sum(lines.map((l) => l.netBase + l.taxBase))),
          itemCount: formatFixed(sum(lines.map((l) => parseFixed(l.quantity, 3))), 3),
          validUntil: dto.validUntil ?? null,
          note: dto.note ?? null,
          createdBy: ctx.userId,
        })
        .returning();
      await tx.insert(saleLines).values(lines.map((l, i) => this.lineRow(ctx, q.id, l, i, false)));
      await this.audit.log(tx, ctx, 'create', 'Quotation', q.id, { number });
      return this.getIn(tx, q.id);
    });
  }

  /** Turns an open quotation into a paid sale at the quoted prices. */
  convertQuotation(ctx: AuthContext, id: string, dto: ConvertQuotationDto) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const [q] = await tx.select().from(sales).where(and(eq(sales.id, id), eq(sales.type, 'quotation'))).limit(1);
      found(q, 'Quotation');
      if (q.status !== 'open') throw new BadRequestException(`This quotation is ${q.status}`);
      const lines = await tx.select().from(saleLines).where(eq(saleLines.saleId, id)).orderBy(asc(saleLines.sortOrder));
      const saleId = await this.completeSale(
        tx,
        ctx,
        {
          storeId: q.storeId,
          customerId: q.customerId ?? undefined,
          customerName: q.customerName,
          currencyCode: q.currencyCode,
          rate: q.rate,
          lines: lines.map((l) => ({
            variantId: l.variantId,
            packagingId: l.packagingId ?? undefined,
            modifierIds: l.modifiers?.map((m) => m.id),
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discount: l.discount,
            note: l.note ?? undefined,
          })),
          payments: dto.payments,
          shiftId: dto.shiftId,
          salespersonId: q.salespersonId ?? undefined,
          note: q.note ?? undefined,
        },
        { fromQuotationId: q.id },
      );
      await tx.update(sales).set({ status: 'converted' }).where(eq(sales.id, id));
      return this.getIn(tx, saleId);
    });
  }

  cancelQuotation(ctx: AuthContext, id: string) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const [q] = await tx.select().from(sales).where(and(eq(sales.id, id), eq(sales.type, 'quotation'))).limit(1);
      found(q, 'Quotation');
      if (q.status !== 'open') throw new BadRequestException(`This quotation is ${q.status}`);
      await tx.update(sales).set({ status: 'cancelled' }).where(eq(sales.id, id));
      await this.audit.log(tx, ctx, 'cancel', 'Quotation', id, { number: q.number });
      return this.getIn(tx, id);
    });
  }

  // ----- Returns and voids -------------------------------------------------------------

  /** Refunds part or all of a sale. Goods go back into stock unless restock is false. */
  createReturn(ctx: AuthContext, saleId: string, dto: CreateReturnDto) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const [sale] = await tx.select().from(sales).where(eq(sales.id, saleId)).limit(1);
      found(sale, 'Sale');
      if (sale.type !== 'sale' || sale.status !== 'completed') throw new BadRequestException('Only completed sales can be returned');
      const info = await this.tenantInfo(tx);
      const day = localDate(info.tz);
      const original = await tx.select().from(saleLines).where(eq(saleLines.saleId, saleId));
      const returnedRes = await tx.execute(sql`
        SELECT l.original_line_id, sum(l.quantity)::text AS qty
        FROM sale_lines l JOIN sales s ON s.id = l.sale_id
        WHERE s.original_sale_id = ${saleId} AND s.type = 'return' AND s.status = 'completed'
        GROUP BY l.original_line_id`);
      const returned = new Map((returnedRes.rows as { original_line_id: string; qty: string }[]).map((r) => [r.original_line_id, parseFixed(r.qty, 3)]));

      const restock = dto.restock ?? true;
      const lines: (PricedLine & { originalLineId: string })[] = [];
      for (const r of dto.lines) {
        const o = original.find((l) => l.id === r.lineId);
        if (!o) throw new BadRequestException('That item is not on this sale');
        const q = parseFixed(r.quantity, 3);
        const sold = parseFixed(o.quantity, 3);
        const left = sold - (returned.get(o.id) ?? 0n);
        if (q <= 0n) throw new BadRequestException('Quantities must be more than zero');
        if (q > left) throw new BadRequestException(`Only ${formatFixed(left, 3)} of "${o.productName}" can still be returned`);
        // Share the line total and VAT, and work net out from them, so the refund is exactly
        // the price paid for these units (1 of 2 at 2.00 refunds 1.00, not 1.01).
        const part = (v: string) => divRound(toCents(v) * q, sold);
        const total = part(o.total);
        const tax = part(o.tax);
        const totalBase = divRound((toCents(o.netBase) + toCents(o.taxBase)) * q, sold);
        const taxBase = part(o.taxBase);
        lines.push({
          originalLineId: o.id,
          variantId: o.variantId,
          productName: o.productName,
          variantName: o.variantName,
          packagingId: o.packagingId,
          packName: o.packName,
          unitsPerPack: o.unitsPerPack,
          modifiers: o.modifiers,
          quantity: formatFixed(q, 3),
          unitPrice: toCents(o.unitPrice),
          discount: part(o.discount),
          taxRateId: o.taxRateId,
          taxRateName: o.taxRateName,
          net: total - tax,
          tax,
          total,
          netBase: totalBase - taxBase,
          taxBase,
          costBase: part(o.costBase),
          kitchenStation: null,
          note: null,
        });
      }

      // Stock back in, line by line, in stock units: the item itself, or the ingredients of a
      // menu item's recipe; plus what its extras used.
      const movements: Movement[] = [];
      if (restock) {
        const extras = lines.flatMap((l) => (l.modifiers ?? []).flatMap((m) => (m.variantId ? [m.variantId] : [])));
        const ids = [...new Set([...lines.map((l) => l.variantId), ...extras])];
        const tracked = new Map(
          (
            await tx
              .select({ id: productVariants.id, trackStock: products.trackStock })
              .from(productVariants)
              .innerJoin(products, eq(products.id, productVariants.productId))
              .where(inArray(productVariants.id, ids))
          ).map((v) => [v.id, v.trackStock]),
        );
        const recipe = await tx
          .select({
            parentId: productComponents.parentVariantId,
            componentId: productComponents.componentVariantId,
            quantity: productComponents.quantity,
            cost: productVariants.costPrice,
            trackStock: products.trackStock,
          })
          .from(productComponents)
          .innerJoin(productVariants, eq(productVariants.id, productComponents.componentVariantId))
          .innerJoin(products, eq(products.id, productVariants.productId))
          .where(inArray(productComponents.parentVariantId, ids));
        for (const l of lines) {
          const q = parseFixed(l.quantity, 3);
          const units = divRound(q * parseFixed(l.unitsPerPack, 3), 1000n);
          // The extras' share of the cost, at what they cost when sold.
          let extrasCost = 0n;
          for (const m of l.modifiers ?? []) {
            if (!m.variantId) continue;
            extrasCost += divRound(q * toCents(m.unitCost ?? '0'), 1000n);
            if (tracked.get(m.variantId)) movements.push({ variantId: m.variantId, quantity: q, unitCost: m.unitCost });
          }
          const parts = recipe.filter((r) => r.parentId === l.variantId);
          if (parts.length) {
            for (const p of parts) {
              if (p.trackStock) movements.push({ variantId: p.componentId, quantity: divRound(units * parseFixed(p.quantity, 3), 1000n), unitCost: p.cost });
            }
          } else if (tracked.get(l.variantId)) {
            // Back at the cost it was sold at.
            movements.push({ variantId: l.variantId, quantity: units, unitCost: fromCents(divRound((l.costBase - extrasCost) * 1000n, units)) });
          }
        }
      }

      const total = sum(lines.map((l) => l.total));
      const totalBase = sum(lines.map((l) => l.netBase + l.taxBase));
      const costBase = restock ? sum(lines.map((l) => l.costBase)) : 0n;
      const number = await this.ledger.nextNumber(tx, ctx.tenantId, PREFIX.return[0], PREFIX.return[1]);
      const shiftId = await this.findOpenShift(tx, ctx, sale.storeId, dto.shiftId);
      const [ret] = await tx
        .insert(sales)
        .values({
          tenantId: ctx.tenantId,
          number,
          type: 'return',
          status: 'completed',
          storeId: sale.storeId,
          shiftId,
          customerId: sale.customerId,
          customerName: sale.customerName,
          salespersonId: ctx.userId,
          originalSaleId: sale.id,
          currencyCode: sale.currencyCode,
          rate: sale.rate,
          subtotal: fromCents(total + sum(lines.map((l) => l.discount))),
          discountTotal: fromCents(sum(lines.map((l) => l.discount))),
          taxTotal: fromCents(sum(lines.map((l) => l.tax))),
          total: fromCents(total),
          totalBase: fromCents(totalBase),
          costBase: fromCents(costBase),
          itemCount: formatFixed(sum(lines.map((l) => parseFixed(l.quantity, 3))), 3),
          fiscalStatus: info.fiscal,
          note: dto.reason,
          createdBy: ctx.userId,
        })
        .returning();
      await tx.insert(saleLines).values(lines.map((l, i) => this.lineRow(ctx, ret.id, l, i, false, l.originalLineId)));
      await tx.insert(salePayments).values({
        tenantId: ctx.tenantId,
        saleId: ret.id,
        method: dto.method,
        currencyCode: sale.currencyCode,
        rate: sale.rate,
        amount: fromCents(-total),
        amountBase: fromCents(-totalBase),
      });
      await this.moveStock(tx, ctx, sale.storeId, movements, 'return', number);

      const acc = await this.ledger.systemAccounts(tx, ctx);
      const je = await this.ledger.post(tx, ctx, {
        date: day,
        description: `Return ${number} of ${sale.number} · ${dto.reason}`,
        source: 'sale_return',
        sourceId: ret.id,
        reference: number,
        lines: [
          { accountId: acc.sales, debit: sum(lines.map((l) => l.netBase)) },
          { accountId: acc.vat_output, debit: sum(lines.map((l) => l.taxBase)) },
          { accountId: acc[METHOD_ACCOUNT[dto.method]], credit: totalBase },
          { accountId: acc.inventory, debit: costBase },
          { accountId: acc.cogs, credit: costBase },
        ],
      });
      await tx.update(sales).set({ journalEntryId: je.id }).where(eq(sales.id, ret.id));
      await this.audit.log(tx, ctx, 'create', 'Sale return', ret.id, { number, sale: sale.number, total: fromCents(total) });
      return this.getIn(tx, ret.id);
    });
  }

  /** Cancels a sale or return completely: stock and money go back as if it never happened. */
  voidSale(ctx: AuthContext, id: string) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const [s] = await tx.select().from(sales).where(eq(sales.id, id)).limit(1);
      found(s, 'Sale');
      if (s.type === 'quotation') throw new BadRequestException('Cancel a quotation instead');
      if (s.status !== 'completed') throw new BadRequestException(`This ${s.type} is already ${s.status}`);
      if (s.type === 'sale') {
        const [r] = await tx
          .select({ n: count() })
          .from(sales)
          .where(and(eq(sales.originalSaleId, id), eq(sales.type, 'return'), eq(sales.status, 'completed')));
        if (r.n > 0) throw new BadRequestException('This sale has returns. Void them first');
      }
      if (s.journalEntryId) await this.ledger.reverse(tx, ctx, s.journalEntryId, { description: `${s.type === 'sale' ? 'Sale' : 'Return'} ${s.number} voided` });
      const moved = await tx
        .select()
        .from(stockMovements)
        .where(and(eq(stockMovements.reference, s.number), inArray(stockMovements.type, ['sale', 'return'])));
      if (moved.length) {
        await tx.insert(stockMovements).values(
          moved.map((m) => ({
            tenantId: ctx.tenantId,
            storeId: m.storeId,
            variantId: m.variantId,
            quantity: formatFixed(-parseFixed(m.quantity, 3), 3),
            type: m.type,
            unitCost: m.unitCost,
            reference: `${s.number} void`,
            note: 'Voided',
            createdBy: ctx.userId,
          })),
        );
      }
      await tx.update(sales).set({ status: 'void' }).where(eq(sales.id, id));
      await tx.update(saleLines).set({ kitchenStatus: null }).where(eq(saleLines.saleId, id));
      await this.audit.log(tx, ctx, 'void', s.type === 'sale' ? 'Sale' : 'Sale return', id, { number: s.number });
      return this.getIn(tx, id);
    });
  }

  // ----- Reading ------------------------------------------------------------------------

  list(ctx: AuthContext, q: SaleQuery) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const { tz } = await this.tenantInfo(tx);
      const where: (SQL | undefined)[] = [];
      if (q.type) where.push(eq(sales.type, q.type));
      if (q.status) where.push(eq(sales.status, q.status));
      if (q.storeId) where.push(eq(sales.storeId, q.storeId));
      if (q.customerId) where.push(eq(sales.customerId, q.customerId));
      if (q.from) where.push(sql`(${sales.soldAt} AT TIME ZONE ${tz})::date >= ${q.from}::date`);
      if (q.to) where.push(sql`(${sales.soldAt} AT TIME ZONE ${tz})::date <= ${q.to}::date`);
      if (q.search) where.push(or(ilike(sales.number, likeEscape(q.search)), ilike(sales.customerName, likeEscape(q.search))));
      const condition = and(...where);
      const [{ total }] = await tx.select({ total: count() }).from(sales).where(condition);
      const rows = await tx
        .select({ sale: sales, storeName: stores.name, deviceName: devices.name, salesperson: users.fullName })
        .from(sales)
        .innerJoin(stores, eq(stores.id, sales.storeId))
        .leftJoin(devices, eq(devices.id, sales.deviceId))
        .leftJoin(users, eq(users.id, sales.salespersonId))
        .where(condition)
        .orderBy(desc(sales.soldAt), desc(sales.number))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
      return {
        items: rows.map((r) => ({ ...r.sale, storeName: r.storeName, deviceName: r.deviceName, salesperson: r.salesperson })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  get(ctx: AuthContext, id: string) {
    return this.dbs.withTenant(ctx, (tx) => this.getIn(tx, id));
  }

  async getIn(tx: Tx, id: string) {
    const [row] = await tx
      .select({ sale: sales, storeName: stores.name, deviceName: devices.name, salesperson: users.fullName })
      .from(sales)
      .innerJoin(stores, eq(stores.id, sales.storeId))
      .leftJoin(devices, eq(devices.id, sales.deviceId))
      .leftJoin(users, eq(users.id, sales.salespersonId))
      .where(eq(sales.id, id))
      .limit(1);
    found(row, 'Sale');
    const lines = await tx.select().from(saleLines).where(eq(saleLines.saleId, id)).orderBy(asc(saleLines.sortOrder));
    const payments = await tx.select().from(salePayments).where(eq(salePayments.saleId, id));
    const related = await tx
      .select({ id: sales.id, number: sales.number, type: sales.type, status: sales.status, total: sales.total, soldAt: sales.soldAt })
      .from(sales)
      .where(row.sale.originalSaleId ? or(eq(sales.originalSaleId, id), eq(sales.id, row.sale.originalSaleId)) : eq(sales.originalSaleId, id))
      .orderBy(asc(sales.soldAt));
    // How much of each line has already been returned, so the return form knows what's left.
    const returnedRes = await tx.execute(sql`
      SELECT l.original_line_id, sum(l.quantity)::text AS qty
      FROM sale_lines l JOIN sales s ON s.id = l.sale_id
      WHERE s.original_sale_id = ${id} AND s.type = 'return' AND s.status = 'completed'
      GROUP BY l.original_line_id`);
    const returned = new Map((returnedRes.rows as { original_line_id: string; qty: string }[]).map((r) => [r.original_line_id, r.qty]));
    return {
      ...row.sale,
      storeName: row.storeName,
      deviceName: row.deviceName,
      salesperson: row.salesperson,
      lines: lines.map((l) => ({ ...l, returnedQuantity: returned.get(l.id) ?? '0.000' })),
      payments,
      related,
    };
  }

  // ----- Kitchen ----------------------------------------------------------------------------

  /** Open kitchen tickets: completed sales with dishes not yet served, oldest first. */
  kitchen(ctx: AuthContext, q: KitchenQuery) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const where = [
        inArray(saleLines.kitchenStatus, ['pending', 'preparing', 'ready']),
        eq(sales.status, 'completed'),
        q.storeId ? eq(sales.storeId, q.storeId) : undefined,
        q.station ? eq(saleLines.kitchenStation, q.station) : undefined,
      ];
      const rows = await tx
        .select({ line: saleLines, number: sales.number, customerName: sales.customerName, soldAt: sales.soldAt, note: sales.note, storeName: stores.name })
        .from(saleLines)
        .innerJoin(sales, eq(sales.id, saleLines.saleId))
        .innerJoin(stores, eq(stores.id, sales.storeId))
        .where(and(...where))
        .orderBy(asc(sales.soldAt), asc(saleLines.sortOrder));
      const tickets = new Map<string, any>();
      for (const r of rows) {
        const t = tickets.get(r.line.saleId) ?? { saleId: r.line.saleId, number: r.number, customerName: r.customerName, soldAt: r.soldAt, note: r.note, storeName: r.storeName, lines: [] };
        t.lines.push({
          id: r.line.id,
          productName: r.line.productName,
          variantName: r.line.variantName,
          packName: r.line.packName,
          choices: r.line.modifiers?.map((m) => m.name) ?? [],
          quantity: r.line.quantity,
          station: r.line.kitchenStation,
          status: r.line.kitchenStatus,
          note: r.line.note,
        });
        tickets.set(r.line.saleId, t);
      }
      const stations = await tx.selectDistinct({ station: products.kitchenStation }).from(products).where(sql`${products.kitchenStation} IS NOT NULL`);
      return { tickets: [...tickets.values()], stations: stations.map((s) => s.station).filter(Boolean) };
    });
  }

  updateKitchen(ctx: AuthContext, saleId: string, dto: KitchenUpdateDto) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const where = [eq(saleLines.saleId, saleId), sql`${saleLines.kitchenStatus} IS NOT NULL`];
      if (dto.lineIds?.length) where.push(inArray(saleLines.id, dto.lineIds));
      const rows = await tx.update(saleLines).set({ kitchenStatus: dto.status }).where(and(...where)).returning({ id: saleLines.id });
      if (!rows.length) throw new BadRequestException('Nothing on this ticket goes to the kitchen');
      return { updated: rows.length };
    });
  }
}
