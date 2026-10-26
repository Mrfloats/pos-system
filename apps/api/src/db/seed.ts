/**
 * Loads demo data: a supermarket/wholesaler and a restaurant, both owned by the
 * same login so you can try switching businesses.
 *
 *   npm run db:seed        (builds the API, then runs this file)
 *
 * Sign in with demo@pos.local / demo1234. Safe to run once; it stops if the
 * demo account already exists.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { AppModule } from '../app.module.js';
import { AuthService } from '../auth/auth.service.js';
import { ProductsService } from '../catalog/products.service.js';
import { CategoriesService, ModifierGroupsService } from '../catalog/settings.service.js';
import type { AuthContext } from '../common/auth-context.js';
import { InventoryService } from '../inventory/inventory.js';
import { StaffService, StoresService } from '../organization/organization.service.js';
import { DbService } from './db.service.js';
import { customers, users } from './schema.js';

const EMAIL = 'demo@pos.local';
const PASSWORD = 'demo1234';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const dbs = app.get(DbService);
  const authSvc = app.get(AuthService);
  const products = app.get(ProductsService);
  const cats = app.get(CategoriesService);
  const inventory = app.get(InventoryService);
  const staff = app.get(StaffService);
  const storesSvc = app.get(StoresService);
  const modifiersSvc = app.get(ModifierGroupsService);

  const [exists] = await dbs.db.select({ id: users.id }).from(users).where(eq(users.email, EMAIL));
  if (exists) {
    console.log(`Demo data already loaded. Sign in with ${EMAIL} / ${PASSWORD}`);
    await app.close();
    return;
  }

  // ---------------------------------------------------------------- Supermarket
  const shop = await authSvc.signup({
    businessName: 'Demo Supermarket & Wholesale',
    businessType: 'mixed',
    fullName: 'Demo Owner',
    email: EMAIL,
    password: PASSWORD,
    phone: '+263 77 000 0000',
  });
  const ctx: AuthContext = {
    tenantId: shop.tenant.id,
    userId: shop.user.id,
    membershipId: shop.membership.id,
    role: 'owner',
  };
  const [main] = await storesSvc.list(ctx);
  await storesSvc.create(ctx, { name: 'Central Warehouse', code: 'WH', type: 'warehouse' });

  const drinks = await cats.create(ctx, { name: 'Drinks', color: '#2563eb', sortOrder: 1 });
  const groceries = await cats.create(ctx, { name: 'Groceries', color: '#16a34a', sortOrder: 2 });
  const bakery = await cats.create(ctx, { name: 'Bakery', color: '#d97706', sortOrder: 3 });
  const household = await cats.create(ctx, { name: 'Household', color: '#9333ea', sortOrder: 4 });

  const items: [string, string, string, string, string, number, [string, number, string]?][] = [
    // name, category, barcode, price, cost, opening stock, [pack name, pack qty, pack price]
    ['Coca-Cola 500ml', drinks.id, '6001067000011', '1.00', '0.62', 120, ['Case of 24', 24, '21.00']],
    ['Mazoe Orange 2L', drinks.id, '6001067000028', '4.20', '3.10', 40, ['Case of 6', 6, '23.50']],
    ['Still Water 500ml', drinks.id, '6001067000035', '0.50', '0.25', 200, ['Case of 24', 24, '10.00']],
    ['Mealie Meal 10kg', groceries.id, '6001067000042', '7.50', '6.10', 60, ['Bale of 5', 5, '35.00']],
    ['Cooking Oil 2L', groceries.id, '6001067000059', '4.80', '3.70', 50, ['Case of 6', 6, '27.00']],
    ['White Sugar 2kg', groceries.id, '6001067000066', '3.20', '2.40', 4, ['Bale of 10', 10, '30.00']],
    ['Rice 2kg', groceries.id, '6001067000073', '3.00', '2.20', 35],
    ['Bread Loaf', bakery.id, '6001067000080', '1.10', '0.80', 30],
    ['Buns (6 pack)', bakery.id, '6001067000097', '1.50', '0.95', 20],
    ['Washing Powder 1kg', household.id, '6001067000103', '2.90', '2.05', 25, ['Case of 12', 12, '32.00']],
    ['Dish Soap 750ml', household.id, '6001067000110', '1.80', '1.10', 3],
  ];

  for (const [name, categoryId, barcode, price, cost, stock, pack] of items) {
    const p = await products.create(ctx, {
      name,
      categoryId,
      variants: [
        {
          barcode,
          sku: barcode.slice(-6),
          price,
          costPrice: cost,
          reorderLevel: '5',
          packagings: pack ? [{ name: pack[0], quantity: String(pack[1]), price: pack[2] }] : undefined,
        },
      ],
    });
    await inventory.record(ctx, {
      storeId: main.id,
      type: 'opening',
      reference: 'OPENING',
      lines: [{ variantId: p.variants[0].id, quantity: String(stock), unitCost: cost }],
    });
  }
  await products.create(ctx, {
    name: 'Delivery fee',
    kind: 'service',
    variants: [{ price: '2.00' }],
  });

  await staff.create(ctx, {
    email: 'cashier@pos.local',
    fullName: 'Tariro Cashier',
    password: PASSWORD,
    role: 'cashier',
    pin: '1234',
    storeIds: [main.id],
  });
  await staff.create(ctx, {
    email: 'manager@pos.local',
    fullName: 'Farai Manager',
    password: PASSWORD,
    role: 'manager',
    pin: '5678',
  });

  await dbs.withTenant(ctx, (tx) =>
    tx.insert(customers).values([
      { tenantId: ctx.tenantId, name: 'Chipo Spaza Shop', phone: '+263 77 111 2222', tin: '2000123456', creditLimit: '500.00' },
      { tenantId: ctx.tenantId, name: 'Mbare Traders (Pvt) Ltd', phone: '+263 78 333 4444', tin: '2000654321', vatNumber: '220012345' },
    ]),
  );

  // ----------------------------------------------------------------- Restaurant
  const grill = await authSvc.signup({
    businessName: 'Demo Grill House',
    businessType: 'restaurant',
    fullName: 'Grill Owner',
    email: 'grill-owner@pos.local',
    password: PASSWORD,
  });
  const gctx: AuthContext = {
    tenantId: grill.tenant.id,
    userId: grill.user.id,
    membershipId: grill.membership.id,
    role: 'owner',
  };
  // The demo owner also gets access to the restaurant, so they can switch businesses.
  await staff.create(gctx, { email: EMAIL, fullName: 'Demo Owner', role: 'owner' });

  const mains = await cats.create(gctx, { name: 'Mains', color: '#dc2626', sortOrder: 1 });
  const drinksR = await cats.create(gctx, { name: 'Drinks', color: '#2563eb', sortOrder: 2 });
  const ingredients = await cats.create(gctx, { name: 'Ingredients', color: '#64748b', sortOrder: 9 });

  const ing = async (name: string, cost: string) =>
    (await products.create(gctx, { name, categoryId: ingredients.id, variants: [{ price: '0', costPrice: cost }] })).variants[0].id;
  const bun = await ing('Burger bun', '0.20');
  const patty = await ing('Beef patty', '0.90');
  const chicken = await ing('Chicken quarter', '1.10');

  const sides = await modifiersSvc.create(gctx, {
    name: 'Choose a side',
    minSelect: 1,
    maxSelect: 1,
    modifiers: [{ name: 'Chips' }, { name: 'Sadza' }, { name: 'Rice' }, { name: 'Salad', priceDelta: '0.50' }],
  });
  const extras = await modifiersSvc.create(gctx, {
    name: 'Extras',
    minSelect: 0,
    maxSelect: 3,
    modifiers: [{ name: 'Extra cheese', priceDelta: '0.50' }, { name: 'Egg', priceDelta: '0.70' }, { name: 'Bacon', priceDelta: '1.00' }],
  });

  await products.create(gctx, {
    name: 'Classic Burger',
    kind: 'menu_item',
    categoryId: mains.id,
    kitchenStation: 'grill',
    modifierGroupIds: [sides.id, extras.id],
    variants: [{ price: '6.50', components: [{ componentVariantId: bun, quantity: '1' }, { componentVariantId: patty, quantity: '1' }] }],
  });
  await products.create(gctx, {
    name: 'Grilled Chicken',
    kind: 'menu_item',
    categoryId: mains.id,
    kitchenStation: 'grill',
    modifierGroupIds: [sides.id],
    variants: [
      { name: 'Quarter', price: '5.00', components: [{ componentVariantId: chicken, quantity: '1' }] },
      { name: 'Half', price: '9.00', components: [{ componentVariantId: chicken, quantity: '2' }] },
    ],
  });
  await products.create(gctx, {
    name: 'Fresh Juice',
    kind: 'menu_item',
    categoryId: drinksR.id,
    kitchenStation: 'bar',
    variants: [{ name: 'Regular', price: '2.00' }, { name: 'Large', price: '3.00' }],
  });

  console.log('Demo data loaded.');
  console.log(`  Owner:   ${EMAIL} / ${PASSWORD} (supermarket + restaurant)`);
  console.log(`  Manager: manager@pos.local / ${PASSWORD}   PIN 5678`);
  console.log(`  Cashier: cashier@pos.local / ${PASSWORD}   PIN 1234`);
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
