/**
 * Thin client for the Floatly API. The access token lives in localStorage; every
 * request sends it as a bearer token. A 401 clears it and returns to sign-in.
 */
/**
 * Where the API is. With Docker it is "/api/v1" on the same domain (see docker/Caddyfile);
 * on Vercel it is the API project's address, e.g. "https://floatly-api.vercel.app/api/v1".
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

const TOKEN_KEY = "pos.token";

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* private mode: session lasts until reload */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

/** The platform console (Floatly staff) keeps its own sign-in, separate from any business. */
const PLATFORM_TOKEN_KEY = "floatly.platform.token";
export const platformTokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(PLATFORM_TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      localStorage.setItem(PLATFORM_TOKEN_KEY, token);
    } catch {
      /* private mode */
    }
  },
  clear() {
    try {
      localStorage.removeItem(PLATFORM_TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

/** Fired when the API says this business's Floatly subscription has lapsed (HTTP 402). */
export const SUBSCRIPTION_LAPSED_EVENT = "floatly:subscription-lapsed";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; query?: Query; platform?: boolean } = {},
): Promise<T> {
  // API_URL may be relative ("/api/v1") when the website and API share a domain.
  const url = new URL(API_URL + path, typeof window === "undefined" ? "http://localhost" : window.location.origin);
  for (const [k, v] of Object.entries(options.query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const store = options.platform ? platformTokenStore : tokenStore;
  const signIn = options.platform ? "/platform/login" : "/login";
  const token = store.get();
  let res: Response;
  try {
    res = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and that the API is running.");
  }

  if (res.status === 401 && token) {
    store.clear();
    if (typeof window !== "undefined" && !window.location.pathname.startsWith(signIn)) {
      // Not a component, so no router here; a full reload also clears cached data.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = `${signIn}?expired=1`;
    }
  }
  if (res.status === 402 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SUBSCRIPTION_LAPSED_EVENT));
  }
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = Array.isArray(body.message) ? body.message.join(". ") : (body.message ?? message);
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, sentence(message));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function sentence(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ----- Shared types (mirrors the API responses) ----------------------------

export type Role = "owner" | "admin" | "manager" | "cashier" | "waiter" | "stock_clerk" | "accountant";
export type BusinessType = "retail" | "wholesale" | "restaurant" | "mixed";

export interface Tenant {
  id: string;
  name: string;
  businessType: BusinessType;
  country: string;
  baseCurrency: string;
  timezone: string;
  tin: string | null;
  vatNumber: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

export interface Session {
  accessToken?: string;
  user: { id: string; email: string; fullName: string; phone: string | null };
  tenant: Tenant;
  membership: { id: string; role: Role };
  businesses: { tenantId: string; name: string; businessType: BusinessType; role: Role }[];
}

export interface Store {
  id: string;
  name: string;
  code: string;
  type: "shop" | "warehouse" | "restaurant";
  address: string | null;
  phone: string | null;
  active: boolean;
}

/** A device running the Floatly Till app. */
export interface Device {
  id: string;
  storeId: string;
  name: string;
  code: string;
  kind: "till" | "handheld" | "kitchen_display" | "kiosk";
  /** Set up on a device (it has a sign-in secret). */
  registered: boolean;
  lastSeenAt: string | null;
  active: boolean;
}

export interface Category {
  id: string;
  name: string;
  parentId: string | null;
  color: string | null;
  sortOrder: number;
  active: boolean;
}

export interface TaxRate {
  id: string;
  name: string;
  code: string;
  rate: string;
  inclusive: boolean;
  isDefault: boolean;
  active: boolean;
  fiscalTaxId: number | null;
}

export interface Unit {
  id: string;
  name: string;
  abbreviation: string;
  allowsDecimal: boolean;
}

export interface Currency {
  id: string;
  code: string;
  name: string;
  symbol: string;
  rateToBase: string;
  isBase: boolean;
  active: boolean;
}

export interface Packaging {
  id?: string;
  name: string;
  quantity: string;
  barcode: string | null;
  price: string | null;
}

export interface Variant {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  price: string;
  costPrice: string | null;
  reorderLevel: string | null;
  isDefault: boolean;
  active: boolean;
  packagings?: Packaging[];
}

export type ProductKind = "standard" | "service" | "menu_item" | "bundle";

export interface Product {
  id: string;
  name: string;
  description: string | null;
  kind: ProductKind;
  categoryId: string | null;
  categoryName?: string | null;
  taxRateId: string | null;
  unitId: string | null;
  trackStock: boolean;
  soldByWeight: boolean;
  kitchenStation: string | null;
  imageUrl: string | null;
  active: boolean;
  variants: Variant[];
  modifierGroups?: { id: string; name: string }[];
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StockLevel {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  sku: string | null;
  barcode: string | null;
  price: string;
  costPrice: string | null;
  reorderLevel: string | null;
  onHand: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  tin: string | null;
  vatNumber: string | null;
  priceListId: string | null;
  creditLimit: string | null;
  groupId?: string | null;
  active: boolean;
}

export interface StaffMember {
  id: string;
  userId: string;
  email: string;
  fullName: string;
  role: Role;
  active: boolean;
  hasPin: boolean;
  lastLoginAt: string | null;
  storeIds: string[];
}

export interface ModifierGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
}

// ----- Accounting ------------------------------------------------------------

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  systemKey: string | null;
  isBank: boolean;
  description: string | null;
  active: boolean;
  /** In the account's normal direction (assets and expenses debit, the rest credit). */
  balance: string;
  hasActivity: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tin: string | null;
  vatNumber: string | null;
  paymentTermsDays: number;
  active: boolean;
  owed?: string;
}

export type DocumentState = "unpaid" | "part_paid" | "overdue" | "paid" | "void";

export interface DocumentLine {
  id: string;
  accountId: string;
  accountName: string;
  accountCode: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRateId: string | null;
  taxRateName: string | null;
  net: string;
  tax: string;
}

export interface Payment {
  id: string;
  number: string;
  accountId: string;
  accountName: string;
  date: string;
  currencyCode: string;
  rate: string;
  amount: string;
  amountBase: string;
  clearedBase: string;
  reference: string | null;
  status: "posted" | "void";
}

/** A customer invoice or a supplier bill. */
export interface FinanceDocument {
  id: string;
  number: string;
  date: string;
  dueDate: string;
  currencyCode: string;
  rate: string;
  taxInclusive: boolean;
  subtotal: string;
  taxTotal: string;
  total: string;
  totalBase: string;
  status: "posted" | "void";
  state: DocumentState;
  amountPaid: string;
  balance: string;
  notes: string | null;
  journalEntryId: string | null;
  supplierReference?: string | null;
  /** Purchases: the store the goods went into. */
  storeName?: string | null;
  createdAt?: string;
  customerId?: string;
  supplierId?: string;
  /** Customer or supplier name, in lists. */
  partyName?: string;
  party?: { id: string; name: string; phone: string | null; email: string | null; address: string | null; tin: string | null; vatNumber: string | null };
  lines?: DocumentLine[];
  payments?: Payment[];
}

export interface Expense {
  id: string;
  number: string;
  date: string;
  accountId: string;
  accountName: string;
  paidFromAccountId: string;
  paidFromName: string;
  supplierName: string | null;
  payee: string | null;
  description: string;
  reference: string | null;
  currencyCode: string;
  total: string;
  net: string;
  tax: string;
  status: "posted" | "void";
}

export interface JournalLine {
  id: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
  memo: string | null;
  currencyCode: string | null;
  foreignAmount: string | null;
}

export interface JournalEntry {
  id: string;
  number: string;
  date: string;
  description: string;
  source: string;
  sourceId: string | null;
  reference: string | null;
  reversesId: string | null;
  reversedBy: string | null;
  createdByName: string | null;
  createdAt: string;
  lines: JournalLine[];
}

export interface AccountingSummary {
  currency: string;
  today: string;
  booksClosedThrough: string | null;
  moneyAccounts: { id: string; code: string; name: string; balance: string }[];
  receivables: string;
  payables: string;
  vatOwed: string;
  stockValue: string;
  overdueInvoices: { count: number; amount: string };
  overdueBills: { count: number; amount: string };
  thisMonth: { from: string; to: string; income: string; expenses: string; profit: string };
}

export interface Periods {
  baseCurrency: string;
  booksClosedThrough: string | null;
  today: string;
}

// ----- Stock management -------------------------------------------------------

export interface Attribute {
  id: string;
  name: string;
  sortOrder: number;
  values: { id: string; value: string }[];
}

export interface PriceList {
  id: string;
  name: string;
  currencyCode: string;
  isDefault: boolean;
  active: boolean;
}

export interface PriceListItem {
  id: string;
  variantId: string;
  minQuantity: string;
  price: string;
  productName: string;
  variantName: string;
  sku: string | null;
  basePrice: string;
}

export interface StorePriceRow {
  variantId: string;
  productName: string;
  variantName: string;
  sku: string | null;
  price: string;
  storePrice: string | null;
}

export interface StockMovementRow {
  id: string;
  createdAt: string;
  type: string;
  quantity: string;
  unitCost: string | null;
  value: string | null;
  reference: string | null;
  note: string | null;
  productName: string;
  variantName: string;
  sku: string | null;
  storeName: string;
  userName: string | null;
}

// ----- Sales -------------------------------------------------------------------

export type PaymentMethod = "cash" | "card" | "mobile" | "bank";
export type SaleType = "sale" | "return" | "quotation";
export type SaleStatus = "open" | "completed" | "converted" | "cancelled" | "void";

export interface SaleLine {
  id: string;
  variantId: string;
  productName: string;
  /** Sold as a pack (a case of 24…): quantity counts packs. */
  packName: string | null;
  unitsPerPack: string;
  /** Restaurant choices, as sold. */
  modifiers: { id: string; name: string; groupName: string; priceDelta: string }[] | null;
  variantName: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  taxRateName: string | null;
  net: string;
  tax: string;
  total: string;
  kitchenStation: string | null;
  kitchenStatus: "pending" | "preparing" | "ready" | "served" | null;
  note: string | null;
  returnedQuantity?: string;
}

export interface SalePayment {
  id: string;
  method: PaymentMethod;
  currencyCode: string;
  rate: string;
  amount: string;
  change: string;
  amountBase: string;
  reference: string | null;
}

export interface Sale {
  id: string;
  number: string;
  type: SaleType;
  status: SaleStatus;
  storeId: string;
  storeName: string;
  deviceName: string | null;
  appVersion: string | null;
  shiftId: string | null;
  customerId: string | null;
  customerName: string;
  salesperson: string | null;
  originalSaleId: string | null;
  soldAt: string;
  currencyCode: string;
  rate: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  totalBase: string;
  costBase: string;
  itemCount: string;
  fiscalStatus: "not_required" | "pending" | "submitted" | "failed";
  note: string | null;
  validUntil: string | null;
  journalEntryId: string | null;
  lines?: SaleLine[];
  payments?: SalePayment[];
  related?: { id: string; number: string; type: SaleType; status: SaleStatus; total: string; soldAt: string }[];
}

export interface CustomerGroup {
  id: string;
  name: string;
  description: string | null;
  discountPercent: string;
  priceListId: string | null;
  members?: number;
}

export interface CashLine {
  currencyCode: string;
  openingFloat: string;
  cashTaken: string;
  transferredOut: string;
  expected: string;
  counted: string | null;
  variance: string | null;
}

export interface Shift {
  id: string;
  number: string;
  storeId: string;
  storeName: string;
  deviceName: string | null;
  cashier: string | null;
  openedAt: string;
  closedAt: string | null;
  openingFloat: Record<string, string>;
  countedCash: Record<string, string> | null;
  note: string | null;
  salesCount: number;
  returnsCount: number;
  netSalesBase: string;
  nonCash: { method: PaymentMethod; currencyCode: string; amount: string }[];
  cash: CashLine[];
}

export interface CashTransfer {
  id: string;
  number: string;
  storeId: string;
  fromStore: string;
  toStore: string | null;
  toAccount: string | null;
  currencyCode: string;
  amount: string;
  amountBase: string;
  reference: string | null;
  note: string | null;
  createdByName: string | null;
  createdAt: string;
}

// ----- Platform console ---------------------------------------------------------

export interface PlatformBusiness {
  id: string;
  name: string;
  businessType: BusinessType;
  country: string;
  baseCurrency: string;
  vatNumber: string | null;
  createdAt: string;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerPhone: string | null;
  staff: number;
  stores: number;
  products: number;
  sales30d: number;
  takings30d: number;
  lastSaleAt: string | null;
  lastLoginAt: string | null;
}

export interface PlatformOverview {
  businesses: number;
  users: number;
  stores: number;
  products: number;
  newThisMonth: number;
  activeLast7Days: number;
  salesLast30Days: number;
  takingsLast30Days: { currency: string; amount: number }[];
  byType: Record<string, number>;
  signups: { month: string; count: number }[];
}

// ----- Subscriptions --------------------------------------------------------------

export type BillingPeriod = "monthly" | "yearly";
export type SubscriptionState = "active" | "grace" | "lapsed" | "suspended" | "cancelled" | "complimentary";

export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  monthlyPrice: string;
  yearlyPrice: string;
  currency: string;
  maxStores: number | null;
  maxStaff: number | null;
  features: string[];
  active?: boolean;
  sortOrder?: number;
}

export interface SubscriptionPayment {
  id: string;
  amount: string;
  currency: string;
  method: string;
  reference: string | null;
  billingPeriod: BillingPeriod;
  periodStart: string;
  periodEnd: string;
  note: string | null;
  createdAt: string;
  planName?: string | null;
  recordedBy?: string | null;
}

export interface MySubscription {
  planId: string | null;
  billingPeriod: BillingPeriod | null;
  status: "active" | "suspended" | "cancelled";
  currentPeriodEnd: string | null;
  state: SubscriptionState;
  plan: Plan | null;
  daysLeft: number | null;
  graceEnds: string | null;
  payments: SubscriptionPayment[];
  plans: Plan[];
}

export interface SignupRequest {
  id: string;
  businessName: string;
  businessType: BusinessType;
  country: string;
  baseCurrency: string;
  fullName: string;
  email: string;
  phone: string | null;
  planId: string;
  planName: string;
  billingPeriod: BillingPeriod;
  price: string;
  currency: string;
  message: string | null;
  status: "pending" | "approved" | "rejected";
  decisionNote: string | null;
  tenantId: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  createdAt: string;
}

export interface PlatformBilling {
  subscriptions: { tenantId: string; planId: string | null; planName: string | null; billingPeriod: BillingPeriod | null; status: string; currentPeriodEnd: string | null; state: SubscriptionState }[];
  pendingRequests: number;
  mrr: { currency: string; amount: number }[];
  endingSoon: number;
  lapsed: number;
}
