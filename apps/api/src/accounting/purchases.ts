import { BadRequestException, Body, Controller, Get, Injectable, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { and, eq, ilike, inArray, ne, or } from 'drizzle-orm';
import { AuditService } from '../common/audit.service.js';
import { type AuthContext, BOOKKEEPERS, Ctx, Role, Roles } from '../common/auth-context.js';
import { assertOwned } from '../common/ownership.js';
import { IsMoney, IsQuantity, ToDecimalString, Trim } from '../common/validation.js';
import { DbService, Tx } from '../db/db.service.js';
import { bills, billLines, products, productVariants, stockMovements, stores, suppliers, taxRates } from '../db/schema.js';
import { IdParam } from '../organization/organization.dto.js';
import { DocumentQuery, IsDay, IsRate } from './accounting.dto.js';
import { DocumentsService } from './documents.service.js';
import { LedgerService } from './ledger.service.js';
import { divRound, fromCents, parseFixed, toCents } from './money.js';

/** Who can record goods bought from suppliers: bookkeepers and stock clerks. */
const PURCHASERS: Role[] = [...BOOKKEEPERS, 'stock_clerk'];

export class PurchaseLineDto {
  @IsUUID() variantId: string;
  @ToDecimalString() @IsQuantity() quantity: string;
  /** Cost per unit in the purchase currency (before VAT unless the purchase is tax inclusive). */
  @ToDecimalString() @IsMoney() unitCost: string;
  @IsOptional() @IsUUID() taxRateId?: string | null;
}

export class PurchasePaymentDto {
  /** Cash, bank or mobile money account it was paid from. */
  @IsUUID() accountId: string;
  @IsOptional() @Trim() @IsString() @MaxLength(80) reference?: string;
}

export class CreatePurchaseDto {
  @IsUUID() supplierId: string;
  /** The store the goods were received into. */
  @IsUUID() storeId: string;
  @IsDay() date: string;
  @IsOptional() @IsDay() dueDate?: string;
  /** The supplier's invoice number. */
  @IsOptional() @Trim() @IsString() @MaxLength(60) supplierReference?: string;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currencyCode?: string;
  @IsOptional() @IsRate() rate?: string;
  @IsOptional() @IsBoolean() taxInclusive?: boolean;
  @IsOptional() @Trim() @IsString() @MaxLength(1000) notes?: string;
  /** Make each item's cost price this purchase's cost (default true). */
  @IsOptional() @IsBoolean() updateCostPrices?: boolean;
  /** Paid in full on the spot. Leave out to owe the supplier. */
  @IsOptional() @ValidateNested() @Type(() => PurchasePaymentDto) payment?: PurchasePaymentDto;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => PurchaseLineDto)
  lines: PurchaseLineDto[];
}

export class ImportPurchaseRowDto {
  /** The supplier's invoice number. Rows with the same supplier and reference become one purchase. */
  @Trim() @IsString() @Length(1, 60) reference: string;
  @IsISO8601() date: string;
  /** Supplier name; a new supplier is added if there's none by that name. */
  @Trim() @IsString() @Length(1, 160) supplier: string;
  /** Store code, e.g. MAIN. */
  @Trim() @IsString() @Length(1, 20) store: string;
  /** SKU or barcode. */
  @Trim() @IsString() @Length(1, 60) item: string;
  @ToDecimalString() @IsQuantity() quantity: string;
  @ToDecimalString() @IsMoney() unitCost: string;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currencyCode?: string;
  /** True when the cost has VAT to add (the business's standard rate). */
  @IsOptional() @IsBoolean() vat?: boolean;
}

export class ImportPurchasesDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => ImportPurchaseRowDto)
  rows: ImportPurchaseRowDto[];
}

/**
 * Purchases: supplier bills for stock. One purchase receives the goods into a
 * store at their cost and records what's owed (or paid) in the books — the
 * bill debits Stock directly, so the goods don't pass through "Stock
 * received, not yet billed".
 */
@Injectable()
export class PurchasesService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly documents: DocumentsService,
  ) {}

  list(ctx: AuthContext, q: DocumentQuery) {
    return this.documents.listDocuments(ctx, 'bill', { ...q, purchases: true });
  }

  get(ctx: AuthContext, id: string) {
    return this.documents.getDocument(ctx, 'bill', id);
  }

  async create(ctx: AuthContext, dto: CreatePurchaseDto) {
    const id = await this.dbs.withTenant(ctx, (tx) => this.createIn(tx, ctx, dto));
    return this.get(ctx, id);
  }

  private async createIn(tx: Tx, ctx: AuthContext, dto: CreatePurchaseDto) {
    await assertOwned(tx, stores, [dto.storeId], 'store');
    const ids = [...new Set(dto.lines.map((l) => l.variantId))];
    if (ids.length !== dto.lines.length) throw new BadRequestException('Each item can appear only once on a purchase');
    const items = await tx
      .select({ id: productVariants.id, name: productVariants.name, productName: products.name, trackStock: products.trackStock })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(inArray(productVariants.id, ids));
    if (items.length !== ids.length) throw new BadRequestException('Unknown item');
    const untracked = items.find((i) => !i.trackStock);
    if (untracked) throw new BadRequestException(`"${untracked.productName}" doesn't track stock. Record it as a bill instead`);
    const byId = new Map(items.map((i) => [i.id, i]));
    const acc = await this.ledger.systemAccounts(tx, ctx);

    const billId = await this.documents.createDocumentIn(
      tx,
      ctx,
      'bill',
      {
        supplierId: dto.supplierId,
        supplierReference: dto.supplierReference,
        date: dto.date,
        dueDate: dto.dueDate,
        currencyCode: dto.currencyCode,
        rate: dto.rate,
        taxInclusive: dto.taxInclusive,
        notes: dto.notes,
        lines: dto.lines.map((l) => {
          const i = byId.get(l.variantId)!;
          return {
            accountId: acc.inventory,
            description: i.name === 'Default' ? i.productName : `${i.productName} · ${i.name}`,
            quantity: l.quantity,
            unitPrice: l.unitCost,
            taxRateId: l.taxRateId ?? null,
          };
        }),
      },
      { storeId: dto.storeId, variantIds: dto.lines.map((l) => l.variantId) },
    );

    // Receive the goods at their cost in the base currency (net of VAT, which is claimed back).
    const [bill] = await tx.select().from(bills).where(eq(bills.id, billId));
    const lines = await tx.select().from(billLines).where(eq(billLines.billId, billId));
    const received = lines.map((l) => ({
      variantId: l.variantId!,
      quantity: l.quantity,
      unitCost: fromCents(divRound(toCents(l.netBase) * 1000n, parseFixed(l.quantity, 3))),
    }));
    await tx.insert(stockMovements).values(
      received.map((r) => ({
        tenantId: ctx.tenantId,
        storeId: dto.storeId,
        variantId: r.variantId,
        quantity: r.quantity,
        type: 'receive' as const,
        unitCost: r.unitCost,
        reference: bill.number,
        note: dto.supplierReference ? `Purchase · ${dto.supplierReference}` : 'Purchase',
        createdBy: ctx.userId,
      })),
    );
    if (dto.updateCostPrices ?? true) {
      for (const r of received) await tx.update(productVariants).set({ costPrice: r.unitCost }).where(eq(productVariants.id, r.variantId));
    }
    if (dto.payment) {
      await this.documents.payIn(tx, ctx, 'bill', billId, { accountId: dto.payment.accountId, date: dto.date, amount: bill.total, reference: dto.payment.reference });
    }
    await this.audit.log(tx, ctx, 'create', 'Purchase', billId, { number: bill.number, items: received.length });
    return billId;
  }

  /**
   * Imports purchase bills from a spreadsheet. Rows sharing supplier and
   * reference become one purchase; one already imported (same supplier and
   * reference) is skipped. Each purchase saves on its own.
   */
  async import(ctx: AuthContext, dto: ImportPurchasesDto) {
    const groups = new Map<string, ImportPurchasesDto['rows']>();
    for (const r of dto.rows) {
      const key = `${r.supplier.toLowerCase()}|${r.reference}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    const result = { imported: 0, skipped: 0, errors: [] as { reference: string; message: string }[] };
    for (const rows of groups.values()) {
      const first = rows[0];
      try {
        const outcome = await this.dbs.withTenant(ctx, async (tx) => {
          let [supplier] = await tx.select().from(suppliers).where(ilike(suppliers.name, first.supplier)).limit(1);
          if (!supplier) [supplier] = await tx.insert(suppliers).values({ tenantId: ctx.tenantId, name: first.supplier }).returning();
          const [dupe] = await tx
            .select({ id: bills.id })
            .from(bills)
            .where(and(eq(bills.supplierId, supplier.id), eq(bills.supplierReference, first.reference), ne(bills.status, 'void')))
            .limit(1);
          if (dupe) return 'skipped' as const;
          const [store] = await tx.select({ id: stores.id }).from(stores).where(ilike(stores.code, first.store)).limit(1);
          if (!store) throw new Error(`Unknown store code "${first.store}"`);
          const codes = [...new Set(rows.map((r) => r.item))];
          const variants = await tx
            .select({ id: productVariants.id, sku: productVariants.sku, barcode: productVariants.barcode })
            .from(productVariants)
            .where(or(inArray(productVariants.sku, codes), inArray(productVariants.barcode, codes)));
          const [vat] = await tx.select({ id: taxRates.id }).from(taxRates).where(eq(taxRates.isDefault, true)).limit(1);
          await this.createIn(tx, ctx, {
            supplierId: supplier.id,
            storeId: store.id,
            date: first.date.slice(0, 10),
            supplierReference: first.reference,
            currencyCode: first.currencyCode,
            notes: 'Imported',
            lines: rows.map((r) => {
              const v = variants.find((x) => x.sku?.toLowerCase() === r.item.toLowerCase() || x.barcode === r.item);
              if (!v) throw new Error(`Unknown item "${r.item}"`);
              return { variantId: v.id, quantity: r.quantity, unitCost: r.unitCost, taxRateId: r.vat && vat ? vat.id : null };
            }),
          });
          return 'imported' as const;
        });
        result[outcome] += 1;
      } catch (e) {
        result.errors.push({ reference: `${first.supplier} ${first.reference}`, message: e instanceof Error ? e.message : 'Could not import' });
      }
    }
    return result;
  }
}

@ApiTags('purchases')
@ApiBearerAuth()
@Roles(...PURCHASERS)
@Controller('purchases')
export class PurchasesController {
  constructor(private readonly svc: PurchasesService) {}

  @Get()
  list(@Ctx() ctx: AuthContext, @Query() q: DocumentQuery) {
    return this.svc.list(ctx, q);
  }

  @Get(':id')
  get(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.svc.get(ctx, p.id);
  }

  @Post()
  create(@Ctx() ctx: AuthContext, @Body() dto: CreatePurchaseDto) {
    return this.svc.create(ctx, dto);
  }

  @Post('import')
  import(@Ctx() ctx: AuthContext, @Body() dto: ImportPurchasesDto) {
    return this.svc.import(ctx, dto);
  }
}
