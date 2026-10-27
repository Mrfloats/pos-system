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
