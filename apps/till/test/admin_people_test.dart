import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'admin_support.dart';

Finder field(String label) => find.widgetWithText(TextField, label);

void main() {
  group('customers', () {
    testWidgets('lists customers with what they owe, and searches on the server', (tester) async {
      final (_, fake, _) = await openAdmin(tester);
      await goTo(tester, 'Customers');
      expect(find.text('2 customers'), findsOneWidget);
      expect(find.text('Moyo Traders'), findsOneWidget);
      expect(find.text(r'$250.00'), findsOneWidget);
      expect(find.text('owes you'), findsOneWidget);
      expect(fake.peopleQueries.last['withBalance'], 'true');

      await tester.enterText(find.byType(TextField), 'walk');
      await tester.pump(const Duration(milliseconds: 400));
      await settle(tester);
      expect(fake.peopleQueries.last['search'], 'walk');
      expect(find.text('1 customer'), findsOneWidget);
      expect(find.text('Moyo Traders'), findsNothing);
    });

    testWidgets("opens a customer: balance, credit, unpaid invoices and purchases", (tester) async {
      await openAdmin(tester);
      await goTo(tester, 'Customers');
      await tapAndSettle(tester, find.text('Moyo Traders'));
      expect(find.text('Owes you'), findsOneWidget);
      expect(find.text(r'$250.00'), findsWidgets);
      expect(find.text(r'$100.00'), findsWidgets); // overdue
      expect(find.text(r'of $500.00'), findsOneWidget);
      expect(find.text(r'$12.00'), findsOneWidget);
      expect(find.text('+263 77 555 0101'), findsWidgets);
      expect(find.text('2000555'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('Purchases at the till'), 300, scrollable: find.byType(Scrollable).last);
      expect(find.text('INV-00002'), findsOneWidget);
      expect(find.text('Overdue'), findsWidgets);
      expect(find.text('Part paid'), findsOneWidget);
      expect(find.text(r'of $200.00'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('S-00105'), 300, scrollable: find.byType(Scrollable).last);
      expect(find.text('S-00105'), findsOneWidget);
      expect(find.text('S-00103'), findsNothing); // someone else's

      await tapAndSettle(tester, find.text('S-00105'));
      expect(find.text('Mai Tino'), findsWidgets);
    });

    testWidgets('adds a customer and opens them', (tester) async {
      final (_, fake, _) = await openAdmin(tester);
      await goTo(tester, 'Customers');
      await tester.tap(find.text('Add customer'));
      await tester.pumpAndSettle();
      final save = find.widgetWithText(FilledButton, 'Add customer');
      await tester.ensureVisible(save);
      await tester.tap(save);
      await tester.pump();
      expect(find.text('Enter the name'), findsOneWidget);

      await tester.enterText(field('Name'), 'Chido Stores');
      await tester.enterText(field('Phone (optional)'), '0772 123 456');
      await tester.enterText(field('Credit limit (optional)'), '300');
      await tester.ensureVisible(save);
      await tapAndSettle(tester, save);
      expect(fake.peopleSent.single, {'name': 'Chido Stores', 'phone': '0772 123 456', 'creditLimit': '300.00'});
      expect(find.widgetWithText(AppBar, 'Chido Stores'), findsOneWidget);
      expect(find.text(r'of $300.00'), findsOneWidget);
    });

    testWidgets('edits a customer, clearing a field and switching them off', (tester) async {
      final (_, fake, _) = await openAdmin(tester);
      await goTo(tester, 'Customers');
      await tapAndSettle(tester, find.text('Moyo Traders'));
      await tester.tap(find.byTooltip('Edit'));
      await tester.pumpAndSettle();
      expect(find.text('Edit customer'), findsOneWidget);
      await tester.enterText(field('Address (optional)'), '');
      await tester.enterText(field('Email (optional)'), 'buy@moyo.example');
      await tester.ensureVisible(find.text('Active customer'));
      await tester.tap(find.text('Active customer'));
      await tester.pump();
      final save = find.widgetWithText(FilledButton, 'Save');
      await tester.ensureVisible(save);
      await tapAndSettle(tester, save);
      final sent = fake.peopleSent.single;
      expect(sent['address'], isNull);
      expect(sent.containsKey('address'), isTrue);
      expect(sent['email'], 'buy@moyo.example');
      expect(sent['active'], isFalse);
      expect(sent['creditLimit'], '500.00');
      expect(find.text('Saved'), findsOneWidget);
      expect(find.widgetWithText(ListTile, 'buy@moyo.example'), findsOneWidget);
    });
  });

  group('suppliers', () {
    testWidgets('lists suppliers with what is owed, and opens one with its bills', (tester) async {
      await openAdmin(tester);
      await goTo(tester, 'Suppliers');
      expect(find.text('1 supplier'), findsOneWidget);
      expect(find.text('Mr Banda · +263 24 222 0000'), findsOneWidget);
      expect(find.text('owed to them'), findsOneWidget);

      await tapAndSettle(tester, find.text('Grain Mills'));
      expect(find.text('You owe them'), findsOneWidget);
      expect(find.text('14 days'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('Latest bills and deliveries'), 300, scrollable: find.byType(Scrollable).last);
      expect(find.text('Unpaid bills'), findsOneWidget);
      expect(find.textContaining('their ref GM-881'), findsWidgets);
      expect(find.textContaining('into Main Store'), findsOneWidget);
      expect(find.text('Paid'), findsOneWidget);
    });

    testWidgets('edits payment terms as a whole number', (tester) async {
      final (_, fake, _) = await openAdmin(tester);
      await goTo(tester, 'Suppliers');
      await tapAndSettle(tester, find.text('Grain Mills'));
      await tester.tap(find.byTooltip('Edit'));
      await tester.pumpAndSettle();
      await tester.enterText(field('Pays within (days)'), '30');
      final save = find.widgetWithText(FilledButton, 'Save');
      await tester.ensureVisible(save);
      await tapAndSettle(tester, save);
      expect(fake.peopleSent.single['paymentTermsDays'], 30);
      expect(find.text('30 days'), findsOneWidget);
    });

    testWidgets('shows no money, and no editing, to someone who may only look', (tester) async {
      final server = FakeServer(role: 'cashier')..permissions = ['suppliers.view', 'customers.view'];
      // A cashier can't sign in on the phone at all; pretend one could, to check the screens hold back.
      server.role = 'stock_clerk';
      await openAdmin(tester, server: server);
      await goTo(tester, 'Suppliers');
      expect(find.text('Add supplier'), findsNothing);
      await tapAndSettle(tester, find.text('Grain Mills'));
      expect(find.byTooltip('Edit'), findsNothing);
      expect(find.text('You owe them'), findsNothing);
      expect(find.text('Mr Banda'), findsOneWidget);
    });
  });
}
