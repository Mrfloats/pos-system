import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { Pool } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import request from 'supertest';
import { resetTestDatabase } from './setup-db.js';

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://pos_app:pos_app@localhost:5432/pos_test';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-0123456789';
process.env.AUTH_RATE_LIMIT = '1000';

let app: INestApplication;
let http: ReturnType<typeof request>;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** The test suite's Floatly staff login, which approves every business the tests create. */
let adminT: Record<string, string>;
let unlimitedPlanId: string;
const ownerDb = () => new Pool({ connectionString: process.env.TEST_MIGRATION_DATABASE_URL ?? 'postgres://pos_owner:pos_owner@localhost:5432/pos_test' });

/** Opens a business the way it really happens: request, approval by Floatly, then sign-in. */
async function signup(businessName: string, email: string, businessType = 'retail', planId = unlimitedPlanId) {
  const req = await http
    .post('/api/v1/auth/signup-requests')
    .send({ businessName, businessType, fullName: `${businessName} Owner`, email, password: 'password123', planId, billingPeriod: 'monthly' })
    .expect(201);
  await http.post(`/api/v1/platform/requests/${req.body.id}/approve`).set(adminT).send({}).expect(201);
  const res = await http.post('/api/v1/auth/login').send({ email, password: 'password123' }).expect(200);
  return res.body as { accessToken: string; tenant: { id: string }; membership: { id: string } };
}

beforeAll(async () => {
  await resetTestDatabase();
  const { AppModule } = await import('../src/app.module.js');
  const { setupApp } = await import('../src/setup-app.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = setupApp(moduleRef.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());

  // Floatly staff can only be created by the database owner role.
  const owner = ownerDb();
  try {
    await owner.query(`INSERT INTO users (id, email, password_hash, full_name, is_platform_admin) VALUES ($1, 'staff@floatly.test', $2, 'Floatly Staff', true)`, [
      uuidv7(),
      await hash('password123'),
    ]);
  } finally {
    await owner.end();
  }
  const login = await http.post('/api/v1/platform/login').send({ email: 'staff@floatly.test', password: 'password123' }).expect(200);
  adminT = { Authorization: `Bearer ${login.body.accessToken}` };
  const plans = await http.get('/api/v1/auth/plans').expect(200);
  unlimitedPlanId = plans.body.find((p: any) => p.code === 'enterprise').id;
});

afterAll(async () => {
  await app?.close();
});

describe('auth and onboarding', () => {
  let owner: Awaited<ReturnType<typeof signup>>;

  it('reports health without signing in', async () => {
    await http.get('/api/v1/health').expect(200);
  });

  it('signs up a wholesale+retail business with sensible defaults', async () => {
    owner = await signup('Mixed Traders', 'mixed@example.com', 'mixed');
    const t = auth(owner.accessToken);

    const stores = await http.get('/api/v1/stores').set(t).expect(200);
    expect(stores.body).toHaveLength(1);
    expect(stores.body[0]).toMatchObject({ code: 'MAIN', type: 'shop' });

    const taxes = await http.get('/api/v1/tax-rates').set(t).expect(200);
    expect(taxes.body.find((r: any) => r.isDefault)).toMatchObject({ code: 'VAT', rate: '15.50' });

    const lists = await http.get('/api/v1/price-lists').set(t).expect(200);
    expect(lists.body.map((l: any) => l.name).sort()).toEqual(['Retail', 'Wholesale']);

    const currencies = await http.get('/api/v1/currencies').set(t).expect(200);
    expect(currencies.body).toEqual([expect.objectContaining({ code: 'USD', isBase: true })]);
  });

  it('rejects a duplicate email', async () => {
    await http
      .post('/api/v1/auth/signup-requests')
      .send({ businessName: 'Xy Shop', businessType: 'retail', fullName: 'X Y', email: 'MIXED@example.com', password: 'password123', planId: unlimitedPlanId, billingPeriod: 'monthly' })
      .expect(409);
  });

  it('logs in, and refuses wrong passwords and missing tokens', async () => {
    await http.post('/api/v1/auth/login').send({ email: 'mixed@example.com', password: 'nope-nope' }).expect(401);
    const ok = await http.post('/api/v1/auth/login').send({ email: 'mixed@example.com', password: 'password123' }).expect(200);
    expect(ok.body.membership.role).toBe('owner');
    await http.get('/api/v1/auth/me').expect(401);
    await http.get('/api/v1/auth/me').set(auth(ok.body.accessToken)).expect(200);
  });

  it('validates input and rejects unknown fields', async () => {
    const t = auth(owner.accessToken);
    await http.post('/api/v1/stores').set(t).send({ name: 'Branch' }).expect(400);
    await http.post('/api/v1/stores').set(t).send({ name: 'Branch', code: 'BR1', hacker: true }).expect(400);
    const created = await http.post('/api/v1/stores').set(t).send({ name: 'Branch', code: 'br1' }).expect(201);
    expect(created.body.code).toBe('BR1');
    await http.post('/api/v1/stores').set(t).send({ name: 'Again', code: 'BR1' }).expect(409);
  });
});

describe('catalog', () => {
  let t: Record<string, string>;
  let productId: string;
  let variantId: string;

  beforeAll(async () => {
    const o = await signup('Catalog Shop', 'catalog@example.com', 'wholesale');
    t = auth(o.accessToken);
  });

  it('creates a product with a variant, a wholesale case and gets the default tax rate', async () => {
    const cat = await http.post('/api/v1/categories').set(t).send({ name: 'Drinks', color: '#ff8800' }).expect(201);
    const res = await http
      .post('/api/v1/products')
      .set(t)
      .send({
        name: 'Coke 500ml',
        categoryId: cat.body.id,
        variants: [
          {
            sku: 'COKE500',
            barcode: '5449000000996',
            price: 1,
            costPrice: '0.62',
            reorderLevel: 24,
            packagings: [{ name: 'Case of 24', quantity: 24, barcode: '15449000000993', price: '20.50' }],
          },
        ],
      })
      .expect(201);
    productId = res.body.id;
    variantId = res.body.variants[0].id;
    expect(res.body).toMatchObject({ name: 'Coke 500ml', categoryName: 'Drinks', trackStock: true });
    expect(res.body.taxRate).toMatchObject({ rate: '15.50' });
    expect(res.body.variants[0]).toMatchObject({ isDefault: true, price: '1.00', costPrice: '0.62' });
    expect(res.body.variants[0].packagings[0]).toMatchObject({ quantity: '24.000', price: '20.50' });
  });

  it('finds a product by unit barcode and by case barcode', async () => {
    const unit = await http.get('/api/v1/products/barcode/5449000000996').set(t).expect(200);
    expect(unit.body).toMatchObject({ match: 'variant', variantId });
    const pack = await http.get('/api/v1/products/barcode/15449000000993').set(t).expect(200);
    expect(pack.body).toMatchObject({ match: 'packaging', variantId });
    await http.get('/api/v1/products/barcode/000').set(t).expect(404);
  });

  it('rejects a barcode already used by another product', async () => {
    await http
      .post('/api/v1/products')
      .set(t)
      .send({ name: 'Fake Coke', variants: [{ barcode: '5449000000996', price: 1 }] })
      .expect(409)
      .expect((res) => expect(res.body.message).toBe('Another product already uses this barcode'));
  });

  it('rejects bad money values', async () => {
    await http.post('/api/v1/products').set(t).send({ name: 'X', variants: [{ price: -1 }] }).expect(400);
    await http.post('/api/v1/products').set(t).send({ name: 'X', variants: [{ price: '1.234' }] }).expect(400);
  });

  it('adds a variant on update and keeps exactly one default', async () => {
    const res = await http
      .patch(`/api/v1/products/${productId}`)
      .set(t)
      .send({ variants: [{ id: variantId, price: '1.10', barcode: '5449000000996' }, { name: '2L', price: '2.50' }] })
      .expect(200);
    expect(res.body.variants).toHaveLength(2);
    expect(res.body.variants.filter((v: any) => v.isDefault)).toHaveLength(1);
    expect(res.body.variants.find((v: any) => v.id === variantId).price).toBe('1.10');
  });

  it('searches by name, SKU and barcode', async () => {
    for (const search of ['coke', 'COKE500', '5449000000996']) {
      const res = await http.get('/api/v1/products').query({ search }).set(t).expect(200);
      expect(res.body.total).toBe(1);
    }
    const none = await http.get('/api/v1/products').query({ search: '%' }).set(t).expect(200);
    expect(none.body.total).toBe(0);
  });

  it('sets wholesale quantity-break prices', async () => {
    const lists = await http.get('/api/v1/price-lists').set(t).expect(200);
    const wholesale = lists.body.find((l: any) => l.name === 'Wholesale');
    const res = await http
      .put(`/api/v1/price-lists/${wholesale.id}/items`)
      .set(t)
      .send({ items: [{ variantId, price: '0.95' }, { variantId, minQuantity: 48, price: '0.90' }] })
      .expect(200);
    expect(res.body).toHaveLength(2);
  });

  it('archives instead of deleting', async () => {
    await http.delete(`/api/v1/products/${productId}`).set(t).expect(200);
    const res = await http.get(`/api/v1/products/${productId}`).set(t).expect(200);
    expect(res.body.active).toBe(false);
  });
});

describe('restaurant menu', () => {
  it('creates modifier groups and a menu item with a recipe', async () => {
    const o = await signup('Cafe Hre', 'cafe@example.com', 'restaurant');
    const t = auth(o.accessToken);
    const stores = await http.get('/api/v1/stores').set(t).expect(200);
    expect(stores.body[0].type).toBe('restaurant');

    const bun = await http.post('/api/v1/products').set(t).send({ name: 'Burger bun', variants: [{ price: 0, costPrice: '0.20' }] }).expect(201);
    const patty = await http.post('/api/v1/products').set(t).send({ name: 'Beef patty', variants: [{ price: 0, costPrice: '0.90' }] }).expect(201);

    const sides = await http
      .post('/api/v1/modifier-groups')
      .set(t)
      .send({ name: 'Choose a side', minSelect: 1, maxSelect: 1, modifiers: [{ name: 'Chips' }, { name: 'Salad', priceDelta: '0.50' }] })
      .expect(201);
    expect(sides.body.modifiers).toHaveLength(2);
    await http.post('/api/v1/modifier-groups').set(t).send({ name: 'Bad', minSelect: 3, maxSelect: 1, modifiers: [] }).expect(400);

    const burger = await http
      .post('/api/v1/products')
      .set(t)
      .send({
        name: 'Classic burger',
        kind: 'menu_item',
        kitchenStation: 'grill',
        modifierGroupIds: [sides.body.id],
        variants: [
          {
            price: '6.50',
            components: [
              { componentVariantId: bun.body.variants[0].id, quantity: 1 },
              { componentVariantId: patty.body.variants[0].id, quantity: 1 },
            ],
          },
        ],
      })
      .expect(201);
    expect(burger.body.trackStock).toBe(false);
    expect(burger.body.modifierGroups).toEqual([{ id: sides.body.id, name: 'Choose a side' }]);
    expect(burger.body.variants[0].components.map((c: any) => c.componentName).sort()).toEqual(['Beef patty', 'Burger bun']);
  });
});

describe('inventory ledger', () => {
  let t: Record<string, string>;
  let storeId: string;
  let otherStoreId: string;
  let variantId: string;

  const level = async (store: string) => {
    const res = await http.get('/api/v1/inventory/levels').query({ storeId: store }).set(t).expect(200);
    return res.body.items.find((i: any) => i.variantId === variantId)?.onHand;
  };

  beforeAll(async () => {
    const o = await signup('Stock Shop', 'stock@example.com');
    t = auth(o.accessToken);
    storeId = (await http.get('/api/v1/stores').set(t)).body[0].id;
    otherStoreId = (await http.post('/api/v1/stores').set(t).send({ name: 'Warehouse', code: 'WH', type: 'warehouse' })).body.id;
    const p = await http.post('/api/v1/products').set(t).send({ name: 'Sugar 2kg', variants: [{ price: '3.20', reorderLevel: 5 }] });
    variantId = p.body.variants[0].id;
  });

  it('receives, wastes and adjusts stock', async () => {
    await http.post('/api/v1/inventory/movements').set(t).send({ storeId, type: 'receive', reference: 'GRN-1', lines: [{ variantId, quantity: 10, unitCost: '2.40' }] }).expect(201);
    await http.post('/api/v1/inventory/movements').set(t).send({ storeId, type: 'waste', lines: [{ variantId, quantity: 2 }] }).expect(201);
    await http.post('/api/v1/inventory/movements').set(t).send({ storeId, type: 'adjustment', lines: [{ variantId, quantity: -1 }] }).expect(201);
    await http.post('/api/v1/inventory/movements').set(t).send({ storeId, type: 'receive', lines: [{ variantId, quantity: -1 }] }).expect(400);
    expect(await level(storeId)).toBe('7.000');
  });

  it('ignores a retried request with the same clientId', async () => {
    const clientId = '0190a1b2-0000-7000-8000-000000000001';
    const body = { storeId, type: 'receive', lines: [{ variantId, quantity: 1, clientId }] };
    const first = await http.post('/api/v1/inventory/movements').set(t).send(body).expect(201);
    const again = await http.post('/api/v1/inventory/movements').set(t).send(body).expect(201);
    expect(first.body.recorded).toBe(1);
    expect(again.body).toMatchObject({ recorded: 0, skippedDuplicates: 1 });
    expect(await level(storeId)).toBe('8.000');
  });

  it('transfers between stores', async () => {
    await http.post('/api/v1/inventory/transfers').set(t).send({ fromStoreId: storeId, toStoreId: otherStoreId, lines: [{ variantId, quantity: 3 }] }).expect(201);
    expect(await level(storeId)).toBe('5.000');
    expect(await level(otherStoreId)).toBe('3.000');
  });

  it('turns a stock take into adjustments and flags low stock', async () => {
    const res = await http.post('/api/v1/inventory/stock-takes').set(t).send({ storeId, lines: [{ variantId, countedQuantity: '4.5' }] }).expect(201);
    expect(res.body.movements[0].quantity).toBe('-0.500');
    expect(await level(storeId)).toBe('4.500');
    const low = await http.get('/api/v1/inventory/levels').query({ storeId, lowStock: true }).set(t).expect(200);
    expect(low.body.total).toBe(1);
  });

  it('lists the movement history', async () => {
    const res = await http.get('/api/v1/inventory/movements').query({ storeId }).set(t).expect(200);
    expect(res.body.total).toBe(6);
    expect(res.body.items[0]).toMatchObject({ productName: 'Sugar 2kg', storeName: 'Main Store' });
  });
});

describe('staff roles', () => {
  let ownerT: Record<string, string>;
  let cashierT: Record<string, string>;
  let cashierId: string;
  let owner: Awaited<ReturnType<typeof signup>>;

  beforeAll(async () => {
    owner = await signup('Roles Shop', 'roles@example.com');
    ownerT = auth(owner.accessToken);
  });

  it('adds a cashier with a till PIN, and rejects a duplicate PIN', async () => {
    const res = await http
      .post('/api/v1/staff')
      .set(ownerT)
      .send({ email: 'cashier@example.com', fullName: 'Tendai Cashier', password: 'password123', role: 'cashier', pin: '1234' })
      .expect(201);
    cashierId = res.body.id;
    expect(res.body).toMatchObject({ role: 'cashier', hasPin: true });
    await http
      .post('/api/v1/staff')
      .set(ownerT)
      .send({ email: 'other@example.com', fullName: 'Other', password: 'password123', role: 'cashier', pin: '1234' })
      .expect(409);
    const login = await http.post('/api/v1/auth/login').send({ email: 'cashier@example.com', password: 'password123' }).expect(200);
    cashierT = auth(login.body.accessToken);
  });

  it('lets a cashier read the catalog but not change it', async () => {
    await http.get('/api/v1/products').set(cashierT).expect(200);
    await http.post('/api/v1/products').set(cashierT).send({ name: 'X', variants: [{ price: 1 }] }).expect(403);
    await http.post('/api/v1/customers').set(cashierT).send({ name: 'Walk-in Ltd', tin: '2000123456' }).expect(201);
  });

  it('keeps at least one owner', async () => {
    await http.patch(`/api/v1/staff/${owner.membership.id}`).set(ownerT).send({ role: 'admin' }).expect(400);
  });

  it('locks out a deactivated staff member immediately', async () => {
    await http.patch(`/api/v1/staff/${cashierId}`).set(ownerT).send({ active: false }).expect(200);
    await http.get('/api/v1/products').set(cashierT).expect(401);
  });

  it('writes an audit trail', async () => {
    const res = await http.get('/api/v1/audit-logs').set(ownerT).expect(200);
    expect(res.body.map((r: any) => r.entity)).toEqual(expect.arrayContaining(['Staff']));
  });
});

describe('one person in several businesses', () => {
  it('lists only the current business staff, and switches business', async () => {
    const shop = await signup('Multi Shop', 'multi@example.com');
    const cafe = await signup('Multi Cafe', 'multi-cafe@example.com', 'restaurant');
    // The shop owner is added to the cafe too.
    await http.post('/api/v1/staff').set(auth(cafe.accessToken)).send({ email: 'multi@example.com', fullName: 'Multi', role: 'manager' }).expect(201);

    const login = await http.post('/api/v1/auth/login').send({ email: 'multi@example.com', password: 'password123' }).expect(200);
    expect(login.body.businesses).toHaveLength(2);
    expect(login.body.tenant.id).toBe(shop.tenant.id);

    const shopStaff = await http.get('/api/v1/staff').set(auth(login.body.accessToken)).expect(200);
    expect(shopStaff.body).toHaveLength(1);

    const switched = await http
      .post('/api/v1/auth/switch-tenant')
      .set(auth(login.body.accessToken))
      .send({ tenantId: cafe.tenant.id })
      .expect(200);
    expect(switched.body.membership.role).toBe('manager');
    const cafeStaff = await http.get('/api/v1/staff').set(auth(switched.body.accessToken)).expect(200);
    expect(cafeStaff.body).toHaveLength(2);
    const tenant = await http.get('/api/v1/tenant').set(auth(switched.body.accessToken)).expect(200);
    expect(tenant.body.name).toBe('Multi Cafe');
  });
});

describe('tenant isolation', () => {
  let a: Record<string, string>;
  let b: Record<string, string>;
  let aProductId: string;
  let aCategoryId: string;
  let aStoreId: string;

  beforeAll(async () => {
    a = auth((await signup('Tenant A', 'a@example.com')).accessToken);
    b = auth((await signup('Tenant B', 'b@example.com')).accessToken);
    aCategoryId = (await http.post('/api/v1/categories').set(a).send({ name: 'Secret category' })).body.id;
    aProductId = (await http.post('/api/v1/products').set(a).send({ name: 'Secret product', variants: [{ price: 9, barcode: 'A-ONLY' }] })).body.id;
    aStoreId = (await http.get('/api/v1/stores').set(a)).body[0].id;
  });

  it("hides another business's records", async () => {
    await http.get(`/api/v1/products/${aProductId}`).set(b).expect(404);
    await http.get('/api/v1/products/barcode/A-ONLY').set(b).expect(404);
    const list = await http.get('/api/v1/products').query({ search: 'Secret' }).set(b).expect(200);
    expect(list.body.total).toBe(0);
    const cats = await http.get('/api/v1/categories').set(b).expect(200);
    expect(cats.body.find((c: any) => c.id === aCategoryId)).toBeUndefined();
  });

  it("refuses to change another business's records", async () => {
    await http.patch(`/api/v1/products/${aProductId}`).set(b).send({ name: 'Hacked' }).expect(404);
    await http.delete(`/api/v1/categories/${aCategoryId}`).set(b).expect(404);
  });

  it("refuses links to another business's records", async () => {
    await http.post('/api/v1/products').set(b).send({ name: 'Sneaky', categoryId: aCategoryId, variants: [{ price: 1 }] }).expect(400);
    await http.post('/api/v1/inventory/movements').set(b).send({ storeId: aStoreId, type: 'receive', lines: [] }).expect(400);
  });

  it('allows the same barcode in two different businesses', async () => {
    await http.post('/api/v1/products').set(b).send({ name: 'Own product', variants: [{ price: 1, barcode: 'A-ONLY' }] }).expect(201);
  });

  it('is enforced by the database even when no tenant is set', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const { rows } = await pool.query('select count(*)::int as n from products');
      expect(rows[0].n).toBe(0);
      await expect(pool.query('delete from stock_movements')).rejects.toThrow(/permission denied/);
    } finally {
      await pool.end();
    }
  });
});

describe('accounting', () => {
  let t: Record<string, string>;
  let acc: Record<string, any>;
  let today: string;
  let yesterday: string;
  let vatId: string;
  let supplierId: string;
  let customerId: string;
  let billId: string;
  let invoiceId: string;

  const A = '/api/v1/accounting';
  const accountByKey = (k: string) => acc[k].id as string;
  const accountByCode = (code: string) => (Object.values(acc).find((a: any) => a.code === code) as any).id as string;
  const balances = async () => {
    const res = await http.get(`${A}/accounts`).set(t).expect(200);
    return Object.fromEntries(res.body.map((a: any) => [a.systemKey ?? a.code, a.balance]));
  };
  const trialBalanced = async () => {
    const tb = await http.get(`${A}/reports/trial-balance`).set(t).expect(200);
    expect(tb.body.balanced).toBe(true);
    const bs = await http.get(`${A}/reports/balance-sheet`).set(t).expect(200);
    expect(bs.body.balanced).toBe(true);
  };

  beforeAll(async () => {
    const o = await signup('Books Wholesale', 'books@example.com', 'wholesale');
    t = auth(o.accessToken);
    const accounts = await http.get(`${A}/accounts`).set(t).expect(200);
    acc = Object.fromEntries(accounts.body.map((a: any) => [a.systemKey ?? a.code, a]));
    const periods = await http.get(`${A}/periods`).set(t).expect(200);
    today = periods.body.today;
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    yesterday = d.toISOString().slice(0, 10);
    vatId = (await http.get('/api/v1/tax-rates').set(t)).body.find((r: any) => r.code === 'VAT').id;
    supplierId = (await http.post('/api/v1/suppliers').set(t).send({ name: 'Delta Beverages', paymentTermsDays: 14 }).expect(201)).body.id;
    customerId = (await http.post('/api/v1/customers').set(t).send({ name: 'Corner Tuckshop', creditLimit: '500' }).expect(201)).body.id;
  });

  it('gives a new business a chart of accounts', () => {
    for (const key of ['cash', 'bank', 'receivables', 'payables', 'inventory', 'vat_input', 'vat_output', 'sales', 'cogs', 'fx']) {
      expect(acc[key]).toBeDefined();
    }
    expect(acc.cash).toMatchObject({ isBank: true, type: 'asset', balance: '0.00' });
  });

  it('posts a supplier bill with VAT and suggests the due date from payment terms', async () => {
    const res = await http
      .post(`${A}/bills`)
      .set(t)
      .send({
        supplierId,
        supplierReference: 'DB-7781',
        date: today,
        lines: [{ accountId: accountByKey('grni'), description: 'Soft drinks', quantity: 4, unitPrice: '25.00', taxRateId: vatId }],
      })
      .expect(201);
    billId = res.body.id;
    expect(res.body).toMatchObject({ number: 'BILL-00001', subtotal: '100.00', taxTotal: '15.50', total: '115.50', state: 'unpaid', balance: '115.50' });
    const due = new Date(`${today}T00:00:00Z`);
    due.setUTCDate(due.getUTCDate() + 14);
    expect(res.body.dueDate).toBe(due.toISOString().slice(0, 10));
    const b = await balances();
    expect(b).toMatchObject({ payables: '115.50', vat_input: '15.50', grni: '-100.00' });
    await trialBalanced();
  });

  it('pays part of a bill and refuses to overpay', async () => {
    await http.post(`${A}/bills/${billId}/payments`).set(t).send({ accountId: accountByKey('bank'), date: today, amount: '200' }).expect(400);
    await http.post(`${A}/bills/${billId}/payments`).set(t).send({ accountId: accountByKey('sales'), date: today, amount: '10' }).expect(400);
    const res = await http.post(`${A}/bills/${billId}/payments`).set(t).send({ accountId: accountByKey('bank'), date: today, amount: '50' }).expect(201);
    expect(res.body).toMatchObject({ state: 'part_paid', amountPaid: '50.00', balance: '65.50' });
    expect(res.body.payments[0]).toMatchObject({ number: 'PAY-00001', accountName: 'Bank account' });
    expect((await balances()).payables).toBe('65.50');
  });

  it('invoices a customer with VAT-inclusive prices and takes payment', async () => {
    const res = await http
      .post(`${A}/invoices`)
      .set(t)
      .send({ customerId, date: today, taxInclusive: true, lines: [{ description: 'Cases of Coke', quantity: 2, unitPrice: '50', taxRateId: vatId }] })
      .expect(201);
    invoiceId = res.body.id;
    expect(res.body).toMatchObject({ number: 'INV-00001', subtotal: '86.58', taxTotal: '13.42', total: '100.00' });
    expect(res.body.lines[0]).toMatchObject({ accountName: 'Sales' });
    const paid = await http.post(`${A}/invoices/${invoiceId}/payments`).set(t).send({ accountId: accountByKey('cash'), date: today, amount: '100' }).expect(201);
    expect(paid.body).toMatchObject({ state: 'paid', balance: '0.00' });
    expect(await balances()).toMatchObject({ receivables: '0.00', sales: '86.58', vat_output: '13.42', cash: '100.00' });
    await trialBalanced();
  });

  it("enforces the customer's credit limit", async () => {
    await http
      .post(`${A}/invoices`)
      .set(t)
      .send({ customerId, date: today, lines: [{ description: 'Big order', unitPrice: '600' }] })
      .expect(400)
      .expect((r) => expect(r.body.message).toMatch(/credit limit/));
  });

  it('records an expense paid in cash, taking out the VAT', async () => {
    const res = await http
      .post(`${A}/expenses`)
      .set(t)
      .send({ date: today, accountId: accountByCode('6010'), paidFromAccountId: accountByKey('cash'), description: 'ZESA tokens', total: '23.10', taxRateId: vatId })
      .expect(201);
    expect(res.body).toMatchObject({ number: 'EXP-00001', net: '20.00', tax: '3.10', total: '23.10' });
    await http
      .post(`${A}/expenses`)
      .set(t)
      .send({ date: today, accountId: accountByKey('payables'), paidFromAccountId: accountByKey('cash'), description: 'Sneaky', total: '1' })
      .expect(400);
    expect((await balances()).cash).toBe('76.90');
  });

  it('values stock movements into the ledger', async () => {
    const storeId = (await http.get('/api/v1/stores').set(t)).body[0].id;
    const p = await http.post('/api/v1/products').set(t).send({ name: 'Rice 2kg', variants: [{ price: '3', costPrice: '2.00' }] });
    const variantId = p.body.variants[0].id;
    await http.post('/api/v1/inventory/movements').set(t).send({ storeId, type: 'receive', lines: [{ variantId, quantity: 10, unitCost: '2.20' }] }).expect(201);
    await http.post('/api/v1/inventory/movements').set(t).send({ storeId, type: 'waste', lines: [{ variantId, quantity: 1 }] }).expect(201);
    const b = await balances();
    // 10 × 2.20 received, 1 × 2.00 (cost price) written off
    expect(b).toMatchObject({ inventory: '20.00', stock_loss: '2.00', grni: '-78.00' }); // billed 100, received 22
    await trialBalanced();
  });

  it('books an exchange gain when a foreign-currency invoice is paid at a better rate', async () => {
    await http.post('/api/v1/currencies').set(t).send({ code: 'ZWG', name: 'Zimbabwe Gold', symbol: 'ZiG', rateToBase: '26.5' }).expect(201);
    const inv = await http
      .post(`${A}/invoices`)
      .set(t)
      .send({ customerId, date: today, currencyCode: 'ZWG', lines: [{ description: 'Sugar', unitPrice: '265' }] })
      .expect(201);
    expect(inv.body).toMatchObject({ currencyCode: 'ZWG', rate: '26.500000', total: '265.00', totalBase: '10.00' });
    await http.post(`${A}/invoices/${inv.body.id}/payments`).set(t).send({ accountId: accountByKey('cash'), date: today, amount: '265', rate: '25' }).expect(201);
    const b = await balances();
    expect(b.receivables).toBe('0.00');
    expect(b.fx).toBe('-0.60'); // a gain: 265 ZiG was worth 10.60 when received, 10.00 when invoiced
    await trialBalanced();
  });

  it('posts balanced manual journals only, and reverses them', async () => {
    const cap = accountByCode('3000');
    await http
      .post(`${A}/journals`)
      .set(t)
      .send({ date: today, description: 'Lopsided', lines: [{ accountId: accountByKey('bank'), debit: '10' }, { accountId: cap, credit: '9' }] })
      .expect(400);
    await http
      .post(`${A}/journals`)
      .set(t)
      .send({ date: today, description: 'Into receivables', lines: [{ accountId: accountByKey('receivables'), debit: '10' }, { accountId: cap, credit: '10' }] })
      .expect(400);
    const je = await http
      .post(`${A}/journals`)
      .set(t)
      .send({ date: today, description: 'Owner puts money in', lines: [{ accountId: accountByKey('bank'), debit: '1000' }, { accountId: cap, credit: '1000' }] })
      .expect(201);
    expect(je.body.lines).toHaveLength(2);
    const rev = await http.post(`${A}/journals/${je.body.id}/reverse`).set(t).send({}).expect(201);
    expect(rev.body).toMatchObject({ source: 'reversal', reversesId: je.body.id });
    await http.post(`${A}/journals/${je.body.id}/reverse`).set(t).send({}).expect(400);
    const invoiceEntry = (await http.get(`${A}/invoices/${invoiceId}`).set(t)).body.journalEntryId;
    await http
      .post(`${A}/journals/${invoiceEntry}/reverse`)
      .set(t)
      .send({})
      .expect(400)
      .expect((r) => expect(r.body.message).toMatch(/Void the invoice/));
  });

  it('voids payments, then the bill, putting the ledger back', async () => {
    await http.post(`${A}/bills/${billId}/void`).set(t).expect(400);
    const bill = (await http.get(`${A}/bills/${billId}`).set(t)).body;
    await http.post(`${A}/payments/${bill.payments[0].id}/void`).set(t).expect(201);
    const voided = await http.post(`${A}/bills/${billId}/void`).set(t).expect(201);
    expect(voided.body.state).toBe('void');
    expect((await balances()).payables).toBe('0.00');
    const list = await http.get(`${A}/bills`).query({ status: 'void' }).set(t).expect(200);
    expect(list.body.total).toBe(1);
    await trialBalanced();
  });

  it('reports profit and loss, VAT and who owes what', async () => {
    const pl = await http.get(`${A}/reports/profit-and-loss`).query({ from: today, to: today }).set(t).expect(200);
    const income = pl.body.sections.find((s: any) => s.title === 'Income');
    expect(income.total).toBe('96.58'); // 86.58 + 10.00 (ZiG invoice)
    expect(pl.body.netProfit).toBe('75.18'); // 96.58 − 2.00 stock loss − 20.00 power + 0.60 exchange gain
    const vat = await http.get(`${A}/reports/vat`).query({ from: today, to: today }).set(t).expect(200);
    expect(vat.body).toMatchObject({ outputTax: '13.42', inputTax: '3.10', netPayable: '10.32' });
    await http.post(`${A}/invoices`).set(t).send({ customerId, date: today, dueDate: today, lines: [{ description: 'On account', unitPrice: '40' }] }).expect(201);
    const aged = await http.get(`${A}/reports/aged-receivables`).set(t).expect(200);
    expect(aged.body.totals).toMatchObject({ current: '40.00', total: '40.00' });
    expect(aged.body.parties[0]).toMatchObject({ name: 'Corner Tuckshop', total: '40.00' });
    const ledger = await http.get(`${A}/reports/general-ledger`).query({ accountId: accountByKey('cash'), from: today, to: today }).set(t).expect(200);
    expect(ledger.body.closingBalance).toBe('87.50'); // 100 − 23.10 + 10.60
    const summary = await http.get(`${A}/summary`).set(t).expect(200);
    expect(summary.body).toMatchObject({ receivables: '40.00', payables: '0.00' });
  });

  it('closes a period: no postings on closed days, and only owners or admins reopen', async () => {
    await http.post(`${A}/periods/close`).set(t).send({ through: today }).expect(400);
    await http.post(`${A}/periods/close`).set(t).send({ through: yesterday }).expect(201);
    await http
      .post(`${A}/expenses`)
      .set(t)
      .send({ date: yesterday, accountId: accountByCode('6000'), paidFromAccountId: accountByKey('cash'), description: 'Late rent', total: '5' })
      .expect(400)
      .expect((r) => expect(r.body.message).toMatch(/closed/));

    await http
      .post('/api/v1/staff')
      .set(t)
      .send({ email: 'acc@example.com', fullName: 'Rudo Accountant', password: 'password123', role: 'accountant' })
      .expect(201);
    const accT = auth((await http.post('/api/v1/auth/login').send({ email: 'acc@example.com', password: 'password123' })).body.accessToken);
    await http.get(`${A}/reports/trial-balance`).set(accT).expect(200);
    await http.post(`${A}/periods/close`).set(accT).send({ through: null }).expect(403);
    await http.post(`${A}/periods/close`).set(t).send({ through: null }).expect(201);
  });

  it('keeps accounting away from cashiers and other businesses', async () => {
    await http
      .post('/api/v1/staff')
      .set(t)
      .send({ email: 'till@example.com', fullName: 'Till Person', password: 'password123', role: 'cashier' })
      .expect(201);
    const cashierT = auth((await http.post('/api/v1/auth/login').send({ email: 'till@example.com', password: 'password123' })).body.accessToken);
    await http.get(`${A}/summary`).set(cashierT).expect(403);
    const other = auth((await signup('Other Books', 'otherbooks@example.com')).accessToken);
    await http.get(`${A}/invoices/${invoiceId}`).set(other).expect(404);
    expect((await http.get(`${A}/invoices`).set(other).expect(200)).body.total).toBe(0);
    await http.post(`${A}/invoices`).set(other).send({ customerId, date: today, lines: [{ description: 'x', unitPrice: '1' }] }).expect(400);
  });

  it('is append-only and always balanced at the database level', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();
    try {
      await expect(client.query('update journal_lines set debit = 0')).rejects.toThrow(/permission denied/);
      await expect(client.query('delete from journal_entries')).rejects.toThrow(/permission denied/);
      // An entry whose lines don't balance is refused when the transaction commits.
      const tenantId = (await http.get('/api/v1/auth/me').set(t)).body.tenant.id;
      await client.query('begin');
      await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
      const { rows } = await client.query(
        `insert into journal_entries (id, tenant_id, number, date, description, source) values (gen_random_uuid(), $1, 'X-1', $2, 'bad', 'manual') returning id`,
        [tenantId, today],
      );
      await client.query(
        `insert into journal_lines (id, tenant_id, entry_id, account_id, debit) values (gen_random_uuid(), $1, $2, $3, 5)`,
        [tenantId, rows[0].id, accountByKey('cash')],
      );
      await expect(client.query('commit')).rejects.toThrow(/does not balance/);
    } finally {
      client.release();
      await pool.end();
    }
  });
});

describe('stock management', () => {
  let t: Record<string, string>;
  let mainId: string;
  let branchId: string;
  let variantId: string;
  let productId: string;
  let today: string;
  const I = '/api/v1/inventory';

  beforeAll(async () => {
    t = auth((await signup('Stock Masters', 'stockmasters@example.com', 'wholesale')).accessToken);
    mainId = (await http.get('/api/v1/stores').set(t)).body[0].id;
    branchId = (await http.post('/api/v1/stores').set(t).send({ name: 'Branch', code: 'BR' })).body.id;
    const cat = await http.post('/api/v1/categories').set(t).send({ name: 'Butchery' });
    const p = await http.post('/api/v1/products').set(t).send({ name: 'Mince', categoryId: cat.body.id, variants: [{ sku: 'MINCE', price: '7', costPrice: '4.00' }] });
    productId = p.body.id;
    variantId = p.body.variants[0].id;
    today = (await http.get('/api/v1/accounting/periods').set(t)).body.today;
    await http.post(`${I}/movements`).set(t).send({ storeId: mainId, type: 'receive', lines: [{ variantId, quantity: 10 }] }).expect(201);
    await http.post(`${I}/transfers`).set(t).send({ fromStoreId: mainId, toStoreId: branchId, lines: [{ variantId, quantity: 3 }] }).expect(201);
    await http.post(`${I}/movements`).set(t).send({ storeId: mainId, type: 'waste', lines: [{ variantId, quantity: 1 }] }).expect(201);
  });

  it('keeps variant attributes with their values in order', async () => {
    const a = await http.post('/api/v1/attributes').set(t).send({ name: 'Size', values: ['Small', 'Medium', 'Large'] }).expect(201);
    await http.post('/api/v1/attributes').set(t).send({ name: 'Size', values: [] }).expect(409);
    await http.patch(`/api/v1/attributes/${a.body.id}`).set(t).send({ values: ['S', 'M', 'L', 'XL'] }).expect(200);
    const list = await http.get('/api/v1/attributes').set(t).expect(200);
    expect(list.body[0].values.map((v: any) => v.value)).toEqual(['S', 'M', 'L', 'XL']);
    await http.delete(`/api/v1/attributes/${a.body.id}`).set(t).expect(200);
  });

  it('sets and clears a price for one store', async () => {
    await http.put('/api/v1/store-prices').set(t).send({ storeId: branchId, items: [{ variantId, price: '7.50' }] }).expect(200);
    const branch = await http.get('/api/v1/store-prices').query({ storeId: branchId }).set(t).expect(200);
    expect(branch.body.items[0]).toMatchObject({ productName: 'Mince', price: '7.00', storePrice: '7.50' });
    const main = await http.get('/api/v1/store-prices').query({ storeId: mainId }).set(t).expect(200);
    expect(main.body.items[0].storePrice).toBeNull();
    await http.put('/api/v1/store-prices').set(t).send({ storeId: branchId, items: [{ variantId, price: null }] }).expect(200);
    expect((await http.get('/api/v1/store-prices').query({ storeId: branchId }).set(t)).body.items[0].storePrice).toBeNull();
  });

  it('lists products with quantity on hand and the stores holding them', async () => {
    const res = await http.get('/api/v1/products').query({ withStock: true }).set(t).expect(200);
    const mince = res.body.items.find((p: any) => p.id === productId);
    expect(mince).toMatchObject({ onHand: '9.000', stores: ['Branch', 'Main Store'] });
  });

  it('values stock, now and at a past date', async () => {
    const now = await http.get(`${I}/reports/valuation`).set(t).expect(200);
    expect(now.body.rows[0]).toMatchObject({ productName: 'Mince', quantity: '9.000', value: '36.00', category: 'Butchery' });
    expect(now.body.totalValue).toBe('36.00');
    const branch = await http.get(`${I}/reports/valuation`).query({ storeId: branchId }).set(t).expect(200);
    expect(branch.body.rows[0].quantity).toBe('3.000');
    const past = await http.get(`${I}/reports/valuation`).query({ asOf: '2020-01-01' }).set(t).expect(200);
    expect(past.body.rows).toHaveLength(0);
  });

  it('shows the stock ledger and one item in detail and in summary', async () => {
    const ledger = await http.get(`${I}/reports/ledger`).query({ from: today, to: today }).set(t).expect(200);
    expect(ledger.body.total).toBe(4); // receive, transfer out + in, waste
    const main = await http.get(`${I}/reports/item-ledger`).query({ variantId, storeId: mainId, from: today, to: today }).set(t).expect(200);
    expect(main.body).toMatchObject({ opening: '0.000', totalIn: '10.000', totalOut: '4.000', closing: '6.000', closingValue: '24.00' });
    expect(main.body.lines.map((l: any) => l.balance)).toEqual(['10.000', '7.000', '6.000']);
    const summary = await http.get(`${I}/reports/item-summary`).query({ from: today, to: today }).set(t).expect(200);
    expect(summary.body.rows[0]).toMatchObject({ opening: '0.000', received: '10.000', transfersIn: '3.000', transfersOut: '3.000', adjusted: '-1.000', closing: '9.000' });
  });

  it('keeps stock costs away from cashiers', async () => {
    await http.post('/api/v1/staff').set(t).send({ email: 'stockcashier@example.com', fullName: 'Till', password: 'password123', role: 'cashier' }).expect(201);
    const c = auth((await http.post('/api/v1/auth/login').send({ email: 'stockcashier@example.com', password: 'password123' })).body.accessToken);
    await http.get(`${I}/reports/valuation`).set(c).expect(403);
    await http.put('/api/v1/store-prices').set(c).send({ storeId: branchId, items: [] }).expect(403);
  });
});

describe('sales', () => {
  let t: Record<string, string>;
  let storeId: string;
  let coke: string;
  let bun: string;
  let patty: string;
  let burger: string;
  let today: string;
  let firstSale: any;
  const S = '/api/v1/sales';

  const onHand = async (variantId: string) => {
    const res = await http.get('/api/v1/inventory/levels').query({ storeId, pageSize: 200 }).set(t);
    return res.body.items.find((i: any) => i.variantId === variantId)?.onHand;
  };
  const balances = async () => {
    const res = await http.get('/api/v1/accounting/accounts').set(t).expect(200);
    return Object.fromEntries(res.body.map((a: any) => [a.systemKey ?? a.code, a.balance]));
  };

  beforeAll(async () => {
    t = auth((await signup('Sales Shop', 'salesshop@example.com', 'mixed')).accessToken);
    storeId = (await http.get('/api/v1/stores').set(t)).body[0].id;
    today = (await http.get('/api/v1/accounting/periods').set(t)).body.today;
    const make = async (body: object) => (await http.post('/api/v1/products').set(t).send(body).expect(201)).body.variants[0].id;
    coke = await make({ name: 'Coke 500ml', variants: [{ sku: 'COKE', barcode: '600100', price: '1.00', costPrice: '0.60' }] });
    bun = await make({ name: 'Bun', variants: [{ price: 0, costPrice: '0.20' }] });
    patty = await make({ name: 'Patty', variants: [{ price: 0, costPrice: '0.90' }] });
    burger = await make({
      name: 'Burger',
      kind: 'menu_item',
      kitchenStation: 'grill',
      variants: [{ price: '6.50', components: [{ componentVariantId: bun, quantity: 1 }, { componentVariantId: patty, quantity: 1 }] }],
    });
    await http
      .post('/api/v1/inventory/movements')
      .set(t)
      .send({ storeId, type: 'receive', lines: [{ variantId: coke, quantity: 50 }, { variantId: bun, quantity: 10 }, { variantId: patty, quantity: 10 }] })
      .expect(201);
  });

  it('sells for cash, gives change, takes stock out and posts the books', async () => {
    const before = await balances();
    const res = await http
      .post(S)
      .set(t)
      .send({ storeId, lines: [{ variantId: coke, quantity: 2 }], payments: [{ method: 'cash', amount: '5' }], clientId: '0190a1b2-0000-7000-8000-00000000aaaa' })
      .expect(201);
    firstSale = res.body;
    expect(res.body).toMatchObject({ number: 'S-00001', type: 'sale', status: 'completed', customerName: 'Cash Customer', total: '2.00', taxTotal: '0.27', costBase: '1.20', fiscalStatus: 'not_required' });
    expect(res.body.payments[0]).toMatchObject({ method: 'cash', amount: '5.00', change: '3.00', amountBase: '2.00' });
    expect(await onHand(coke)).toBe('48.000');
    const after = await balances();
    expect(Number(after.cash) - Number(before.cash)).toBeCloseTo(2, 2);
    expect(Number(after.sales) - Number(before.sales)).toBeCloseTo(1.73, 2);
    expect(Number(after.vat_output) - Number(before.vat_output)).toBeCloseTo(0.27, 2);
    expect(Number(after.cogs) - Number(before.cogs)).toBeCloseTo(1.2, 2);
  });

  it('records a retried sale once', async () => {
    const again = await http
      .post(S)
      .set(t)
      .send({ storeId, lines: [{ variantId: coke, quantity: 2 }], payments: [{ method: 'cash', amount: '5' }], clientId: '0190a1b2-0000-7000-8000-00000000aaaa' })
      .expect(201);
    expect(again.body.id).toBe(firstSale.id);
    expect(await onHand(coke)).toBe('48.000');
  });

  it('refuses short payments and overpaying by card', async () => {
    await http.post(S).set(t).send({ storeId, lines: [{ variantId: coke, quantity: 2 }], payments: [{ method: 'cash', amount: '1' }] }).expect(400);
    await http.post(S).set(t).send({ storeId, lines: [{ variantId: coke, quantity: 1 }], payments: [{ method: 'card', amount: '5' }] }).expect(400);
    await http.post(S).set(t).send({ storeId, lines: [{ variantId: coke, quantity: 1 }], payments: [] }).expect(400);
  });

  it('uses up recipe ingredients and sends dishes to the kitchen', async () => {
    const sale = await http.post(S).set(t).send({ storeId, lines: [{ variantId: burger, quantity: 2 }], payments: [{ method: 'card', amount: '13' }] }).expect(201);
    expect(sale.body).toMatchObject({ total: '13.00', costBase: '2.20' });
    expect(await onHand(bun)).toBe('8.000');
    expect(await onHand(patty)).toBe('8.000');
    const k = await http.get(`${S}/kitchen`).set(t).expect(200);
    const ticket = k.body.tickets.find((x: any) => x.saleId === sale.body.id);
    expect(ticket.lines[0]).toMatchObject({ productName: 'Burger', station: 'grill', status: 'pending' });
    await http.patch(`${S}/${sale.body.id}/kitchen`).set(t).send({ status: 'ready' }).expect(200);
    await http.patch(`${S}/${sale.body.id}/kitchen`).set(t).send({ status: 'served' }).expect(200);
    const after = await http.get(`${S}/kitchen`).set(t).expect(200);
    expect(after.body.tickets.find((x: any) => x.saleId === sale.body.id)).toBeUndefined();
  });

  it('sells in ZiG and accepts US dollars', async () => {
    await http.post('/api/v1/currencies').set(t).send({ code: 'ZWG', name: 'Zimbabwe Gold', symbol: 'ZiG', rateToBase: '26.5' }).expect(201);
    const res = await http
      .post(S)
      .set(t)
      .send({ storeId, currencyCode: 'ZWG', lines: [{ variantId: coke, quantity: 1 }], payments: [{ method: 'cash', currencyCode: 'USD', amount: '1' }] })
      .expect(201);
    expect(res.body).toMatchObject({ currencyCode: 'ZWG', total: '26.50', totalBase: '1.00' });
    expect(res.body.payments[0]).toMatchObject({ currencyCode: 'USD', amountBase: '1.00', change: '0.00' });
  });

  it('cashes up a shift: float + cash sales − cash sent = expected', async () => {
    const shift = await http.post('/api/v1/shifts').set(t).send({ storeId, openingFloat: { USD: '20' } }).expect(201);
    await http.post('/api/v1/shifts').set(t).send({ storeId }).expect(400);
    const sale = await http.post(S).set(t).send({ storeId, lines: [{ variantId: coke, quantity: 3 }], payments: [{ method: 'cash', amount: '3' }] }).expect(201);
    expect(sale.body.shiftId).toBe(shift.body.id);
    const bank = (await http.get('/api/v1/accounting/accounts').set(t)).body.find((a: any) => a.systemKey === 'bank');
    await http.post('/api/v1/cash-transfers').set(t).send({ storeId, shiftId: shift.body.id, toAccountId: bank.id, amount: '1' }).expect(201);
    const closed = await http.post(`/api/v1/shifts/${shift.body.id}/close`).set(t).send({ countedCash: { USD: '21.50' } }).expect(201);
    expect(closed.body.cash).toEqual([
      expect.objectContaining({ currencyCode: 'USD', openingFloat: '20.00', cashTaken: '3.00', transferredOut: '1.00', expected: '22.00', counted: '21.50', variance: '-0.50' }),
    ]);
    expect(closed.body.salesCount).toBe(1);
  });

  it('refunds part of a sale, puts stock back and refuses to refund more than was sold', async () => {
    const line = firstSale.lines[0];
    const ret = await http.post(`${S}/${firstSale.id}/returns`).set(t).send({ lines: [{ lineId: line.id, quantity: 1 }], method: 'cash', reason: 'Flat' }).expect(201);
    expect(ret.body).toMatchObject({ type: 'return', number: 'R-00001', total: '1.00', note: 'Flat' });
    expect(ret.body.payments[0]).toMatchObject({ amount: '-1.00', amountBase: '-1.00' });
    await http.post(`${S}/${firstSale.id}/returns`).set(t).send({ lines: [{ lineId: line.id, quantity: 2 }], method: 'cash', reason: 'Again' }).expect(400);
    const sale = await http.get(`${S}/${firstSale.id}`).set(t).expect(200);
    expect(sale.body.lines[0].returnedQuantity).toBe('1.000');
    firstSale.returnId = ret.body.id;
  });

  it('voids a return, then the sale, restoring stock', async () => {
    const before = Number(await onHand(coke));
    await http.post(`${S}/${firstSale.id}/void`).set(t).expect(400);
    await http.post(`${S}/${firstSale.returnId}/void`).set(t).expect(201);
    expect(Number(await onHand(coke))).toBe(before - 1);
    const voided = await http.post(`${S}/${firstSale.id}/void`).set(t).expect(201);
    expect(voided.body.status).toBe('void');
    expect(Number(await onHand(coke))).toBe(before + 1);
  });

  it('turns a quotation into a sale at the quoted price', async () => {
    const q = await http.post(`${S}/quotations`).set(t).send({ storeId, customerName: 'Mrs Moyo', lines: [{ variantId: coke, quantity: 4, unitPrice: '0.90' }], validUntil: today }).expect(201);
    expect(q.body).toMatchObject({ type: 'quotation', status: 'open', total: '3.60', number: 'Q-00001' });
    const sale = await http.post(`${S}/${q.body.id}/convert`).set(t).send({ payments: [{ method: 'mobile', amount: '3.60' }] }).expect(201);
    expect(sale.body).toMatchObject({ type: 'sale', total: '3.60', customerName: 'Mrs Moyo', originalSaleId: q.body.id });
    expect((await http.get(`${S}/${q.body.id}`).set(t)).body.status).toBe('converted');
    await http.post(`${S}/${q.body.id}/convert`).set(t).send({ payments: [{ method: 'cash', amount: '4' }] }).expect(400);
  });

  it("applies a customer group's discount", async () => {
    const g = await http.post('/api/v1/customer-groups').set(t).send({ name: 'Staff', discountPercent: '10' }).expect(201);
    const c = await http.post('/api/v1/customers').set(t).send({ name: 'Tendai', groupId: g.body.id }).expect(201);
    const sale = await http.post(S).set(t).send({ storeId, customerId: c.body.id, lines: [{ variantId: coke, quantity: 10 }], payments: [{ method: 'cash', amount: '9' }] }).expect(201);
    expect(sale.body).toMatchObject({ customerName: 'Tendai', discountTotal: '1.00', total: '9.00' });
    const groups = await http.get('/api/v1/customer-groups').set(t).expect(200);
    expect(groups.body[0]).toMatchObject({ name: 'Staff', members: 1 });
  });

  it('imports sales from a file, once', async () => {
    const rows = [
      { reference: 'OLD-1', date: `${today}T09:00:00`, store: 'main', item: 'COKE', quantity: '2', paymentMethod: 'cash' },
      { reference: 'OLD-1', date: `${today}T09:00:00`, store: 'main', item: '600100', quantity: '1' },
      { reference: 'OLD-2', date: `${today}T10:00:00`, store: 'main', item: 'NOPE', quantity: '1' },
    ];
    const first = await http.post(`${S}/import`).set(t).send({ rows }).expect(201);
    expect(first.body).toMatchObject({ imported: 1, skipped: 0, errors: [{ reference: 'OLD-2', message: 'Unknown item "NOPE"' }] });
    const again = await http.post(`${S}/import`).set(t).send({ rows: rows.slice(0, 2) }).expect(201);
    expect(again.body).toMatchObject({ imported: 0, skipped: 1 });
    const list = await http.get(S).query({ search: 'S-' }).set(t).expect(200);
    expect(list.body.items.find((s: any) => s.note === 'Imported OLD-1')).toMatchObject({ total: '3.00', itemCount: '3.000' });
  });

  it('reports profit, daily takings, VAT, returns and cash', async () => {
    const range = { from: today, to: today };
    const items = await http.get(`${S}/reports/profitability`).query({ ...range, by: 'item' }).set(t).expect(200);
    const cokeRow = items.body.rows.find((r: any) => r.name === 'Coke 500ml');
    // Sold: 1 (ZiG) + 3 (shift) + 4 (quote) + 10 (group) + 3 (import) = 21; the voided sale and its return don't count.
    expect(cokeRow.quantity).toBe('21.000');
    expect(Number(cokeRow.profit)).toBeGreaterThan(0);
    for (const by of ['category', 'cashier', 'store']) await http.get(`${S}/reports/profitability`).query({ ...range, by }).set(t).expect(200);
    const daily = await http.get(`${S}/reports/daily`).query(range).set(t).expect(200);
    expect(daily.body.rows[0]).toMatchObject({ day: today, sales: 6, returns: 0 });
    const tax = await http.get(`${S}/reports/sales-tax`).query(range).set(t).expect(200);
    expect(tax.body.groups[0].rateName).toBe('Standard VAT');
    await http.get(`${S}/reports/purchases-tax`).query(range).set(t).expect(200);
    const returns = await http.get(`${S}/reports/returns`).query(range).set(t).expect(200);
    expect(returns.body.rows).toHaveLength(0); // the only return was voided
    const cash = await http.get(`${S}/reports/cash-balance`).set(t).expect(200);
    expect(cash.body.stores[0].balances.find((b: any) => b.currencyCode === 'USD')).toBeDefined();
    const book = await http.get(`${S}/reports/cashbook`).query({ ...range, storeId, currencyCode: 'USD' }).set(t).expect(200);
    expect(book.body.rows.some((r: any) => r.kind === 'Cash sent')).toBe(true);
  });

  it('lets a cashier sell but not refund', async () => {
    await http.post('/api/v1/staff').set(t).send({ email: 'salescashier@example.com', fullName: 'Cashier', password: 'password123', role: 'cashier' }).expect(201);
    const c = auth((await http.post('/api/v1/auth/login').send({ email: 'salescashier@example.com', password: 'password123' })).body.accessToken);
    const sale = await http.post(S).set(c).send({ storeId, lines: [{ variantId: coke, quantity: 1 }], payments: [{ method: 'cash', amount: '1' }] }).expect(201);
    expect(sale.body.salesperson).toBe('Cashier');
    await http.post(`${S}/${sale.body.id}/returns`).set(c).send({ lines: [{ lineId: sale.body.lines[0].id, quantity: 1 }], method: 'cash', reason: 'x' }).expect(403);
    await http.get(`${S}/reports/daily`).query({ from: today, to: today }).set(c).expect(403);
  });
});

describe('figures worked out in subqueries', () => {
  it("shows what's owed per supplier and filters the journal by account", async () => {
    const t = auth((await signup('Subquery Shop', 'subquery@example.com')).accessToken);
    const today = (await http.get('/api/v1/accounting/periods').set(t)).body.today;
    const accounts = (await http.get('/api/v1/accounting/accounts').set(t)).body;
    const rent = accounts.find((a: any) => a.code === '6000').id;
    const cash = accounts.find((a: any) => a.systemKey === 'cash').id;
    const supplier = await http.post('/api/v1/suppliers').set(t).send({ name: 'Landlord' }).expect(201);
    await http.post('/api/v1/suppliers').set(t).send({ name: 'Other' }).expect(201);
    await http.post('/api/v1/accounting/bills').set(t).send({ supplierId: supplier.body.id, date: today, lines: [{ accountId: rent, description: 'Rent', unitPrice: '300' }] }).expect(201);
    const list = await http.get('/api/v1/suppliers').set(t).expect(200);
    expect(list.body.items.find((s: any) => s.name === 'Landlord').owed).toBe('300.00');
    expect(list.body.items.find((s: any) => s.name === 'Other').owed).toBe('0.00');
    await http.post('/api/v1/accounting/expenses').set(t).send({ date: today, accountId: rent, paidFromAccountId: cash, description: 'Deposit', total: '10' }).expect(201);
    const byCash = await http.get('/api/v1/accounting/journals').query({ accountId: cash }).set(t).expect(200);
    expect(byCash.body.total).toBe(1);
    const expenses = await http.get('/api/v1/accounting/expenses').set(t).expect(200);
    expect(expenses.body.items[0].paidFromName).toBe('Cash on hand');
  });
});

describe('imported sales and shifts', () => {
  it('keeps imported sales out of the open shift', async () => {
    const t = auth((await signup('Import Shift Shop', 'importshift@example.com')).accessToken);
    const storeId = (await http.get('/api/v1/stores').set(t)).body[0].id;
    await http.post('/api/v1/products').set(t).send({ name: 'Tea', variants: [{ sku: 'TEA', price: '2' }] }).expect(201);
    const shift = await http.post('/api/v1/shifts').set(t).send({ storeId }).expect(201);
    await http.post('/api/v1/sales/import').set(t).send({ rows: [{ reference: 'X1', date: '2026-01-05', store: 'MAIN', item: 'TEA', quantity: '1' }] }).expect(201);
    const after = await http.get(`/api/v1/shifts/${shift.body.id}`).set(t).expect(200);
    expect(after.body.salesCount).toBe(0);
  });
});

describe('purchases', () => {
  let t: Record<string, string>;
  let storeId: string;
  let variantId: string;
  let supplierId: string;
  let today: string;
  let vatId: string;
  let bank: string;
  const P = '/api/v1/purchases';
  const balances = async () =>
    Object.fromEntries((await http.get('/api/v1/accounting/accounts').set(t)).body.map((a: any) => [a.systemKey ?? a.code, a.balance]));
  const onHand = async () =>
    (await http.get('/api/v1/inventory/levels').query({ storeId }).set(t)).body.items.find((i: any) => i.variantId === variantId)?.onHand;

  beforeAll(async () => {
    t = auth((await signup('Purchase Shop', 'purchases@example.com')).accessToken);
    storeId = (await http.get('/api/v1/stores').set(t)).body[0].id;
    variantId = (await http.post('/api/v1/products').set(t).send({ name: 'Sugar 2kg', variants: [{ sku: 'SUGAR', price: '4', costPrice: '2.00' }] })).body.variants[0].id;
    supplierId = (await http.post('/api/v1/suppliers').set(t).send({ name: 'Star Sugar' })).body.id;
    today = (await http.get('/api/v1/accounting/periods').set(t)).body.today;
    vatId = (await http.get('/api/v1/tax-rates').set(t)).body.find((r: any) => r.code === 'VAT').id;
    bank = (await http.get('/api/v1/accounting/accounts').set(t)).body.find((a: any) => a.systemKey === 'bank').id;
  });

  it('receives goods at cost, owes or pays the supplier, and updates the cost price', async () => {
    const res = await http
      .post(P)
      .set(t)
      .send({ supplierId, storeId, date: today, supplierReference: 'SS-9', lines: [{ variantId, quantity: 10, unitCost: '2.50', taxRateId: vatId }], payment: { accountId: bank } })
      .expect(201);
    expect(res.body).toMatchObject({ number: 'BILL-00001', subtotal: '25.00', taxTotal: '3.88', total: '28.88', state: 'paid' });
    expect(await onHand()).toBe('10.000');
    const b = await balances();
    expect(b).toMatchObject({ inventory: '25.00', vat_input: '3.88', bank: '-28.88', payables: '0.00', grni: '0.00' });
    const product = await http.get('/api/v1/products').query({ search: 'Sugar' }).set(t);
    expect(product.body.items[0].variants[0].costPrice).toBe('2.50');
    const list = await http.get(P).set(t).expect(200);
    expect(list.body.items[0]).toMatchObject({ supplierReference: 'SS-9', storeName: 'Main Store', partyName: 'Star Sugar' });
  });

  it('voids a purchase only after its payment, taking the goods back out', async () => {
    const owed = await http.post(P).set(t).send({ supplierId, storeId, date: today, lines: [{ variantId, quantity: 4, unitCost: '2.50' }] }).expect(201);
    expect(owed.body.state).toBe('unpaid');
    expect(await onHand()).toBe('14.000');
    const paid = (await http.get(P).set(t)).body.items.find((x: any) => x.number === 'BILL-00001');
    await http.post(`/api/v1/accounting/bills/${paid.id}/void`).set(t).expect(400);
    await http.post(`/api/v1/accounting/bills/${owed.body.id}/void`).set(t).expect(201);
    expect(await onHand()).toBe('10.000');
    expect((await balances()).inventory).toBe('25.00');
    const services = await http.post('/api/v1/products').set(t).send({ name: 'Delivery', kind: 'service', variants: [{ price: '1' }] });
    await http.post(P).set(t).send({ supplierId, storeId, date: today, lines: [{ variantId: services.body.variants[0].id, quantity: 1, unitCost: '1' }] }).expect(400);
  });

  it('imports purchase bills once, adding unknown suppliers', async () => {
    const rows = [
      { reference: 'INV-1', date: today, supplier: 'New Wholesaler', store: 'main', item: 'SUGAR', quantity: '5', unitCost: '2.40', vat: true },
      { reference: 'INV-1', date: today, supplier: 'New Wholesaler', store: 'main', item: 'SUGAR2', quantity: '1', unitCost: '1' },
    ];
    const bad = await http.post(`${P}/import`).set(t).send({ rows }).expect(201);
    expect(bad.body).toMatchObject({ imported: 0, errors: [{ message: 'Unknown item "SUGAR2"' }] });
    const ok = await http.post(`${P}/import`).set(t).send({ rows: rows.slice(0, 1) }).expect(201);
    expect(ok.body).toMatchObject({ imported: 1, skipped: 0 });
    const again = await http.post(`${P}/import`).set(t).send({ rows: rows.slice(0, 1) }).expect(201);
    expect(again.body).toMatchObject({ imported: 0, skipped: 1 });
    expect(await onHand()).toBe('15.000');
    const tax = await http.get('/api/v1/sales/reports/purchases-tax').query({ from: today, to: today }).set(t).expect(200);
    expect(tax.body.rows.some((r: any) => r.supplier === 'New Wholesaler' && r.tax === '1.86')).toBe(true);
  });
});

describe('returns from a mixed sale', () => {
  it('puts back exactly the items returned, nothing else', async () => {
    const t = auth((await signup('Mixed Return Shop', 'mixedreturn@example.com')).accessToken);
    const storeId = (await http.get('/api/v1/stores').set(t)).body[0].id;
    const make = async (name: string) => (await http.post('/api/v1/products').set(t).send({ name, variants: [{ price: '1', costPrice: '0.50' }] })).body.variants[0].id;
    const sugar = await make('Sugar');
    const tea = await make('Tea');
    await http.post('/api/v1/inventory/movements').set(t).send({ storeId, type: 'receive', lines: [{ variantId: sugar, quantity: 10 }, { variantId: tea, quantity: 10 }] }).expect(201);
    const sale = await http.post('/api/v1/sales').set(t).send({ storeId, lines: [{ variantId: sugar, quantity: 2 }, { variantId: tea, quantity: 1 }], payments: [{ method: 'cash', amount: '3' }] }).expect(201);
    const sugarLine = sale.body.lines.find((l: any) => l.variantId === sugar);
    await http.post(`/api/v1/sales/${sale.body.id}/returns`).set(t).send({ lines: [{ lineId: sugarLine.id, quantity: 1 }], method: 'cash', reason: 'Torn bag' }).expect(201);
    const levels = (await http.get('/api/v1/inventory/levels').query({ storeId }).set(t)).body.items;
    expect(levels.find((i: any) => i.variantId === sugar).onHand).toBe('9.000');
    expect(levels.find((i: any) => i.variantId === tea).onHand).toBe('9.000');
  });
});

describe('platform console', () => {
  const ownerPool = () => new Pool({ connectionString: process.env.TEST_MIGRATION_DATABASE_URL ?? 'postgres://pos_owner:pos_owner@localhost:5432/pos_test' });
  let biz: Awaited<ReturnType<typeof signup>>;
  let platformT: Record<string, string>;

  beforeAll(async () => {
    biz = await signup('Platform Watched Shop', 'watched@example.com');
    await signup('Platform Admin Person', 'floatly-admin@example.com');
  });

  it('refuses people who are not platform admins, and the API role cannot make them one', async () => {
    await http.post('/api/v1/platform/login').send({ email: 'floatly-admin@example.com', password: 'password123' }).expect(401);
    const app = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await expect(app.query(`update users set is_platform_admin = true where email = 'floatly-admin@example.com'`)).rejects.toThrow(/Platform access can only be granted/);
      await expect(app.query('select platform_businesses()')).rejects.toThrow(/Platform access only/);
    } finally {
      await app.end();
    }
  });

  it('shows every business to a platform admin', async () => {
    const owner = ownerPool();
    try {
      await owner.query(`update users set is_platform_admin = true where email = 'floatly-admin@example.com'`);
    } finally {
      await owner.end();
    }
    const login = await http.post('/api/v1/platform/login').send({ email: 'floatly-admin@example.com', password: 'password123' }).expect(200);
    platformT = auth(login.body.accessToken);
    const overview = await http.get('/api/v1/platform/overview').set(platformT).expect(200);
    expect(overview.body.businesses).toBeGreaterThanOrEqual(10);
    const list = await http.get('/api/v1/platform/businesses').set(platformT).expect(200);
    const watched = list.body.find((b: any) => b.name === 'Platform Watched Shop');
    expect(watched).toMatchObject({ ownerEmail: 'watched@example.com', staff: 1, stores: 1, businessType: 'retail' });
    const detail = await http.get(`/api/v1/platform/businesses/${biz.tenant.id}`).set(platformT).expect(200);
    expect(detail.body.business.name).toBe('Platform Watched Shop');
    expect(detail.body.staff[0]).toMatchObject({ email: 'watched@example.com', role: 'owner' });
    await http.get('/api/v1/platform/businesses/0190a1b2-0000-7000-8000-000000000999').set(platformT).expect(404);
  });

  it('keeps platform and business sign-ins apart, and logs platform visits in the business', async () => {
    await http.get('/api/v1/stores').set(platformT).expect(401);
    await http.get('/api/v1/platform/overview').set(auth(biz.accessToken)).expect(403);
    await http.get('/api/v1/platform/overview').expect(401);
    const owner = ownerPool();
    try {
      const { rows } = await owner.query(`select count(*)::int as n from audit_logs where tenant_id = $1 and action = 'platform_view'`, [biz.tenant.id]);
      expect(rows[0].n).toBe(1);
    } finally {
      await owner.end();
    }
  });
});

describe('sign-up requests and subscriptions', () => {
  const R = '/api/v1/auth/signup-requests';
  const base = { businessType: 'retail', fullName: 'Rudo Moyo', password: 'password123', billingPeriod: 'yearly' };
  let plans: Record<string, any>;
  let today: string;
  const daysFromToday = (n: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  beforeAll(async () => {
    plans = Object.fromEntries((await http.get('/api/v1/auth/plans').expect(200)).body.map((p: any) => [p.code, p]));
    today = new Date().toISOString().slice(0, 10);
  });

  it('shows the plans on offer to anyone', () => {
    expect(Object.keys(plans)).toEqual(['starter', 'growth', 'enterprise']);
    expect(plans.starter).toMatchObject({ monthlyPrice: '15.00', yearlyPrice: '150.00', maxStores: 1, maxStaff: 3 });
  });

  it('keeps a requested business waiting, and says so at sign-in', async () => {
    const r = await http.post(R).send({ ...base, businessName: 'Waiting Shop', email: 'waiting@example.com', planId: plans.growth.id }).expect(201);
    expect(r.body).toMatchObject({ status: 'pending', businessName: 'Waiting Shop' });
    await http.post(R).send({ ...base, businessName: 'Again', email: 'waiting@example.com', planId: plans.growth.id }).expect(409);
    const login = await http.post('/api/v1/auth/login').send({ email: 'waiting@example.com', password: 'password123' }).expect(403);
    expect(login.body.message).toMatch(/Waiting Shop is waiting for approval/);
    await http.post('/api/v1/auth/login').send({ email: 'waiting@example.com', password: 'wrong-one' }).expect(401);
    const list = await http.get('/api/v1/platform/requests').query({ status: 'pending' }).set(adminT).expect(200);
    const mine = list.body.find((x: any) => x.email === 'waiting@example.com');
    expect(mine).toMatchObject({ planName: 'Growth', billingPeriod: 'yearly', price: '350.00' });
    expect(mine.passwordHash).toBeUndefined();
    const billing = await http.get('/api/v1/platform/billing').set(adminT).expect(200);
    expect(billing.body.pendingRequests).toBeGreaterThanOrEqual(1);
  });

  it('turns a request down with a reason the applicant sees', async () => {
    const r = await http.post(R).send({ ...base, businessName: 'Dodgy Deals', email: 'dodgy@example.com', planId: plans.starter.id }).expect(201);
    await http.post(`/api/v1/platform/requests/${r.body.id}/reject`).set(adminT).send({ reason: 'We could not verify the business' }).expect(201);
    const login = await http.post('/api/v1/auth/login').send({ email: 'dodgy@example.com', password: 'password123' }).expect(403);
    expect(login.body.message).toMatch(/wasn't approved: We could not verify the business/);
    await http.post(`/api/v1/platform/requests/${r.body.id}/approve`).set(adminT).send({}).expect(400);
    // Applicants and businesses can't read requests.
    await http.get('/api/v1/platform/requests').expect(401);
  });

  it('approves with a first payment: the business opens with a paid-up year', async () => {
    const r = await http.post(R).send({ ...base, businessName: 'Starter Shop', email: 'starter@example.com', planId: plans.starter.id }).expect(201);
    const ok = await http
      .post(`/api/v1/platform/requests/${r.body.id}/approve`)
      .set(adminT)
      .send({ payment: { amount: '150', method: 'EcoCash', reference: 'MP2610.1234' } })
      .expect(201);
    expect(ok.body).toMatchObject({ plan: 'Starter', billingPeriod: 'yearly' });
    const t = auth((await http.post('/api/v1/auth/login').send({ email: 'starter@example.com', password: 'password123' }).expect(200)).body.accessToken);
    const sub = await http.get('/api/v1/subscription').set(t).expect(200);
    expect(sub.body).toMatchObject({ state: 'active', billingPeriod: 'yearly', plan: expect.objectContaining({ name: 'Starter' }) });
    expect(sub.body.currentPeriodEnd).toBe(ok.body.currentPeriodEnd);
    expect(sub.body.payments).toEqual([expect.objectContaining({ amount: '150.00', method: 'EcoCash', periodStart: today })]);
  });

  it("enforces the plan's limits", async () => {
    const t = auth((await http.post('/api/v1/auth/login').send({ email: 'starter@example.com', password: 'password123' })).body.accessToken);
    const res = await http.post('/api/v1/stores').set(t).send({ name: 'Branch', code: 'BR' }).expect(403);
    expect(res.body.message).toMatch(/Starter plan allows 1 store/);
  });

  it("won't let a business change its own subscription, even straight in the database", async () => {
    const t = auth((await http.post('/api/v1/auth/login').send({ email: 'starter@example.com', password: 'password123' })).body.accessToken);
    await http.patch('/api/v1/tenant').set(t).send({ subscriptionStatus: 'active' }).expect(400);
    const tenantId = (await http.get('/api/v1/auth/me').set(t)).body.tenant.id;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
      await expect(client.query(`update tenants set current_period_end = '2099-01-01'`)).rejects.toThrow(/Only Floatly can change a subscription/);
      await client.query('rollback');
    } finally {
      client.release();
      await pool.end();
    }
  });

  it('warns during the grace days, then locks the business until it pays', async () => {
    const t = auth((await http.post('/api/v1/auth/login').send({ email: 'starter@example.com', password: 'password123' })).body.accessToken);
    const tenantId = (await http.get('/api/v1/auth/me').set(t)).body.tenant.id;
    const S = `/api/v1/platform/businesses/${tenantId}/subscription`;

    await http.patch(S).set(adminT).send({ currentPeriodEnd: daysFromToday(-3) }).expect(200);
    await http.get('/api/v1/stores').set(t).expect(200);
    expect((await http.get('/api/v1/subscription').set(t)).body.state).toBe('grace');

    await http.patch(S).set(adminT).send({ currentPeriodEnd: daysFromToday(-10) }).expect(200);
    await http.get('/api/v1/stores').set(t).expect(200); // the store list stays open so the app can load
    const locked = await http.get('/api/v1/customers').set(t).expect(402);
    expect(locked.body).toMatchObject({ code: 'subscription_inactive' });
    await http.get('/api/v1/auth/me').set(t).expect(200);
    expect((await http.get('/api/v1/subscription').set(t).expect(200)).body.state).toBe('lapsed');

    // A payment after the end date runs from today.
    const paid = await http.post(`/api/v1/platform/businesses/${tenantId}/payments`).set(adminT).send({ amount: '15', method: 'Cash', billingPeriod: 'monthly' }).expect(201);
    expect(paid.body.periodStart).toBe(today);
    await http.get('/api/v1/stores').set(t).expect(200);
    // …and one before the end date continues straight after it.
    const next = await http.post(`/api/v1/platform/businesses/${tenantId}/payments`).set(adminT).send({ amount: '15', method: 'Cash' }).expect(201);
    expect(next.body.periodStart > paid.body.periodEnd).toBe(true);

    await http.patch(S).set(adminT).send({ status: 'suspended' }).expect(200);
    expect((await http.get('/api/v1/customers').set(t).expect(402)).body.message).toMatch(/suspended/);
    await http.patch(S).set(adminT).send({ status: 'active' }).expect(200);
    await http.get('/api/v1/stores').set(t).expect(200);

    const subs = await http.get(`/api/v1/platform/businesses/${tenantId}/subscription`).set(adminT).expect(200);
    expect(subs.body.payments).toHaveLength(3);
  });

  it('lets Floatly staff change plans and prices', async () => {
    const res = await http.patch(`/api/v1/platform/plans/${plans.starter.id}`).set(adminT).send({ monthlyPrice: '18' }).expect(200);
    expect(res.body.monthlyPrice).toBe('18.00');
    const t = auth((await http.post('/api/v1/auth/login').send({ email: 'starter@example.com', password: 'password123' })).body.accessToken);
    await http.get('/api/v1/platform/plans').set(t).expect(403);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await expect(pool.query(`update plans set monthly_price = 0`)).resolves.toMatchObject({ rowCount: 0 });
    } finally {
      await pool.end();
    }
  });
});

describe('till app', () => {
  let ownerT: Record<string, string>;
  let mainId: string;
  let branchId: string;
  let deviceId: string;
  let deviceToken: string;
  let variantId: string;

  beforeAll(async () => {
    ownerT = auth((await signup('Till Shop', 'tillshop@example.com', 'retail')).accessToken);
    mainId = (await http.get('/api/v1/stores').set(ownerT)).body[0].id;
    branchId = (await http.post('/api/v1/stores').set(ownerT).send({ name: 'Branch', code: 'BR' }).expect(201)).body.id;
    await http
      .post('/api/v1/staff')
      .set(ownerT)
      .send({ email: 'till.cashier@example.com', fullName: 'Rudo Cashier', password: 'password123', role: 'cashier', pin: '4321', storeIds: [mainId] })
      .expect(201);
    await http
      .post('/api/v1/staff')
      .set(ownerT)
      .send({ email: 'till.branch@example.com', fullName: 'Farai Branch', password: 'password123', role: 'cashier', pin: '8765', storeIds: [branchId] })
      .expect(201);
    deviceId = (await http.post('/api/v1/devices').set(ownerT).send({ storeId: mainId, name: 'Front till', code: 't01' }).expect(201)).body.id;
    deviceToken = (await http.post(`/api/v1/devices/${deviceId}/token`).set(ownerT).expect(201)).body.token;
    const product = await http
      .post('/api/v1/products')
      .set(ownerT)
      .send({ name: 'Bread', variants: [{ barcode: '700100', price: '1.20', costPrice: '0.80' }] })
      .expect(201);
    variantId = product.body.variants[0].id;
    await http.put('/api/v1/store-prices').set(ownerT).send({ storeId: mainId, items: [{ variantId, price: '1.30' }] }).expect(200);
  });

  it('signs a cashier in on a paired till with their PIN', async () => {
    const res = await http.post('/api/v1/auth/till').send({ deviceToken, pin: '4321' }).expect(200);
    expect(res.body).toMatchObject({ user: { fullName: 'Rudo Cashier' }, membership: { role: 'cashier' }, device: { id: deviceId, storeId: mainId } });
    await http.get('/api/v1/auth/me').set(auth(res.body.accessToken)).expect(200);
    const devices = await http.get('/api/v1/devices').set(ownerT).expect(200);
    expect(devices.body[0]).toMatchObject({ code: 'T01', registered: true });
    expect(devices.body[0].lastSeenAt).not.toBeNull();
  });

  it('refuses a wrong PIN, an unknown till and staff from another store', async () => {
    await http.post('/api/v1/auth/till').send({ deviceToken, pin: '0000' }).expect(401);
    await http.post('/api/v1/auth/till').send({ deviceToken: 'dev_not-a-real-token-at-all-000000', pin: '4321' }).expect(401);
    await http.post('/api/v1/auth/till').send({ deviceToken: 'nonsense', pin: '4321' }).expect(400);
    await http.post('/api/v1/auth/till').send({ deviceToken, pin: '8765' }).expect(403);
  });

  it("gives the till this store's prices to sell offline, then takes the synced sale once", async () => {
    const t = auth((await http.post('/api/v1/auth/till').send({ deviceToken, pin: '4321' }).expect(200)).body.accessToken);
    const g = await http.post('/api/v1/customer-groups').set(ownerT).send({ name: 'Staff', discountPercent: '5' }).expect(201);
    await http.post('/api/v1/customers').set(ownerT).send({ name: 'Chipo', groupId: g.body.id }).expect(201);

    const catalog = await http.get('/api/v1/till/catalog').query({ storeId: mainId }).set(t).expect(200);
    expect(catalog.body).toMatchObject({ tenant: { name: 'Till Shop', baseCurrency: 'USD' }, store: { id: mainId, code: 'MAIN' } });
    expect(catalog.body.currencies).toEqual([expect.objectContaining({ code: 'USD', isBase: true })]);
    expect(catalog.body.products[0]).toMatchObject({ name: 'Bread', variants: [{ id: variantId, barcode: '700100', price: '1.30' }] });
    expect(catalog.body.products[0].variants[0].costPrice).toBeUndefined();
    expect(catalog.body.customers).toEqual([expect.objectContaining({ name: 'Chipo', discountPercent: '5.00' })]);
    const branch = await http.get('/api/v1/till/catalog').query({ storeId: branchId }).set(ownerT).expect(200);
    expect(branch.body.products[0].variants[0].price).toBe('1.20');

    const sale = {
      storeId: mainId,
      deviceId,
      clientId: '0190a1b2-0000-7000-8000-00000000c0de',
      soldAt: new Date(Date.now() - 60_000).toISOString(),
      lines: [{ variantId, quantity: '2', unitPrice: '1.30', discount: '0' }],
      payments: [{ method: 'cash', amount: '5' }],
    };
    const first = await http.post('/api/v1/sales').set(t).send(sale).expect(201);
    expect(first.body).toMatchObject({ total: '2.60', deviceId });
    const again = await http.post('/api/v1/sales').set(t).send(sale).expect(201);
    expect(again.body.id).toBe(first.body.id);
  });

  it('keeps a till session on its till: no swapping it for an ordinary one', async () => {
    const t = auth((await http.post('/api/v1/auth/till').send({ deviceToken, pin: '4321' }).expect(200)).body.accessToken);
    const me = await http.get('/api/v1/auth/me').set(t).expect(200);
    await http.post('/api/v1/auth/switch-tenant').set(t).send({ tenantId: me.body.tenant.id }).expect(403);
  });

  it('ends a signed-in till session as soon as the till is set up on another device', async () => {
    const t = auth((await http.post('/api/v1/auth/till').send({ deviceToken, pin: '4321' }).expect(200)).body.accessToken);
    await http.get('/api/v1/till/catalog').query({ storeId: mainId }).set(t).expect(200);
    deviceToken = (await http.post(`/api/v1/devices/${deviceId}/token`).set(ownerT).expect(201)).body.token;
    const res = await http.get('/api/v1/till/catalog').query({ storeId: mainId }).set(t).expect(401);
    expect(res.body.code).toBe('device_revoked');
  });

  it('ends signed-in till sessions and stops sign-ins once the till is switched off', async () => {
    const t = auth((await http.post('/api/v1/auth/till').send({ deviceToken, pin: '4321' }).expect(200)).body.accessToken);
    await http.patch(`/api/v1/devices/${deviceId}`).set(ownerT).send({ active: false }).expect(200);
    expect((await http.get('/api/v1/auth/me').set(t).expect(401)).body.code).toBe('device_revoked');
    expect((await http.post('/api/v1/auth/till').send({ deviceToken, pin: '4321' }).expect(401)).body.code).toBe('device_revoked');
    // The backoffice sign-in of the same business is untouched.
    await http.get('/api/v1/devices').set(ownerT).expect(200);
  });
});

describe('packs and choices', () => {
  let t: Record<string, string>;
  let storeId: string;
  let coke: { variant: string; caseId: string; sixId: string };
  let cheese: string;
  let burger: string;
  let side: { chips: string; salad: string };
  let extra: { cheese: string; noOnion: string };
  const S = '/api/v1/sales';
  const onHand = async (variantId: string) =>
    (await http.get('/api/v1/inventory/levels').query({ storeId, pageSize: 200 }).set(t)).body.items.find((i: any) => i.variantId === variantId)?.onHand;

  beforeAll(async () => {
    t = auth((await signup('Pack Shop', 'packshop@example.com', 'mixed')).accessToken);
    storeId = (await http.get('/api/v1/stores').set(t)).body[0].id;
    const c = await http
      .post('/api/v1/products')
      .set(t)
      .send({
        name: 'Coke 300ml',
        variants: [
          {
            barcode: '600300',
            price: '1.00',
            costPrice: '0.60',
            packagings: [
              { name: 'Case of 24', quantity: 24, barcode: 'CASE24', price: '20.00' },
              { name: 'Six pack', quantity: 6, barcode: 'SIX6' },
            ],
          },
        ],
      })
      .expect(201);
    const packs = c.body.variants[0].packagings;
    coke = { variant: c.body.variants[0].id, caseId: packs.find((p: any) => p.quantity === '24.000').id, sixId: packs.find((p: any) => p.quantity === '6.000').id };
    cheese = (await http.post('/api/v1/products').set(t).send({ name: 'Cheese slice', variants: [{ price: 0, costPrice: '0.30' }] }).expect(201)).body.variants[0].id;
    await http
      .post('/api/v1/inventory/movements')
      .set(t)
      .send({ storeId, type: 'receive', lines: [{ variantId: coke.variant, quantity: 100 }, { variantId: cheese, quantity: 20 }] })
      .expect(201);

    const sides = await http
      .post('/api/v1/modifier-groups')
      .set(t)
      .send({ name: 'Side', minSelect: 1, maxSelect: 1, modifiers: [{ name: 'Chips' }, { name: 'Salad', priceDelta: '0.50' }] })
      .expect(201);
    const extras = await http
      .post('/api/v1/modifier-groups')
      .set(t)
      .send({ name: 'Extras', minSelect: 0, maxSelect: 2, modifiers: [{ name: 'Cheese', priceDelta: '1.00', variantId: cheese }, { name: 'No onion' }] })
      .expect(201);
    const id = (g: any, name: string) => g.body.modifiers.find((m: any) => m.name === name).id;
    side = { chips: id(sides, 'Chips'), salad: id(sides, 'Salad') };
    extra = { cheese: id(extras, 'Cheese'), noOnion: id(extras, 'No onion') };
    burger = (
      await http
        .post('/api/v1/products')
        .set(t)
        .send({ name: 'Burger', kind: 'menu_item', kitchenStation: 'grill', modifierGroupIds: [sides.body.id, extras.body.id], variants: [{ price: '6.50' }] })
        .expect(201)
    ).body.variants[0].id;
  });

  it('sells cases at the case price, taking every unit out of stock', async () => {
    const sale = await http
      .post(S)
      .set(t)
      .send({ storeId, lines: [{ variantId: coke.variant, packagingId: coke.caseId, quantity: 2 }], payments: [{ method: 'cash', amount: '40' }] })
      .expect(201);
    expect(sale.body).toMatchObject({ total: '40.00', costBase: '28.80' });
    expect(sale.body.lines[0]).toMatchObject({ packName: 'Case of 24', unitsPerPack: '24.000', quantity: '2.000', unitPrice: '20.00' });
    expect(await onHand(coke.variant)).toBe('52.000');

    // A pack without its own price is the unit price times the units in it.
    const six = await http
      .post(S)
      .set(t)
      .send({ storeId, lines: [{ variantId: coke.variant, packagingId: coke.sixId, quantity: 1 }], payments: [{ method: 'cash', amount: '6' }] })
      .expect(201);
    expect(six.body.total).toBe('6.00');
    expect(await onHand(coke.variant)).toBe('46.000');

    // A refunded case goes back as 24 units, at the cost it was sold at.
    const ret = await http
      .post(`${S}/${sale.body.id}/returns`)
      .set(t)
      .send({ lines: [{ lineId: sale.body.lines[0].id, quantity: 1 }], method: 'cash', reason: 'Too many' })
      .expect(201);
    expect(ret.body).toMatchObject({ total: '20.00', costBase: '14.40' });
    expect(await onHand(coke.variant)).toBe('70.000');

    const today = (await http.get('/api/v1/accounting/periods').set(t)).body.today;
    const report = await http.get(`${S}/reports/profitability`).query({ from: today, to: today, by: 'item' }).set(t).expect(200);
    expect(report.body.rows.find((r: any) => r.id === coke.variant).quantity).toBe('30.000');
  });

  it("refuses another item's pack, and choices on a pack", async () => {
    await http.post(S).set(t).send({ storeId, lines: [{ variantId: cheese, packagingId: coke.caseId, quantity: 1 }], payments: [{ method: 'cash', amount: '20' }] }).expect(400);
    await http
      .post(S)
      .set(t)
      .send({ storeId, lines: [{ variantId: coke.variant, packagingId: coke.caseId, modifierIds: [side.chips], quantity: 1 }], payments: [{ method: 'cash', amount: '20' }] })
      .expect(400);
  });

  it('adds the price of choices, uses up their stock and puts them on the kitchen ticket', async () => {
    const sale = await http
      .post(S)
      .set(t)
      .send({ storeId, lines: [{ variantId: burger, modifierIds: [side.salad, extra.cheese, extra.noOnion], quantity: 2 }], payments: [{ method: 'cash', amount: '20' }] })
      .expect(201);
    expect(sale.body.total).toBe('16.00');
    expect(sale.body.costBase).toBe('0.60');
    expect(sale.body.lines[0].modifiers.map((m: any) => `${m.groupName}: ${m.name}`)).toEqual(['Side: Salad', 'Extras: Cheese', 'Extras: No onion']);
    expect(await onHand(cheese)).toBe('18.000');
    const kitchen = await http.get(`${S}/kitchen`).set(t).expect(200);
    expect(kitchen.body.tickets.find((k: any) => k.saleId === sale.body.id).lines[0].choices).toEqual(['Salad', 'Cheese', 'No onion']);

    // Refunded with restocking: the cheese goes back.
    await http
      .post(`${S}/${sale.body.id}/returns`)
      .set(t)
      .send({ lines: [{ lineId: sale.body.lines[0].id, quantity: 1 }], method: 'cash', reason: 'Wrong order' })
      .expect(201);
    expect(await onHand(cheese)).toBe('19.000');
  });

  it('checks the choices: required ones answered, no more than allowed, only ones offered', async () => {
    const sell = (modifierIds: string[] | undefined, variantId = burger) =>
      http.post(S).set(t).send({ storeId, lines: [{ variantId, modifierIds, quantity: 1 }], payments: [{ method: 'cash', amount: '20' }] });
    expect((await sell([extra.cheese]).expect(400)).body.message).toContain('Choose one for "Side"');
    await sell([side.chips, side.salad]).expect(400);
    await sell([side.chips], coke.variant).expect(400);
    // Left out entirely (an import, say): sold without choices.
    expect((await sell(undefined).expect(201)).body.total).toBe('6.50');
  });

  it('gives the till each pack at its price and each item its choices', async () => {
    const catalog = await http.get('/api/v1/till/catalog').query({ storeId }).set(t).expect(200);
    const c = catalog.body.products.find((p: any) => p.name === 'Coke 300ml');
    expect(c.variants[0].packagings.map((p: any) => [p.name, p.barcode, p.price])).toEqual([
      ['Six pack', 'SIX6', '6.00'],
      ['Case of 24', 'CASE24', '20.00'],
    ]);
    const b = catalog.body.products.find((p: any) => p.name === 'Burger');
    expect(b.modifierGroups.map((g: any) => [g.name, g.minSelect, g.maxSelect, g.modifiers.map((m: any) => `${m.name} ${m.priceDelta}`)])).toEqual([
      ['Side', 1, 1, ['Chips 0.00', 'Salad 0.50']],
      ['Extras', 0, 2, ['Cheese 1.00', 'No onion 0.00']],
    ]);
  });
});

describe('wholesale and retail prices', () => {
  let t: Record<string, string>;
  let storeId: string;
  let retailId: string;
  let wholesaleId: string;
  let sugar: string;
  let boxId: string;
  const S = '/api/v1/sales';
  const sell = (body: object) => http.post(S).set(t).send({ storeId, payments: [{ method: 'cash', amount: '1000' }], ...body });

  beforeAll(async () => {
    t = auth((await signup('Price Shop', 'priceshop@example.com', 'mixed')).accessToken);
    storeId = (await http.get('/api/v1/stores').set(t)).body[0].id;
    const lists = (await http.get('/api/v1/price-lists').set(t).expect(200)).body;
    retailId = lists.find((l: any) => l.name === 'Retail').id;
    wholesaleId = lists.find((l: any) => l.name === 'Wholesale').id;
    const p = await http
      .post('/api/v1/products')
      .set(t)
      .send({
        name: 'Sugar 2kg',
        variants: [
          {
            barcode: '800200',
            price: '1.20',
            costPrice: '0.70',
            listPrices: [{ priceListId: wholesaleId, price: '1.00' }],
            packagings: [{ name: 'Bale of 10', quantity: 10, barcode: 'BALE10' }],
          },
        ],
      })
      .expect(201);
    sugar = p.body.variants[0].id;
    boxId = p.body.variants[0].packagings[0].id;
    expect(p.body.variants[0].listPrices).toEqual([{ priceListId: wholesaleId, minQuantity: '1.000', price: '1.00' }]);
    await http.post('/api/v1/inventory/movements').set(t).send({ storeId, type: 'receive', lines: [{ variantId: sugar, quantity: 500 }] }).expect(201);
  });

  it('keeps quantity breaks when the product form changes the wholesale price', async () => {
    await http
      .put(`/api/v1/price-lists/${wholesaleId}/items`)
      .set(t)
      .send({ items: [{ variantId: sugar, price: '1.00' }, { variantId: sugar, minQuantity: 50, price: '0.90' }] })
      .expect(200);
    const product = (await http.get('/api/v1/products').query({ search: 'Sugar' }).set(t)).body.items[0];
    await http
      .patch(`/api/v1/products/${product.id}`)
      .set(t)
      .send({ variants: [{ id: sugar, price: '1.20', listPrices: [{ priceListId: wholesaleId, price: '0.95' }] }] })
      .expect(200);
    const again = await http.get(`/api/v1/products/${product.id}`).set(t).expect(200);
    expect(again.body.variants[0].listPrices.map((l: any) => [l.minQuantity, l.price])).toEqual([
      ['1.000', '0.95'],
      ['50.000', '0.90'],
    ]);
  });

  it('sells at the retail price unless the sale is priced wholesale', async () => {
    expect((await sell({ lines: [{ variantId: sugar, quantity: 2 }] }).expect(201)).body).toMatchObject({ total: '2.40', priceListId: null });
    const wholesale = await sell({ priceListId: wholesaleId, lines: [{ variantId: sugar, quantity: 2 }] }).expect(201);
    expect(wholesale.body).toMatchObject({ total: '1.90', priceListId: wholesaleId });
    // From 50 the cheaper break applies.
    expect((await sell({ priceListId: wholesaleId, lines: [{ variantId: sugar, quantity: 60 }] }).expect(201)).body.total).toBe('54.00');
    // A bale without its own price is ten of the wholesale unit price.
    expect((await sell({ priceListId: wholesaleId, lines: [{ variantId: sugar, packagingId: boxId, quantity: 1 }] }).expect(201)).body.total).toBe('9.50');
    const preview = await http.post(`${S}/preview`).set(t).send({ storeId, priceListId: wholesaleId, lines: [{ variantId: sugar, quantity: 1 }] }).expect(200);
    expect(preview.body).toMatchObject({ priceListId: wholesaleId, total: '0.95' });
  });

  it("uses a wholesale customer's prices without being asked, unless the sale says otherwise", async () => {
    const trader = await http.post('/api/v1/customers').set(t).send({ name: 'Moyo Traders', priceListId: wholesaleId }).expect(201);
    expect((await sell({ customerId: trader.body.id, lines: [{ variantId: sugar, quantity: 2 }] }).expect(201)).body).toMatchObject({ total: '1.90', priceListId: wholesaleId });
    // Asked for retail (a list with no price for it): the normal price.
    expect((await sell({ customerId: trader.body.id, priceListId: retailId, lines: [{ variantId: sugar, quantity: 2 }] }).expect(201)).body.total).toBe('2.40');

    const group = await http.post('/api/v1/customer-groups').set(t).send({ name: 'Tuckshops', priceListId: wholesaleId }).expect(201);
    const shop = await http.post('/api/v1/customers').set(t).send({ name: 'Mai Rudo Tuckshop', groupId: group.body.id }).expect(201);
    expect((await sell({ customerId: shop.body.id, lines: [{ variantId: sugar, quantity: 2 }] }).expect(201)).body.total).toBe('1.90');

    const catalog = await http.get('/api/v1/till/catalog').query({ storeId }).set(t).expect(200);
    expect(catalog.body.priceLists.map((l: any) => [l.name, l.isDefault])).toEqual([
      ['Retail', true],
      ['Wholesale', false],
    ]);
    const v = catalog.body.products.find((p: any) => p.name === 'Sugar 2kg').variants[0];
    expect(v.listPrices.map((l: any) => [l.minQuantity, l.price])).toEqual([
      ['1.000', '0.95'],
      ['50.000', '0.90'],
    ]);
    expect(v.packagings[0]).toMatchObject({ ownPrice: false, price: '12.00' });
    expect(catalog.body.customers.find((c: any) => c.name === 'Mai Rudo Tuckshop').priceListId).toBe(wholesaleId);
  });

  it('gives a bale its own retail and wholesale price', async () => {
    const product = (await http.get('/api/v1/products').query({ search: 'Sugar' }).set(t)).body.items[0];
    const saved = await http
      .patch(`/api/v1/products/${product.id}`)
      .set(t)
      .send({
        variants: [
          {
            id: sugar,
            price: '1.20',
            packagings: [{ name: 'Bale of 10', quantity: 10, barcode: 'BALE10', price: '11.50', listPrices: [{ priceListId: wholesaleId, price: '9.00' }] }],
          },
        ],
      })
      .expect(200);
    const bale = saved.body.variants[0].packagings[0];
    expect(bale.listPrices).toEqual([{ priceListId: wholesaleId, minQuantity: '1.000', price: '9.00' }]);
    // The single item keeps its own wholesale prices.
    expect(saved.body.variants[0].listPrices.map((l: any) => l.price)).toEqual(['0.95', '0.90']);

    const retail = await sell({ lines: [{ variantId: sugar, packagingId: bale.id, quantity: 2 }] }).expect(201);
    expect(retail.body.total).toBe('23.00');
    const wholesale = await sell({ priceListId: wholesaleId, lines: [{ variantId: sugar, packagingId: bale.id, quantity: 2 }] }).expect(201);
    expect(wholesale.body.total).toBe('18.00');

    const catalog = await http.get('/api/v1/till/catalog').query({ storeId }).set(t).expect(200);
    const pack = catalog.body.products.find((p: any) => p.name === 'Sugar 2kg').variants[0].packagings[0];
    expect(pack).toMatchObject({ price: '11.50', ownPrice: true, listPrices: [{ priceListId: wholesaleId, minQuantity: '1.000', price: '9.00' }] });
    // The price list page lists single items only, and editing it leaves the bale's price alone.
    const items = await http.get(`/api/v1/price-lists/${wholesaleId}/items`).set(t).expect(200);
    expect(items.body.every((i: any) => i.packagingId === null)).toBe(true);
    await http.put(`/api/v1/price-lists/${wholesaleId}/items`).set(t).send({ items: [{ variantId: sugar, price: '0.95' }] }).expect(200);
    expect((await sell({ priceListId: wholesaleId, lines: [{ variantId: sugar, packagingId: bale.id, quantity: 1 }] }).expect(201)).body.total).toBe('9.00');
  });

  it('refuses a switched-off price list', async () => {
    await http.patch(`/api/v1/price-lists/${wholesaleId}`).set(t).send({ active: false }).expect(200);
    await sell({ priceListId: wholesaleId, lines: [{ variantId: sugar, quantity: 1 }] }).expect(400);
    await http.patch(`/api/v1/price-lists/${wholesaleId}`).set(t).send({ active: true }).expect(200);
  });
});

describe('permissions and the audit trail', () => {
  let ownerT: Record<string, string>;
  let adminT2: Record<string, string>;
  let cashierT: Record<string, string>;
  let adminId: string;
  let ownerMembershipId: string;
  let storeId: string;
  let productId: string;
  let variantId: string;
  let saleId: string;
  let lineId: string;
  let today: string;
  const mobile = { 'X-Floatly-Client': 'mobile/1.0.0' };

  const staff = async (email: string, role: string) => {
    const res = await http.post('/api/v1/staff').set(ownerT).send({ email, fullName: `Perm ${role}`, password: 'password123', role }).expect(201);
    const login = await http.post('/api/v1/auth/login').send({ email, password: 'password123' }).expect(200);
    return { id: res.body.id as string, t: auth(login.body.accessToken) };
  };
  const move = (t: Record<string, string>, type = 'adjustment') =>
    http.post('/api/v1/inventory/movements').set(t).set(mobile).send({ storeId, type, note: 'Counted again', lines: [{ variantId, quantity: 1 }] });
  const setPrice = (t: Record<string, string>, price: string) =>
    http.patch(`/api/v1/products/${productId}`).set(t).set(mobile).send({ variants: [{ id: variantId, price }] });

  beforeAll(async () => {
    const o = await signup('Permission Shop', 'perms@example.com');
    ownerT = auth(o.accessToken);
    ownerMembershipId = o.membership.id;
    storeId = (await http.get('/api/v1/stores').set(ownerT)).body[0].id;
    today = (await http.get('/api/v1/accounting/periods').set(ownerT)).body.today;
    const p = await http.post('/api/v1/products').set(ownerT).send({ name: 'Rice 2kg', variants: [{ price: '4.00', costPrice: '3.00' }] }).expect(201);
    productId = p.body.id;
    variantId = p.body.variants[0].id;
    await http.post('/api/v1/inventory/movements').set(ownerT).send({ storeId, type: 'receive', lines: [{ variantId, quantity: 20 }] }).expect(201);
    const sale = await http.post('/api/v1/sales').set(ownerT).send({ storeId, lines: [{ variantId, quantity: 2 }], payments: [{ method: 'cash', amount: '8' }] }).expect(201);
    saleId = sale.body.id;
    lineId = sale.body.lines[0].id;
    const admin = await staff('perm-admin@example.com', 'admin');
    adminId = admin.id;
    adminT2 = admin.t;
    cashierT = (await staff('perm-cashier@example.com', 'cashier')).t;
  });

  it('tells each person what they may do when they sign in', async () => {
    const owner = await http.get('/api/v1/auth/me').set(ownerT).expect(200);
    expect(owner.body.membership.permissions).toEqual(expect.arrayContaining(['inventory.adjust', 'returns.approve', 'audit.view', 'products.price']));
    const cashier = await http.get('/api/v1/auth/me').set(cashierT).expect(200);
    expect(cashier.body.membership.permissions).toEqual(expect.arrayContaining(['sales.view', 'customers.edit']));
    for (const p of ['inventory.adjust', 'damaged.record', 'products.price', 'products.edit', 'returns.create', 'returns.approve', 'sales.void', 'reports.view', 'audit.view', 'dashboard.view']) {
      expect(cashier.body.membership.permissions).not.toContain(p);
    }
  });

  it('rejects a cashier on every admin endpoint', async () => {
    await move(cashierT).expect(403);
    await move(cashierT, 'waste').expect(403);
    await http.post('/api/v1/inventory/transfers').set(cashierT).send({ fromStoreId: storeId, toStoreId: storeId, lines: [{ variantId, quantity: 1 }] }).expect(403);
    await http.post('/api/v1/inventory/stock-takes').set(cashierT).send({ storeId, lines: [{ variantId, countedQuantity: 1 }] }).expect(403);
    await setPrice(cashierT, '1.00').expect(403);
    await http.post('/api/v1/products').set(cashierT).send({ name: 'X', variants: [{ price: 1 }] }).expect(403);
    await http.delete(`/api/v1/products/${productId}`).set(cashierT).expect(403);
    await http.put('/api/v1/store-prices').set(cashierT).send({ storeId, items: [{ variantId, price: '1.00' }] }).expect(403);
    await http.post(`/api/v1/sales/${saleId}/returns`).set(cashierT).send({ lines: [{ lineId, quantity: 1 }], method: 'cash', reason: 'x' }).expect(403);
    await http.post(`/api/v1/sales/${saleId}/void`).set(cashierT).expect(403);
    await http.post('/api/v1/suppliers').set(cashierT).send({ name: 'Nobody Ltd' }).expect(403);
    await http.get('/api/v1/sales/reports/daily').query({ from: today, to: today }).set(cashierT).expect(403);
    await http.get('/api/v1/inventory/reports/valuation').set(cashierT).expect(403);
    await http.get('/api/v1/audit-logs').set(cashierT).expect(403);
    await http.get('/api/v1/staff').set(cashierT).expect(403);
    await http.patch(`/api/v1/staff/${adminId}`).set(cashierT).send({ deniedPermissions: [] }).expect(403);
    // Nothing changed.
    const product = await http.get(`/api/v1/products/${productId}`).set(ownerT).expect(200);
    expect(product.body.variants[0].price).toBe('4.00');
  });

  it('lets an admin do all of it', async () => {
    await move(adminT2).expect(201);
    await move(adminT2, 'waste').expect(201);
    await setPrice(adminT2, '4.50').expect(200);
    await http.get('/api/v1/sales/reports/daily').query({ from: today, to: today }).set(adminT2).expect(200);
    await http.get('/api/v1/audit-logs').set(adminT2).expect(200);
  });

  it('lets only an owner take permissions away, and never from an owner', async () => {
    const catalog = await http.get('/api/v1/staff/permissions').set(adminT2).expect(200);
    expect(catalog.body.find((p: any) => p.key === 'inventory.adjust')).toMatchObject({ group: 'Stock', roles: expect.arrayContaining(['stock_clerk']) });
    await http.patch(`/api/v1/staff/${adminId}`).set(adminT2).send({ deniedPermissions: [] }).expect(403);
    await http.patch(`/api/v1/staff/${adminId}`).set(ownerT).send({ deniedPermissions: ['not.a.permission'] }).expect(400);
    await http.patch(`/api/v1/staff/${ownerMembershipId}`).set(ownerT).send({ deniedPermissions: ['audit.view'] }).expect(400);
    const res = await http.patch(`/api/v1/staff/${adminId}`).set(ownerT).send({ deniedPermissions: ['inventory.adjust', 'products.price', 'audit.view'] }).expect(200);
    expect(res.body.deniedPermissions).toEqual(['inventory.adjust', 'products.price', 'audit.view']);
    expect(res.body.permissions).not.toContain('inventory.adjust');
    expect(res.body.permissions).toContain('damaged.record');
  });

  it('applies a removed permission at once, and leaves the rest', async () => {
    await move(adminT2).expect(403);
    await move(adminT2, 'waste').expect(201); // damaged stock is its own permission
    await setPrice(adminT2, '9.99').expect(403);
    await setPrice(adminT2, '4.50').expect(200); // same price: nothing to refuse
    await http.patch(`/api/v1/products/${productId}`).set(adminT2).send({ name: 'Rice 2kg bag' }).expect(200);
    await http.put('/api/v1/store-prices').set(adminT2).send({ storeId, items: [{ variantId, price: '9.99' }] }).expect(403);
    await http.get('/api/v1/audit-logs').set(adminT2).expect(403);
    const me = await http.get('/api/v1/auth/me').set(adminT2).expect(200);
    expect(me.body.membership.permissions).not.toContain('products.price');
    // Given back.
    await http.patch(`/api/v1/staff/${adminId}`).set(ownerT).send({ deniedPermissions: [] }).expect(200);
    await move(adminT2).expect(201);
  });

  it('records who, their role, the app, the store and the value before and after', async () => {
    const prices = await http.get('/api/v1/audit-logs').query({ action: 'price_change' }).set(ownerT).expect(200);
    expect(prices.body).toHaveLength(1);
    expect(prices.body[0]).toMatchObject({
      entity: 'Product',
      entityId: productId,
      role: 'admin',
      platform: 'mobile',
      userName: 'Perm admin',
      oldValue: { [variantId]: '4.00' },
      newValue: { [variantId]: '4.50' },
    });

    const adjustments = await http.get('/api/v1/audit-logs').query({ action: 'stock_adjustment', platform: 'mobile' }).set(ownerT).expect(200);
    expect(adjustments.body).toHaveLength(2);
    // Newest first. 20 received, 2 sold, +1, 1 wasted, 1 wasted: 17 before the last adjustment.
    expect(adjustments.body[0]).toMatchObject({ role: 'admin', platform: 'mobile', storeId, storeName: 'Main Store', oldValue: { [variantId]: '17.000' }, newValue: { [variantId]: '18.000' } });
    expect(adjustments.body[0].data).toMatchObject({ reason: 'Counted again' });

    const waste = await http.get('/api/v1/audit-logs').query({ action: 'stock_waste', storeId }).set(ownerT).expect(200);
    expect(waste.body).toHaveLength(2);

    const perms = await http.get('/api/v1/audit-logs').query({ entity: 'Staff', action: 'update' }).set(ownerT).expect(200);
    expect(perms.body.find((r: any) => r.newValue?.deniedPermissions?.length === 3)).toMatchObject({ role: 'owner', entityId: adminId });
  });

  it('refunds with the store and the reason in the trail', async () => {
    await http.post(`/api/v1/sales/${saleId}/returns`).set(adminT2).set(mobile).send({ lines: [{ lineId, quantity: 1 }], method: 'cash', reason: 'Torn bag' }).expect(201);
    const res = await http.get('/api/v1/audit-logs').query({ entity: 'Sale return' }).set(ownerT).expect(200);
    expect(res.body[0]).toMatchObject({ action: 'create', role: 'admin', platform: 'mobile', storeId });
    expect(res.body[0].data).toMatchObject({ reason: 'Torn bag' });
  });
});

describe('phone sign-in, lockout and PIN confirmation', () => {
  let ownerT: Record<string, string>;
  let storeId: string;
  let productId: string;
  let variantId: string;
  let saleId: string;
  let lineId: string;
  const L = '/api/v1/auth/login';
  const R = '/api/v1/auth/refresh';
  const pin = (p: string) => ({ 'X-Floatly-Pin': p });

  const phone = async (email: string) => (await http.post(L).send({ email, password: 'password123', session: 'mobile' }).expect(200)).body;
  const setPrice = (t: Record<string, string>, price: string) => http.patch(`/api/v1/products/${productId}`).set(t).send({ variants: [{ id: variantId, price }] });
  const sql = async (text: string, values: unknown[] = []) => {
    const db = ownerDb();
    try {
      return await db.query(text, values);
    } finally {
      await db.end();
    }
  };

  beforeAll(async () => {
    const o = await signup('Phone Shop', 'phone@example.com');
    ownerT = auth(o.accessToken);
    storeId = (await http.get('/api/v1/stores').set(ownerT)).body[0].id;
    const p = await http.post('/api/v1/products').set(ownerT).send({ name: 'Flour 2kg', variants: [{ price: '2.00', costPrice: '1.50' }] }).expect(201);
    productId = p.body.id;
    variantId = p.body.variants[0].id;
    await http.post('/api/v1/inventory/movements').set(ownerT).send({ storeId, type: 'receive', lines: [{ variantId, quantity: 10 }] }).expect(201);
    const sale = await http.post('/api/v1/sales').set(ownerT).send({ storeId, lines: [{ variantId, quantity: 2 }], payments: [{ method: 'cash', amount: '4' }] }).expect(201);
    saleId = sale.body.id;
    lineId = sale.body.lines[0].id;
    await http.post('/api/v1/staff').set(ownerT).send({ email: 'phone-admin@example.com', fullName: 'Phone Admin', password: 'password123', role: 'admin', pin: '4321' }).expect(201);
  });

  it('gives everyone a short staff ID, numbered per role', async () => {
    const me = await http.get('/api/v1/auth/me').set(ownerT).expect(200);
    expect(me.body.membership).toMatchObject({ staffCode: 'OWN-001', hasPin: false });
    const second = await http.post('/api/v1/staff').set(ownerT).send({ email: 'phone-admin2@example.com', fullName: 'Second Admin', password: 'password123', role: 'admin' }).expect(201);
    expect(second.body.staffCode).toBe('ADM-002');
    const list = await http.get('/api/v1/staff').set(ownerT).expect(200);
    expect(list.body.map((s: any) => s.staffCode).sort()).toEqual(['ADM-001', 'ADM-002', 'OWN-001']);
    // The ID stays when the role changes.
    const moved = await http.patch(`/api/v1/staff/${second.body.id}`).set(ownerT).send({ role: 'manager' }).expect(200);
    expect(moved.body.staffCode).toBe('ADM-002');
  });

  it('signs a phone in with a refresh token, and the backoffice without one', async () => {
    const web = await http.post(L).send({ email: 'phone-admin@example.com', password: 'password123' }).expect(200);
    expect(web.body.refreshToken).toBeUndefined();
    const s = await phone('phone-admin@example.com');
    expect(s.refreshToken).toMatch(/^rt_/);
    expect(s.expiresIn).toBe(900);
    expect(s.membership).toMatchObject({ role: 'admin', staffCode: 'ADM-001', hasPin: true });
    await http.get('/api/v1/auth/me').set(auth(s.accessToken)).expect(200);
    // Only its hash is kept.
    const stored = await sql('SELECT token_hash FROM refresh_tokens');
    expect(stored.rows.some((r: any) => r.token_hash === s.refreshToken)).toBe(false);
  });

  it('swaps the refresh token each time, forgiving a quick repeat', async () => {
    const s = await phone('phone-admin@example.com');
    const next = await http.post(R).send({ refreshToken: s.refreshToken }).expect(200);
    expect(next.body.refreshToken).toMatch(/^rt_/);
    expect(next.body.refreshToken).not.toBe(s.refreshToken);
    await http.get('/api/v1/products').set(auth(next.body.accessToken)).expect(200);
    // The phone missed the answer and asks again straight away.
    await http.post(R).send({ refreshToken: s.refreshToken }).expect(200);
    await http.post(R).send({ refreshToken: 'rt_' + 'x'.repeat(43) }).expect(401);
    await http.post(R).send({ refreshToken: 'nonsense' }).expect(400);
  });

  it('ends the whole sign-in when an old refresh token turns up later', async () => {
    const s = await phone('phone-admin@example.com');
    const next = await http.post(R).send({ refreshToken: s.refreshToken }).expect(200);
    await sql(`UPDATE refresh_tokens SET used_at = now() - interval '5 minutes' WHERE used_at IS NOT NULL`);
    await http.post(R).send({ refreshToken: s.refreshToken }).expect(401); // the copy
    await http.post(R).send({ refreshToken: next.body.refreshToken }).expect(401); // and the real phone must sign in again
  });

  it('ends a sign-in on logout, when it goes unused, or when the person loses access', async () => {
    const a = await phone('phone-admin@example.com');
    await http.post('/api/v1/auth/logout').send({ refreshToken: a.refreshToken }).expect(200);
    await http.post(R).send({ refreshToken: a.refreshToken }).expect(401);

    const b = await phone('phone-admin@example.com');
    await sql(`UPDATE refresh_tokens SET expires_at = now() - interval '1 minute' WHERE revoked_at IS NULL AND used_at IS NULL`);
    await http.post(R).send({ refreshToken: b.refreshToken }).expect(401);

    const c = await phone('phone-admin2@example.com');
    const staff = await http.get('/api/v1/staff').set(ownerT).expect(200);
    const id = staff.body.find((m: any) => m.email === 'phone-admin2@example.com').id;
    await http.patch(`/api/v1/staff/${id}`).set(ownerT).send({ active: false }).expect(200);
    await http.post(R).send({ refreshToken: c.refreshToken }).expect(401);
  });

  it("won't refresh into a business the person doesn't belong to", async () => {
    const other = await signup('Someone Else', 'someone-else@example.com');
    const s = await phone('phone-admin@example.com');
    await http.post(R).send({ refreshToken: s.refreshToken, tenantId: other.tenant.id }).expect(401);
    await http.post('/api/v1/auth/switch-tenant').set(auth(s.accessToken)).send({ tenantId: other.tenant.id }).expect(403);
  });

  it('asks for the PIN again before a price change or refund from a phone', async () => {
    const s = await phone('phone-admin@example.com');
    const t = auth(s.accessToken);
    const none = await setPrice(t, '2.10').expect(403);
    expect(none.body.code).toBe('pin_required');
    const wrong = await setPrice(t, '2.10').set(pin('0000')).expect(403);
    expect(wrong.body.code).toBe('wrong_pin');
    await setPrice(t, '2.10').set(pin('4321')).expect(200);
    // Other edits don't need it.
    await http.patch(`/api/v1/products/${productId}`).set(t).send({ name: 'Flour 2kg bag' }).expect(200);
    await http.put('/api/v1/store-prices').set(t).send({ storeId, items: [{ variantId, price: '2.20' }] }).expect(403);
    await http.put('/api/v1/store-prices').set(t).set(pin('4321')).send({ storeId, items: [{ variantId, price: null }] }).expect(200);

    const refund = { lines: [{ lineId, quantity: 1 }], method: 'cash', reason: 'Weevils' };
    expect((await http.post(`/api/v1/sales/${saleId}/returns`).set(t).send(refund).expect(403)).body.code).toBe('pin_required');
    const ret = await http.post(`/api/v1/sales/${saleId}/returns`).set(t).set(pin('4321')).send(refund).expect(201);
    await http.post(`/api/v1/sales/${ret.body.id}/void`).set(t).expect(403);
    await http.post(`/api/v1/sales/${ret.body.id}/void`).set(t).set(pin('4321')).expect(201);

    await http.post('/api/v1/auth/verify-pin').set(t).set(pin('4321')).expect(200);
    await http.post('/api/v1/auth/verify-pin').set(t).expect(400);

    // The audit trail says it was a phone, without being told.
    const trail = await http.get('/api/v1/audit-logs').query({ action: 'price_change' }).set(ownerT).expect(200);
    expect(trail.body[0]).toMatchObject({ platform: 'mobile', role: 'admin', oldValue: { [variantId]: '2.00' }, newValue: { [variantId]: '2.10' } });
  });

  it("doesn't ask the backoffice for a PIN", async () => {
    const web = await http.post(L).send({ email: 'phone-admin@example.com', password: 'password123' }).expect(200);
    await setPrice(auth(web.body.accessToken), '2.30').expect(200);
  });

  it('lets someone choose their own PIN with their password', async () => {
    const s = await phone('phone@example.com');
    const t = auth(s.accessToken);
    expect((await setPrice(t, '2.40').expect(403)).body.code).toBe('pin_not_set');
    expect((await http.post('/api/v1/auth/verify-pin').set(t).set(pin('1111')).expect(403)).body.code).toBe('pin_not_set');
    await http.post('/api/v1/auth/pin').set(t).send({ password: 'wrong-password', pin: '9876' }).expect(400);
    await http.post('/api/v1/auth/pin').set(t).send({ password: 'password123', pin: '4321' }).expect(409); // the admin's
    await http.post('/api/v1/auth/pin').set(t).send({ password: 'password123', pin: '98' }).expect(400);
    await http.post('/api/v1/auth/pin').set(t).send({ password: 'password123', pin: '9876' }).expect(200);
    await setPrice(t, '2.40').set(pin('9876')).expect(200);
    expect((await http.get('/api/v1/auth/me').set(t).expect(200)).body.membership.hasPin).toBe(true);
  });

  it('locks an account after five wrong passwords, even for the right one', async () => {
    await http.post('/api/v1/staff').set(ownerT).send({ email: 'lockme@example.com', fullName: 'Lock Me', password: 'password123', role: 'cashier' }).expect(201);
    const attempt = (password: string) => http.post(L).send({ email: 'lockme@example.com', password });
    for (let i = 0; i < 4; i++) await attempt('wrong-password').expect(401);
    // A right password before the limit starts the count again.
    await attempt('password123').expect(200);
    for (let i = 0; i < 4; i++) await attempt('wrong-password').expect(401);
    const fifth = await attempt('wrong-password').expect(429);
    expect(fifth.body).toMatchObject({ code: 'account_locked' });
    expect(fifth.body.message).toMatch(/locked for 15 more minutes/);
    await attempt('password123').expect(429);
    // An unknown email gives nothing away and is never "locked".
    for (let i = 0; i < 6; i++) await http.post(L).send({ email: 'nobody-here@example.com', password: 'wrong-password' }).expect(401);
    // Time passes.
    await sql(`UPDATE users SET locked_until = now() - interval '1 second' WHERE email = 'lockme@example.com'`);
    await attempt('password123').expect(200);
  });

  it('counts wrong PINs towards the lock too', async () => {
    const s = await phone('phone-admin@example.com');
    const t = auth(s.accessToken);
    for (let i = 0; i < 4; i++) await setPrice(t, '5.00').set(pin('0000')).expect(403);
    await setPrice(t, '5.00').set(pin('0000')).expect(429);
    await setPrice(t, '5.00').set(pin('4321')).expect(429);
    await http.post(L).send({ email: 'phone-admin@example.com', password: 'password123' }).expect(429);
    await sql(`UPDATE users SET locked_until = NULL WHERE email = 'phone-admin@example.com'`);
    await setPrice(t, '5.00').set(pin('4321')).expect(200);
  });
});

describe('dashboard and who may use the phone app', () => {
  let ownerT: Record<string, string>;
  let storeId: string;
  let warehouseId: string;
  let rice: string;
  let beans: string;
  const D = '/api/v1/dashboard';

  beforeAll(async () => {
    ownerT = auth((await signup('Dash Shop', 'dash@example.com')).accessToken);
    storeId = (await http.get('/api/v1/stores').set(ownerT)).body[0].id;
    warehouseId = (await http.post('/api/v1/stores').set(ownerT).send({ name: 'Depot', code: 'DEP', type: 'warehouse' }).expect(201)).body.id;
    const make = async (body: object) => (await http.post('/api/v1/products').set(ownerT).send(body).expect(201)).body.variants[0].id;
    rice = await make({ name: 'Rice 5kg', variants: [{ price: '10.00', costPrice: '7.00', reorderLevel: 5 }] });
    beans = await make({ name: 'Beans 1kg', variants: [{ price: '2.00', costPrice: '1.00', reorderLevel: 50 }] });
    await http.post('/api/v1/inventory/movements').set(ownerT).send({ storeId, type: 'receive', lines: [{ variantId: rice, quantity: 20 }, { variantId: beans, quantity: 20 }] }).expect(201);
    const sell = (lines: object[], amount: string, method = 'cash') =>
      http.post('/api/v1/sales').set(ownerT).send({ storeId, lines, payments: [{ method, amount }] }).expect(201);
    const first = await sell([{ variantId: rice, quantity: 2 }], '20');
    await sell([{ variantId: rice, quantity: 1 }, { variantId: beans, quantity: 5 }], '20', 'card');
    await http.post(`/api/v1/sales/${first.body.id}/returns`).set(ownerT).send({ lines: [{ lineId: first.body.lines[0].id, quantity: 1 }], method: 'cash', reason: 'Split bag' }).expect(201);
    // A sale a week ago and one yesterday, to compare with.
    const db = ownerDb();
    try {
      const old = await sell([{ variantId: beans, quantity: 5 }], '10');
      await db.query(`UPDATE sales SET sold_at = now() - interval '7 days' WHERE id = $1`, [old.body.id]);
      const y = await sell([{ variantId: rice, quantity: 4 }], '40');
      await db.query(`UPDATE sales SET sold_at = now() - interval '1 day' WHERE id = $1`, [y.body.id]);
    } finally {
      await db.end();
    }
  });

  it("sums up today, compares it and lists what's selling and what's low", async () => {
    const res = await http.get(D).set(ownerT).expect(200);
    // Today: 20.00 + 20.00 sold, 10.00 refunded.
    expect(res.body.today).toEqual({ gross: '30.00', sales: 2, returns: 1, averageBasket: '20.00' });
    expect(res.body.yesterday).toMatchObject({ gross: '40.00', sales: 1, changePercent: -25 });
    expect(res.body.lastWeek).toMatchObject({ gross: '10.00', sales: 1, changePercent: 200 });
    expect(res.body.trend).toHaveLength(8);
    expect(res.body.trend[7]).toMatchObject({ day: res.body.date, gross: '30.00' });
    expect(res.body.currencyCode).toBe('USD');
    expect(res.body.topProducts.map((p: any) => [p.name, p.quantity, p.revenue])).toEqual([
      ['Rice 5kg', '2.000', '20.00'],
      ['Beans 1kg', '5.000', '10.00'],
    ]);
    expect(res.body.paymentMethods).toEqual([
      { method: 'card', amount: '20.00' },
      { method: 'cash', amount: '10.00' },
    ]);
    // Beans: 20 received, 10 sold, reorder at 50. Rice: 20 − 7 + 1 = 14, reorder at 5.
    expect(res.body.lowStock).toMatchObject({ total: 1, items: [{ name: 'Beans 1kg', onHand: '10.000', reorderLevel: '50.000' }] });
  });

  it('narrows to one store', async () => {
    const depot = await http.get(D).query({ storeId: warehouseId }).set(ownerT).expect(200);
    expect(depot.body.today).toEqual({ gross: '0.00', sales: 0, returns: 0, averageBasket: '0.00' });
    expect(depot.body.yesterday.changePercent).toBeNull();
    expect(depot.body.topProducts).toEqual([]);
    expect(depot.body.lowStock.total).toBe(2); // nothing is kept there
    const shop = await http.get(D).query({ storeId }).set(ownerT).expect(200);
    expect(shop.body.today.gross).toBe('30.00');
    const other = await signup('Dash Other', 'dash-other@example.com');
    const otherStore = (await http.get('/api/v1/stores').set(auth(other.accessToken))).body[0].id;
    await http.get(D).query({ storeId: otherStore }).set(ownerT).expect(400);
    expect((await http.get(D).set(auth(other.accessToken)).expect(200)).body.today.sales).toBe(0);
  });

  it('is for managers and up, and can be taken away', async () => {
    const add = async (email: string, role: string) => {
      const res = await http.post('/api/v1/staff').set(ownerT).send({ email, fullName: role, password: 'password123', role }).expect(201);
      return { id: res.body.id as string, t: auth((await http.post('/api/v1/auth/login').send({ email, password: 'password123' }).expect(200)).body.accessToken) };
    };
    const manager = await add('dash-manager@example.com', 'manager');
    await http.get(D).set(manager.t).expect(200);
    for (const role of ['cashier', 'waiter', 'stock_clerk', 'accountant']) {
      const member = await add(`dash-${role}@example.com`, role);
      await http.get(D).set(member.t).expect(403);
    }
    await http.patch(`/api/v1/staff/${manager.id}`).set(ownerT).send({ deniedPermissions: ['dashboard.view'] }).expect(200);
    await http.get(D).set(manager.t).expect(403);
  });

  it('only lets owners, admins and managers sign in to the phone app', async () => {
    const phone = (email: string) => http.post('/api/v1/auth/login').send({ email, password: 'password123', session: 'mobile' });
    await phone('dash@example.com').expect(200);
    await phone('dash-manager@example.com').expect(200);
    for (const role of ['cashier', 'waiter', 'stock_clerk', 'accountant']) {
      const res = await phone(`dash-${role}@example.com`).expect(403);
      expect(res.body.code).toBe('not_for_role');
      // …though they can still use the backoffice pages their role allows.
      await http.post('/api/v1/auth/login').send({ email: `dash-${role}@example.com`, password: 'password123' }).expect(200);
    }
    // No refresh token was left behind for them.
    const db = ownerDb();
    try {
      const left = await db.query(`SELECT count(*)::int AS n FROM refresh_tokens r JOIN users u ON u.id = r.user_id WHERE u.email LIKE 'dash-cashier%'`);
      expect(left.rows[0].n).toBe(0);
    } finally {
      await db.end();
    }
  });
});

describe('sales activity filters', () => {
  let ownerT: Record<string, string>;
  let cashierT: Record<string, string>;
  let cashierUserId: string;
  let storeId: string;
  let depotId: string;
  const S = '/api/v1/sales';
  const list = (query: object, t = ownerT) => http.get(S).query(query).set(t).expect(200);

  beforeAll(async () => {
    ownerT = auth((await signup('Activity Shop', 'activity@example.com')).accessToken);
    storeId = (await http.get('/api/v1/stores').set(ownerT)).body[0].id;
    depotId = (await http.post('/api/v1/stores').set(ownerT).send({ name: 'Second Shop', code: 'TWO' }).expect(201)).body.id;
    const staff = await http.post('/api/v1/staff').set(ownerT).send({ email: 'activity-cashier@example.com', fullName: 'Chipo Cashier', password: 'password123', role: 'cashier' }).expect(201);
    cashierUserId = staff.body.userId;
    cashierT = auth((await http.post('/api/v1/auth/login').send({ email: 'activity-cashier@example.com', password: 'password123' }).expect(200)).body.accessToken);
    const v = (await http.post('/api/v1/products').set(ownerT).send({ name: 'Soap', variants: [{ price: '1.00' }] }).expect(201)).body.variants[0].id;
    for (const s of [storeId, depotId]) await http.post('/api/v1/inventory/movements').set(ownerT).send({ storeId: s, type: 'receive', lines: [{ variantId: v, quantity: 50 }] }).expect(201);
    const sell = (t: Record<string, string>, store: string, quantity: number, payments: object[], customerName?: string) =>
      http.post(S).set(t).send({ storeId: store, lines: [{ variantId: v, quantity }], payments, customerName }).expect(201);
    const a = await sell(ownerT, storeId, 10, [{ method: 'cash', amount: '10' }]);
    await sell(cashierT, storeId, 4, [{ method: 'card', amount: '4' }], 'Mai Tino');
    await sell(cashierT, depotId, 6, [{ method: 'cash', amount: '2' }, { method: 'mobile', amount: '4' }]);
    const voided = await sell(cashierT, storeId, 3, [{ method: 'cash', amount: '3' }]);
    await http.post(`${S}/${voided.body.id}/void`).set(ownerT).expect(201);
    await http.post(`${S}/${a.body.id}/returns`).set(ownerT).send({ lines: [{ lineId: a.body.lines[0].id, quantity: 2 }], method: 'cash', reason: 'Wrong one' }).expect(201);
  });

  it('lists everything with how each was paid and what it all comes to', async () => {
    const res = await list({});
    expect(res.body.total).toBe(5);
    // 10 + 4 + 6 sold, 2 refunded; the voided 3 doesn't count.
    expect(res.body.totalBase).toBe('18.00');
    const split = res.body.items.find((s: any) => s.total === '6.00');
    expect(split).toMatchObject({ paymentMethods: ['cash', 'mobile'], salesperson: 'Chipo Cashier', storeName: 'Second Shop' });
  });

  it('filters by cashier, payment method, branch, kind and words', async () => {
    const mine = await list({ cashierId: cashierUserId });
    expect(mine.body.total).toBe(3);
    expect(mine.body.totalBase).toBe('10.00');
    expect(mine.body.items.every((s: any) => s.salesperson === 'Chipo Cashier')).toBe(true);

    expect((await list({ paymentMethod: 'mobile' })).body.items.map((s: any) => s.total)).toEqual(['6.00']);
    expect((await list({ paymentMethod: 'card' })).body.total).toBe(1);
    expect((await list({ paymentMethod: 'cash', cashierId: cashierUserId, storeId })).body.items.map((s: any) => s.status)).toEqual(['void']);
    expect((await list({ storeId: depotId })).body).toMatchObject({ total: 1, totalBase: '6.00' });
    expect((await list({ type: 'return' })).body).toMatchObject({ total: 1, totalBase: '-2.00' });
    expect((await list({ status: 'void' })).body).toMatchObject({ total: 1, totalBase: '0.00' });
    expect((await list({ search: 'tino' })).body.items.map((s: any) => s.customerName)).toEqual(['Mai Tino']);
    expect((await list({ from: '2000-01-01', to: '2000-01-02' })).body).toMatchObject({ total: 0, totalBase: '0.00' });
    await http.get(S).query({ paymentMethod: 'cheque' }).set(ownerT).expect(400);
    const soap = (await http.get('/api/v1/products').set(ownerT)).body.items[0].variants[0].id;
    await http.post(`${S}/quotations`).set(ownerT).send({ storeId, lines: [{ variantId: soap, quantity: 1 }] }).expect(201);
    expect((await list({})).body.total).toBe(6);
    expect((await list({ excludeQuotations: 'true' })).body).toMatchObject({ total: 5, totalBase: '18.00' });
    await http.get(S).query({ cashierId: 'someone' }).set(ownerT).expect(400);
  });

  it('pages through, keeping the total for the whole list', async () => {
    const first = await list({ pageSize: 2 });
    const second = await list({ pageSize: 2, page: 2 });
    expect(first.body.items).toHaveLength(2);
    expect(second.body.items).toHaveLength(2);
    expect(first.body.totalBase).toBe('18.00');
    expect(second.body.totalBase).toBe('18.00');
    expect(new Set([...first.body.items, ...second.body.items].map((s: any) => s.id)).size).toBe(4);
  });
});

describe('inventory on the phone', () => {
  let ownerT: Record<string, string>;
  let managerT: Record<string, string>;
  let cashierT: Record<string, string>;
  let mainId: string;
  let branchId: string;
  let productId: string;
  let tea: string;
  let teaBig: string;
  const I = '/api/v1/inventory';
  const pin = { 'X-Floatly-Pin': '2580' };

  beforeAll(async () => {
    ownerT = auth((await signup('Phone Stock', 'phonestock@example.com')).accessToken);
    mainId = (await http.get('/api/v1/stores').set(ownerT)).body[0].id;
    branchId = (await http.post('/api/v1/stores').set(ownerT).send({ name: 'Branch', code: 'BR' }).expect(201)).body.id;
    const p = await http
      .post('/api/v1/products')
      .set(ownerT)
      .send({ name: 'Tea', variants: [{ name: '100 bags', sku: 'TEA100', barcode: '600999', price: '3.00', costPrice: '2.00', reorderLevel: 10 }, { name: '250 bags', price: '6.50', reorderLevel: 2 }] })
      .expect(201);
    productId = p.body.id;
    const byName = (n: string) => p.body.variants.find((v: any) => v.name === n).id;
    tea = byName('100 bags');
    teaBig = byName('250 bags');
    await http.post(`${I}/movements`).set(ownerT).send({ storeId: mainId, type: 'receive', lines: [{ variantId: tea, quantity: 8 }, { variantId: teaBig, quantity: 5 }] }).expect(201);
    await http.post(`${I}/movements`).set(ownerT).send({ storeId: branchId, type: 'receive', lines: [{ variantId: tea, quantity: 4 }] }).expect(201);
    await http.post('/api/v1/staff').set(ownerT).send({ email: 'phonestock-m@example.com', fullName: 'Stock Manager', password: 'password123', role: 'manager', pin: '2580' }).expect(201);
    await http.post('/api/v1/staff').set(ownerT).send({ email: 'phonestock-c@example.com', fullName: 'Stock Cashier', password: 'password123', role: 'cashier' }).expect(201);
    managerT = auth((await http.post('/api/v1/auth/login').send({ email: 'phonestock-m@example.com', password: 'password123', session: 'mobile' }).expect(200)).body.accessToken);
    cashierT = auth((await http.post('/api/v1/auth/login').send({ email: 'phonestock-c@example.com', password: 'password123' }).expect(200)).body.accessToken);
  });

  it('adds up every store when none is chosen, low stock included', async () => {
    const all = await http.get(`${I}/levels`).set(managerT).expect(200);
    expect(Object.fromEntries(all.body.items.map((i: any) => [i.variantName, i.onHand]))).toEqual({ '100 bags': '12.000', '250 bags': '5.000' });
    const low = await http.get(`${I}/levels`).query({ lowStock: true }).set(managerT).expect(200);
    expect(low.body.items.map((i: any) => i.variantName)).toEqual([]);
    const branchLow = await http.get(`${I}/levels`).query({ lowStock: true, storeId: branchId }).set(managerT).expect(200);
    expect(branchLow.body.items.map((i: any) => i.variantName)).toEqual(['100 bags', '250 bags']);
    expect((await http.get(`${I}/levels`).query({ search: '600999' }).set(managerT).expect(200)).body.total).toBe(1);
  });

  it('shows one item in every store', async () => {
    const res = await http.get(`${I}/items/${tea}`).set(managerT).expect(200);
    expect(res.body).toMatchObject({ productName: 'Tea', variantName: '100 bags', sku: 'TEA100', price: '3.00', costPrice: '2.00', reorderLevel: '10.000', onHand: '12.000', trackStock: true });
    expect(res.body.stores.map((s: any) => [s.storeName, s.onHand])).toEqual([
      ['Branch', '4.000'],
      ['Main Store', '8.000'],
    ]);
    await http.get(`${I}/items/${productId}`).set(managerT).expect(404);
  });

  it("changes one item's price with the PIN, leaving the other as it was", async () => {
    const url = `/api/v1/products/variants/${tea}`;
    expect((await http.patch(url).set(managerT).send({ price: '3.25' }).expect(403)).body.code).toBe('pin_required');
    const res = await http.patch(url).set(managerT).set(pin).send({ price: '3.25', reorderLevel: '6' }).expect(200);
    const a = res.body.variants.find((v: any) => v.id === tea);
    const b = res.body.variants.find((v: any) => v.id === teaBig);
    expect([a.price, a.reorderLevel, a.active]).toEqual(['3.25', '6.000', true]);
    expect([b.price, b.active]).toEqual(['6.50', true]);
    // Reorder level and cost alone need no PIN.
    await http.patch(url).set(managerT).send({ reorderLevel: null, costPrice: '2.10' }).expect(200);
    await http.patch(url).set(cashierT).send({ reorderLevel: '1' }).expect(403);
    const trail = await http.get('/api/v1/audit-logs').query({ action: 'price_change' }).set(ownerT).expect(200);
    expect(trail.body[0]).toMatchObject({ platform: 'mobile', role: 'manager', oldValue: { [tea]: '3.00' }, newValue: { [tea]: '3.25' } });
  });

  it('records damaged stock and lists it, newest first, with who did it', async () => {
    await http.post(`${I}/movements`).set(managerT).send({ storeId: mainId, type: 'waste', note: 'Expired: past best-before', lines: [{ variantId: tea, quantity: 2 }] }).expect(201);
    await http.post(`${I}/movements`).set(managerT).send({ storeId: branchId, type: 'waste', note: 'Damaged: box crushed', lines: [{ variantId: teaBig, quantity: 1 }] }).expect(201);
    const all = await http.get(`${I}/movements`).query({ type: 'waste' }).set(managerT).expect(200);
    expect(all.body.total).toBe(2);
    expect(all.body.items.map((m: any) => [m.note, m.quantity, m.storeName, m.createdByName])).toEqual([
      ['Damaged: box crushed', '-1.000', 'Branch', 'Stock Manager'],
      ['Expired: past best-before', '-2.000', 'Main Store', 'Stock Manager'],
    ]);
    expect((await http.get(`${I}/movements`).query({ type: 'waste', storeId: mainId }).set(managerT).expect(200)).body.total).toBe(1);
    expect((await http.get(`${I}/movements`).query({ type: 'waste', search: 'nothing' }).set(managerT).expect(200)).body.total).toBe(0);
    await http.get(`${I}/movements`).query({ type: 'stolen' }).set(managerT).expect(400);
    expect((await http.get(`${I}/items/${tea}`).set(managerT).expect(200)).body.onHand).toBe('10.000');
  });
});

describe('customers and suppliers on the phone', () => {
  let ownerT: Record<string, string>;
  let cashierT: Record<string, string>;
  let storeId: string;
  let today: string;
  let customerId: string;
  let otherCustomerId: string;
  let supplierId: string;
  let sales: string;
  let rent: string;

  beforeAll(async () => {
    ownerT = auth((await signup('People Shop', 'people@example.com')).accessToken);
    storeId = (await http.get('/api/v1/stores').set(ownerT)).body[0].id;
    today = (await http.get('/api/v1/accounting/periods').set(ownerT)).body.today;
    const accounts = (await http.get('/api/v1/accounting/accounts').set(ownerT)).body;
    sales = accounts.find((a: any) => a.systemKey === 'sales').id;
    rent = accounts.find((a: any) => a.code === '6000').id;
    customerId = (await http.post('/api/v1/customers').set(ownerT).send({ name: 'Moyo Traders', phone: '+263 77 555 0101', creditLimit: '500' }).expect(201)).body.id;
    otherCustomerId = (await http.post('/api/v1/customers').set(ownerT).send({ name: 'Walk-in Ltd' }).expect(201)).body.id;
    supplierId = (await http.post('/api/v1/suppliers').set(ownerT).send({ name: 'Grain Mills', contactName: 'Mr Banda', phone: '+263 24 222 0000', paymentTermsDays: 14 }).expect(201)).body.id;
    await http.post('/api/v1/staff').set(ownerT).send({ email: 'people-cashier@example.com', fullName: 'People Cashier', password: 'password123', role: 'cashier' }).expect(201);
    cashierT = auth((await http.post('/api/v1/auth/login').send({ email: 'people-cashier@example.com', password: 'password123' }).expect(200)).body.accessToken);

    // Two invoices: one part paid, one overdue.
    const inv = (date: string, dueDate: string, amount: string) =>
      http.post('/api/v1/accounting/invoices').set(ownerT).send({ customerId, date, dueDate, lines: [{ accountId: sales, description: 'Maize meal', unitPrice: amount }] }).expect(201);
    const first = await inv(today, today, '200');
    await http.post(`/api/v1/accounting/invoices/${first.body.id}/payments`).set(ownerT).send({ accountId: accounts.find((a: any) => a.systemKey === 'cash').id, date: today, amount: '50' }).expect(201);
    const old = new Date(Date.parse(today) - 20 * 86_400_000).toISOString().slice(0, 10);
    await inv(old, old, '100');
    // Till sales to the customer.
    const v = (await http.post('/api/v1/products').set(ownerT).send({ name: 'Salt', variants: [{ price: '2.00' }] }).expect(201)).body.variants[0].id;
    await http.post('/api/v1/inventory/movements').set(ownerT).send({ storeId, type: 'receive', lines: [{ variantId: v, quantity: 20 }] }).expect(201);
    const sale = await http.post('/api/v1/sales').set(ownerT).send({ storeId, customerId, lines: [{ variantId: v, quantity: 5 }], payments: [{ method: 'cash', amount: '10' }] }).expect(201);
    await http.post('/api/v1/sales').set(ownerT).send({ storeId, customerId, lines: [{ variantId: v, quantity: 2 }], payments: [{ method: 'card', amount: '4' }] }).expect(201);
    await http.post(`/api/v1/sales/${sale.body.id}/returns`).set(ownerT).send({ lines: [{ lineId: sale.body.lines[0].id, quantity: 1 }], method: 'cash', reason: 'Spilt' }).expect(201);
    // Two bills for the supplier, one paid.
    const bill = (amount: string) =>
      http.post('/api/v1/accounting/bills').set(ownerT).send({ supplierId, date: today, lines: [{ accountId: rent, description: 'Delivery', unitPrice: amount }] }).expect(201);
    await bill('80');
    const paidBill = await bill('30');
    await http.post(`/api/v1/accounting/bills/${paidBill.body.id}/payments`).set(ownerT).send({ accountId: accounts.find((a: any) => a.systemKey === 'cash').id, date: today, amount: '30' }).expect(201);
  });

  it("shows each customer's balance in the list, to bookkeepers only", async () => {
    const res = await http.get('/api/v1/customers').query({ withBalance: true }).set(ownerT).expect(200);
    const owed = Object.fromEntries(res.body.items.map((c: any) => [c.name, c.owed]));
    expect(owed).toEqual({ 'Moyo Traders': '250.00', 'Walk-in Ltd': '0.00' });
    expect((await http.get('/api/v1/customers').set(ownerT).expect(200)).body.items[0].owed).toBeUndefined();
    await http.get('/api/v1/customers').query({ withBalance: true }).set(cashierT).expect(403);
    await http.get('/api/v1/customers').set(cashierT).expect(200);
  });

  it('sums a customer up: owed, overdue, credit left, spent, and unpaid invoices oldest first', async () => {
    const res = await http.get(`/api/v1/customers/${customerId}/summary`).set(ownerT).expect(200);
    expect(res.body).toMatchObject({ name: 'Moyo Traders', owed: '250.00', overdue: '100.00', creditLimit: '500.00', creditLeft: '250.00', salesCount: 2, spent: '12.00' });
    expect(res.body.lastSaleAt).toBeTruthy();
    expect(res.body.unpaidInvoices.map((i: any) => [i.balance, i.state])).toEqual([
      ['100.00', 'overdue'],
      ['150.00', 'part_paid'],
    ]);
    const none = await http.get(`/api/v1/customers/${otherCustomerId}/summary`).set(ownerT).expect(200);
    expect(none.body).toMatchObject({ owed: '0.00', creditLeft: null, salesCount: 0, spent: '0.00', lastSaleAt: null, unpaidInvoices: [] });
    await http.get(`/api/v1/customers/${customerId}/summary`).set(cashierT).expect(403);
    const purchases = await http.get('/api/v1/sales').query({ customerId, excludeQuotations: 'true' }).set(ownerT).expect(200);
    expect(purchases.body).toMatchObject({ total: 3, totalBase: '12.00' });
  });

  it('sums a supplier up: owed, unpaid bills and the latest bills', async () => {
    const res = await http.get(`/api/v1/suppliers/${supplierId}/summary`).set(ownerT).expect(200);
    expect(res.body).toMatchObject({ name: 'Grain Mills', contactName: 'Mr Banda', paymentTermsDays: 14, owed: '80.00', overdue: '0.00', billCount: 2 });
    expect(res.body.unpaidBills.map((b: any) => b.balance)).toEqual(['80.00']);
    expect(res.body.recentBills.map((b: any) => b.state).sort()).toEqual(['paid', 'unpaid']);
    await http.get(`/api/v1/suppliers/${supplierId}/summary`).set(cashierT).expect(403);
    await http.get('/api/v1/suppliers/00000000-0000-7000-8000-000000000000/summary').set(ownerT).expect(404);
  });

  it('adds and edits customers and suppliers, with the audit trail saying it was a phone', async () => {
    const mobile = { 'X-Floatly-Client': 'mobile' };
    await http.patch(`/api/v1/customers/${otherCustomerId}`).set(ownerT).set(mobile).send({ phone: '0772 000 111', email: 'walkin@example.com' }).expect(200);
    await http.patch(`/api/v1/suppliers/${supplierId}`).set(ownerT).set(mobile).send({ email: 'orders@grainmills.example' }).expect(200);
    await http.patch(`/api/v1/suppliers/${supplierId}`).set(cashierT).send({ email: 'x@example.com' }).expect(403);
    const trail = await http.get('/api/v1/audit-logs').query({ platform: 'mobile' }).set(ownerT).expect(200);
    expect(trail.body.map((r: any) => r.entity).sort()).toEqual(['Customer', 'Supplier']);
  });
});

describe('refund and void requests', () => {
  let ownerT: Record<string, string>;
  let managerT: Record<string, string>;
  let cashierT: Record<string, string>;
  let cashierUserId: string;
  let storeId: string;
  let variantId: string;
  let shiftId: string;
  const pin = { 'X-Floatly-Pin': '7531' };
  const R = '/api/v1/sale-requests';

  const sell = async (quantity: number, method = 'cash') =>
    (await http.post('/api/v1/sales').set(cashierT).send({ storeId, shiftId, lines: [{ variantId, quantity }], payments: [{ method, amount: String(quantity * 2) }] }).expect(201)).body;
  const onHand = async () => (await http.get(`/api/v1/inventory/items/${variantId}`).set(ownerT)).body.stores.find((s: any) => s.storeId === storeId).onHand;

  beforeAll(async () => {
    ownerT = auth((await signup('Request Shop', 'requests@example.com')).accessToken);
    storeId = (await http.get('/api/v1/stores').set(ownerT)).body[0].id;
    variantId = (await http.post('/api/v1/products').set(ownerT).send({ name: 'Bread', variants: [{ price: '2.00', costPrice: '1.20' }] }).expect(201)).body.variants[0].id;
    await http.post('/api/v1/inventory/movements').set(ownerT).send({ storeId, type: 'receive', lines: [{ variantId, quantity: 50 }] }).expect(201);
    await http.post('/api/v1/staff').set(ownerT).send({ email: 'req-manager@example.com', fullName: 'Req Manager', password: 'password123', role: 'manager', pin: '7531' }).expect(201);
    const c = await http.post('/api/v1/staff').set(ownerT).send({ email: 'req-cashier@example.com', fullName: 'Req Cashier', password: 'password123', role: 'cashier' }).expect(201);
    cashierUserId = c.body.userId;
    managerT = auth((await http.post('/api/v1/auth/login').send({ email: 'req-manager@example.com', password: 'password123', session: 'mobile' }).expect(200)).body.accessToken);
    cashierT = auth((await http.post('/api/v1/auth/login').send({ email: 'req-cashier@example.com', password: 'password123' }).expect(200)).body.accessToken);
    shiftId = (await http.post('/api/v1/shifts').set(cashierT).send({ storeId, openingFloat: { USD: '10.00' } }).expect(201)).body.id;
  });

  it("lets a cashier ask for a refund they can't make, and checks it first", async () => {
    const sale = await sell(4);
    const lineId = sale.lines[0].id;
    await http.post(`/api/v1/sales/${sale.id}/returns`).set(cashierT).send({ lines: [{ lineId, quantity: 1 }], method: 'cash', reason: 'x' }).expect(403);
    const ask = (body: object) => http.post(`/api/v1/sales/${sale.id}/requests`).set(cashierT).send({ kind: 'refund', method: 'cash', reason: 'Stale', shiftId, ...body });
    await ask({ lines: [{ lineId, quantity: 5 }] }).expect(400);
    await ask({ lines: [] }).expect(400);
    await ask({ lines: [{ lineId, quantity: 1 }], method: undefined }).expect(400);
    const res = await ask({ lines: [{ lineId, quantity: 2 }] }).expect(201);
    expect(res.body).toMatchObject({ kind: 'refund', status: 'pending', amount: '4.00', saleNumber: sale.number, requestedByName: 'Req Cashier', storeName: 'Main Store', shiftId });
    expect(res.body.lines).toEqual([{ lineId, quantity: '2.000', name: 'Bread' }]);
    // One open request per sale.
    expect((await ask({ lines: [{ lineId, quantity: 1 }] }).expect(409)).body.message).toMatch(/already has a request/);
  });

  it('shows managers everything waiting, oldest first, and cashiers only their own', async () => {
    const waiting = await http.get(R).query({ status: 'pending' }).set(managerT).expect(200);
    expect(waiting.body.total).toBe(1);
    await http.get(R).query({ status: 'pending' }).set(cashierT).expect(403);
    const mine = await http.get(R).query({ mine: true }).set(cashierT).expect(200);
    expect(mine.body.items).toHaveLength(1);
    expect((await http.get('/api/v1/dashboard').set(managerT).expect(200)).body.pendingRequests).toBe(1);
    // A cashier can't decide.
    const id = waiting.body.items[0].id;
    await http.post(`${R}/${id}/approve`).set(cashierT).send({}).expect(403);
    await http.post(`${R}/${id}/reject`).set(cashierT).send({ note: 'no' }).expect(403);
  });

  it('approves with the PIN: the refund comes from the cashier\'s shift, in their name, stock back', async () => {
    const [req] = (await http.get(R).query({ status: 'pending' }).set(managerT)).body.items;
    const before = await onHand();
    expect((await http.post(`${R}/${req.id}/approve`).set(managerT).send({}).expect(403)).body.code).toBe('pin_required');
    const res = await http.post(`${R}/${req.id}/approve`).set(managerT).set(pin).send({ note: 'OK, stale loaf' }).expect(200);
    expect(res.body).toMatchObject({ status: 'approved', decidedByName: 'Req Manager', decisionNote: 'OK, stale loaf' });
    expect(res.body.resultNumber).toMatch(/^R-/);
    const ret = (await http.get(`/api/v1/sales/${res.body.resultSaleId}`).set(ownerT)).body;
    expect(ret).toMatchObject({ type: 'return', total: '4.00', shiftId, salesperson: 'Req Cashier', originalSaleId: req.saleId });
    expect(Number(await onHand()) - Number(before)).toBe(2);
    // Decided once only.
    await http.post(`${R}/${req.id}/approve`).set(managerT).set(pin).send({}).expect(400);
    await http.post(`${R}/${req.id}/reject`).set(managerT).send({ note: 'too late' }).expect(400);
    const trail = await http.get('/api/v1/audit-logs').query({ action: 'approve_refund' }).set(ownerT).expect(200);
    expect(trail.body[0]).toMatchObject({ role: 'manager', platform: 'mobile', storeId, oldValue: { status: 'pending' }, newValue: { status: 'approved' } });
  });

  it('rejects with a note the cashier can read, and changes nothing', async () => {
    const sale = await sell(1);
    const req = (await http.post(`/api/v1/sales/${sale.id}/requests`).set(cashierT).send({ kind: 'void', reason: 'Rang it twice' }).expect(201)).body;
    expect(req.amount).toBe('2.00');
    await http.post(`${R}/${req.id}/reject`).set(managerT).send({}).expect(400);
    await http.post(`${R}/${req.id}/reject`).set(managerT).send({ note: 'There were two customers' }).expect(200);
    const mine = await http.get(R).query({ mine: true, status: 'decided' }).set(cashierT).expect(200);
    expect(mine.body.items[0]).toMatchObject({ status: 'rejected', decisionNote: 'There were two customers', kind: 'void' });
    expect((await http.get(`/api/v1/sales/${sale.id}`).set(ownerT)).body.status).toBe('completed');
  });

  it('approves a void, which voids the sale and puts the stock back', async () => {
    const sale = await sell(3, 'card');
    const before = await onHand();
    const req = (await http.post(`/api/v1/sales/${sale.id}/requests`).set(cashierT).send({ kind: 'void', reason: 'Card declined after all' }).expect(201)).body;
    await http.post(`${R}/${req.id}/approve`).set(managerT).set(pin).send({}).expect(200);
    expect((await http.get(`/api/v1/sales/${sale.id}`).set(ownerT)).body.status).toBe('void');
    expect(Number(await onHand()) - Number(before)).toBe(3);
  });

  it('lets the cashier take a request back, and nobody decide their own', async () => {
    const sale = await sell(1);
    const req = (await http.post(`/api/v1/sales/${sale.id}/requests`).set(cashierT).send({ kind: 'void', reason: 'Oops' }).expect(201)).body;
    await http.post(`${R}/${req.id}/cancel`).set(managerT).expect(403);
    await http.post(`${R}/${req.id}/cancel`).set(cashierT).expect(200);
    await http.post(`${R}/${req.id}/approve`).set(managerT).set(pin).send({}).expect(400);

    // A manager who asks (say, on a till) needs someone else to approve.
    const managerSale = (await http.post('/api/v1/sales').set(ownerT).send({ storeId, lines: [{ variantId, quantity: 1 }], payments: [{ method: 'cash', amount: '2' }] }).expect(201)).body;
    const own = (await http.post(`/api/v1/sales/${managerSale.id}/requests`).set(managerT).send({ kind: 'void', reason: 'Test' }).expect(201)).body;
    expect((await http.post(`${R}/${own.id}/approve`).set(managerT).set(pin).send({}).expect(403)).body.message).toMatch(/Someone else/);
    await http.post(`${R}/${own.id}/approve`).set(ownerT).send({}).expect(200); // the owner, on the web: no PIN asked
  });

  it("refunds from no shift when the cashier's has closed since", async () => {
    const sale = await sell(1);
    const req = (await http.post(`/api/v1/sales/${sale.id}/requests`).set(cashierT).send({ kind: 'refund', method: 'cash', reason: 'Late', shiftId, lines: [{ lineId: sale.lines[0].id, quantity: 1 }] }).expect(201)).body;
    await http.post(`/api/v1/shifts/${shiftId}/close`).set(cashierT).send({ countedCash: { USD: '0.00' } }).expect(201);
    const res = await http.post(`${R}/${req.id}/approve`).set(managerT).set(pin).send({}).expect(200);
    expect((await http.get(`/api/v1/sales/${res.body.resultSaleId}`).set(ownerT)).body.shiftId).toBeNull();
  });

  it('is kept away from other businesses', async () => {
    const other = auth((await signup('Other Request Shop', 'requests-other@example.com')).accessToken);
    const [req] = (await http.get(R).query({ status: 'decided' }).set(managerT)).body.items;
    await http.get(`${R}/${req.id}`).set(other).expect(404);
    expect((await http.get(R).set(other).expect(200)).body.total).toBe(0);
    expect(cashierUserId).toBeTruthy();
  });
});

describe('notifications', () => {
  let ownerT: Record<string, string>;
  let managerT: Record<string, string>;
  let cashierT: Record<string, string>;
  let storeId: string;
  let branchId: string;
  let bread: string;
  let tv: string;
  const N = '/api/v1/notifications';
  const kinds = (body: any) => body.items.map((i: any) => i.kind);

  beforeAll(async () => {
    ownerT = auth((await signup('Bell Shop', 'bell@example.com')).accessToken);
    storeId = (await http.get('/api/v1/stores').set(ownerT)).body[0].id;
    branchId = (await http.post('/api/v1/stores').set(ownerT).send({ name: 'Bell Branch', code: 'BB' }).expect(201)).body.id;
    bread = (await http.post('/api/v1/products').set(ownerT).send({ name: 'Bread', variants: [{ price: '2.00', reorderLevel: 10 }] }).expect(201)).body.variants[0].id;
    tv = (await http.post('/api/v1/products').set(ownerT).send({ name: 'Television', variants: [{ price: '300.00' }] }).expect(201)).body.variants[0].id;
    await http.post('/api/v1/inventory/movements').set(ownerT).send({ storeId, type: 'receive', lines: [{ variantId: bread, quantity: 12 }, { variantId: tv, quantity: 3 }] }).expect(201);
    await http.post('/api/v1/inventory/movements').set(ownerT).send({ storeId: branchId, type: 'receive', lines: [{ variantId: bread, quantity: 50 }] }).expect(201);
    await http.post('/api/v1/staff').set(ownerT).send({ email: 'bell-manager@example.com', fullName: 'Bell Manager', password: 'password123', role: 'manager' }).expect(201);
    await http.post('/api/v1/staff').set(ownerT).send({ email: 'bell-cashier@example.com', fullName: 'Bell Cashier', password: 'password123', role: 'cashier' }).expect(201);
    managerT = auth((await http.post('/api/v1/auth/login').send({ email: 'bell-manager@example.com', password: 'password123' }).expect(200)).body.accessToken);
    cashierT = auth((await http.post('/api/v1/auth/login').send({ email: 'bell-cashier@example.com', password: 'password123' }).expect(200)).body.accessToken);

    const sell = async (variantId: string, quantity: number, amount: string, t = cashierT) =>
      (await http.post('/api/v1/sales').set(t).send({ storeId, lines: [{ variantId, quantity }], payments: [{ method: 'cash', amount }] }).expect(201)).body;
    // Bread sales leave 6 in the shop: under its reorder level of 10.
    for (let i = 0; i < 6; i++) await sell(bread, 1, '2');
    // A television sold yesterday and refunded today: a large refund.
    const tvSale = await sell(tv, 1, '300', ownerT);
    await http.post(`/api/v1/sales/${tvSale.id}/returns`).set(ownerT).send({ lines: [{ lineId: tvSale.lines[0].id, quantity: 1 }], method: 'cash', reason: 'Screen cracked' }).expect(201);
    // A sale voided.
    const voided = await sell(bread, 1, '2', ownerT);
    await http.post(`/api/v1/sales/${voided.id}/void`).set(ownerT).expect(201);
    // A request waiting.
    const asked = await sell(bread, 1, '2');
    await http.post(`/api/v1/sales/${asked.id}/requests`).set(cashierT).send({ kind: 'void', reason: 'Wrong item' }).expect(201);
    // Takings yesterday.
    const db = ownerDb();
    try {
      await db.query(`UPDATE sales SET sold_at = now() - interval '1 day' WHERE id = $1`, [tvSale.id]);
    } finally {
      await db.end();
    }
  });

  it('tells a manager what needs a look, newest first', async () => {
    const res = await http.get(N).set(managerT).expect(200);
    expect(new Set(kinds(res.body))).toEqual(new Set(['low_stock', 'request', 'large_refund', 'void', 'end_of_day']));
    const at = res.body.items.map((i: any) => i.at);
    expect([...at].sort().reverse()).toEqual(at);
    const byKind = Object.fromEntries(res.body.items.map((i: any) => [i.kind, i]));
    // Low in the shop (4 left), though the branch has 50.
    expect(byKind.low_stock).toMatchObject({ title: '1 item running low', body: 'Bread at Main Store', attention: true, link: { to: 'low_stock' } });
    expect(byKind.request.title).toBe('Bell Cashier asks to void on ' + byKind.request.title.split(' on ')[1]);
    expect(byKind.request).toMatchObject({ body: '"Wrong item"', link: { to: 'request' } });
    expect(byKind.large_refund.title).toMatch(/^Large refund: USD 300\.00 on S-/);
    expect(byKind.large_refund.body).toContain('"Screen cracked"');
    expect(byKind.void).toMatchObject({ body: 'By Bell Shop Owner · USD 2.00', attention: false, link: { to: 'sale' } });
    expect(byKind.end_of_day.title).toMatch(/'s takings: USD 300\.00$/);
    expect(byKind.end_of_day.body).toBe('1 sale');
    // Ids stay the same between calls, so the app can tell what's new.
    const again = await http.get(N).set(managerT).expect(200);
    expect(again.body.items.map((i: any) => i.id)).toEqual(res.body.items.map((i: any) => i.id));
  });

  it('narrows to one store', async () => {
    const branch = await http.get(N).query({ storeId: branchId }).set(managerT).expect(200);
    expect(kinds(branch.body)).toEqual(['end_of_day']);
    const shop = await http.get(N).query({ storeId }).set(managerT).expect(200);
    expect(shop.body.items.find((i: any) => i.kind === 'low_stock').body).toBe('Bread');
    expect(branch.body.items[0].body).toBe('No sales');
  });

  it('keeps requests to those who decide them, and the bell from till staff', async () => {
    await http.patch('/api/v1/staff/' + (await http.get('/api/v1/staff').set(ownerT)).body.find((s: any) => s.fullName === 'Bell Manager').id)
      .set(ownerT)
      .send({ deniedPermissions: ['returns.approve'] })
      .expect(200);
    expect(kinds((await http.get(N).set(managerT).expect(200)).body)).not.toContain('request');
    await http.get(N).set(cashierT).expect(403);
    const other = auth((await signup('Quiet Shop', 'quiet-bell@example.com')).accessToken);
    expect(kinds((await http.get(N).set(other).expect(200)).body)).toEqual(['end_of_day']);
  });
});

describe('ZIMRA fiscal receipts from the till', () => {
  let ownerT: Record<string, string>;
  let tillT: Record<string, string>;
  let till2T: Record<string, string>;
  let storeId: string;
  let variantId: string;
  let deviceId: string;

  // What a till sends for a receipt it signed and printed.
  const receipt = (globalNo: number, extra: object = {}) => ({
    deviceId: 4021,
    fiscalDayNo: 3,
    globalNo,
    counter: globalNo,
    invoiceNo: `4021-${globalNo}`,
    receiptType: 'FiscalInvoice',
    date: '2026-11-12T10:15:00',
    qrCode: `https://fdmstest.zimra.co.zw/000000402112112026${String(globalNo).padStart(10, '0')}ABCDEF0123456789`,
    verificationCode: 'ABCD-EF01-2345-6789',
    hash: 'aGFzaA==',
    signature: 'c2lnbmF0dXJl',
    status: 'pending',
    ...extra,
  });
  const sell = async (fiscal?: object, clientId = uuidv7()) =>
    (await http.post('/api/v1/sales').set(tillT).send({ storeId, deviceId, clientId, lines: [{ variantId, quantity: 1 }], payments: [{ method: 'cash', amount: '2.00' }], fiscal }).expect(201)).body;

  beforeAll(async () => {
    ownerT = auth((await signup('Fiscal Shop', 'fiscal@example.com')).accessToken);
    storeId = (await http.get('/api/v1/stores').set(ownerT)).body[0].id;
    await http.post('/api/v1/staff').set(ownerT).send({ email: 'fiscal.cashier@example.com', fullName: 'Fiscal Cashier', password: 'password123', role: 'cashier', pin: '2468', storeIds: [storeId] }).expect(201);
    const pair = async (code: string) => {
      const id = (await http.post('/api/v1/devices').set(ownerT).send({ storeId, name: `Till ${code}`, code }).expect(201)).body.id;
      const deviceToken = (await http.post(`/api/v1/devices/${id}/token`).set(ownerT).expect(201)).body.token;
      return { id, t: auth((await http.post('/api/v1/auth/till').send({ deviceToken, pin: '2468' }).expect(200)).body.accessToken) };
    };
    const one = await pair('T01');
    deviceId = one.id;
    tillT = one.t;
    till2T = (await pair('T02')).t;
  });

  it('keeps HS codes and ZIMRA tax IDs, and gives them to the till', async () => {
    const bad = await http.post('/api/v1/products').set(ownerT).send({ name: 'Bread', hsCode: '123', variants: [{ price: '2.00' }] }).expect(400);
    expect(JSON.stringify(bad.body.message)).toMatch(/hsCode must be 4 or 8 digits/);
    const product = await http.post('/api/v1/products').set(ownerT).send({ name: 'Bread', hsCode: '19059000', variants: [{ price: '2.00', costPrice: '1.20' }] }).expect(201);
    variantId = product.body.variants[0].id;
    await http.post('/api/v1/inventory/movements').set(ownerT).send({ storeId, type: 'receive', lines: [{ variantId, quantity: 20 }] }).expect(201);
    const vat = (await http.get('/api/v1/tax-rates').set(ownerT)).body.find((r: any) => r.code === 'VAT');
    await http.patch(`/api/v1/tax-rates/${vat.id}`).set(ownerT).send({ fiscalTaxId: 517 }).expect(200);

    const catalog = await http.get('/api/v1/till/catalog').query({ storeId }).set(tillT).expect(200);
    expect(catalog.body.products.find((p: any) => p.name === 'Bread').hsCode).toBe('19059000');
    expect(catalog.body.taxRates.find((r: any) => r.code === 'VAT').fiscalTaxId).toBe(517);
    // Cleared with null.
    await http.patch(`/api/v1/products/${product.body.id}`).set(ownerT).send({ hsCode: null }).expect(200);
    expect((await http.get(`/api/v1/products/${product.body.id}`).set(ownerT)).body.hsCode).toBeNull();
    await http.patch(`/api/v1/products/${product.body.id}`).set(ownerT).send({ hsCode: '1905' }).expect(200);
  });

  it('records the fiscal invoice a till sends with a sale', async () => {
    const sale = await sell(receipt(1));
    expect(sale).toMatchObject({ fiscalStatus: 'pending', fiscalReference: '4021-1', deviceId });
    expect(sale.fiscal).toMatchObject({ deviceId: 4021, fiscalDayNo: 3, globalNo: 1, receiptType: 'FiscalInvoice', verificationCode: 'ABCD-EF01-2345-6789', receiptId: null, errors: [] });
    // Sent twice (offline retry): still one sale.
    const again = await http
      .post('/api/v1/sales')
      .set(tillT)
      .send({ storeId, clientId: sale.clientId, lines: [{ variantId, quantity: 1 }], payments: [{ method: 'cash', amount: '2.00' }], fiscal: receipt(1) })
      .expect(201);
    expect(again.body.id).toBe(sale.id);
    for (const wrong of [{ verificationCode: 'abcd' }, { date: '2026-11-12 10:15' }, { receiptType: 'Invoice' }, { globalNo: 0 }]) {
      await http.post('/api/v1/sales').set(tillT).send({ storeId, lines: [{ variantId, quantity: 1 }], payments: [{ method: 'cash', amount: '2.00' }], fiscal: receipt(9, wrong) }).expect(400);
    }
  });

  it("takes ZIMRA's answers from the till, and hands back the ones for sales it hasn't got yet", async () => {
    const sale = await sell(receipt(2));
    const notYet = uuidv7();
    const res = await http
      .post('/api/v1/till/fiscal-receipts')
      .set(tillT)
      .send({ receipts: [{ clientId: sale.clientId, status: 'submitted', receiptId: 9876543210, serverDate: '2026-11-12T10:15:02' }, { clientId: notYet, status: 'submitted' }] })
      .expect(200);
    expect(res.body).toEqual({ updated: [sale.clientId], missing: [notYet] });
    const got = (await http.get(`/api/v1/sales/${sale.id}`).set(ownerT)).body;
    expect(got.fiscalStatus).toBe('submitted');
    expect(got.fiscal).toMatchObject({ receiptId: 9876543210, serverDate: '2026-11-12T10:15:02', verificationCode: 'ABCD-EF01-2345-6789' });

    const red = [{ code: 'RCPT026', color: 'Red', description: 'Incorrectly calculated tax amount' }];
    await http.post('/api/v1/till/fiscal-receipts').set(tillT).send({ receipts: [{ saleId: sale.id, status: 'failed', errors: red }] }).expect(200);
    const failed = (await http.get(`/api/v1/sales/${sale.id}`).set(ownerT)).body;
    expect(failed.fiscalStatus).toBe('failed');
    expect(failed.fiscal.errors).toEqual(red);
    expect(failed.fiscal.receiptId).toBe(9876543210);
    await http.post('/api/v1/till/fiscal-receipts').set(tillT).send({ receipts: [{ status: 'submitted' }] }).expect(400);
  });

  it("won't void a sale reported to ZIMRA: the refund is a credit note", async () => {
    const sale = await sell(receipt(3));
    expect((await http.post(`/api/v1/sales/${sale.id}/void`).set(ownerT).send({}).expect(400)).body.message).toMatch(/reported to ZIMRA.*Refund it instead/);
    const ask = await http.post(`/api/v1/sales/${sale.id}/requests`).set(tillT).send({ kind: 'void', reason: 'Wrong item' }).expect(400);
    expect(ask.body.message).toMatch(/Ask for a refund instead/);

    const ret = await http
      .post(`/api/v1/sales/${sale.id}/returns`)
      .set(ownerT)
      .send({ lines: [{ lineId: sale.lines[0].id, quantity: 1 }], method: 'cash', reason: 'Stale', deviceId, fiscal: receipt(4, { receiptType: 'CreditNote' }) })
      .expect(201);
    expect(ret.body).toMatchObject({ type: 'return', deviceId, fiscalStatus: 'pending', fiscalReference: '4021-4' });
    expect(ret.body.fiscal.receiptType).toBe('CreditNote');
    expect((await http.post(`/api/v1/sales/${ret.body.id}/void`).set(ownerT).send({}).expect(400)).body.message).toMatch(/credit note/);

    // A sale the till didn't fiscalise can still be voided.
    const plain = await sell();
    expect(plain).toMatchObject({ fiscalStatus: 'not_required', fiscal: null });
    await http.post(`/api/v1/sales/${plain.id}/void`).set(ownerT).send({}).expect(201);
  });

  it('adds the credit note to a refund made without one (approved on a phone)', async () => {
    const sale = await sell(receipt(5));
    const ret = await http.post(`/api/v1/sales/${sale.id}/returns`).set(ownerT).send({ lines: [{ lineId: sale.lines[0].id, quantity: 1 }], method: 'cash', reason: 'Approved on phone' }).expect(201);
    expect(ret.body.fiscal).toBeNull();
    const res = await http
      .post('/api/v1/till/fiscal-receipts')
      .set(tillT)
      .send({ receipts: [{ saleId: ret.body.id, status: 'pending', receipt: receipt(6, { receiptType: 'CreditNote' }) }] })
      .expect(200);
    expect(res.body.updated).toEqual([ret.body.id]);
    expect((await http.get(`/api/v1/sales/${ret.body.id}`).set(ownerT)).body).toMatchObject({ fiscalStatus: 'pending', fiscalReference: '4021-6' });
    // A receipt already there is never replaced, only its status updated.
    await http
      .post('/api/v1/till/fiscal-receipts')
      .set(tillT)
      .send({ receipts: [{ saleId: ret.body.id, status: 'submitted', receipt: receipt(7, { receiptType: 'CreditNote' }) }] })
      .expect(200);
    const after = (await http.get(`/api/v1/sales/${ret.body.id}`).set(ownerT)).body;
    expect(after).toMatchObject({ fiscalStatus: 'submitted', fiscalReference: '4021-6' });
    expect(after.fiscal.globalNo).toBe(6);
  });

  it('lets each till report its ZIMRA registration, one till per ZIMRA device', async () => {
    const state = { environment: 'test', taxpayerName: 'Fiscal Shop (Pvt) Ltd', dayStatus: 'FiscalDayOpened', dayNo: 3, dayOpenedAt: '2026-11-12T06:00:00.000Z', unsent: 2, lastGlobalNo: 7 };
    const res = await http.put('/api/v1/till/fiscal-device').set(tillT).send({ fiscalDeviceId: 4021, serialNo: 'FLT-T01', state }).expect(200);
    expect(res.body).toMatchObject({ fiscalDeviceId: 4021, fiscalSerialNo: 'FLT-T01', fiscalState: state });
    expect(res.body.fiscalState.reportedAt).toBeTruthy();
    const listed = (await http.get('/api/v1/devices').set(ownerT).expect(200)).body.find((d: any) => d.code === 'T01');
    expect(listed).toMatchObject({ fiscalDeviceId: 4021, fiscalState: { unsent: 2, dayStatus: 'FiscalDayOpened' } });

    const clash = await http.put('/api/v1/till/fiscal-device').set(till2T).send({ fiscalDeviceId: 4021, serialNo: 'FLT-T02', state: { ...state, unsent: 0 } }).expect(409);
    expect(clash.body.message).toMatch(/already set up on till T01/);
    await http.put('/api/v1/till/fiscal-device').set(ownerT).send({ fiscalDeviceId: 1 }).expect(400);
    await http.put('/api/v1/till/fiscal-device').set(tillT).send({ fiscalDeviceId: 4021, state: { environment: 'staging', unsent: 0 } }).expect(400);

    const cleared = await http.put('/api/v1/till/fiscal-device').set(tillT).send({ fiscalDeviceId: null }).expect(200);
    expect(cleared.body).toMatchObject({ fiscalDeviceId: null, fiscalSerialNo: null, fiscalState: null });
    await http.put('/api/v1/till/fiscal-device').set(till2T).send({ fiscalDeviceId: 4021, serialNo: 'FLT-T02', state: { ...state, unsent: 0 } }).expect(200);
  });
});
