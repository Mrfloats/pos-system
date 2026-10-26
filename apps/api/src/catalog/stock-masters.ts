import { BadRequestException, Body, Controller, Delete, Get, Injectable, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsOptional, IsString, IsUUID, Length, ValidateNested } from 'class-validator';
import { and, asc, count, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { AuditService } from '../common/audit.service.js';
import { type AuthContext, Ctx, MANAGERS, Roles } from '../common/auth-context.js';
import { assertOwned } from '../common/ownership.js';
import { found, IsMoney, likeEscape, ListQuery, ToDecimalString, Trim } from '../common/validation.js';
import { DbService, Tx } from '../db/db.service.js';
import { attributes, attributeValues, products, productVariants, storePrices, stores } from '../db/schema.js';
import { IdParam } from '../organization/organization.dto.js';

// ----- Variant attributes ---------------------------------------------------------

export class AttributeDto {
  @Trim() @IsString() @Length(1, 60) name: string;
  /** In display order, e.g. ["Small", "Medium", "Large"]. */
  @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) @Length(1, 60, { each: true }) values: string[];
}

export class UpdateAttributeDto {
  @IsOptional() @Trim() @IsString() @Length(1, 60) name?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) @Length(1, 60, { each: true }) values?: string[];
}

@Injectable()
export class AttributesService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: AuthContext) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const rows = await tx.select().from(attributes).orderBy(asc(attributes.sortOrder), asc(attributes.name));
      const values = await tx.select().from(attributeValues).orderBy(asc(attributeValues.sortOrder));
      return rows.map((a) => ({ ...a, values: values.filter((v) => v.attributeId === a.id).map((v) => ({ id: v.id, value: v.value })) }));
    });
  }

  private async setValues(tx: Tx, tenantId: string, attributeId: string, values: string[]) {
    const clean = values.map((v) => v.trim()).filter(Boolean);
    await tx.delete(attributeValues).where(eq(attributeValues.attributeId, attributeId));
    if (clean.length) {
      await tx.insert(attributeValues).values(clean.map((value, i) => ({ tenantId, attributeId, value, sortOrder: i })));
    }
  }

  create(ctx: AuthContext, dto: AttributeDto) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const [a] = await tx.insert(attributes).values({ tenantId: ctx.tenantId, name: dto.name }).returning();
      await this.setValues(tx, ctx.tenantId, a.id, dto.values);
      await this.audit.log(tx, ctx, 'create', 'Attribute', a.id, dto);
      return a;
    });
  }

  update(ctx: AuthContext, id: string, dto: UpdateAttributeDto) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const [a] = await tx.select().from(attributes).where(eq(attributes.id, id)).limit(1);
      found(a, 'Attribute');
      if (dto.name) await tx.update(attributes).set({ name: dto.name }).where(eq(attributes.id, id));
      if (dto.values) await this.setValues(tx, ctx.tenantId, id, dto.values);
      await this.audit.log(tx, ctx, 'update', 'Attribute', id, dto);
      return { ...a, name: dto.name ?? a.name };
    });
  }

  remove(ctx: AuthContext, id: string) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const rows = await tx.delete(attributes).where(eq(attributes.id, id)).returning({ id: attributes.id });
      found(rows[0], 'Attribute');
      await this.audit.log(tx, ctx, 'delete', 'Attribute', id);
      return { id };
    });
  }
}

@ApiTags('attributes')
@ApiBearerAuth()
@Controller('attributes')
export class AttributesController {
  constructor(private readonly svc: AttributesService) {}

  @Get()
  list(@Ctx() ctx: AuthContext) {
    return this.svc.list(ctx);
  }

  @Roles(...MANAGERS)
  @Post()
  create(@Ctx() ctx: AuthContext, @Body() dto: AttributeDto) {
    return this.svc.create(ctx, dto);
  }

  @Roles(...MANAGERS)
  @Patch(':id')
  update(@Ctx() ctx: AuthContext, @Param() p: IdParam, @Body() dto: UpdateAttributeDto) {
    return this.svc.update(ctx, p.id, dto);
  }

  @Roles(...MANAGERS)
  @Delete(':id')
  remove(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.svc.remove(ctx, p.id);
  }
}

// ----- Store prices ----------------------------------------------------------------

export class StorePriceQuery extends ListQuery {
  @IsUUID() storeId: string;
}

export class StorePriceItemDto {
  @IsUUID() variantId: string;
  /** Null removes the store price, so the normal price applies again. */
  @IsOptional() @ToDecimalString() @IsMoney() price: string | null;
}

export class SetStorePricesDto {
  @IsUUID() storeId: string;
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => StorePriceItemDto) items: StorePriceItemDto[];
}

@Injectable()
export class StorePricesService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  /** Every active variant with its normal price and, where set, its price in this store. */
  list(ctx: AuthContext, q: StorePriceQuery) {
    return this.dbs.withTenant(ctx, async (tx) => {
      await assertOwned(tx, stores, [q.storeId], 'store');
      const where = and(
        eq(products.active, true),
        eq(productVariants.active, true),
        q.search
          ? or(ilike(products.name, likeEscape(q.search)), ilike(productVariants.sku, likeEscape(q.search)), eq(productVariants.barcode, q.search))
          : undefined,
      );
      const [{ total }] = await tx
        .select({ total: count() })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(where);
      const items = await tx
        .select({
          variantId: productVariants.id,
          productName: products.name,
          variantName: productVariants.name,
          sku: productVariants.sku,
          price: productVariants.price,
          storePrice: storePrices.price,
        })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .leftJoin(storePrices, and(eq(storePrices.variantId, productVariants.id), eq(storePrices.storeId, q.storeId)))
        .where(where)
        .orderBy(asc(products.name), asc(productVariants.name))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  set(ctx: AuthContext, dto: SetStorePricesDto) {
    return this.dbs.withTenant(ctx, async (tx) => {
      await assertOwned(tx, stores, [dto.storeId], 'store');
      const ids = dto.items.map((i) => i.variantId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException('Each item can appear only once');
      await assertOwned(tx, productVariants, ids, 'product variant');
      const clear = dto.items.filter((i) => i.price == null).map((i) => i.variantId);
      const set = dto.items.filter((i) => i.price != null);
      if (clear.length) {
        await tx.delete(storePrices).where(and(eq(storePrices.storeId, dto.storeId), inArray(storePrices.variantId, clear)));
      }
      if (set.length) {
        await tx
          .insert(storePrices)
          .values(set.map((i) => ({ tenantId: ctx.tenantId, storeId: dto.storeId, variantId: i.variantId, price: i.price! })))
          .onConflictDoUpdate({ target: [storePrices.storeId, storePrices.variantId], set: { price: sql`excluded.price` } });
      }
      await this.audit.log(tx, ctx, 'update', 'Store prices', dto.storeId, { set: set.length, cleared: clear.length });
      return { set: set.length, cleared: clear.length };
    });
  }
}

@ApiTags('store-prices')
@ApiBearerAuth()
@Controller('store-prices')
export class StorePricesController {
  constructor(private readonly svc: StorePricesService) {}

  @Get()
  list(@Ctx() ctx: AuthContext, @Query() q: StorePriceQuery) {
    return this.svc.list(ctx, q);
  }

  @Roles(...MANAGERS)
  @Put()
  set(@Ctx() ctx: AuthContext, @Body() dto: SetStorePricesDto) {
    return this.svc.set(ctx, dto);
  }
}
