import 'package:floatly_till/core/money.dart';
import 'package:floatly_till/models/receipt.dart';
import 'package:floatly_till/models/sale.dart' show PayMethod;
import 'package:floatly_till/printing/receipt_pdf.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'admin_support.dart';

void main() {
  group('a receipt from a sale the API returns', () {
    Receipt receipt(Map<String, dynamic> sale) => Receipt.fromApiSale(
      saleDetail(sale),
      businessName: 'Corner Shop',
      address: '12 Market Street',
      tin: '2000123456',
      symbolOf: (code) => code == 'USD' ? r'$' : code,
    );

    test('carries the items, totals and payments as they were', () {
      final r = receipt(fakeSales().first);
      expect(r.heading, 'Sale S-00105');
      expect(r.showTillRef, isFalse);
      expect([r.businessName, r.storeName, r.address, r.tin, r.cashier, r.customerName], ['Corner Shop', 'Main Store', '12 Market Street', '2000123456', 'Chipo Cashier', 'Mai Tino']);
      expect(r.lines.map((l) => l.name), ['Rice 5kg', 'Cola · 500ml (Case of 24)']);
      expect(r.lines.first.quantity, 2000);
      expect(r.lines.first.unitPrice, 500);
      expect(formatMoney(r.total, r.symbol), r'$45.00');
      expect(r.taxTotal, 163);
      expect(r.payments.map((p) => p.method), [PayMethod.cash, PayMethod.mobile]);
      expect(r.change, 50);
      expect(r.uploaded, isTrue);
    });

    test('calls a refund a refund, without minus signs', () {
      final r = receipt(fakeSales()[1]);
      expect(r.isReturn, isTrue);
      expect(r.heading, 'Refund R-00104');
      expect(r.payments.single.amount, 500);
      expect(Receipt.fromJson(r.toJson()).heading, 'Refund R-00104');
    });

    test('still shows the till reference on receipts made on a till', () {
      final j = receipt(fakeSales().first).toJson()..['reference'] = 'T01-000042';
      expect(Receipt.fromJson(j).showTillRef, isTrue);
      expect(Receipt.fromJson({...j, 'number': null, 'saleId': null}).heading, 'Receipt T01-000042');
    });

    test('makes a PDF to share', () async {
      final bytes = await receiptPdf(receipt(fakeSales().first), paperWidth: 80);
      expect(String.fromCharCodes(bytes.take(5)), '%PDF-');
    });
  });

  group('sales activity', () {
    testWidgets("lists today's transactions with their total, and loads more on scrolling", (tester) async {
      final (_, fake, _) = await openAdmin(tester);
      await goTo(tester, 'Sales Activity');
      expect(find.text(r'44 transactions · $560.00 · All stores'), findsOneWidget);
      expect(find.text('S-00105'), findsOneWidget);
      expect(find.text('Mai Tino'), findsOneWidget);
      expect(find.text('Refund'), findsOneWidget);
      expect(find.text(r'−$5.00'), findsOneWidget);
      expect(find.text('Voided'), findsOneWidget);
      expect(find.byIcon(Icons.phone_android), findsOneWidget);
      final first = fake.salesQueries.last;
      expect(first['excludeQuotations'], 'true');
      expect(first['from'], first['to']); // today
      expect(first['from'], matches(r'^\d{4}-\d{2}-\d{2}$'));
      expect(first.containsKey('storeId'), isFalse);

      // The rest arrive as the end comes near.
      expect(find.text('S-00062'), findsNothing);
      await tester.runAsync(() async {
        await tester.drag(find.byType(ListView), const Offset(0, -2400));
        await Future<void>.delayed(const Duration(milliseconds: 60));
      });
      await settle(tester);
      await tester.runAsync(() async {
        await tester.drag(find.byType(ListView), const Offset(0, -3000));
        await Future<void>.delayed(const Duration(milliseconds: 60));
      });
      await settle(tester);
      expect(fake.salesQueries.last['page'], '2');
      expect(find.text('S-00062'), findsOneWidget);
    });

    testWidgets('filters on the server by cashier, payment, kind and search', (tester) async {
      final (_, fake, _) = await openAdmin(tester);
      await goTo(tester, 'Sales Activity');

      await tester.tap(find.text('Cashier'));
      await tester.pumpAndSettle();
      await tapAndSettle(tester, find.text('Admin User').last);
      expect(fake.salesQueries.last['cashierId'], 'u1');
      expect(find.text(r'1 transaction · -$5.00 · All stores'), findsOneWidget);

      await tester.tap(find.text('Admin User'));
      await tester.pumpAndSettle();
      await tapAndSettle(tester, find.text('Any cashier'));
      await tester.tap(find.text('Payment'));
      await tester.pumpAndSettle();
      await tapAndSettle(tester, find.text('Card'));
      expect(fake.salesQueries.last, containsPair('paymentMethod', 'card'));
      expect(fake.salesQueries.last.containsKey('cashierId'), isFalse);
      expect(find.text(r'1 transaction · $20.00 · All stores'), findsOneWidget);

      await tester.tap(find.text('Card'));
      await tester.pumpAndSettle();
      await tapAndSettle(tester, find.text('Any payment'));
      // The chips scroll sideways on a narrow phone.
      await tester.ensureVisible(find.text('Kind'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Kind'));
      await tester.pumpAndSettle();
      await tapAndSettle(tester, find.text('Voided').last);
      expect(fake.salesQueries.last, containsPair('status', 'void'));
      expect(find.text('S-00102'), findsOneWidget);
      expect(find.text('S-00105'), findsNothing);

      await tester.enterText(find.byType(TextField), 'nothing like this');
      await tester.pump(const Duration(milliseconds: 400));
      await settle(tester);
      expect(fake.salesQueries.last['search'], 'nothing like this');
      expect(find.text('No transactions'), findsOneWidget);
    });

    testWidgets('asks for one branch when one is chosen, and for other dates', (tester) async {
      final (_, fake, _) = await openAdmin(tester);
      await goTo(tester, 'Sales Activity');
      await tester.tap(find.text('All stores'));
      await tester.pumpAndSettle();
      await tapAndSettle(tester, find.text('Main Store').last);
      expect(fake.salesQueries.last['storeId'], 's1');
      expect(find.textContaining('· Main Store'), findsOneWidget);

      await tester.tap(find.text('Today'));
      await tester.pumpAndSettle();
      await tapAndSettle(tester, find.text('Last 7 days'));
      final q = fake.salesQueries.last;
      expect(DateTime.parse(q['to']!).difference(DateTime.parse(q['from']!)).inDays, 6);
      await tester.tap(find.text('Last 7 days'));
      await tester.pumpAndSettle();
      await tapAndSettle(tester, find.text('All dates'));
      expect(fake.salesQueries.last.containsKey('from'), isFalse);
    });

    testWidgets('opens a transaction: items, payment, what was refunded, and its receipt', (tester) async {
      await openAdmin(tester);
      await goTo(tester, 'Sales Activity');
      await tapAndSettle(tester, find.text('S-00103'));
      expect(find.text(r'$20.00'), findsWidgets);
      expect(find.text('Front till'), findsOneWidget);
      expect(find.text('Chipo Cashier'), findsOneWidget);
      expect(find.text('2 items'), findsOneWidget);
      expect(find.text('Cola · 500ml (Case of 24)'), findsOneWidget);
      expect(find.text('1 refunded'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('View receipt'), 300, scrollable: find.byType(Scrollable).last);
      expect(find.text('Card'), findsOneWidget);
      expect(find.text('R-00104'), findsWidgets);

      // Through to the refund made from it, and back.
      await tapAndSettle(tester, find.text('R-00104').last);
      expect(find.text('Refunded'), findsOneWidget);
      expect(find.text('Torn bag'), findsOneWidget);
      expect(find.text('Given back'), findsOneWidget);
      Navigator.of(tester.element(find.text('Given back'))).pop();
      await tester.pumpAndSettle();

      await tester.tap(find.text('View receipt'));
      await tester.pumpAndSettle();
      expect(find.text('Sale S-00103'), findsOneWidget);
      expect(find.text('Print again'), findsOneWidget);
      expect(find.text('Share PDF'), findsOneWidget);
    });
  });

  group('receipts', () {
    testWidgets('finds a receipt by number across all dates and shows it as printed', (tester) async {
      final (_, fake, _) = await openAdmin(tester);
      await goTo(tester, 'Receipts');
      expect(find.text('44 receipts · All stores'), findsOneWidget);
      expect(fake.salesQueries.last.containsKey('from'), isFalse);
      expect(find.text('Cashier'), findsNothing); // the finder keeps to search and dates

      await tester.enterText(find.byType(TextField), 'S-00105');
      await tester.pump(const Duration(milliseconds: 400));
      await settle(tester);
      expect(fake.salesQueries.last['search'], 'S-00105');
      expect(find.text('1 receipt · All stores'), findsOneWidget);

      await tapAndSettle(tester, find.text('S-00105').last);
      expect(find.text('Corner Shop'), findsOneWidget);
      // The branch's own address, not head office's.
      expect(find.text('12 Market Street'), findsOneWidget);
      expect(find.text('TIN 2000123456'), findsOneWidget);
      expect(find.text('Sale S-00105'), findsOneWidget);
      expect(find.text('Till ref'), findsNothing);
      expect(find.text('Mai Tino'), findsWidgets);
      expect(find.text('Rice 5kg'), findsOneWidget);
      expect(find.byTooltip('Receipt printer'), findsOneWidget);
    });

    testWidgets('says so when a receipt is for a voided sale', (tester) async {
      await openAdmin(tester);
      await goTo(tester, 'Receipts');
      await tapAndSettle(tester, find.text('S-00102'));
      expect(find.text('This sale was voided.'), findsOneWidget);
    });

    testWidgets("doesn't appear for someone without permission to see sales", (tester) async {
      final server = FakeServer()..permissions = ['dashboard.view'];
      await openAdmin(tester, server: server);
      await tester.tap(find.byTooltip('Open navigation menu'));
      await tester.pumpAndSettle();
      expect(find.text('Dashboard'), findsWidgets);
      expect(find.text('Sales Activity'), findsNothing);
      expect(find.text('Receipts'), findsNothing);
    });
  });
}
