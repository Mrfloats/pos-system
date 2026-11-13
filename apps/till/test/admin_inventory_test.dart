import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'admin_support.dart';

Finder field(String label) => find.widgetWithText(TextField, label);

void main() {
  group('inventory', () {
    testWidgets('lists stock for all stores together, or one, and the low ones', (tester) async {
      await openAdmin(tester);
      await goTo(tester, 'Inventory');
      expect(find.text('2 items · All stores together'), findsOneWidget);
      expect(find.text('Rice · 5kg'), findsOneWidget);
      expect(find.text('24'), findsOneWidget); // 4 in the shop + 20 in the depot
      expect(find.text(r'$9.50 · RICE5 · 600111'), findsOneWidget);
      expect(find.text('Cooking oil 2L'), findsOneWidget);
      expect(find.text('Low'), findsNothing);

      // In the shop alone, rice is under its reorder level.
      await tester.tap(find.text('All stores'));
      await tester.pumpAndSettle();
      await tapAndSettle(tester, find.text('Main Store').last);
      expect(find.text('2 items · Main Store'), findsOneWidget);
      expect(find.text('4'), findsOneWidget);
      expect(find.text('Low'), findsOneWidget);
      await tapAndSettle(tester, find.text('Low stock only'));
      expect(find.text('1 item · Main Store'), findsOneWidget);
      expect(find.text('Cooking oil 2L'), findsNothing);
    });

    testWidgets('shows an item by store, and changes its retail and wholesale prices only with the PIN', (tester) async {
      final (_, fake, _) = await openAdmin(tester);
      await goTo(tester, 'Inventory');
      await tapAndSettle(tester, find.text('Rice · 5kg'));
      expect(find.text('In stock, all stores'), findsOneWidget);
      expect(find.text('Groceries · RICE5 · 600111'), findsOneWidget);
      expect(find.text('Cost \$7.00 · reorder at 10'), findsOneWidget);
      expect(find.text('Depot'), findsOneWidget);
      expect(find.text('20'), findsOneWidget);
      expect(find.text('Retail price'), findsOneWidget);
      expect(find.text('Wholesale price'), findsOneWidget);
      expect(find.text(r'$9.00'), findsOneWidget);

      await tester.tap(find.text('Wholesale price'));
      await tester.pumpAndSettle();
      expect(find.text('Prices'), findsOneWidget);
      await tester.enterText(field('Retail price'), '9.75');
      await tester.enterText(field('Wholesale price'), '8.80');
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();
      expect(find.text('Confirm the new prices'), findsOneWidget);
      expect(find.text('Rice · 5kg\nRetail: \$9.50 → \$9.75\nWholesale: \$9.00 → \$8.80'), findsOneWidget);
      await tester.enterText(field('Your PIN'), '1111');
      await tapAndSettle(tester, find.text('Confirm'));
      expect(find.text('Wrong PIN'), findsOneWidget);
      expect(fake.items['v-rice']!['price'], '9.50');
      expect(fake.wholesale['v-rice'], '9.00');
      await tester.enterText(field('Your PIN'), '4321');
      await tapAndSettle(tester, find.text('Confirm'));
      expect(fake.patched.last, {
        'price': '9.75',
        'listPrices': [
          {'priceListId': 'pl-wholesale', 'price': '8.80'},
        ],
      });
      expect(find.text(r'$9.75'), findsOneWidget);
      expect(find.text(r'$8.80'), findsOneWidget);
    });

    testWidgets('clears the wholesale price, so the item sells at its retail price', (tester) async {
      final (_, fake, _) = await openAdmin(tester);
      await goTo(tester, 'Inventory');
      await tapAndSettle(tester, find.text('Rice · 5kg'));
      await tester.tap(find.text('Wholesale price'));
      await tester.pumpAndSettle();
      await tester.enterText(field('Wholesale price'), '');
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();
      expect(find.text('Confirm the new price'), findsOneWidget);
      expect(find.text('Rice · 5kg\nWholesale: \$9.00 → same as retail'), findsOneWidget);
      await tester.enterText(field('Your PIN'), '4321');
      await tapAndSettle(tester, find.text('Confirm'));
      expect(fake.patched.last, {
        'listPrices': [
          {'priceListId': 'pl-wholesale', 'price': null},
        ],
      });
      expect(find.text('Same as retail'), findsOneWidget);
    });

    testWidgets('adjusts stock down with a reason, in the shop', (tester) async {
      final (_, fake, _) = await openAdmin(tester);
      await goTo(tester, 'Inventory');
      await tapAndSettle(tester, find.text('Cooking oil 2L'));
      await tester.tap(find.text('Adjust stock'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Remove'));
      await tester.enterText(field('How many'), '2');
      await tester.pump();
      expect(find.text('Leaves 28 in this store.'), findsOneWidget);
      await tester.tap(find.text('Save'));
      await tester.pump();
      expect(find.text('Choose a reason'), findsOneWidget);
      expect(fake.posted, isEmpty);

      await tester.tap(find.text('Missing or stolen'));
      await tester.enterText(field('Note (optional)'), 'Shelf 3');
      await tapAndSettle(tester, find.text('Save'));
      final sent = fake.posted.single;
      expect(sent['type'], 'adjustment');
      expect(sent['storeId'], 's1'); // the shop, not the depot
      expect(sent['note'], 'Missing or stolen: Shelf 3');
      expect((sent['lines'] as List).single, containsPair('quantity', '-2.000'));
      expect(((sent['lines'] as List).single as Map)['clientId'], isNotEmpty);
      // Back on the item, with its new movement.
      expect(find.text('Adjusted'), findsOneWidget);
      expect(find.text('-2'), findsOneWidget);
      expect(find.text('28'), findsWidgets);
    });

    testWidgets('adds a product with opening stock', (tester) async {
      final (_, fake, _) = await openAdmin(tester);
      await goTo(tester, 'Inventory');
      await tester.tap(find.text('Add product'));
      await tester.pumpAndSettle();
      final save = find.widgetWithText(FilledButton, 'Add product');
      await tester.ensureVisible(save);
      await tester.pumpAndSettle();
      await tester.tap(save);
      await tester.pump();
      expect(find.text('Give it a name'), findsOneWidget);
      await tester.enterText(field('Name'), 'Sugar 2kg');
      await tester.enterText(field('Retail price'), '3.10');
      await tester.enterText(field('Wholesale price'), '2.90');
      await tester.enterText(field('Cost (optional)'), '2.40');
      await tester.enterText(field('Barcode (optional)'), '600333');
      await tester.enterText(field('How many'), '12');
      await tester.tap(find.text('No category'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Groceries').last);
      await tester.pumpAndSettle();
      await tester.ensureVisible(save);
      await tester.pumpAndSettle();
      await tapAndSettle(tester, save);
      expect(fake.added.single, containsPair('name', 'Sugar 2kg'));
      expect(fake.added.single['categoryId'], 'c1');
      expect((fake.added.single['variants'] as List).single, {
        'price': '3.10',
        'listPrices': [
          {'priceListId': 'pl-wholesale', 'price': '2.90'},
        ],
        'costPrice': '2.40',
        'barcode': '600333',
      });
      final opening = fake.posted.single;
      expect([opening['type'], opening['storeId']], ['opening', 's1']);
      expect((opening['lines'] as List).single, containsPair('quantity', '12.000'));
      // On the new item's page.
      expect(find.widgetWithText(AppBar, 'Sugar 2kg'), findsOneWidget);
      expect(find.text('In stock, all stores'), findsOneWidget);
    });

    testWidgets('offers only what the person may do', (tester) async {
      final server = FakeServer()..permissions = ['inventory.view'];
      await openAdmin(tester, server: server);
      await tester.runAsync(() => tester.tap(find.byTooltip('Open navigation menu')));
      await tester.pumpAndSettle();
      expect(find.text('Damaged Stock'), findsNothing);
      // Inventory is all they have, so it is already open.
      await tapAndSettle(tester, find.text('Inventory').last);
      expect(find.text('Add product'), findsNothing);
      await tapAndSettle(tester, find.text('Rice · 5kg'));
      expect(find.text('Adjust stock'), findsNothing);
      expect(find.text('Damaged'), findsNothing);
      await tester.tap(find.text('Retail price'));
      await tester.pumpAndSettle();
      expect(find.text('Prices'), findsNothing);
    });
  });

  group('damaged stock', () {
    testWidgets('records an expired item and lists it with its cost', (tester) async {
      final (_, fake, _) = await openAdmin(tester);
      await goTo(tester, 'Damaged Stock');
      expect(find.text('Nothing written off'), findsOneWidget);

      await tester.tap(find.text('Record damaged'));
      await tester.pumpAndSettle();
      await settle(tester);
      expect(find.text('Which item?'), findsOneWidget);
      await tapAndSettle(tester, find.text('Rice · 5kg'));
      expect(find.text('Record damaged stock'), findsOneWidget);
      await tester.enterText(field('How many are damaged'), '3');
      await tester.tap(find.text('Expired'));
      await tester.enterText(field('Note (optional)'), 'past best-before');
      await tester.pump();
      expect(find.text('Leaves 1 in this store.'), findsOneWidget);
      await tapAndSettle(tester, find.text('Write off'));

      final sent = fake.posted.single;
      expect([sent['type'], sent['storeId'], sent['note']], ['waste', 's1', 'Expired: past best-before']);
      expect((sent['lines'] as List).single, containsPair('quantity', '3.000'));
      // Back on the history.
      expect(find.text('1 write-off · All stores'), findsOneWidget);
      expect(find.text('Expired: past best-before'), findsOneWidget);
      expect(find.text('−3'), findsOneWidget);
      expect(find.text(r'$21.00 at cost'), findsOneWidget);
    });

    testWidgets('needs words when the reason is Other', (tester) async {
      final (_, fake, _) = await openAdmin(tester);
      await goTo(tester, 'Damaged Stock');
      await tester.tap(find.text('Record damaged'));
      await tester.pumpAndSettle();
      await settle(tester);
      await tapAndSettle(tester, find.text('Cooking oil 2L'));
      await tester.enterText(field('How many are damaged'), '1');
      await tester.tap(find.text('Other'));
      await tester.pump();
      await tester.tap(find.text('Write off'));
      await tester.pump();
      expect(find.text('Say what happened'), findsOneWidget);
      await tester.enterText(field('What happened'), 'Leaking cap');
      await tapAndSettle(tester, find.text('Write off'));
      expect(fake.posted.single['note'], 'Leaking cap');
    });
  });
}
