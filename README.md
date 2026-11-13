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
  - Wholesale: every shop has Retail and Wholesale prices (restaurants have one price). A wholesale price sits next to the retail price on each product, in the backoffice and on the phone, and on each of its packs; left empty, the item sells at its retail price, packs (case of 24 with its own barcode and price), price lists with quantity breaks, customers and customer groups on wholesale prices, customer credit limits. Sales use the price list the cashier picks, or the customer's.
  - Restaurant: menu items, kitchen stations, choice groups (sides, extras), recipes that use up ingredient stock.
- **Stock ledger.** Opening stock, goods received, adjustments, waste, transfers between stores and stock takes. Stock is never edited in place: every change is a new ledger row. The database refuses updates and deletes on the ledger, and retried requests are ignored using idempotency keys, ready for offline tills.
- **Customers** with TIN and VAT number for ZIMRA fiscal tax invoices.
- **Accounts.** A double-entry general ledger with a ready-made chart of accounts, suppliers and bills, customer invoices on credit, payments in and out, expenses, moving money between cash, bank and mobile money, manual journals, and month-end closing. Reports: profit and loss, balance sheet, trial balance, general ledger, VAT summary, and aged debtors and creditors. Documents can be in any currency the business accepts (USD, ZiG…); the books are kept in the base currency and exchange gains and losses are posted automatically. Stock received, written off or counted is valued into the ledger. The database refuses unbalanced entries, edits to posted entries, and postings into a closed period.
- **Sales.** Sales, returns and quotations, each paid by cash, card, mobile money or bank in any accepted currency (split payments, change in cash). A sale takes stock out (recipe ingredients for menu items), posts sales, VAT, cost of goods and the money to the ledger, and sends dishes to the kitchen board. Also shifts with cash-up, cash transfers, customer groups with discounts, CSV import, and reports: item, category, cashier and shop profitability, shift reconciliation, sales and purchases VAT, store cashbook, cash balance, daily sales and returns.
- **Suppliers and purchases.** A purchase is a supplier bill for stock: it receives the goods into a store at their cost (and can update cost prices), records what is owed or pays it on the spot, and posts straight to Stock and VAT. Purchase bills can be imported from CSV; voiding a purchase takes its goods back out.
- **Audit log** of who changed what.
- **Backoffice screens:** sign in, sign up, overview, products (list, add, edit), categories, stock, customers, staff and settings (business, stores, tills, tax rates, currencies).
- **Till app** ([apps/till](apps/till/README.md)) for Android countertop tills, phones and tablets, Windows PCs, and iPhones, iPads and Macs. An owner sets a till up once by signing in on it. Staff then sign in with their till PIN. It sells with barcode scanning, retail and wholesale prices (switched by the cashier or set by the customer, with quantity breaks), wholesale cases, restaurant sides and extras, customers and discounts, and any currency. Payments can be split across cash, card, mobile money and bank. It prints straight to Bluetooth, USB, network and Windows receipt printers (including Sunmi built-in printers), opens the cash drawer, and runs shifts with cash-up. Managers can do refunds. It keeps selling with no internet and uploads each sale exactly once when the connection is back.

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

## Managing the business from a phone

Owners, admins and managers can run the business from the same Flutter app the tills use (`apps/till`), against the same API, data and permissions as the backoffice. On a new device, tap **Manage your business instead** on the setup screen; on a paired till, choose **Manage the business** from the PIN screen's menu. Sign in with email and password. Cashiers, waiters, stock clerks and accountants are refused by the API (`not_for_role`) and keep using the till or the backoffice.

The side menu shows the person's name, role and staff ID (e.g. "Admin — ID: ADM-001") and only the sections their permissions allow:

| Section | What it does |
| --- | --- |
| Dashboard | Today's takings, transactions, average basket, change on yesterday and the same day last week, 8-day chart, top products, payment methods, low stock, requests waiting |
| Sales Activity | Transactions with server-side filters (dates, cashier, payment method, kind, branch, search) and the total for the filtered list; a transaction's items, payments and refunds |
| Inventory | Search or scan; stock per branch; change the selling price (PIN), cost and reorder level; adjust stock with a reason; add a product with opening stock |
| Customers | Search; what they owe, credit left, spending, unpaid invoices, purchases; add and edit |
| Suppliers | Contact details, what's owed, unpaid bills and latest deliveries; add and edit |
| Damaged Stock | Write off damaged, expired or spoiled stock with a reason; history with value at cost |
| Returns | Refund and void requests from the tills: approve (PIN) or turn down with a note |
| Reports | Sales by day, product, category and cashier; profit (with expenses and net profit from the books); stock value. Charts, tables, share as PDF or CSV |
| Receipts | Find any receipt by number or customer; print again (receipt printer or print dialog) or share as PDF |

The bell lists low stock, requests waiting, large refunds (over three times an average sale), voids and yesterday's takings. The store picker in the top bar narrows every screen to one branch.

### Permissions

Every endpoint checks a permission on the API as well as the role; hiding a button in the app is never the only lock. A role starts with the permissions below. An **owner** can untick any of them for one person on the backoffice **Staff** page; owners always keep every permission. A change applies to that person's next request.

| Permission | Lets someone | Starts with |
| --- | --- | --- |
| `dashboard.view` | see the dashboard and the bell | owner, admin, manager |
| `sales.view` | see sales and receipts | owner, admin, manager, cashier, waiter, accountant |
| `sales.void` | void sales | owner, admin, manager |
| `returns.create` | refund sales | owner, admin, manager |
| `returns.request` | ask a manager for a refund or void (till) | owner, admin, manager, cashier, waiter |
| `returns.approve` | approve or turn down those requests | owner, admin, manager |
| `inventory.view` | see stock levels and movements | everyone |
| `inventory.adjust` | receive, adjust, count and transfer stock | owner, admin, manager, stock clerk |
| `damaged.record` | write off damaged stock | owner, admin, manager, stock clerk |
| `products.edit` | add and edit products | owner, admin, manager |
| `products.price` | change selling prices | owner, admin, manager |
| `customers.view` / `customers.edit` | see / add and edit customers | everyone / till staff and managers |
| `suppliers.view` / `suppliers.edit` | see / add and edit suppliers | everyone / managers and accountants |
| `reports.view` | sales and profit reports | owner, admin, manager, accountant |
| `reports.stock` | stock reports and valuation | owner, admin, manager, stock clerk, accountant |
| `audit.view` | the audit trail | owner, admin |

The list is in `apps/api/src/common/permissions.ts`.

### Security

- **Sessions:** a phone gets a 15-minute access token and a refresh token, kept in the phone's keychain and swapped for a new one each time. A refresh token used again after it was replaced ends the whole sign-in. Sign-ins unused for 30 days end. Logging out ends it on the server and removes the tokens, the saved figures and anything queued from the phone.
- **PIN:** after a first sign-in the app offers to set a PIN, which then opens the app and locks it again after 5 minutes untouched. Changing a price, refunding, voiding and approving a request from a phone need the PIN again (`X-Floatly-Pin`).
- **Lockout:** five wrong passwords or PINs in a row lock the account for 15 minutes.
- **Forgot password:** "Forgot password?" on the website's sign-in, the phone app's sign-in and the till setup screen emails a link (`/reset-password#token`) that works once, for 60 minutes. Choosing the new password ends a lockout and every sign-in in a browser or on a phone; tills keep their PIN sign-ins. The answer doesn't say whether an email has a login. Email goes out through `SMTP_URL` (see DEPLOY.md); without it, development writes the email to the API's log.
- **Audit:** every change records who, their role, the app (web, till or mobile), the store, and the value before and after (prices, stock levels, request decisions). See it with `GET /audit-logs`.

### Offline

Screens are saved as they load. Without a connection the app shows the saved copy with a banner saying when it was saved. Stock adjustments and write-offs made offline wait on the phone and upload when the connection is back; each carries an id, so one sent twice is recorded once. If Floatly turns one down, Floatly wins and the app says why. Price changes and approvals need a connection.

### Stays on the web

Staff, roles and permissions; tax, currency and business settings; imports, exports and backups; removing past transactions. The app's menu says so under **More on the web**.

### Settings

API environment variables, all optional: `MOBILE_ACCESS_SECONDS` (900), `REFRESH_IDLE_DAYS` (30), `LOGIN_MAX_FAILURES` (5), `LOGIN_LOCK_MINUTES` (15).

### Putting it live

The API needs a redeploy, which applies migrations `0017` (permissions and audit), `0018` (phone sign-in, lockout, staff IDs) and `0019` (refund and void requests). Tills need the new app build for cashiers to ask for refunds and voids.

## ZIMRA fiscalisation (FDMS)

Each till is its own ZIMRA fiscal device (Fiscal Device Gateway API v7.2). The till does the fiscalising, so it carries on offline and prints the QR code straight away.

- **Registering a till:** on the till, a manager opens **Till settings → ZIMRA**, chooses ZIMRA's test or live server, enters the device ID, activation key and serial number ZIMRA issued for that till, taps **Check with ZIMRA**, then **Register this till**. The till makes its own key (ECDSA P-256, kept in the device's secure storage), gets its certificate and settings from ZIMRA, and carries on ZIMRA's receipt and day numbers. Floatly makes sure one ZIMRA device isn't set up on two tills.
- **Selling:** every sale is signed as a fiscal invoice before it's saved. The receipt shows ZIMRA's fields (taxpayer, FISCAL TAX INVOICE, invoice and fiscal day numbers, device, tax table) with the QR code and verification code. Receipts go to ZIMRA in order as soon as it can be reached, and Floatly is told what ZIMRA said. If a sale breaks ZIMRA's rules (a product without an HS code, a tax ZIMRA doesn't offer), the till says so and records nothing.
- **Refunds** are credit notes for the original receipt, printed for the customer. A refund approved on a phone gets its credit note on the cashier's till. Sales reported to ZIMRA can't be voided: refund them instead.
- **The fiscal day** opens with the first sale. A manager closes it with **End of day (Z report)**, which sends the day's signed totals and prints the Z report. The till warns before ZIMRA's limit (usually 24 hours) and stops selling at it.
- **HS codes:** a VAT-registered business needs an HS code on every product (backoffice product form): 8 digits for zero-rated and exempt items, 4 or 8 otherwise. Tax rates are matched to ZIMRA's taxes by percent, or by the ZIMRA tax ID set on the rate in Settings.
- **Backoffice:** each sale shows its ZIMRA status (Pending, Fiscalised, Failed) with the verification code and any errors from ZIMRA. Settings → Tills shows each till's ZIMRA device, fiscal day and receipts not yet sent.
- **Test products:** the demo data has a "ZIMRA tests" category: items at 15.5% VAT, zero-rated and exempt, one sold by weight, one with a case, and one without an HS code, which a VAT-registered till refuses. To add them to another business: `node --env-file=apps/api/.env apps/api/dist/db/test-products.js owner@example.com "Business name"` locally, or `.\floatly-cloud.cmd test-products owner@example.com "Business name"` online.
- **Limits:** only the Android and Windows apps fiscalise (a browser can't use ZIMRA's client certificate). Invoices typed into the backoffice aren't fiscalised.
- **Going live:** register a device on ZIMRA's test server first. ZIMRA asks for sample invoices and credit notes before approving the software, then issues live devices. The device model name and version sent to ZIMRA (`Server` / `v1` by default) must be the ones registered with ZIMRA; change them under **Device model** when registering. The API needs a redeploy (migration `0020`) and tills need the new app build.

The code is in `apps/till/lib/fiscal/` (receipts, signing, day totals and QR in `fdms.dart`; the ZIMRA API in `fdms_client.dart`; the device, day and queue in `fiscal_device.dart`) and `apps/api/src/sales/fiscal.ts` with the endpoints in `apps/api/src/till/till.ts`. The tests check the signing text against ZIMRA's own published example and run registration, selling offline, refunds and closing the day against an in-memory ZIMRA that verifies every signature.

## Tests

```bash
npm run test:api
```

The 153 end-to-end tests run against a real PostgreSQL test database (`pos_test`) as the restricted role. They cover sign-up, login, validation, catalog, wholesale packs and prices (every shop has a Wholesale list), restaurant menus, the stock ledger, accounting (postings, VAT, exchange gains, closing periods, and the database-level ledger rules), roles and permissions (a cashier's token is refused by every admin endpoint), phone sessions, lockout and PIN confirmation, forgot-password links, the audit trail, refund and void requests, the dashboard and notifications, people in several businesses, tenant isolation, the till app's PIN sign-in, offline catalog, synced sales, switching a till off, and sales of cases and dishes with choices, and ZIMRA fiscal receipts, results and till registrations.

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
      sales/              sales, returns, quotations, kitchen, shifts, cash transfers, import, sales reports,
                          refund and void requests
      dashboard/          the phone's dashboard
      notifications/      the phone's bell
      common/permissions.ts  every permission and the roles that start with it
      till/               the till app's catalog download and ZIMRA status (PIN sign-in is in auth/)
    test/                 end-to-end tests
  backoffice/
    src/app/(auth)/       sign in, sign up
    src/app/(app)/        the signed-in screens
    src/components/       shared UI
    src/lib/              API client, session, formatting
  till/                   Flutter till app (see apps/till/README.md)
    lib/state/            pairing, PIN sign-in, offline catalog, basket, shifts, upload queue
    lib/screens/          setup, PIN, till, payment, receipt, sales, refund, shifts
    lib/admin/            managing the business from a phone (see above)
    lib/fiscal/           the till as a ZIMRA fiscal device (see above)
docker/postgres/init.sql  creates the database and the two roles
docker-compose.yml        PostgreSQL 16 and Redis 7 for development
```

## Changing the database

1. Edit `apps/api/src/db/schema.ts`. Give every new business table a `tenantId` column and the `tenantIsolation(t)` policy.
2. `npm run db:generate -w apps/api` writes a new SQL migration in `apps/api/drizzle/`.
3. `npm run db:migrate` applies it.

When a request links to another record by id (category, store, variant…), check it with `assertOwned()` first. Foreign keys are checked without row-level security, so this check is what stops links to another business's records.

## Next steps

1. **Paynow** (EcoCash, OneMoney, InnBucks), and ZIMRA fiscalisation for invoices made in the backoffice.
2. **Restaurants on the till:** open tables and printed kitchen tickets.
3. Backoffice screens for price lists, modifier groups and stock transfers. The API endpoints already exist.

## Putting it online

See **[DEPLOY.md](DEPLOY.md)**: one server with Docker (`docker-compose.prod.yml`), this computer through a Cloudflare Tunnel (`floatly.cmd`), or Vercel with a Neon database (`floatly-cloud.cmd`).

## Before production

- Change every password in `docker/postgres/init.sql` and set a long random `JWT_SECRET`.
- Confirm tax rates with ZIMRA.
- Serve the API over HTTPS behind a proxy, and set `CORS_ORIGINS` to your backoffice domain.
- The backoffice keeps the access token in the browser's localStorage. Moving it to an httpOnly cookie is a good hardening step.
