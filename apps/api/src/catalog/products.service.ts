import { BadRequestException, Injectable } from '@nestjs/common';
import { and, asc, count, eq, exists, ilike, inArray, isNull, or, sql, SQL } from 'drizzle-orm';
import { AuditService } from '../common/audit.service.js';
import { type AuthContext } from '../common/auth-context.js';
import { assertOwned } from '../common/ownership.js';
import { found, likeEscape, Page } from '../common/validation.js';
import { DbService, Tx } from '../db/db.service.js';
import {
  categories,
  modifierGroups,
  priceListItems,
  priceLists,
  productComponents,
  productModifierGroups,
  productPackagings,
  products,
  productVariants,
  taxRates,
  units,
} from '../db/schema.js';
import { CreateProductDto, ProductQuery, UpdateProductDto, VariantDto } from './catalog.dto.js';

type Product = typeof products.$inferSelect;
type Variant = typeof productVariants.$inferSelect;

@Injectable()
export class ProductsService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  /** Paginated product list with variants. Search matches name, SKU or barcode. */
  async list(ctx: AuthContext, q: ProductQuery): Promise<Page<Product & { variants: Variant[] }>> {
    return this.dbs.withTenant(ctx, async (tx) => {
      const where: SQL[] = [];
      if (q.categoryId) where.push(eq(products.categoryId, q.categoryId));
      if (q.kind) where.push(eq(products.kind, q.kind));
      if (q.active !== undefined) where.push(eq(products.active, q.active));
      if (q.search) {
        const pattern = likeEscape(q.search);
        where.push(
          or(
            ilike(products.name, pattern),
            exists(
              tx
                .select({ one: productVariants.id })
                .from(productVariants)
                .where(
                  and(
                    eq(productVariants.productId, products.id),
                    or(ilike(productVariants.sku, pattern), eq(productVariants.barcode, q.search)),
                  ),
                ),
            ),
          )!,
        );
      }
      const condition = where.length ? and(...where) : undefined;

      const [{ total }] = await tx.select({ total: count() }).from(products).where(condition);
      const rows = await tx
        .select()
        .from(products)
        .where(condition)
        .orderBy(asc(products.name))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);

      const variants = rows.length
        ? await tx
            .select()
            .from(productVariants)
            .where(inArray(productVariants.productId, rows.map((r) => r.id)))
            .orderBy(asc(productVariants.createdAt))
        : [];
      const listPrices = await this.listPricesFor(
        tx,
        variants.map((v) => v.id),
      );
      // Stock across all stores, and which stores hold any, for the stock management list.
      const stock = new Map<string, { onHand: string; stores: string[] }>();
      if (q.withStock && rows.length) {
        const res = await tx.execute(sql`
          SELECT v.product_id, s.name AS store_name, sum(m.quantity)::text AS qty
          FROM stock_movements m
          JOIN product_variants v ON v.id = m.variant_id
          JOIN stores s ON s.id = m.store_id
          WHERE v.product_id IN (${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)})
          GROUP BY v.product_id, s.name
          ORDER BY s.name`);
        for (const r of res.rows as { product_id: string; store_name: string; qty: string }[]) {
          const entry = stock.get(r.product_id) ?? { onHand: '0', stores: [] };
          entry.onHand = (Number(entry.onHand) + Number(r.qty)).toFixed(3);
          if (Number(r.qty) !== 0) entry.stores.push(r.store_name);
          stock.set(r.product_id, entry);
        }
      }
      return {
        items: rows.map((p) => ({
          ...p,
          variants: variants
            .filter((v) => v.productId === p.id)
            .map((v) => ({ ...v, listPrices: listPrices.filter((l) => l.variantId === v.id && l.packagingId === null).map(({ variantId, packagingId, ...l }) => l) })),
          ...(q.withStock ? (stock.get(p.id) ?? { onHand: '0.000', stores: [] }) : {}),
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  get(ctx: AuthContext, id: string) {
    return this.dbs.withTenant(ctx, (tx) => this.full(tx, id));
  }

  /** Finds what to ring up for a scanned barcode: a variant, or a wholesale pack of one. */
  lookupBarcode(ctx: AuthContext, barcode: string) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const [variant] = await tx
        .select({ id: productVariants.id, productId: productVariants.productId })
        .from(productVariants)
        .where(and(eq(productVariants.barcode, barcode), eq(productVariants.active, true)))
        .limit(1);
      if (variant) {
        return { match: 'variant' as const, variantId: variant.id, packaging: null, product: await this.full(tx, variant.productId) };
      }
      const [pack] = await tx
        .select({ pack: productPackagings, productId: productVariants.productId })
        .from(productPackagings)
        .innerJoin(productVariants, eq(productVariants.id, productPackagings.variantId))
        .where(eq(productPackagings.barcode, barcode))
        .limit(1);
      found(pack, 'Barcode');
      return {
        match: 'packaging' as const,
        variantId: pack.pack.variantId,
        packaging: pack.pack,
        product: await this.full(tx, pack.productId),
      };
    });
  }

  async create(ctx: AuthContext, dto: CreateProductDto) {
    const id = await this.dbs.withTenant(ctx, async (tx) => {
      await this.checkReferences(tx, dto);
      const kind = dto.kind ?? 'standard';
      let taxRateId = dto.taxRateId;
      if (taxRateId === undefined) {
        const [def] = await tx
          .select({ id: taxRates.id })
          .from(taxRates)
          .where(and(eq(taxRates.isDefault, true), eq(taxRates.active, true)))
          .limit(1);
        taxRateId = def?.id ?? null;
      }

      const [product] = await tx
        .insert(products)
        .values({
          tenantId: ctx.tenantId,
          name: dto.name,
          description: dto.description,
          kind,
          categoryId: dto.categoryId,
          taxRateId,
          unitId: dto.unitId,
          // Services and menu items don't hold stock themselves.
          trackStock: dto.trackStock ?? kind === 'standard',
          soldByWeight: dto.soldByWeight,
          kitchenStation: dto.kitchenStation,
          imageUrl: dto.imageUrl,
          active: dto.active,
        })
        .returning();

      await this.saveVariants(tx, ctx, product.id, dto.variants, true);
      if (dto.modifierGroupIds) await this.setModifierGroups(tx, ctx, product.id, dto.modifierGroupIds);
      await this.audit.log(tx, ctx, 'create', 'Product', product.id, dto);
      return product.id;
    });
    return this.get(ctx, id);
  }

  async update(ctx: AuthContext, id: string, dto: UpdateProductDto) {
    await this.dbs.withTenant(ctx, async (tx) => {
      const [existing] = await tx.select({ id: products.id }).from(products).where(eq(products.id, id));
      found(existing, 'Product');
      await this.checkReferences(tx, dto);

      const { variants, modifierGroupIds, ...fields } = dto;
      if (Object.keys(fields).length) {
        await tx.update(products).set(fields).where(eq(products.id, id));
      }
      if (variants) await this.saveVariants(tx, ctx, id, variants, false);
      if (modifierGroupIds) await this.setModifierGroups(tx, ctx, id, modifierGroupIds);
      await this.audit.log(tx, ctx, 'update', 'Product', id, dto);
    });
    return this.get(ctx, id);
  }

  /** Products are archived, not deleted, so past sales and stock history stay intact. */
  async archive(ctx: AuthContext, id: string) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const rows = await tx
        .update(products)
        .set({ active: false })
        .where(eq(products.id, id))
        .returning({ id: products.id });
      found(rows[0], 'Product');
      await this.audit.log(tx, ctx, 'archive', 'Product', id);
      return { id, active: false };
    });
  }

  // -------------------------------------------------------------------------

  private async full(tx: Tx, id: string) {
    const [row] = await tx
      .select({
        product: products,
        categoryName: categories.name,
        taxRate: { id: taxRates.id, name: taxRates.name, rate: taxRates.rate, inclusive: taxRates.inclusive },
        unit: { id: units.id, name: units.name, abbreviation: units.abbreviation, allowsDecimal: units.allowsDecimal },
      })
      .from(products)
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .leftJoin(taxRates, eq(taxRates.id, products.taxRateId))
      .leftJoin(units, eq(units.id, products.unitId))
      .where(eq(products.id, id));
    found(row, 'Product');

    const variants = await tx
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, id))
      .orderBy(asc(productVariants.createdAt));
    const variantIds = variants.map((v) => v.id);
    const packs = variantIds.length
      ? await tx.select().from(productPackagings).where(inArray(productPackagings.variantId, variantIds))
      : [];
    const components = variantIds.length
      ? await tx
          .select({
            parentVariantId: productComponents.parentVariantId,
            componentVariantId: productComponents.componentVariantId,
            quantity: productComponents.quantity,
            componentName: products.name,
            componentVariantName: productVariants.name,
          })
          .from(productComponents)
          .innerJoin(productVariants, eq(productVariants.id, productComponents.componentVariantId))
          .innerJoin(products, eq(products.id, productVariants.productId))
          .where(inArray(productComponents.parentVariantId, variantIds))
      : [];
    const listPrices = await this.listPricesFor(tx, variantIds);
    const groups = await tx
      .select({ id: modifierGroups.id, name: modifierGroups.name })
      .from(productModifierGroups)
      .innerJoin(modifierGroups, eq(modifierGroups.id, productModifierGroups.groupId))
      .where(eq(productModifierGroups.productId, id))
      .orderBy(asc(productModifierGroups.sortOrder));

    return {
      ...row.product,
      categoryName: row.categoryName,
      taxRate: row.taxRate?.id ? row.taxRate : null,
      unit: row.unit?.id ? row.unit : null,
      variants: variants.map((v) => ({
        ...v,
        packagings: packs
          .filter((p) => p.variantId === v.id)
          .map((p) => ({ ...p, listPrices: listPrices.filter((l) => l.packagingId === p.id).map(({ variantId, packagingId, ...l }) => l) })),
        components: components.filter((c) => c.parentVariantId === v.id),
        listPrices: listPrices.filter((l) => l.variantId === v.id && l.packagingId === null).map(({ variantId, packagingId, ...l }) => l),
      })),
      modifierGroups: groups,
    };
  }

  /** Prices on price lists (Wholesale…) for these variants, with each list's quantity breaks, lowest first. */
  private listPricesFor(tx: Tx, variantIds: string[]) {
    if (!variantIds.length) return Promise.resolve([]);
    return tx
      .select({
        variantId: priceListItems.variantId,
        packagingId: priceListItems.packagingId,
        priceListId: priceListItems.priceListId,
        minQuantity: priceListItems.minQuantity,
        price: priceListItems.price,
      })
      .from(priceListItems)
      .where(inArray(priceListItems.variantId, variantIds))
      .orderBy(asc(priceListItems.minQuantity));
  }

  private async checkReferences(tx: Tx, dto: UpdateProductDto) {
    await assertOwned(tx, categories, [dto.categoryId], 'category');
    await assertOwned(tx, taxRates, [dto.taxRateId], 'tax rate');
    await assertOwned(tx, units, [dto.unitId], 'unit');
    await assertOwned(tx, modifierGroups, dto.modifierGroupIds ?? [], 'modifier group');
    await assertOwned(
      tx,
      priceLists,
      (dto.variants ?? []).flatMap((v) => [...(v.listPrices ?? []), ...(v.packagings ?? []).flatMap((p) => p.listPrices ?? [])].map((l) => l.priceListId)),
      'price list',
    );
    const componentIds = (dto.variants ?? []).flatMap((v) => (v.components ?? []).map((c) => c.componentVariantId));
    await assertOwned(tx, productVariants, componentIds, 'component variant');

    const barcodes = (dto.variants ?? []).flatMap((v) => [v.barcode, ...(v.packagings ?? []).map((p) => p.barcode)]).filter(Boolean);
    if (new Set(barcodes).size !== barcodes.length) {
      throw new BadRequestException('The same barcode is used twice in this product');
    }
  }

  /**
   * Creates or updates variants. Variants left out of an update are deactivated
   * (not deleted) because sales and stock history point at them.
   */
  private async saveVariants(tx: Tx, ctx: AuthContext, productId: string, input: VariantDto[], isNew: boolean) {
    const existing = isNew
      ? []
      : await tx.select().from(productVariants).where(eq(productVariants.productId, productId));
    const existingIds = new Set(existing.map((v) => v.id));
    for (const v of input) {
      if (v.id && !existingIds.has(v.id)) throw new BadRequestException('Variant does not belong to this product');
    }

    const keptIds: string[] = [];
    for (const v of input) {
      let variantId: string;
      if (v.id) {
        // Only change the fields that were sent; leave the rest as they are.
        const changes: Partial<typeof productVariants.$inferInsert> = { price: v.price };
        if (v.name !== undefined) changes.name = v.name;
        if (v.sku !== undefined) changes.sku = v.sku;
        if (v.barcode !== undefined) changes.barcode = v.barcode;
        if (v.costPrice !== undefined) changes.costPrice = v.costPrice;
        if (v.reorderLevel !== undefined) changes.reorderLevel = v.reorderLevel;
        changes.active = v.active ?? true;
        await tx.update(productVariants).set(changes).where(eq(productVariants.id, v.id));
        variantId = v.id;
      } else {
        const [row] = await tx
          .insert(productVariants)
          .values({
            tenantId: ctx.tenantId,
            productId,
            name: v.name ?? 'Default',
            sku: v.sku ?? null,
            barcode: v.barcode ?? null,
            price: v.price,
            costPrice: v.costPrice ?? null,
            reorderLevel: v.reorderLevel ?? null,
            active: v.active ?? true,
          })
          .returning({ id: productVariants.id });
        variantId = row.id;
      }
      keptIds.push(variantId);

      if (v.packagings) {
        await tx.delete(productPackagings).where(eq(productPackagings.variantId, variantId));
        if (v.packagings.length) {
          const saved = await tx
            .insert(productPackagings)
            .values(
              v.packagings.map((p) => ({
                tenantId: ctx.tenantId,
                variantId,
                name: p.name,
                quantity: p.quantity,
                barcode: p.barcode ?? null,
                price: p.price ?? null,
              })),
            )
            .returning({ id: productPackagings.id });
          // Each pack's price on price lists (Wholesale…), from 1 pack.
          const packPrices = v.packagings.flatMap((p, i) =>
            (p.listPrices ?? [])
              .filter((lp) => lp.price !== null && lp.price !== undefined)
              .map((lp) => ({ tenantId: ctx.tenantId, priceListId: lp.priceListId, variantId, packagingId: saved[i].id, minQuantity: '1', price: lp.price! })),
          );
          if (packPrices.length) await tx.insert(priceListItems).values(packPrices);
        }
      }
      // The price from 1 unit on each list sent; quantity breaks set on the price list stay.
      for (const lp of v.listPrices ?? []) {
        await tx
          .delete(priceListItems)
          .where(
            and(
              eq(priceListItems.priceListId, lp.priceListId),
              eq(priceListItems.variantId, variantId),
              isNull(priceListItems.packagingId),
              eq(priceListItems.minQuantity, '1'),
            ),
          );
        if (lp.price !== null && lp.price !== undefined) {
          await tx.insert(priceListItems).values({ tenantId: ctx.tenantId, priceListId: lp.priceListId, variantId, minQuantity: '1', price: lp.price });
        }
      }
      if (v.components) {
        if (v.components.some((c) => c.componentVariantId === variantId)) {
          throw new BadRequestException('An item cannot contain itself');
        }
        await tx.delete(productComponents).where(eq(productComponents.parentVariantId, variantId));
        if (v.components.length) {
          await tx.insert(productComponents).values(
            v.components.map((c) => ({
              tenantId: ctx.tenantId,
              parentVariantId: variantId,
              componentVariantId: c.componentVariantId,
              quantity: c.quantity,
            })),
          );
        }
      }
    }

    const dropped = existing.filter((v) => !keptIds.includes(v.id)).map((v) => v.id);
    if (dropped.length) {
      await tx.update(productVariants).set({ active: false, isDefault: false }).where(inArray(productVariants.id, dropped));
    }

    // Exactly one default variant: keep the current one if it survived, else the first sent.
    const currentDefault = existing.find((v) => v.isDefault && keptIds.includes(v.id))?.id;
    const defaultId = currentDefault ?? keptIds[0];
    await tx
      .update(productVariants)
      .set({ isDefault: false })
      .where(and(eq(productVariants.productId, productId), eq(productVariants.isDefault, true)));
    await tx.update(productVariants).set({ isDefault: true }).where(eq(productVariants.id, defaultId));
  }

  private async setModifierGroups(tx: Tx, ctx: AuthContext, productId: string, groupIds: string[]) {
    await tx.delete(productModifierGroups).where(eq(productModifierGroups.productId, productId));
    if (groupIds.length) {
      await tx
        .insert(productModifierGroups)
        .values(groupIds.map((groupId, i) => ({ tenantId: ctx.tenantId, productId, groupId, sortOrder: i })));
    }
  }
}
