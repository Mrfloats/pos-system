# Floatly Till

The point-of-sale app. One Flutter codebase builds for:

| Device | Build |
| --- | --- |
| Android countertop tills (Sunmi, iMin…), phones and tablets | `flutter build apk` |
| Windows tills and PCs | `flutter build windows` |
| iPhones, iPads and Macs | `flutter build ios` / `flutter build macos` (needs a Mac) |
| Any browser (handy for trying it) | `flutter build web` |

It works with the same API as the backoffice, so every sale shows up in the backoffice straight away: in Sales, the stock ledger, the books and the reports.

## What it does

- **Setting up a till.** An owner or admin opens the app once, signs in, picks the store and names the till (T01, T02…). The device gets its own secret. Their sign-in isn't kept.
- **PIN sign-in.** Staff sign in with the 4–6 digit till PIN set for them in the backoffice under **Staff**. Only owners, admins, managers, cashiers and waiters can sell. Staff limited to certain stores can only sign in on those stores' tills. **Lock** hands the till to the next person.
- **Selling.** Product grid with categories, search, and barcode scanning. USB, Bluetooth and built-in scanners type into the search box. Phones and tablets can also scan with the camera. Variants, items sold by weight, quantity changes, line notes for the kitchen, customers with their group discount, and selling in any currency the business accepts. Managers can change a price or give a discount on a line.
- **Payment.** Cash, card, mobile money or bank, in any accepted currency, split across several if needed. Quick cash buttons, and the change is worked out (in the currency of the last cash payment).
- **Receipts.** Shown on screen. They print to 58 or 80 mm receipt printers through the system print dialog, or are shared as a PDF (WhatsApp, email). Set the paper width, and printing after every sale, in **Till settings**.
- **Shifts.** Open with the cash float, close with the cash count. Closing shows expected against counted cash per currency.
- **Refunds.** Managers refund part or all of a sale, and choose whether the goods go back on the shelf.
- **Works offline.** Products, prices and customers are kept on the device. With no internet, selling carries on. Sales are saved on the till and upload by themselves when the connection is back, and each one is recorded exactly once. Anyone who has signed in on the till before can sign in offline with their PIN. Receipts made offline carry the till's own number (T01-000042) until Floatly gives the sale its number.
- **Kept fresh.** Products and prices download again every 5 minutes, and waiting sales try to upload every 30 seconds.

What needs the internet: setting up a till, a person's first sign-in on a till, opening and closing shifts, adding customers and refunds.

## Linked to the backoffice

| In the backoffice | On the till |
| --- | --- |
| **Staff**: set each person's till PIN and stores | PIN sign-in |
| **Stock**: products, variants, barcodes, prices, store prices, categories | Product grid and scanning |
| **Settings → Tax rates and Currencies** | VAT on receipts; currencies to sell and take money in |
| **Settings → Tills**: see each till and when it was last used; rename or switch one off | A switched-off till can't be signed in on |
| **Sales**: every sale, return and shift, with the till that made it | Sales upload as they happen |

## Running it on your computer

1. Flutter is installed at `C:\flutter`. Add `C:\flutter\bin` to your PATH (Start → "Edit environment variables for your account" → Path → New), then open a new terminal.
2. Turn on **Developer Mode** (Start → Settings → System → For developers). Flutter needs it to build with plugins on Windows.
3. Start the API (see the main README). Then, in `apps/till`:

   ```bash
   flutter pub get
   flutter run -d chrome        # in the browser
   flutter run -d windows       # as a Windows app (needs Visual Studio, below)
   flutter run                  # on an Android phone plugged in by USB
   ```

4. On the setup screen, open **Server** and enter `http://localhost:4000`. Sign in as `demo@pos.local` / `demo1234`, choose Main Store and add a till. Then sign in with the cashier PIN `1234` or the manager PIN `5678`.

A till uses `https://floatly-api.vercel.app` unless you change it under **Server**.

For `flutter run -d chrome` against a local API, add the address Flutter prints (for example `http://localhost:5555`) to `CORS_ORIGINS` in `apps/api/.env`, and start it with `flutter run -d chrome --web-port 5555`. Phone, tablet and desktop apps don't need this.

## Building the apps

### Android (countertop tills, phones, tablets)

1. Install [Android Studio](https://developer.android.com/studio). On first start, let it install the Android SDK. Then run `flutter doctor --android-licenses` and accept them.
2. `flutter build apk --release`
3. The app is `build/app/outputs/flutter-apk/app-release.apk`. Copy it to the device and open it to install, or use `adb install`.

Before publishing on the Play Store, create your own signing key ([Flutter guide](https://docs.flutter.dev/deployment/android#sign-the-app)). The release build is signed with the debug key until you do.

### Windows

1. Install [Visual Studio Community](https://visualstudio.microsoft.com/downloads/) with the **Desktop development with C++** workload.
2. `flutter build windows --release`
3. Copy the whole `build/windows/x64/runner/Release` folder to the till PC and run `floatly_till.exe`.

### iPhone, iPad, Mac

These need a Mac with Xcode: `flutter build ios` or `flutter build macos`.

## Printing

Receipts go through the operating system's printing:

- **Sunmi, iMin and other Android tills** with a built-in printer: install or enable the maker's print service (for Sunmi, "Sunmi Print Service" / built-in printer service). The printer then appears in the print dialog.
- **USB, network and Bluetooth receipt printers**: install the printer's Android print plugin or Windows driver.
- Set the paper width (58 or 80 mm) in **Till settings**.

Printing straight to ESC/POS printers without a dialog is a planned next step.

## Tests

```bash
flutter test
```

These check the money maths and basket pricing against the same baskets the API's tests use, so offline totals match what the API records. They also run the till's screens: a full offline sale (scan, pay cash, give change, queue the sale), the phone layout, setup and PIN.

`test/live_api_test.dart` runs the real till code against a running API with the demo data. It pairs a till, signs in by PIN, sells and uploads, checks the API recorded the same total, refunds as a manager and closes the shift:

```bash
FLOATLY_LIVE_API=http://localhost:4000 flutter test test/live_api_test.dart
```

It adds a till and a few sales to that database, so point it at a test copy.

## Project layout

```
lib/
  main.dart               starts the app: setup → PIN → till
  core/
    api.dart              calls the Floatly API
    money.dart            exact money maths, the same as the API's
    local_store*.dart     saves to files (devices) or browser storage (web); secrets in the keychain
  models/
    catalog.dart          products, prices, tax rates, currencies, customers
    sale.dart             basket pricing and payments, the same rules as the API
    receipt.dart          a sale as printed, kept for reprints
  state/till_state.dart   pairing, PIN sign-in (online and offline), catalog, basket, shifts, upload queue
  screens/                setup, PIN, till, payment, receipt, sales, refund, shifts, customers, settings, camera scanner
  widgets/                product grid, basket, logo, shared pieces
  printing/receipt_pdf.dart   58/80 mm receipt
tool/render_icons.dart    draws the app icon (then `dart run flutter_launcher_icons`)
```

## API endpoints the till uses

| Endpoint | For |
| --- | --- |
| `POST /auth/login`, `POST /auth/switch-tenant` | Setting up (owner or admin) |
| `GET /stores`, `GET /devices`, `POST /devices`, `POST /devices/:id/token` | Choosing the store and till, getting the till's secret |
| `POST /auth/till` | PIN sign-in with the till's secret |
| `GET /till/catalog?storeId=` | Everything to sell offline, in one download |
| `POST /sales` | A sale, with `clientId` so a retry is recorded once |
| `GET /shifts`, `POST /shifts`, `POST /shifts/:id/close` | Shifts and cash-up |
| `GET /sales/:id`, `POST /sales/:id/returns` | Refunds |
| `POST /customers` | Adding a customer at the till |

## Next steps

- Print straight to ESC/POS printers (Bluetooth, USB, network) and Sunmi/iMin built-in printers, and open the cash drawer.
- ZIMRA fiscal receipts once the API sends sales to FDMS.
- Wholesale packs (a case barcode adds 24) and restaurant choice groups, once the sales API takes them.
- Open tables and kitchen tickets for restaurants.
