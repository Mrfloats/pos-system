/**
 * Adds products for trying ZIMRA fiscalisation on a till, in a "ZIMRA tests"
 * category: standard-rated, zero-rated and exempt items with HS codes, one sold
 * by weight, one with a case, and one without an HS code (a VAT-registered
 * till refuses it). Each gets opening stock in the business's first shop.
 *
 *   npm run build -w apps/api
 *   node --env-file=apps/api/.env apps/api/dist/db/test-products.js [owner email] ["Business name"]
 *
 * Defaults to the demo owner (demo@pos.local). Safe to run again: products
 * already there are left as they are. The tax treatments and HS codes are for
 * testing; check real products' with ZIMRA.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { INestApplicationContext } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AppModule } from '../app.module.js';
import { ProductsService } from '../catalog/products.service.js';
import { CategoriesService } from '../catalog/settings.service.js';
import type { AuthContext } from '../common/auth-context.js';
import { rolePermissions } from '../common/permissions.js';
import { InventoryService } from '../inventory/inventory.js';
import { StoresService } from '../organization/organization.service.js';
import { DbService } from './db.service.js';
import { categories, memberships, products, taxRates, tenants, units, users } from './schema.js';

type Tax = 'VAT' | 'ZERO' | 'EXEMPT';

interface TestProduct {
  name: string;
  tax: Tax;
  hsCode: string | null;
  price: string;
  cost: string;
  barcode: string;
  stock: number;
  byWeight?: boolean;
  pack?: { name: string; quantity: string; price: string };
}

export const TEST_PRODUCTS: TestProduct[] = [
  { name: 'Test Soft Drink 330ml', tax: 'VAT', hsCode: '22021000', price: '1.00', cost: '0.60', barcode: 'ZT00001', stock: 100 },
  { name: 'Test Bath Soap', tax: 'VAT', hsCode: '3401', price: '0.80', cost: '0.45', barcode: 'ZT00002', stock: 100 },
  {
    name: 'Test Cooking Oil 2L',
    tax: 'VAT',
    hsCode: '15079000',
    price: '4.50',
    cost: '3.40',
    barcode: 'ZT00003',
    stock: 60,
    pack: { name: 'Case of 6', quantity: '6', price: '25.00' },
  },
  { name: 'Test Mealie Meal 5kg', tax: 'ZERO', hsCode: '11022000', price: '4.00', cost: '3.20', barcode: 'ZT00004', stock: 50 },
  { name: 'Test Fresh Milk 1L', tax: 'ZERO', hsCode: '04012000', price: '1.20', cost: '0.85', barcode: 'ZT00005', stock: 50 },
  { name: 'Test Tomatoes (per kg)', tax: 'EXEMPT', hsCode: '07020000', price: '1.50', cost: '0.90', barcode: 'ZT00006', stock: 40, byWeight: true },
  { name: 'Test School Exercise Book', tax: 'EXEMPT', hsCode: '48202000', price: '0.50', cost: '0.30', barcode: 'ZT00007', stock: 100 },
  { name: 'Test Item Without HS Code', tax: 'VAT', hsCode: null, price: '2.00', cost: '1.20', barcode: 'ZT00008', stock: 20 },
];

const CATEGORY = 'ZIMRA tests';

/** Adds the test products to the business in [ctx]. Returns how many were new. */
export async function addTestProducts(app: INestApplicationContext, ctx: AuthContext): Promise<{ added: string[]; skipped: string[] }> {
  const dbs = app.get(DbService);
  const productsSvc = app.get(ProductsService);
  const inventory = app.get(InventoryService);
  // Stock goes to a shop (where tills sell), not a warehouse.
  const stores = await app.get(StoresService).list(ctx);
  const store = stores.find((s) => s.type === 'shop' && s.active) ?? stores[0];
  if (!store) throw new Error('This business has no store');

  const { rates, kg, category, existing } = await dbs.withTenant(ctx, async (tx) => ({
    rates: await tx.select({ id: taxRates.id, code: taxRates.code }).from(taxRates),
    kg: (await tx.select({ id: units.id }).from(units).where(eq(units.abbreviation, 'kg')))[0],
    category: (await tx.select({ id: categories.id }).from(categories).where(eq(categories.name, CATEGORY)))[0],
    existing: new Set((await tx.select({ name: products.name }).from(products)).map((p) => p.name)),
  }));
  const rate = (code: Tax) => {
    const r = rates.find((x) => x.code === code);
    if (!r) throw new Error(`This business has no ${code} tax rate (Settings → Tax rates)`);
    return r.id;
  };
  const categoryId = category?.id ?? (await app.get(CategoriesService).create(ctx, { name: CATEGORY, color: '#0f766e', sortOrder: 99 })).id;

  const added: string[] = [];
  const skipped: string[] = [];
  for (const t of TEST_PRODUCTS) {
    if (existing.has(t.name)) {
      skipped.push(t.name);
      continue;
    }
    const p = await productsSvc.create(ctx, {
      name: t.name,
      categoryId,
      taxRateId: rate(t.tax),
      hsCode: t.hsCode,
      soldByWeight: t.byWeight ?? false,
      unitId: t.byWeight ? kg?.id : undefined,
      variants: [
        {
          barcode: t.barcode,
          sku: t.barcode,
          price: t.price,
          costPrice: t.cost,
          packagings: t.pack ? [{ name: t.pack.name, quantity: t.pack.quantity, price: t.pack.price }] : undefined,
        },
      ],
    });
    await inventory.record(ctx, {
      storeId: store.id,
      type: 'opening',
      reference: 'ZIMRA TEST',
      lines: [{ variantId: p.variants[0].id, quantity: String(t.stock), unitCost: t.cost }],
    });
    added.push(t.name);
  }
  return { added, skipped };
}

async function main() {
  const email = (process.argv[2] ?? 'demo@pos.local').toLowerCase();
  const business = process.argv[3];
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const dbs = app.get(DbService);
    const [user] = await dbs.db.select({ id: users.id }).from(users).where(eq(users.email, email));
    // The owner's businesses, as that person sees them at sign-in (row-level security allows no more).
    const rows = user
      ? await dbs.withUser(user.id, (tx) =>
          tx
            .select({ userId: memberships.userId, membershipId: memberships.id, tenantId: tenants.id, name: tenants.name })
            .from(memberships)
            .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
            .where(and(eq(memberships.userId, user.id), eq(memberships.role, 'owner'))),
        )
      : [];
    const matches = business ? rows.filter((r) => r.name.toLowerCase() === business.toLowerCase()) : rows;
    if (matches.length !== 1) {
      console.error(
        matches.length === 0
          ? `No business owned by ${email}${business ? ` called "${business}"` : ''}.`
          : `${email} owns several businesses; name one: ${matches.map((m) => `"${m.name}"`).join(', ')}`,
      );
      process.exitCode = 1;
      return;
    }
    const m = matches[0];
    const ctx: AuthContext = {
      tenantId: m.tenantId,
      userId: m.userId,
      membershipId: m.membershipId,
      role: 'owner',
      permissions: new Set(rolePermissions('owner')),
      platform: 'web',
      mobileSession: false,
      hasPin: false,
      pinConfirmed: false,
    };
    const { added, skipped } = await addTestProducts(app, ctx);
    console.log(`${m.name}: added ${added.length} test product${added.length === 1 ? '' : 's'} in "${CATEGORY}"${skipped.length ? `, ${skipped.length} already there` : ''}.`);
    for (const t of TEST_PRODUCTS) console.log(`  ${t.barcode}  ${t.name.padEnd(28)} ${t.tax.padEnd(6)} HS ${t.hsCode ?? '(none)'}  $${t.price}${t.byWeight ? '/kg' : ''}`);
  } finally {
    await app.close();
  }
}

// Run as a script (not when the demo seed imports it).
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/db/test-products.js')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
