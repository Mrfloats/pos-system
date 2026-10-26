import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { type AuthContext, Ctx, FRONT_OF_HOUSE, Roles } from '../common/auth-context.js';
import { divRound, fromCents, parseFixed, toCents } from '../accounting/money.js';
import { found } from '../common/validation.js';
import { DbService } from '../db/db.service.js';
import {
  categories,
  currencies,
  customerGroups,
  customers,
  modifierGroups,
  modifiers,
  productModifierGroups,
  productPackagings,
  products,
  productVariants,
  storePrices,
  stores,
  taxRates,
  tenants,
  units,
} from '../db/schema.js';

export class TillCatalogQuery {
  @IsUUID() storeId: string;
}

/** Most customers a till keeps on hand for offline lookups. */
const CUSTOMER_LIMIT = 5000;

@Injectable()
export class TillService {
  constructor(private readonly dbs: DbService) {}

  /**
   * Everything a till needs to keep selling offline, in one download: the business
   * and store for receipts, currencies, tax rates, categories, the products on sale
   * at this store's prices, and customers with their group discount.
   */
  catalog(ctx: AuthContext, storeId: string) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const [store] = await tx
        .select({ id: stores.id, name: stores.name, code: stores.code, address: stores.address, phone: stores.phone })
        .from(stores)
        .where(eq(stores.id, storeId));
      found(store, 'Store');
      const [tenant] = await tx
        .select({
          id: tenants.id,
          name: tenants.name,
          businessType: tenants.businessType,
          baseCurrency: tenants.baseCurrency,
          timezone: tenants.timezone,
          tin: tenants.tin,
          vatNumber: tenants.vatNumber,
          address: tenants.address,
          phone: tenants.phone,
          email: tenants.email,
        })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId));

      const currencyRows = await tx
        .select({ code: currencies.code, name: currencies.name, symbol: currencies.symbol, rateToBase: currencies.rateToBase, isBase: currencies.isBase })
        .from(currencies)
        .where(eq(currencies.active, true))
        .orderBy(desc(currencies.isBase), asc(currencies.code));
      // Inactive rates too: a product can still point at one, and sales use it.
      const taxRows = await tx
        .select({ id: taxRates.id, name: taxRates.name, code: taxRates.code, rate: taxRates.rate, inclusive: taxRates.inclusive })
        .from(taxRates);
      const categoryRows = await tx
        .select({ id: categories.id, parentId: categories.parentId, name: categories.name, color: categories.color, sortOrder: categories.sortOrder })
        .from(categories)
        .where(eq(categories.active, true))
        .orderBy(asc(categories.sortOrder), asc(categories.name));

      const productRows = await tx
        .select({
          id: products.id,
          name: products.name,
          categoryId: products.categoryId,
          taxRateId: products.taxRateId,
          kind: products.kind,
          soldByWeight: products.soldByWeight,
          kitchenStation: products.kitchenStation,
          imageUrl: products.imageUrl,
          unit: units.abbreviation,
          allowsDecimal: units.allowsDecimal,
        })
        .from(products)
        .leftJoin(units, eq(units.id, products.unitId))
        .where(eq(products.active, true))
        .orderBy(asc(products.name));
      const variantRows = await tx
        .select({
          id: productVariants.id,
          productId: productVariants.productId,
          name: productVariants.name,
          sku: productVariants.sku,
          barcode: productVariants.barcode,
          // This store's own price when it has one.
          price: sql<string>`coalesce(${storePrices.price}, ${productVariants.price})`,
          isDefault: productVariants.isDefault,
        })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .leftJoin(storePrices, and(eq(storePrices.variantId, productVariants.id), eq(storePrices.storeId, storeId)))
        .where(and(eq(productVariants.active, true), eq(products.active, true)))
        .orderBy(desc(productVariants.isDefault), asc(productVariants.createdAt));

      // Wholesale packs, priced as a sale prices them: the pack's own price, else the item's price × units.
      const packRows = await tx
        .select({ id: productPackagings.id, variantId: productPackagings.variantId, name: productPackagings.name, quantity: productPackagings.quantity, barcode: productPackagings.barcode, price: productPackagings.price })
        .from(productPackagings)
        .orderBy(asc(productPackagings.quantity));
      const priceOf = new Map(variantRows.map((v) => [v.id, v.price]));
      const packsByVariant = new Map<string, { id: string; name: string; quantity: string; barcode: string | null; price: string }[]>();
      for (const p of packRows) {
        const unit = priceOf.get(p.variantId);
        if (unit === undefined) continue;
        const price = p.price ?? fromCents(divRound(toCents(unit) * parseFixed(p.quantity, 3), 1000n));
        const list = packsByVariant.get(p.variantId) ?? packsByVariant.set(p.variantId, []).get(p.variantId)!;
        list.push({ id: p.id, name: p.name, quantity: p.quantity, barcode: p.barcode, price });
      }

      // Restaurant choices offered on each product, groups and options in order.
      const groupLinks = await tx
        .select({ productId: productModifierGroups.productId, group: modifierGroups })
        .from(productModifierGroups)
        .innerJoin(modifierGroups, eq(modifierGroups.id, productModifierGroups.groupId))
        .orderBy(asc(productModifierGroups.sortOrder));
      const options = groupLinks.length
        ? await tx
            .select({ id: modifiers.id, groupId: modifiers.groupId, name: modifiers.name, priceDelta: modifiers.priceDelta })
            .from(modifiers)
            .orderBy(asc(modifiers.sortOrder), asc(modifiers.name))
        : [];
      const groupsByProduct = new Map<string, unknown[]>();
      for (const { productId, group } of groupLinks) {
        const list = groupsByProduct.get(productId) ?? groupsByProduct.set(productId, []).get(productId)!;
        list.push({
          id: group.id,
          name: group.name,
          minSelect: group.minSelect,
          maxSelect: group.maxSelect,
          modifiers: options.filter((o) => o.groupId === group.id).map(({ groupId, ...o }) => o),
        });
      }

      const variantsByProduct = new Map<string, unknown[]>();
      for (const { productId, ...v } of variantRows) {
        const list = variantsByProduct.get(productId) ?? variantsByProduct.set(productId, []).get(productId)!;
        list.push({ ...v, packagings: packsByVariant.get(v.id) ?? [] });
      }

      const customerRows = await tx
        .select({
          id: customers.id,
          name: customers.name,
          phone: customers.phone,
          tin: customers.tin,
          vatNumber: customers.vatNumber,
          discountPercent: customerGroups.discountPercent,
        })
        .from(customers)
        .leftJoin(customerGroups, eq(customerGroups.id, customers.groupId))
        .where(eq(customers.active, true))
        .orderBy(asc(customers.name))
        .limit(CUSTOMER_LIMIT);

      return {
        tenant,
        store,
        currencies: currencyRows,
        taxRates: taxRows,
        categories: categoryRows,
        products: productRows
          .map((p) => ({ ...p, variants: variantsByProduct.get(p.id) ?? [], modifierGroups: groupsByProduct.get(p.id) ?? [] }))
          .filter((p) => p.variants.length),
        customers: customerRows,
        syncedAt: new Date().toISOString(),
      };
    });
  }
}

@ApiTags('till')
@ApiBearerAuth()
@Controller('till')
export class TillController {
  constructor(private readonly svc: TillService) {}

  /** The till app downloads this after signing in and every few minutes, so it can sell offline. */
  @Roles(...FRONT_OF_HOUSE)
  @Get('catalog')
  catalog(@Ctx() ctx: AuthContext, @Query() q: TillCatalogQuery) {
    return this.svc.catalog(ctx, q.storeId);
  }
}

@Module({
  controllers: [TillController],
  providers: [TillService],
})
export class TillModule {}
