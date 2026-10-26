import { BadRequestException, Body, Controller, Get, Injectable, Module, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { and, count, desc, eq, inArray, sql, SQL } from 'drizzle-orm';
import { AccountingModule } from '../accounting/accounting.module.js';
import { LedgerService } from '../accounting/ledger.service.js';
import { AuditService } from '../common/audit.service.js';
import { type AuthContext, Ctx, Roles, STOCK_WRITERS } from '../common/auth-context.js';
import { assertOwned } from '../common/ownership.js';
import {
  IsMoney,
  IsQuantity,
  IsSignedQuantity,
  likeEscape,
  ListQuery,
  ToDecimalString,
  Trim,
} from '../common/validation.js';
import { DbService, Tx } from '../db/db.service.js';
import { products, productVariants, stockMovements, stores } from '../db/schema.js';
import { StockReportsController, StockReportsService } from './stock-reports.js';

// ----- DTOs ------------------------------------------------------------------

export const MANUAL_MOVEMENT_TYPES = ['opening', 'receive', 'adjustment', 'waste'] as const;

/** Journal entry descriptions for the value of stock movements. */
const STOCK_POSTING_LABELS: Record<(typeof MANUAL_MOVEMENT_TYPES)[number], string> = {
  opening: 'Opening stock',
  receive: 'Goods received',
  adjustment: 'Stock adjustment',
  waste: 'Stock written off',
};

export class MovementLineDto {
  @IsUUID() variantId: string;
  /** Positive for opening/receive/waste; signed (+/−) for adjustment. Base units. */
  @ToDecimalString() @IsSignedQuantity() quantity: string;
  @IsOptional() @ToDecimalString() @IsMoney() unitCost?: string;
  /** Idempotency key: resending the same clientId is ignored. */
  @IsOptional() @IsUUID() clientId?: string;
}

export class CreateMovementsDto {
  @IsUUID() storeId: string;
  @IsIn(MANUAL_MOVEMENT_TYPES) type: (typeof MANUAL_MOVEMENT_TYPES)[number];
  @IsOptional() @Trim() @IsString() @MaxLength(80) reference?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(500) note?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => MovementLineDto)
  lines: MovementLineDto[];
}

export class TransferLineDto {
  @IsUUID() variantId: string;
  @ToDecimalString() @IsQuantity() quantity: string;
}

export class TransferDto {
  @IsUUID() fromStoreId: string;
  @IsUUID() toStoreId: string;
  @IsOptional() @Trim() @IsString() @MaxLength(80) reference?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(500) note?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => TransferLineDto)
  lines: TransferLineDto[];
}

export class StockTakeLineDto {
  @IsUUID() variantId: string;
  @ToDecimalString() @IsQuantity() countedQuantity: string;
}

export class StockTakeDto {
  @IsUUID() storeId: string;
  @IsOptional() @Trim() @IsString() @MaxLength(80) reference?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => StockTakeLineDto)
  lines: StockTakeLineDto[];
}

export class LevelsQuery extends ListQuery {
  @IsUUID() storeId: string;
  /** Only items at or below their reorder level. */
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  lowStock?: boolean;
}

export class MovementsQuery extends ListQuery {
  @IsOptional() @IsUUID() storeId?: string;
  @IsOptional() @IsUUID() variantId?: string;
}

// ----- Service -----------------------------------------------------------------

@Injectable()
export class InventoryService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
  ) {}

  /** Stock on hand per variant in one store (sum of the ledger). */
  levels(ctx: AuthContext, q: LevelsQuery) {
    return this.dbs.withTenant(ctx, async (tx) => {
      await assertOwned(tx, stores, [q.storeId], 'store');
      const search = q.search
        ? sql`AND (p.name ILIKE ${likeEscape(q.search)} OR v.sku ILIKE ${likeEscape(q.search)} OR v.barcode = ${q.search})`
        : sql``;
      const low = q.lowStock ? sql`WHERE v_reorder IS NOT NULL AND on_hand <= v_reorder` : sql``;
      const base = sql`
        WITH levels AS (
          SELECT v.id AS variant_id, p.id AS product_id, p.name AS product_name, v.name AS variant_name,
                 v.sku, v.barcode, v.price, v.cost_price, v.reorder_level AS v_reorder,
                 COALESCE(SUM(m.quantity), 0) AS on_hand
          FROM product_variants v
          JOIN products p ON p.id = v.product_id
          LEFT JOIN stock_movements m ON m.variant_id = v.id AND m.store_id = ${q.storeId}
          WHERE p.track_stock AND p.active AND v.active ${search}
          GROUP BY v.id, p.id
        )`;
      const totalRes = await tx.execute(sql`${base} SELECT count(*)::int AS total FROM levels ${low}`);
      const rows = await tx.execute(sql`${base}
        SELECT * FROM levels ${low}
        ORDER BY product_name, variant_name
        LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`);
      return {
        items: rows.rows.map((r: any) => ({
          variantId: r.variant_id,
          productId: r.product_id,
          productName: r.product_name,
          variantName: r.variant_name,
          sku: r.sku,
          barcode: r.barcode,
          price: r.price,
          costPrice: r.cost_price,
          reorderLevel: r.v_reorder,
          onHand: String(r.on_hand),
        })),
        total: (totalRes.rows[0] as any).total as number,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  movements(ctx: AuthContext, q: MovementsQuery) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const where: SQL[] = [];
      if (q.storeId) where.push(eq(stockMovements.storeId, q.storeId));
      if (q.variantId) where.push(eq(stockMovements.variantId, q.variantId));
      const condition = where.length ? and(...where) : undefined;
      const [{ total }] = await tx.select({ total: count() }).from(stockMovements).where(condition);
      const items = await tx
        .select({
          movement: stockMovements,
          productName: products.name,
          variantName: productVariants.name,
          storeName: stores.name,
        })
        .from(stockMovements)
        .innerJoin(productVariants, eq(productVariants.id, stockMovements.variantId))
        .innerJoin(products, eq(products.id, productVariants.productId))
        .innerJoin(stores, eq(stores.id, stockMovements.storeId))
        .where(condition)
        .orderBy(desc(stockMovements.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
      return {
        items: items.map((i) => ({ ...i.movement, productName: i.productName, variantName: i.variantName, storeName: i.storeName })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  /** Opening stock, goods received, manual adjustments and waste. */
  record(ctx: AuthContext, dto: CreateMovementsDto) {
    return this.dbs.withTenant(ctx, async (tx) => {
      await assertOwned(tx, stores, [dto.storeId], 'store');
      await this.assertStockable(tx, dto.lines.map((l) => l.variantId));

      const values = dto.lines.map((l) => {
        const n = Number(l.quantity);
        if (n === 0) throw new BadRequestException('Quantity cannot be zero');
        if (dto.type !== 'adjustment' && n < 0) {
          throw new BadRequestException(`Use positive quantities for ${dto.type}`);
        }
        const signed = dto.type === 'waste' ? `-${l.quantity}` : l.quantity;
        return {
          tenantId: ctx.tenantId,
          storeId: dto.storeId,
          variantId: l.variantId,
          quantity: signed,
          type: dto.type,
          unitCost: l.unitCost ?? null,
          reference: dto.reference ?? null,
          note: dto.note ?? null,
          clientId: l.clientId ?? null,
          createdBy: ctx.userId,
        };
      });
      // Duplicate clientIds (a retried request) are silently skipped.
      const inserted = await tx.insert(stockMovements).values(values).onConflictDoNothing().returning();
      await this.ledger.postStockMovements(tx, ctx, inserted, {
        description: STOCK_POSTING_LABELS[dto.type],
        reference: dto.reference,
      });
      await this.audit.log(tx, ctx, `stock_${dto.type}`, 'Stock', dto.storeId, {
        lines: dto.lines.length,
        reference: dto.reference,
      });
      return { recorded: inserted.length, skippedDuplicates: values.length - inserted.length, movements: inserted };
    });
  }

  transfer(ctx: AuthContext, dto: TransferDto) {
    if (dto.fromStoreId === dto.toStoreId) throw new BadRequestException('Choose two different stores');
    return this.dbs.withTenant(ctx, async (tx) => {
      await assertOwned(tx, stores, [dto.fromStoreId, dto.toStoreId], 'store');
      await this.assertStockable(tx, dto.lines.map((l) => l.variantId));
      const reference = dto.reference ?? `TRF-${Date.now().toString(36).toUpperCase()}`;
      const common = { tenantId: ctx.tenantId, reference, note: dto.note ?? null, createdBy: ctx.userId };
      const rows = dto.lines.flatMap((l) => {
        if (Number(l.quantity) <= 0) throw new BadRequestException('Transfer quantities must be positive');
        return [
          { ...common, storeId: dto.fromStoreId, variantId: l.variantId, quantity: `-${l.quantity}`, type: 'transfer_out' as const },
          { ...common, storeId: dto.toStoreId, variantId: l.variantId, quantity: l.quantity, type: 'transfer_in' as const },
        ];
      });
      const inserted = await tx.insert(stockMovements).values(rows).returning();
      await this.audit.log(tx, ctx, 'stock_transfer', 'Stock', null, { ...dto, reference });
      return { reference, movements: inserted };
    });
  }

  /** Records counted quantities: the difference from the system figure becomes an adjustment. */
  stockTake(ctx: AuthContext, dto: StockTakeDto) {
    return this.dbs.withTenant(ctx, async (tx) => {
      await assertOwned(tx, stores, [dto.storeId], 'store');
      const ids = dto.lines.map((l) => l.variantId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException('Each item can be counted only once');
      await this.assertStockable(tx, ids);

      const current = await tx
        .select({ variantId: stockMovements.variantId, onHand: sql<string>`sum(${stockMovements.quantity})` })
        .from(stockMovements)
        .where(and(eq(stockMovements.storeId, dto.storeId), inArray(stockMovements.variantId, ids)))
        .groupBy(stockMovements.variantId);
      const onHand = new Map(current.map((c) => [c.variantId, c.onHand]));
      const reference = dto.reference ?? `COUNT-${new Date().toISOString().slice(0, 10)}`;

      const adjustments = dto.lines
        .map((l) => {
          const diff = decimalDiff(l.countedQuantity, onHand.get(l.variantId) ?? '0');
          return { line: l, diff };
        })
        .filter((a) => a.diff !== '0.000');

      const inserted = adjustments.length
        ? await tx
            .insert(stockMovements)
            .values(
              adjustments.map((a) => ({
                tenantId: ctx.tenantId,
                storeId: dto.storeId,
                variantId: a.line.variantId,
                quantity: a.diff,
                type: 'adjustment' as const,
                reference,
                note: 'Stock take',
                createdBy: ctx.userId,
              })),
            )
            .returning()
        : [];
      await this.ledger.postStockMovements(tx, ctx, inserted, { description: 'Stock take differences', reference });
      await this.audit.log(tx, ctx, 'stock_take', 'Stock', dto.storeId, { counted: dto.lines.length, adjusted: inserted.length, reference });
      return { counted: dto.lines.length, adjusted: inserted.length, reference, movements: inserted };
    });
  }

  private async assertStockable(tx: Tx, variantIds: string[]) {
    const unique = [...new Set(variantIds)];
    const rows = await tx
      .select({ id: productVariants.id, trackStock: products.trackStock, name: products.name })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(inArray(productVariants.id, unique));
    if (rows.length !== unique.length) throw new BadRequestException('Unknown product variant');
    const untracked = rows.find((r) => !r.trackStock);
    if (untracked) throw new BadRequestException(`"${untracked.name}" does not track stock`);
  }
}

/** counted − onHand using fixed-point thousandths (avoids floating-point drift). */
function decimalDiff(counted: string, onHand: string): string {
  const toMilli = (s: string) => {
    const neg = s.startsWith('-');
    const [i, f = ''] = s.replace('-', '').split('.');
    const v = BigInt(i) * 1000n + BigInt((f + '000').slice(0, 3));
    return neg ? -v : v;
  };
  const d = toMilli(counted) - toMilli(onHand);
  const neg = d < 0n;
  const abs = neg ? -d : d;
  return `${neg ? '-' : ''}${abs / 1000n}.${(abs % 1000n).toString().padStart(3, '0')}`;
}

// ----- Controller --------------------------------------------------------------

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(private readonly svc: InventoryService) {}

  @Get('levels')
  levels(@Ctx() ctx: AuthContext, @Query() q: LevelsQuery) {
    return this.svc.levels(ctx, q);
  }

  @Get('movements')
  movements(@Ctx() ctx: AuthContext, @Query() q: MovementsQuery) {
    return this.svc.movements(ctx, q);
  }

  @Roles(...STOCK_WRITERS)
  @Post('movements')
  record(@Ctx() ctx: AuthContext, @Body() dto: CreateMovementsDto) {
    return this.svc.record(ctx, dto);
  }

  @Roles(...STOCK_WRITERS)
  @Post('transfers')
  transfer(@Ctx() ctx: AuthContext, @Body() dto: TransferDto) {
    return this.svc.transfer(ctx, dto);
  }

  @Roles(...STOCK_WRITERS)
  @Post('stock-takes')
  stockTake(@Ctx() ctx: AuthContext, @Body() dto: StockTakeDto) {
    return this.svc.stockTake(ctx, dto);
  }
}

@Module({
  imports: [AccountingModule],
  controllers: [InventoryController, StockReportsController],
  providers: [InventoryService, StockReportsService],
})
export class InventoryModule {}
