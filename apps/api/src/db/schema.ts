/**
 * Database schema for the POS / backoffice platform.
 *
 * Multi-tenancy: every business that signs up is a tenant. All business data
 * carries a tenant_id, and PostgreSQL row-level security (RLS) policies make the
 * database itself refuse to return or write rows belonging to another tenant.
 * The API sets `app.tenant_id` (and `app.user_id`) at the start of each
 * transaction — see src/db/db.service.ts.
 *
 * One schema serves retail shops, wholesalers and restaurants:
 *   - retail     → products, variants, barcodes, stock per store
 *   - wholesale  → packagings (case of 24), tiered price lists, customer credit
 *   - restaurant → menu items, modifier groups, recipes (components)
 *
 * Money is stored as numeric (exact decimals), never floating point.
 * Stock is stored as a ledger of movements; on-hand = SUM(quantity).
 */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgPolicy,
  pgRole,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

// ---------------------------------------------------------------------------
// Row-level security helpers
// ---------------------------------------------------------------------------

/** The login role the running API uses. Created by docker/postgres/init.sql. */
export const appRole = pgRole('pos_app').existing();

/** Current tenant / user, set per transaction by the API. Empty string → NULL. */
export const currentTenant = sql`nullif(current_setting('app.tenant_id', true), '')::uuid`;
export const currentUser = sql`nullif(current_setting('app.user_id', true), '')::uuid`;

/** Standard policy: a row is visible and writable only inside its own tenant. */
const tenantIsolation = (table: { tenantId: unknown }) =>
  pgPolicy('tenant_isolation', {
    as: 'permissive',
    for: 'all',
    to: appRole,
    using: sql`${table.tenantId} = ${currentTenant}`,
    withCheck: sql`${table.tenantId} = ${currentTenant}`,
  });

/** Floatly staff only (see is_platform_admin() in the migrations). */
const platformAdmin = sql`is_platform_admin()`;

const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());
const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const qty = (name: string) => numeric(name, { precision: 14, scale: 3 });

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const businessType = pgEnum('business_type', ['retail', 'wholesale', 'restaurant', 'mixed']);
export const memberRole = pgEnum('member_role', [
  'owner',
  'admin',
  'manager',
  'cashier',
  'waiter',
  'stock_clerk',
  'accountant',
]);
export const billingPeriod = pgEnum('billing_period', ['monthly', 'yearly']);
export const subscriptionStatus = pgEnum('subscription_status', ['active', 'suspended', 'cancelled']);
export const signupStatus = pgEnum('signup_status', ['pending', 'approved', 'rejected']);
export const storeType = pgEnum('store_type', ['shop', 'warehouse', 'restaurant']);
export const deviceKind = pgEnum('device_kind', ['till', 'handheld', 'kitchen_display', 'kiosk']);
export const productKind = pgEnum('product_kind', [
  'standard', // stocked goods sold as-is
  'service', // no stock (delivery fee, labour)
  'menu_item', // restaurant dish; stock deducted through its recipe
  'bundle', // sold as one item, made of other items
]);
export const stockMovementType = pgEnum('stock_movement_type', [
  'opening',
  'receive',
  'sale',
  'return',
  'adjustment',
  'transfer_in',
  'transfer_out',
  'waste',
]);
export const accountType = pgEnum('account_type', ['asset', 'liability', 'equity', 'income', 'expense']);
export const journalSource = pgEnum('journal_source', [
  'manual',
  'opening',
  'invoice',
  'invoice_payment',
  'bill',
  'bill_payment',
  'expense',
  'transfer',
  'stock',
  'sale',
  'sale_return',
  'cash_transfer',
  'reversal',
]);
export const documentStatus = pgEnum('document_status', ['posted', 'void']);
export const paymentKind = pgEnum('payment_kind', ['invoice_receipt', 'bill_payment']);

// ---------------------------------------------------------------------------
// Tenancy, identity and access
// ---------------------------------------------------------------------------

export const tenants = pgTable(
  'tenants',
  {
    id: id(),
    name: text('name').notNull(),
    businessType: businessType('business_type').notNull().default('retail'),
    country: text('country').notNull().default('ZW'),
    baseCurrency: text('base_currency').notNull().default('USD'),
    timezone: text('timezone').notNull().default('Africa/Harare'),
    // Fiscal / tax registration (printed on receipts, sent to ZIMRA FDMS)
    tin: text('tin'),
    vatNumber: text('vat_number'),
    address: text('address'),
    phone: text('phone'),
    email: text('email'),
    /** Accounting: no journal entry may be dated on or before this day (month-end close). */
    booksClosedThrough: date('books_closed_through', { mode: 'string' }),
    // Subscription, managed by Floatly staff only (a database trigger refuses other changes).
    planId: uuid('plan_id').references((): AnyPgColumn => plans.id, { onDelete: 'set null' }),
    billingPeriod: billingPeriod('billing_period'),
    subscriptionStatus: subscriptionStatus('subscription_status').notNull().default('active'),
    /** Paid up to and including this day. Null: no end date (complimentary). */
    currentPeriodEnd: date('current_period_end', { mode: 'string' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // A tenant is visible when it is the active tenant. With no active tenant (at sign-in),
    // a user can see the businesses they belong to, to choose one.
    pgPolicy('tenant_access', {
      as: 'permissive',
      for: 'select',
      to: appRole,
      using: sql`${t.id} = ${currentTenant} OR (${currentTenant} IS NULL AND ${t.id} IN (SELECT m.tenant_id FROM memberships m WHERE m.user_id = ${currentUser}))`,
    }),
    pgPolicy('tenant_write', {
      as: 'permissive',
      for: 'all',
      to: appRole,
      using: sql`${t.id} = ${currentTenant}`,
      withCheck: sql`${t.id} = ${currentTenant}`,
    }),
  ],
);

/** Global identities. One person can belong to several businesses through memberships. */
export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  /** Floatly staff who can see every business in the platform console. Granted with `npm run platform:admin`. */
  isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRole('role').notNull(),
    /** Hashed 4–6 digit PIN for quick sign-in on a till. */
    pinHash: text('pin_hash'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('memberships_tenant_user_uq').on(t.tenantId, t.userId),
    index('memberships_user_idx').on(t.userId),
    tenantIsolation(t),
    // At sign-in (no active tenant) a user may read their own memberships across tenants
    // to choose a business. Inside a tenant only that tenant's memberships are visible.
    pgPolicy('own_memberships', {
      as: 'permissive',
      for: 'select',
      to: appRole,
      using: sql`${currentTenant} IS NULL AND ${t.userId} = ${currentUser}`,
    }),
  ],
);

export const stores = pgTable(
  'stores',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    code: text('code').notNull(),
    type: storeType('type').notNull().default('shop'),
    address: text('address'),
    phone: text('phone'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('stores_tenant_code_uq').on(t.tenantId, t.code), tenantIsolation(t)],
);

/** Which stores a staff member may work in. No rows = all stores (owners, admins). */
export const storeStaff = pgTable(
  'store_staff',
  {
    tenantId: tenantId(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.membershipId] }), tenantIsolation(t)],
);

/** A registered till, handheld, kitchen screen or kiosk. Each signs in with its own token. */
export const devices = pgTable(
  'devices',
  {
    id: id(),
    tenantId: tenantId(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Short code printed on receipts and used in receipt numbers, e.g. T01. */
    code: text('code').notNull(),
    kind: deviceKind('kind').notNull().default('till'),
    tokenHash: text('token_hash'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('devices_store_code_uq').on(t.storeId, t.code), tenantIsolation(t)],
);

// ---------------------------------------------------------------------------
// Money and tax
// ---------------------------------------------------------------------------

/** Currencies a business accepts (e.g. USD and ZiG) with the rate against the base currency. */
export const currencies = pgTable(
  'currencies',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    symbol: text('symbol').notNull(),
    /** How many units of this currency equal 1 unit of the base currency. */
    rateToBase: numeric('rate_to_base', { precision: 18, scale: 6 }).notNull().default('1'),
    isBase: boolean('is_base').notNull().default(false),
    active: boolean('active').notNull().default(true),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('currencies_tenant_code_uq').on(t.tenantId, t.code), tenantIsolation(t)],
);

export const taxRates = pgTable(
  'tax_rates',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    code: text('code').notNull(),
    /** Percentage, e.g. 15.50 */
    rate: numeric('rate', { precision: 5, scale: 2 }).notNull(),
    /** True when shelf prices already include this tax. */
    inclusive: boolean('inclusive').notNull().default(true),
    /** Tax identifier expected by the fiscal authority (ZIMRA FDMS taxID). */
    fiscalTaxId: integer('fiscal_tax_id'),
    isDefault: boolean('is_default').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('tax_rates_tenant_code_uq').on(t.tenantId, t.code), tenantIsolation(t)],
);

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const categories = pgTable(
  'categories',
  {
    id: id(),
    tenantId: tenantId(),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    color: text('color'),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('categories_tenant_idx').on(t.tenantId), tenantIsolation(t)],
);

export const units = pgTable(
  'units',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    abbreviation: text('abbreviation').notNull(),
    /** kg, litres → true; pieces → false */
    allowsDecimal: boolean('allows_decimal').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('units_tenant_abbr_uq').on(t.tenantId, t.abbreviation), tenantIsolation(t)],
);

export const products = pgTable(
  'products',
  {
    id: id(),
    tenantId: tenantId(),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    taxRateId: uuid('tax_rate_id').references(() => taxRates.id, { onDelete: 'set null' }),
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description'),
    kind: productKind('kind').notNull().default('standard'),
    trackStock: boolean('track_stock').notNull().default(true),
    /** Price is entered from a scale (weight/volume) at the till. */
    soldByWeight: boolean('sold_by_weight').notNull().default(false),
    /** Restaurant: which kitchen/bar printer station prepares it. */
    kitchenStation: text('kitchen_station'),
    imageUrl: text('image_url'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('products_tenant_category_idx').on(t.tenantId, t.categoryId),
    index('products_tenant_name_idx').on(t.tenantId, t.name),
    tenantIsolation(t),
  ],
);

/** What is actually sold and stocked. Every product has at least one (the default) variant. */
export const productVariants = pgTable(
  'product_variants',
  {
    id: id(),
    tenantId: tenantId(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    name: text('name').notNull().default('Default'),
    sku: text('sku'),
    barcode: text('barcode'),
    /** Selling price in the base currency (retail price). */
    price: money('price').notNull(),
    costPrice: money('cost_price'),
    reorderLevel: qty('reorder_level'),
    isDefault: boolean('is_default').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('variants_product_idx').on(t.productId),
    uniqueIndex('variants_tenant_barcode_uq')
      .on(t.tenantId, t.barcode)
      .where(sql`${t.barcode} IS NOT NULL`),
    uniqueIndex('variants_tenant_sku_uq')
      .on(t.tenantId, t.sku)
      .where(sql`${t.sku} IS NOT NULL`),
    tenantIsolation(t),
  ],
);

/** Wholesale packs: the same variant sold as a case/carton with its own barcode and price. */
export const productPackagings = pgTable(
  'product_packagings',
  {
    id: id(),
    tenantId: tenantId(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Base units in one pack, e.g. 24. */
    quantity: qty('quantity').notNull(),
    barcode: text('barcode'),
    price: money('price'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('packagings_tenant_barcode_uq')
      .on(t.tenantId, t.barcode)
      .where(sql`${t.barcode} IS NOT NULL`),
    tenantIsolation(t),
  ],
);

/** Named price lists (Retail, Wholesale, Staff…) with optional quantity breaks. */
export const priceLists = pgTable(
  'price_lists',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    currencyCode: text('currency_code').notNull().default('USD'),
    isDefault: boolean('is_default').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [tenantIsolation(t)],
);

export const priceListItems = pgTable(
  'price_list_items',
  {
    id: id(),
    tenantId: tenantId(),
    priceListId: uuid('price_list_id')
      .notNull()
      .references(() => priceLists.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    /** The price of one of this pack (a case of 24…) rather than of a single item. */
    packagingId: uuid('packaging_id').references(() => productPackagings.id, { onDelete: 'cascade' }),
    /** Price applies from this quantity upwards (quantity breaks for wholesale); for a pack, how many packs. */
    minQuantity: qty('min_quantity').notNull().default('1'),
    price: money('price').notNull(),
  },
  (t) => [
    // One price per list, item (or pack) and quantity; NULLS NOT DISTINCT so single-item prices (no pack) are unique too.
    unique('price_list_items_uq').on(t.priceListId, t.variantId, t.packagingId, t.minQuantity).nullsNotDistinct(),
    tenantIsolation(t),
  ],
);

/** Variant attributes (Size, Colour, Flavour…) and their values, used to build product variants. */
export const attributes = pgTable(
  'attributes',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('attributes_tenant_name_uq').on(t.tenantId, t.name), tenantIsolation(t)],
);

export const attributeValues = pgTable(
  'attribute_values',
  {
    id: id(),
    tenantId: tenantId(),
    attributeId: uuid('attribute_id')
      .notNull()
      .references(() => attributes.id, { onDelete: 'cascade' }),
    value: text('value').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [uniqueIndex('attribute_values_uq').on(t.attributeId, t.value), tenantIsolation(t)],
);

/** A different selling price for a variant in one store (e.g. a branch in a pricier area). */
export const storePrices = pgTable(
  'store_prices',
  {
    tenantId: tenantId(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    price: money('price').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.variantId] }), tenantIsolation(t)],
);

/** Restaurant modifiers: "Choose a side" (pick 1), "Extras" (pick 0–3)… */
export const modifierGroups = pgTable(
  'modifier_groups',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    minSelect: integer('min_select').notNull().default(0),
    maxSelect: integer('max_select').notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [tenantIsolation(t)],
);

export const modifiers = pgTable(
  'modifiers',
  {
    id: id(),
    tenantId: tenantId(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => modifierGroups.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    priceDelta: money('price_delta').notNull().default('0'),
    /** Optional stock item consumed when chosen (e.g. extra cheese). */
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'set null' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [tenantIsolation(t)],
);

export const productModifierGroups = pgTable(
  'product_modifier_groups',
  {
    tenantId: tenantId(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => modifierGroups.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.productId, t.groupId] }), tenantIsolation(t)],
);

/** Recipes and bundles: selling the parent consumes these component quantities. */
export const productComponents = pgTable(
  'product_components',
  {
    tenantId: tenantId(),
    parentVariantId: uuid('parent_variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    componentVariantId: uuid('component_variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    quantity: qty('quantity').notNull(),
  },
  (t) => [primaryKey({ columns: [t.parentVariantId, t.componentVariantId] }), tenantIsolation(t)],
);

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

/** Groups of customers (Staff, Schools, Wholesale…) with a default discount. */
export const customerGroups = pgTable(
  'customer_groups',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    description: text('description'),
    /** Percentage taken off each line when a sale is made to someone in this group. */
    discountPercent: numeric('discount_percent', { precision: 5, scale: 2 }).notNull().default('0'),
    priceListId: uuid('price_list_id').references(() => priceLists.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('customer_groups_tenant_name_uq').on(t.tenantId, t.name), tenantIsolation(t)],
);

export const customers = pgTable(
  'customers',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    /** Buyer tax details required on ZIMRA fiscal tax invoices. */
    tin: text('tin'),
    vatNumber: text('vat_number'),
    /** Wholesale customers can be tied to a price list and given credit. */
    priceListId: uuid('price_list_id').references(() => priceLists.id, { onDelete: 'set null' }),
    creditLimit: money('credit_limit'),
    groupId: uuid('group_id').references(() => customerGroups.id, { onDelete: 'set null' }),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('customers_tenant_name_idx').on(t.tenantId, t.name),
    index('customers_tenant_phone_idx').on(t.tenantId, t.phone),
    tenantIsolation(t),
  ],
);

// ---------------------------------------------------------------------------
// Inventory ledger
// ---------------------------------------------------------------------------

/**
 * Append-only stock ledger. Never updated or deleted (the API role has no
 * UPDATE/DELETE grant on it). Corrections are new 'adjustment' rows.
 * `clientId` is an idempotency key so a till retrying an offline sync never
 * double-counts.
 */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: id(),
    tenantId: tenantId(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    /** Signed, in base units: +received, −sold. */
    quantity: qty('quantity').notNull(),
    type: stockMovementType('type').notNull(),
    unitCost: money('unit_cost'),
    reference: text('reference'),
    note: text('note'),
    clientId: uuid('client_id'),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('stock_movements_store_variant_idx').on(t.tenantId, t.storeId, t.variantId),
    uniqueIndex('stock_movements_client_uq')
      .on(t.tenantId, t.clientId)
      .where(sql`${t.clientId} IS NOT NULL`),
    tenantIsolation(t),
  ],
);

// ---------------------------------------------------------------------------
// Accounting
// ---------------------------------------------------------------------------
//
// Double-entry general ledger. Every invoice, bill, payment, expense and
// stock movement posts a journal entry whose debits equal its credits (a
// deferred database trigger refuses any that don't). Entries are append-only:
// mistakes are undone with a reversing entry, never by editing.
//
// Documents can be in any currency the business accepts. Each stores the rate
// used and its amounts in the base currency; the ledger itself is kept in the
// base currency, with the original currency amount kept on each line.

/** Chart of accounts. `systemKey` marks the accounts the API posts to automatically. */
export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: accountType('type').notNull(),
    /** e.g. 'receivables', 'payables', 'inventory', 'vat_output'. Null for accounts people add. */
    systemKey: text('system_key'),
    /** Cash, bank and mobile money accounts: money can be paid from or into them. */
    isBank: boolean('is_bank').notNull().default(false),
    description: text('description'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('accounts_tenant_code_uq').on(t.tenantId, t.code),
    uniqueIndex('accounts_tenant_system_key_uq')
      .on(t.tenantId, t.systemKey)
      .where(sql`${t.systemKey} IS NOT NULL`),
    tenantIsolation(t),
  ],
);

/** Running number per tenant and document kind (JE-00001, INV-00001…). */
export const documentCounters = pgTable(
  'document_counters',
  {
    tenantId: tenantId(),
    kind: text('kind').notNull(),
    lastNumber: integer('last_number').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.kind] }), tenantIsolation(t)],
);

export const journalEntries = pgTable(
  'journal_entries',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    description: text('description').notNull(),
    source: journalSource('source').notNull(),
    /** The invoice, bill, payment… that produced this entry. */
    sourceId: uuid('source_id'),
    reference: text('reference'),
    /** Set on a reversing entry: the entry it cancels. */
    reversesId: uuid('reverses_id'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('journal_entries_tenant_number_uq').on(t.tenantId, t.number),
    uniqueIndex('journal_entries_reverses_uq')
      .on(t.reversesId)
      .where(sql`${t.reversesId} IS NOT NULL`),
    index('journal_entries_tenant_date_idx').on(t.tenantId, t.date),
    index('journal_entries_source_idx').on(t.tenantId, t.sourceId),
    tenantIsolation(t),
  ],
);

export const journalLines = pgTable(
  'journal_lines',
  {
    id: id(),
    tenantId: tenantId(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => journalEntries.id, { onDelete: 'restrict' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    /** Base currency. Exactly one of debit / credit is non-zero. */
    debit: money('debit').notNull().default('0'),
    credit: money('credit').notNull().default('0'),
    /** The amount in the currency it happened in, when that wasn't the base currency. */
    currencyCode: text('currency_code'),
    foreignAmount: money('foreign_amount'),
    rate: numeric('rate', { precision: 18, scale: 6 }),
    memo: text('memo'),
  },
  (t) => [
    index('journal_lines_entry_idx').on(t.entryId),
    index('journal_lines_account_idx').on(t.tenantId, t.accountId),
    check('journal_lines_one_side', sql`${t.debit} >= 0 AND ${t.credit} >= 0 AND (${t.debit} = 0) <> (${t.credit} = 0)`),
    tenantIsolation(t),
  ],
);

export const suppliers = pgTable(
  'suppliers',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    contactName: text('contact_name'),
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    tin: text('tin'),
    vatNumber: text('vat_number'),
    /** Days until a bill is due, used to suggest the due date. */
    paymentTermsDays: integer('payment_terms_days').notNull().default(30),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('suppliers_tenant_name_idx').on(t.tenantId, t.name), tenantIsolation(t)],
);

/** Columns shared by customer invoices and supplier bills. */
const documentColumns = () => ({
  id: id(),
  tenantId: tenantId(),
  number: text('number').notNull(),
  date: date('date', { mode: 'string' }).notNull(),
  dueDate: date('due_date', { mode: 'string' }).notNull(),
  currencyCode: text('currency_code').notNull(),
  /** Units of the document currency per 1 base currency unit, fixed when the document was posted. */
  rate: numeric('rate', { precision: 18, scale: 6 }).notNull().default('1'),
  /** True when the line prices already include tax. */
  taxInclusive: boolean('tax_inclusive').notNull().default(false),
  subtotal: money('subtotal').notNull(),
  taxTotal: money('tax_total').notNull(),
  total: money('total').notNull(),
  totalBase: money('total_base').notNull(),
  status: documentStatus('status').notNull().default('posted'),
  notes: text('notes'),
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id, { onDelete: 'restrict' }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

const documentLineColumns = () => ({
  id: id(),
  tenantId: tenantId(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'restrict' }),
  description: text('description').notNull(),
  quantity: qty('quantity').notNull().default('1'),
  unitPrice: money('unit_price').notNull(),
  taxRateId: uuid('tax_rate_id').references(() => taxRates.id, { onDelete: 'restrict' }),
  /** Document currency, excluding tax. */
  net: money('net').notNull(),
  tax: money('tax').notNull(),
  /** The same in the base currency. */
  netBase: money('net_base').notNull(),
  taxBase: money('tax_base').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});

/** Sales on credit: what a customer owes. */
export const invoices = pgTable(
  'invoices',
  {
    ...documentColumns(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
  },
  (t) => [
    uniqueIndex('invoices_tenant_number_uq').on(t.tenantId, t.number),
    index('invoices_tenant_customer_idx').on(t.tenantId, t.customerId),
    tenantIsolation(t),
  ],
);

export const invoiceLines = pgTable(
  'invoice_lines',
  {
    ...documentLineColumns(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
  },
  (t) => [index('invoice_lines_invoice_idx').on(t.invoiceId), tenantIsolation(t)],
);

/** Supplier invoices: what the business owes. */
export const bills = pgTable(
  'bills',
  {
    ...documentColumns(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    /** The supplier's own invoice number. */
    supplierReference: text('supplier_reference'),
    /** Set on purchases: the store the goods were received into. */
    storeId: uuid('store_id').references(() => stores.id, { onDelete: 'restrict' }),
  },
  (t) => [
    uniqueIndex('bills_tenant_number_uq').on(t.tenantId, t.number),
    index('bills_tenant_supplier_idx').on(t.tenantId, t.supplierId),
    tenantIsolation(t),
  ],
);

export const billLines = pgTable(
  'bill_lines',
  {
    ...documentLineColumns(),
    billId: uuid('bill_id')
      .notNull()
      .references(() => bills.id, { onDelete: 'cascade' }),
    /** Purchases: the item received. */
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'restrict' }),
  },
  (t) => [index('bill_lines_bill_idx').on(t.billId), tenantIsolation(t)],
);

/** Money received against an invoice, or paid against a bill. Always in the document's currency. */
export const payments = pgTable(
  'payments',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    kind: paymentKind('kind').notNull(),
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'restrict' }),
    billId: uuid('bill_id').references(() => bills.id, { onDelete: 'restrict' }),
    /** The cash, bank or mobile money account the money went into or came out of. */
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    date: date('date', { mode: 'string' }).notNull(),
    currencyCode: text('currency_code').notNull(),
    rate: numeric('rate', { precision: 18, scale: 6 }).notNull().default('1'),
    amount: money('amount').notNull(),
    /** Base value of the money moved, at the payment's rate. */
    amountBase: money('amount_base').notNull(),
    /** Base value taken off the invoice or bill, at the document's rate. The gap is an exchange gain or loss. */
    clearedBase: money('cleared_base').notNull(),
    reference: text('reference'),
    status: documentStatus('status').notNull().default('posted'),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('payments_tenant_number_uq').on(t.tenantId, t.number),
    index('payments_invoice_idx').on(t.invoiceId),
    index('payments_bill_idx').on(t.billId),
    check(
      'payments_one_document',
      sql`(${t.kind} = 'invoice_receipt' AND ${t.invoiceId} IS NOT NULL AND ${t.billId} IS NULL) OR (${t.kind} = 'bill_payment' AND ${t.billId} IS NOT NULL AND ${t.invoiceId} IS NULL)`,
    ),
    tenantIsolation(t),
  ],
);

/** Money paid out straight away, without a supplier bill (rent, fuel, bank charges…). */
export const expenses = pgTable(
  'expenses',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    /** What it was spent on (an expense or asset account). */
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    /** Where the money came from (a cash, bank or mobile money account). */
    paidFromAccountId: uuid('paid_from_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
    payee: text('payee'),
    description: text('description').notNull(),
    reference: text('reference'),
    currencyCode: text('currency_code').notNull(),
    rate: numeric('rate', { precision: 18, scale: 6 }).notNull().default('1'),
    taxRateId: uuid('tax_rate_id').references(() => taxRates.id, { onDelete: 'restrict' }),
    /** Amount paid, including any tax. */
    total: money('total').notNull(),
    net: money('net').notNull(),
    tax: money('tax').notNull(),
    netBase: money('net_base').notNull(),
    taxBase: money('tax_base').notNull(),
    status: documentStatus('status').notNull().default('posted'),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('expenses_tenant_number_uq').on(t.tenantId, t.number),
    index('expenses_tenant_date_idx').on(t.tenantId, t.date),
    tenantIsolation(t),
  ],
);

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------
//
// One table holds sales, returns (refunds of an earlier sale) and quotations.
// A completed sale takes stock out through the stock ledger and posts its
// money, VAT and cost of goods to the general ledger in the same transaction.

export const saleType = pgEnum('sale_type', ['sale', 'return', 'quotation']);
export const saleStatus = pgEnum('sale_status', ['open', 'completed', 'converted', 'cancelled', 'void']);
export const paymentMethod = pgEnum('payment_method', ['cash', 'card', 'mobile', 'bank']);
export const kitchenStatus = pgEnum('kitchen_status', ['pending', 'preparing', 'ready', 'served']);
export const fiscalStatus = pgEnum('fiscal_status', ['not_required', 'pending', 'submitted', 'failed']);

/** A cashier's session on a till: opening float, sales, cash drops and the count at close. */
export const shifts = pgTable(
  'shifts',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
    cashierId: uuid('cashier_id').references(() => users.id, { onDelete: 'set null' }),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /** Cash in the drawer at the start, per currency: { "USD": "20.00" }. */
    openingFloat: jsonb('opening_float').$type<Record<string, string>>().notNull().default({}),
    /** Cash counted at close, per currency. */
    countedCash: jsonb('counted_cash').$type<Record<string, string>>(),
    note: text('note'),
  },
  (t) => [
    uniqueIndex('shifts_tenant_number_uq').on(t.tenantId, t.number),
    index('shifts_store_idx').on(t.tenantId, t.storeId, t.openedAt),
    tenantIsolation(t),
  ],
);

export const sales = pgTable(
  'sales',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    type: saleType('type').notNull().default('sale'),
    status: saleStatus('status').notNull().default('completed'),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
    shiftId: uuid('shift_id').references(() => shifts.id, { onDelete: 'set null' }),
    /** The till app's version, for support. Null for sales made in the backoffice. */
    appVersion: text('app_version'),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    /** Name and tax details printed on the receipt (kept even if the customer record changes). */
    customerName: text('customer_name').notNull().default('Cash Customer'),
    /** Prices came from this price list (Wholesale…); null for normal (retail) prices. */
    priceListId: uuid('price_list_id').references(() => priceLists.id, { onDelete: 'set null' }),
    salespersonId: uuid('salesperson_id').references(() => users.id, { onDelete: 'set null' }),
    /** For a return: the sale being refunded. For a sale made from a quotation: that quotation. */
    originalSaleId: uuid('original_sale_id'),
    soldAt: timestamp('sold_at', { withTimezone: true }).notNull().defaultNow(),
    currencyCode: text('currency_code').notNull(),
    /** Units of the sale currency per 1 base unit. */
    rate: numeric('rate', { precision: 18, scale: 6 }).notNull().default('1'),
    /** Sale currency, tax included. */
    subtotal: money('subtotal').notNull(),
    discountTotal: money('discount_total').notNull().default('0'),
    taxTotal: money('tax_total').notNull(),
    total: money('total').notNull(),
    totalBase: money('total_base').notNull(),
    costBase: money('cost_base').notNull().default('0'),
    itemCount: qty('item_count').notNull().default('0'),
    fiscalStatus: fiscalStatus('fiscal_status').notNull().default('not_required'),
    fiscalReference: text('fiscal_reference'),
    note: text('note'),
    /** Quotations: valid until this day. */
    validUntil: date('valid_until', { mode: 'string' }),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id, { onDelete: 'restrict' }),
    /** Idempotency key from the till, so an offline sale synced twice is recorded once. */
    clientId: uuid('client_id'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('sales_tenant_number_uq').on(t.tenantId, t.number),
    uniqueIndex('sales_tenant_client_uq')
      .on(t.tenantId, t.clientId)
      .where(sql`${t.clientId} IS NOT NULL`),
    index('sales_tenant_sold_idx').on(t.tenantId, t.soldAt),
    index('sales_original_idx').on(t.originalSaleId),
    tenantIsolation(t),
  ],
);

/** A modifier chosen on a sale line, kept as it was when sold. */
export interface SoldModifier {
  id: string;
  name: string;
  groupName: string;
  /** Added to the line's unit price, base currency. */
  priceDelta: string;
  /** Stock item it uses up, one per item sold. */
  variantId: string | null;
  /** That stock item's cost when sold, base currency (so a refund puts it back at the same cost). */
  unitCost: string | null;
}

export const saleLines = pgTable(
  'sale_lines',
  {
    id: id(),
    tenantId: tenantId(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    /** For a return line: the sale line it refunds. */
    originalLineId: uuid('original_line_id'),
    productName: text('product_name').notNull(),
    variantName: text('variant_name').notNull(),
    /** Sold as a pack (a case of 24…): then `quantity` counts packs and `unitPrice` is per pack. */
    packagingId: uuid('packaging_id').references(() => productPackagings.id, { onDelete: 'set null' }),
    packName: text('pack_name'),
    /** Stock units in one of `quantity`: the pack size, else 1. Stock and item reports count quantity × unitsPerPack. */
    unitsPerPack: qty('units_per_pack').notNull().default('1'),
    /** Restaurant choices (a side, extras) as sold, with the price each added. */
    modifiers: jsonb('modifiers').$type<SoldModifier[]>(),
    quantity: qty('quantity').notNull(),
    /** Sale currency, tax included, before discount. */
    unitPrice: money('unit_price').notNull(),
    discount: money('discount').notNull().default('0'),
    taxRateId: uuid('tax_rate_id').references(() => taxRates.id, { onDelete: 'set null' }),
    taxRateName: text('tax_rate_name'),
    /** Sale currency. total = net + tax. */
    net: money('net').notNull(),
    tax: money('tax').notNull(),
    total: money('total').notNull(),
    netBase: money('net_base').notNull(),
    taxBase: money('tax_base').notNull(),
    /** Cost of what was sold (recipe ingredients for menu items), base currency. */
    costBase: money('cost_base').notNull().default('0'),
    kitchenStation: text('kitchen_station'),
    kitchenStatus: kitchenStatus('kitchen_status'),
    note: text('note'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    index('sale_lines_sale_idx').on(t.saleId),
    index('sale_lines_kitchen_idx')
      .on(t.tenantId, t.kitchenStatus)
      .where(sql`${t.kitchenStatus} IS NOT NULL`),
    tenantIsolation(t),
  ],
);

export const salePayments = pgTable(
  'sale_payments',
  {
    id: id(),
    tenantId: tenantId(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    method: paymentMethod('method').notNull(),
    /** The currency the customer paid in (may differ from the sale currency). */
    currencyCode: text('currency_code').notNull(),
    rate: numeric('rate', { precision: 18, scale: 6 }).notNull().default('1'),
    /** Tendered, in currencyCode. Refunds are negative. */
    amount: money('amount').notNull(),
    /** Change handed back, in currencyCode. */
    change: money('change').notNull().default('0'),
    /** Kept by the business (amount − change), base currency. */
    amountBase: money('amount_base').notNull(),
    reference: text('reference'),
  },
  (t) => [index('sale_payments_sale_idx').on(t.saleId), tenantIsolation(t)],
);

/** Cash taken out of a store's till: banked, sent to head office, or moved to another store. */
export const cashTransfers = pgTable(
  'cash_transfers',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    shiftId: uuid('shift_id').references(() => shifts.id, { onDelete: 'set null' }),
    /** A bank or other money account the cash went into… */
    toAccountId: uuid('to_account_id').references(() => accounts.id, { onDelete: 'restrict' }),
    /** …or another store's till. */
    toStoreId: uuid('to_store_id').references(() => stores.id, { onDelete: 'restrict' }),
    currencyCode: text('currency_code').notNull(),
    rate: numeric('rate', { precision: 18, scale: 6 }).notNull().default('1'),
    amount: money('amount').notNull(),
    amountBase: money('amount_base').notNull(),
    reference: text('reference'),
    note: text('note'),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('cash_transfers_tenant_number_uq').on(t.tenantId, t.number),
    check('cash_transfers_one_destination', sql`(${t.toAccountId} IS NULL) <> (${t.toStoreId} IS NULL)`),
    tenantIsolation(t),
  ],
);

// ---------------------------------------------------------------------------
// Subscriptions (Floatly's own billing)
// ---------------------------------------------------------------------------

/** What businesses can subscribe to. Anyone can read them (the sign-up page shows prices); only Floatly staff change them. */
export const plans = pgTable(
  'plans',
  {
    id: id(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    monthlyPrice: money('monthly_price').notNull(),
    yearlyPrice: money('yearly_price').notNull(),
    currency: text('currency').notNull().default('USD'),
    /** Null: unlimited. */
    maxStores: integer('max_stores'),
    maxStaff: integer('max_staff'),
    features: jsonb('features').$type<string[]>().notNull().default([]),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [
    pgPolicy('plans_read', { as: 'permissive', for: 'select', to: appRole, using: sql`true` }),
    pgPolicy('plans_admin', { as: 'permissive', for: 'all', to: appRole, using: platformAdmin, withCheck: platformAdmin }),
  ],
);

/** A request to open a new business on Floatly, waiting for Floatly staff to approve it. */
export const signupRequests = pgTable(
  'signup_requests',
  {
    id: id(),
    businessName: text('business_name').notNull(),
    businessType: businessType('business_type').notNull(),
    country: text('country').notNull().default('ZW'),
    baseCurrency: text('base_currency').notNull().default('USD'),
    fullName: text('full_name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    /** The applicant's chosen password, already hashed; it becomes their login on approval. */
    passwordHash: text('password_hash').notNull(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    billingPeriod: billingPeriod('billing_period').notNull(),
    message: text('message'),
    status: signupStatus('status').notNull().default('pending'),
    /** Reason given when turning a request down, shown to the applicant. */
    decisionNote: text('decision_note'),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('signup_requests_status_idx').on(t.status, t.createdAt),
    uniqueIndex('signup_requests_pending_email_uq')
      .on(t.email)
      .where(sql`${t.status} = 'pending'`),
    // Anyone may ask (the API checks the details); only Floatly staff may read or decide.
    pgPolicy('signup_requests_submit', { as: 'permissive', for: 'insert', to: appRole, withCheck: sql`${t.status} = 'pending'` }),
    pgPolicy('signup_requests_admin', { as: 'permissive', for: 'all', to: appRole, using: platformAdmin, withCheck: platformAdmin }),
  ],
);

/** Money a business paid Floatly, and the period it covers. Recorded by Floatly staff. */
export const subscriptionPayments = pgTable(
  'subscription_payments',
  {
    id: id(),
    tenantId: tenantId(),
    planId: uuid('plan_id').references(() => plans.id, { onDelete: 'set null' }),
    billingPeriod: billingPeriod('billing_period').notNull(),
    amount: money('amount').notNull(),
    currency: text('currency').notNull(),
    /** EcoCash, bank transfer, cash… */
    method: text('method').notNull(),
    reference: text('reference'),
    periodStart: date('period_start', { mode: 'string' }).notNull(),
    periodEnd: date('period_end', { mode: 'string' }).notNull(),
    note: text('note'),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('subscription_payments_tenant_idx').on(t.tenantId, t.periodEnd),
    // A business sees its own payments; Floatly staff see and record all of them.
    pgPolicy('subscription_payments_read', { as: 'permissive', for: 'select', to: appRole, using: sql`${t.tenantId} = ${currentTenant} OR is_platform_admin()` }),
    pgPolicy('subscription_payments_record', { as: 'permissive', for: 'insert', to: appRole, withCheck: platformAdmin }),
  ],
);

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    data: jsonb('data'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_tenant_created_idx').on(t.tenantId, t.createdAt), tenantIsolation(t)],
);
