import { BadRequestException, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import { AuditService } from '../common/audit.service.js';
import { type AuthContext } from '../common/auth-context.js';
import { assertOwned } from '../common/ownership.js';
import { TenantCrud } from '../common/tenant-crud.js';
import { found } from '../common/validation.js';
import { DbService } from '../db/db.service.js';
import {
  categories,
  currencies,
  modifierGroups,
  modifiers,
  priceListItems,
  priceLists,
  products,
  productVariants,
  taxRates,
  units,
} from '../db/schema.js';
import {
  CreateCategoryDto,
  CreateModifierGroupDto,
  CreatePriceListDto,
  CreateTaxRateDto,
  SetPriceListItemsDto,
  UpdateCategoryDto,
  UpdateModifierGroupDto,
  UpdatePriceListDto,
  UpdateTaxRateDto,
} from './catalog.dto.js';

@Injectable()
export class CategoriesService extends TenantCrud<typeof categories> {
  constructor(dbs: DbService, audit: AuditService) {
    super(dbs, audit, categories, {
      entity: 'Category',
      searchColumns: [categories.name],
      orderBy: [categories.sortOrder, categories.name],
    });
  }

  override async create(ctx: AuthContext, dto: CreateCategoryDto) {
    await this.checkParent(ctx, undefined, dto.parentId);
    return super.create(ctx, dto);
  }

  override async update(ctx: AuthContext, id: string, dto: UpdateCategoryDto) {
    await this.checkParent(ctx, id, dto.parentId);
    return super.update(ctx, id, dto);
  }

  private async checkParent(ctx: AuthContext, id: string | undefined, parentId?: string) {
    if (!parentId) return;
    if (parentId === id) throw new BadRequestException('A category cannot be its own parent');
    await this.dbs.withTenant(ctx, (tx) => assertOwned(tx, categories, [parentId], 'parent category'));
  }
}

/** Tables with an is_default flag where only one row may be the default. */
@Injectable()
export class TaxRatesService extends TenantCrud<typeof taxRates> {
  constructor(dbs: DbService, audit: AuditService) {
    super(dbs, audit, taxRates, {
      entity: 'Tax rate',
      searchColumns: [taxRates.name, taxRates.code],
      orderBy: [taxRates.name],
    });
  }

  override async create(ctx: AuthContext, dto: CreateTaxRateDto) {
    const row = await super.create(ctx, dto);
    if (dto.isDefault) await this.makeOnlyDefault(ctx, row.id);
    return row;
  }

  override async update(ctx: AuthContext, id: string, dto: UpdateTaxRateDto) {
    const row = await super.update(ctx, id, dto);
    if (dto.isDefault) await this.makeOnlyDefault(ctx, id);
    return row;
  }

  private makeOnlyDefault(ctx: AuthContext, id: string) {
    return this.dbs.withTenant(ctx, (tx) =>
      tx.update(taxRates).set({ isDefault: false }).where(and(ne(taxRates.id, id), eq(taxRates.isDefault, true))),
    );
  }
}

@Injectable()
export class UnitsService extends TenantCrud<typeof units> {
  constructor(dbs: DbService, audit: AuditService) {
    super(dbs, audit, units, { entity: 'Unit', orderBy: [units.name] });
  }
}

@Injectable()
export class CurrenciesService extends TenantCrud<typeof currencies> {
  constructor(dbs: DbService, audit: AuditService) {
    super(dbs, audit, currencies, {
      entity: 'Currency',
      orderBy: [currencies.code],
    });
  }

  override async update(ctx: AuthContext, id: string, dto: Partial<typeof currencies.$inferInsert>) {
    const current = await this.get(ctx, id);
    if (current.isBase && (dto.rateToBase !== undefined && Number(dto.rateToBase) !== 1)) {
      throw new BadRequestException('The base currency rate is always 1');
    }
    if (current.isBase && dto.code && dto.code !== current.code) {
      throw new BadRequestException('The base currency code cannot be changed');
    }
    return super.update(ctx, id, dto);
  }

  override async remove(ctx: AuthContext, id: string) {
    const current = await this.get(ctx, id);
    if (current.isBase) throw new BadRequestException('The base currency cannot be removed');
    return super.remove(ctx, id);
  }
}

@Injectable()
export class PriceListsService extends TenantCrud<typeof priceLists> {
  constructor(dbs: DbService, audit: AuditService) {
    super(dbs, audit, priceLists, { entity: 'Price list', orderBy: [priceLists.name] });
  }

  override async create(ctx: AuthContext, dto: CreatePriceListDto) {
    const row = await super.create(ctx, dto);
    if (dto.isDefault) await this.makeOnlyDefault(ctx, row.id);
    return row;
  }

  override async update(ctx: AuthContext, id: string, dto: UpdatePriceListDto) {
    const row = await super.update(ctx, id, dto);
    if (dto.isDefault) await this.makeOnlyDefault(ctx, id);
    return row;
  }

  items(ctx: AuthContext, priceListId: string) {
    return this.dbs.withTenant(ctx, async (tx) => {
      await this.getIn(tx, priceListId);
      // With names and the normal price, so a price list can be shown and edited on its own.
      const rows = await tx
        .select({ item: priceListItems, productName: products.name, variantName: productVariants.name, sku: productVariants.sku, basePrice: productVariants.price })
        .from(priceListItems)
        .innerJoin(productVariants, eq(productVariants.id, priceListItems.variantId))
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(and(eq(priceListItems.priceListId, priceListId), isNull(priceListItems.packagingId)))
        .orderBy(asc(products.name), asc(productVariants.name), asc(priceListItems.minQuantity));
      return rows.map((r) => ({ ...r.item, productName: r.productName, variantName: r.variantName, sku: r.sku, basePrice: r.basePrice }));
    });
  }

  /** Replaces all price breaks for the variants included in the request. */
  setItems(ctx: AuthContext, priceListId: string, dto: SetPriceListItemsDto) {
    return this.dbs.withTenant(ctx, async (tx) => {
      await this.getIn(tx, priceListId);
      const variantIds = [...new Set([...dto.items.map((i) => i.variantId), ...(dto.removeVariantIds ?? [])])];
      await assertOwned(tx, productVariants, variantIds, 'product variant');
      for (const variantId of variantIds) {
        await tx
          .delete(priceListItems)
          .where(and(eq(priceListItems.priceListId, priceListId), eq(priceListItems.variantId, variantId), isNull(priceListItems.packagingId)));
      }
      if (dto.items.length) {
        await tx.insert(priceListItems).values(
          dto.items.map((i) => ({
            tenantId: ctx.tenantId,
            priceListId,
            variantId: i.variantId,
            minQuantity: i.minQuantity ?? '1',
            price: i.price,
          })),
        );
      }
      await this.audit.log(tx, ctx, 'set_prices', 'Price list', priceListId, { count: dto.items.length });
      return tx
        .select()
        .from(priceListItems)
        .where(and(eq(priceListItems.priceListId, priceListId), isNull(priceListItems.packagingId)));
    });
  }

  private makeOnlyDefault(ctx: AuthContext, id: string) {
    return this.dbs.withTenant(ctx, (tx) =>
      tx
        .update(priceLists)
        .set({ isDefault: false })
        .where(and(ne(priceLists.id, id), eq(priceLists.isDefault, true))),
    );
  }
}

@Injectable()
export class ModifierGroupsService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: AuthContext) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const groups = await tx.select().from(modifierGroups).orderBy(asc(modifierGroups.name));
      const options = await tx
        .select()
        .from(modifiers)
        .orderBy(asc(modifiers.sortOrder), asc(modifiers.name));
      return groups.map((g) => ({ ...g, modifiers: options.filter((m) => m.groupId === g.id) }));
    });
  }

  async get(ctx: AuthContext, id: string) {
    const all = await this.list(ctx);
    return found(
      all.find((g) => g.id === id),
      'Modifier group',
    );
  }

  async create(ctx: AuthContext, dto: CreateModifierGroupDto) {
    this.checkLimits(dto.minSelect ?? 0, dto.maxSelect ?? 1);
    const id = await this.dbs.withTenant(ctx, async (tx) => {
      await assertOwned(tx, productVariants, dto.modifiers.map((m) => m.variantId), 'product variant');
      const [g] = await tx
        .insert(modifierGroups)
        .values({
          tenantId: ctx.tenantId,
          name: dto.name,
          minSelect: dto.minSelect,
          maxSelect: dto.maxSelect,
        })
        .returning();
      await this.replaceOptions(tx, ctx, g.id, dto.modifiers);
      await this.audit.log(tx, ctx, 'create', 'Modifier group', g.id, dto);
      return g.id;
    });
    return this.get(ctx, id);
  }

  async update(ctx: AuthContext, id: string, dto: UpdateModifierGroupDto) {
    await this.dbs.withTenant(ctx, async (tx) => {
      const [current] = await tx.select().from(modifierGroups).where(eq(modifierGroups.id, id));
      found(current, 'Modifier group');
      this.checkLimits(dto.minSelect ?? current.minSelect, dto.maxSelect ?? current.maxSelect);
      const { modifiers: options, ...fields } = dto;
      if (Object.keys(fields).length) {
        await tx.update(modifierGroups).set(fields).where(eq(modifierGroups.id, id));
      }
      if (options) {
        await assertOwned(tx, productVariants, options.map((m) => m.variantId), 'product variant');
        await this.replaceOptions(tx, ctx, id, options);
      }
      await this.audit.log(tx, ctx, 'update', 'Modifier group', id, dto);
    });
    return this.get(ctx, id);
  }

  remove(ctx: AuthContext, id: string) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const rows = await tx.delete(modifierGroups).where(eq(modifierGroups.id, id)).returning({ id: modifierGroups.id });
      found(rows[0], 'Modifier group');
      await this.audit.log(tx, ctx, 'delete', 'Modifier group', id);
      return { id };
    });
  }

  private checkLimits(min: number, max: number) {
    if (min > max) throw new BadRequestException('minSelect cannot be more than maxSelect');
  }

  private async replaceOptions(
    tx: Parameters<Parameters<DbService['withTenant']>[1]>[0],
    ctx: AuthContext,
    groupId: string,
    options: CreateModifierGroupDto['modifiers'],
  ) {
    await tx.delete(modifiers).where(eq(modifiers.groupId, groupId));
    if (!options.length) return;
    await tx.insert(modifiers).values(
      options.map((m, i) => ({
        tenantId: ctx.tenantId,
        groupId,
        name: m.name,
        priceDelta: m.priceDelta ?? '0',
        variantId: m.variantId,
        sortOrder: m.sortOrder ?? i,
      })),
    );
  }
}
