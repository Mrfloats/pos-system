# Floatly

Point of sale and backoffice for **retail shops, wholesalers and restaurants**.

| Part | Folder | Built with | Status |
| --- | --- | --- | --- |
| API | `apps/api` | NestJS 12, TypeScript, PostgreSQL 16, Drizzle ORM | Foundations done |
| Backoffice (web) | `apps/backoffice` | Next.js 16, React 19, Tailwind CSS 4, TanStack Query | Foundations done |
| Till app (Android countertop tills, phones, tablets, Windows, iOS, macOS) | `apps/till` | Flutter 3.47 | First version done |

## What's in this first version

- **Businesses and sign-up.** Each business is a tenant. Sign-up creates the first store, the base currency, tax rates (Zimbabwe VAT 15.5%, zero-rated, exempt), units and price lists.
- **Tenant isolation in the database.** PostgreSQL row-level security means one business can never read or change another's data, even if a query forgets a filter. The API connects as a restricted role (`pos_app`); migrations run as the owner (`pos_owner`).
- **Staff and roles.** Owner, admin, manager, cashier, waiter, stock clerk and accountant. Each person can have a 4–6 digit till PIN and be limited to certain stores. One login can belong to several businesses and switch between them.
- **Catalog for all three business types:**
  - Retail: products, variants, barcodes, SKUs, categories, tax per product, sold-by-weight.
  - Wholesale: packs (case of 24 with its own barcode and price), price lists with quantity breaks, customer credit limits.
  - Restaurant: menu items, kitchen stations, choice groups (sides, extras), recipes that use up ingredient stock.
- **Stock ledger.** Opening stock, goods received, adjustments, waste, transfers between stores and stock takes. Stock is never edited in place: every change is a new ledger row. The database refuses updates and deletes on the ledger, and retried requests are ignored using idempotency keys, ready for offline tills.
- **Customers** with TIN and VAT number for ZIMRA fiscal tax invoices.
- **Accounts.** A double-entry general ledger with a ready-made chart of accounts, suppliers and bills, customer invoices on credit, payments in and out, expenses, moving money between cash, bank and mobile money, manual journals, and month-end closing. Reports: profit and loss, balance sheet, trial balance, general ledger, VAT summary, and aged debtors and creditors. Documents can be in any currency the business accepts (USD, ZiG…); the books are kept in the base currency and exchange gains and losses are posted automatically. Stock received, written off or counted is valued into the ledger. The database refuses unbalanced entries, edits to posted entries, and postings into a closed period.
- **Sales.** Sales, returns and quotations, each paid by cash, card, mobile money or bank in any accepted currency (split payments, change in cash). A sale takes stock out (recipe ingredients for menu items), posts sales, VAT, cost of goods and the money to the ledger, and sends dishes to the kitchen board. Also shifts with cash-up, cash transfers, customer groups with discounts, CSV import, and reports: item, category, cashier and shop profitability, shift reconciliation, sales and purchases VAT, store cashbook, cash balance, daily sales and returns.
- **Suppliers and purchases.** A purchase is a supplier bill for stock: it receives the goods into a store at their cost (and can update cost prices), records what is owed or pays it on the spot, and posts straight to Stock and VAT. Purchase bills can be imported from CSV; voiding a purchase takes its goods back out.
- **Audit log** of who changed what.
- **Backoffice screens:** sign in, sign up, overview, products (list, add, edit), categories, stock, customers, staff and settings (business, stores, tills, tax rates, currencies).
- **Till app** ([apps/till](apps/till/README.md)) for Android countertop tills, phones and tablets, Windows PCs, and iPhones, iPads and Macs. An owner sets a till up once by signing in on it. Staff then sign in with their till PIN. It sells with barcode scanning, wholesale cases, restaurant sides and extras, customers and discounts, and any currency. Payments can be split across cash, card, mobile money and bank. It prints straight to Bluetooth, USB, network and Windows receipt printers (including Sunmi built-in printers), opens the cash drawer, and runs shifts with cash-up. Managers can do refunds. It keeps selling with no internet and uploads each sale exactly once when the connection is back.

## Run it on your computer

You need **Node.js 22 or newer** and **Docker Desktop**.

```bash
# 1. Install everything
npm install

# 2. Start PostgreSQL and Redis
npm run db:up

# 3. Create your local settings files
cp apps/api/.env.example apps/api/.env
cp apps/backoffice/.env.example apps/backoffice/.env.local

# 4. Create the tables, then load demo data
npm run db:migrate
npm run db:seed

# 5. Start the API (terminal 1) and the backoffice (terminal 2)
npm run dev:api
npm run dev:web
```

On Windows PowerShell, type `npm.cmd` instead of `npm` (PowerShell blocks `npm` by default), and use `copy` instead of `cp`.

Then open:

- Backoffice: http://localhost:3000
- API documentation: http://localhost:4000/api/docs

### Demo logins (password `demo1234`)

| Email | Role | Till PIN |
| --- | --- | --- |
| demo@pos.local | Owner of the supermarket *and* the restaurant | — |
| manager@pos.local | Manager | 5678 |
| cashier@pos.local | Cashier (Main Store only) | 1234 |

## Platform console (Floatly staff)

A separate, read-only console at http://localhost:3000/platform lists every business on Floatly: owners, staff, stores, products, takings and how recently each was used. It has its own sign-in; business logins cannot open it, and a platform login cannot open a business.

Give someone access (an existing login keeps its password; a new email needs one):

```bash
npm run platform:admin -- you@example.com "a long password" "Your Name"
npm run platform:admin -- you@example.com --revoke
```

Business data stays behind row-level security. The console reads it only through the `platform_*` database functions, which check the caller is a platform admin, and only the database owner role can grant that flag. Opening a business in the console is written to that business's own audit log.

### Sign-ups and subscriptions

New businesses don't open straight away. The sign-up page sends a **request** with the plan they chose (monthly or yearly); it waits under **Requests** in the platform console until Floatly staff approve it (optionally recording the first payment) or turn it down with a reason. Until then, signing in tells the applicant their request is waiting, or why it wasn't approved.

- **Plans** (prices, store and staff limits, features) are edited in the console under **Plans**. Limits are enforced when a business adds stores or staff.
- Each business is paid up to a date. **Record payment** on its console page adds one month or year. In the last week the business sees a reminder; after the date it has 7 days' grace, then everything except signing in and its Subscription page is refused (HTTP 402) until a payment is recorded. Staff can also suspend a business.
- Businesses can't change their own subscription: a database trigger only lets Floatly staff change those columns. Businesses that existed before subscriptions have no plan and no end date (complimentary) until staff set one.

## Tests

```bash
npm run test:api
```

The 91 end-to-end tests run against a real PostgreSQL test database (`pos_test`) as the restricted role. They cover sign-up, login, validation, catalog, wholesale packs and prices, restaurant menus, the stock ledger, accounting (postings, VAT, exchange gains, closing periods, and the database-level ledger rules), roles, people in several businesses, tenant isolation, and the till app's PIN sign-in, offline catalog, synced sales, switching a till off, and sales of cases and dishes with choices.

The till app has its own tests: `flutter test` in `apps/till` (see its README).

## Project layout

```
apps/
  api/
    drizzle/              SQL migrations (generated from src/db/schema.ts)
    src/
      db/schema.ts        every table, with its row-level security policy
      db/db.service.ts    withTenant(): runs queries inside one business
      auth/               sign-up, login, switch business
      organization/       business settings, stores, staff, devices
      catalog/            products, categories, tax, units, currencies, price lists, modifiers
      customers/          customers
      inventory/          stock levels, movements, transfers, stock takes
      accounting/         ledger, chart of accounts, invoices, bills, payments, expenses, reports
      sales/              sales, returns, quotations, kitchen, shifts, cash transfers, import, sales reports
      till/               the till app's catalog download (PIN sign-in is in auth/)
    test/                 end-to-end tests
  backoffice/
    src/app/(auth)/       sign in, sign up
    src/app/(app)/        the signed-in screens
    src/components/       shared UI
    src/lib/              API client, session, formatting
  till/                   Flutter till app (see apps/till/README.md)
    lib/state/            pairing, PIN sign-in, offline catalog, basket, shifts, upload queue
    lib/screens/          setup, PIN, till, payment, receipt, sales, refund, shifts
docker/postgres/init.sql  creates the database and the two roles
docker-compose.yml        PostgreSQL 16 and Redis 7 for development
```

## Changing the database

1. Edit `apps/api/src/db/schema.ts`. Give every new business table a `tenantId` column and the `tenantIsolation(t)` policy.
2. `npm run db:generate -w apps/api` writes a new SQL migration in `apps/api/drizzle/`.
3. `npm run db:migrate` applies it.

When a request links to another record by id (category, store, variant…), check it with `assertOwned()` first. Foreign keys are checked without row-level security, so this check is what stops links to another business's records.

## Next steps

1. **ZIMRA FDMS fiscalisation** and **Paynow** (EcoCash, OneMoney, InnBucks).
2. **Restaurants on the till:** open tables and printed kitchen tickets.
3. Backoffice screens for price lists, modifier groups and stock transfers. The API endpoints already exist.

## Putting it online

See **[DEPLOY.md](DEPLOY.md)**: one server with Docker (`docker-compose.prod.yml`), this computer through a Cloudflare Tunnel (`floatly.cmd`), or Vercel with a Neon database (`floatly-cloud.cmd`).

## Before production

- Change every password in `docker/postgres/init.sql` and set a long random `JWT_SECRET`.
- Confirm tax rates with ZIMRA.
- Serve the API over HTTPS behind a proxy, and set `CORS_ORIGINS` to your backoffice domain.
- The backoffice keeps the access token in the browser's localStorage. Moving it to an httpOnly cookie is a good hardening step.
