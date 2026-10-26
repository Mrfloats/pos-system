import 'dart:convert';

import 'package:floatly_till/core/local_store.dart';
import 'package:floatly_till/main.dart';
import 'package:floatly_till/state/till_state.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fixtures.dart';

/// A paired till with its catalog saved, and a cashier signed in offline.
Future<TillState> offlineTill({bool signedIn = true}) async {
  final store = MemoryStore();
  store.values['device'] = jsonEncode(
    DeviceConfig(
      server: 'http://localhost:4000',
      deviceId: 'd1',
      deviceCode: 'T01',
      deviceName: 'Front till',
      storeId: 's1',
      storeName: 'Main Store',
      businessName: 'Sales Shop',
    ).toJson(),
  );
  store.secrets['device_token'] = 'dev_test-token';
  store.values['catalog'] = jsonEncode(catalogJson());
  final state = TillState(store);
  await state.init();
  if (signedIn) state.session = Session(userId: 'u1', fullName: 'Rudo Cashier', role: 'cashier');
  return state;
}

void main() {
  testWidgets('asks an owner to set up a new device', (tester) async {
    final state = TillState(MemoryStore());
    await state.init();
    await tester.pumpWidget(TillApp(state: state));
    await tester.pumpAndSettle();
    expect(find.text('Owner or admin sign-in'), findsOneWidget);
    state.dispose();
  });

  testWidgets('a paired till asks for a PIN', (tester) async {
    final state = await offlineTill(signedIn: false);
    await tester.pumpWidget(TillApp(state: state));
    await tester.pumpAndSettle();
    expect(find.text('Sales Shop'), findsOneWidget);
    expect(find.text('Main Store · Front till'), findsOneWidget);
    await tester.tap(find.text('1'));
    await tester.tap(find.text('2'));
    await tester.pump();
    expect(find.text('Enter your PIN'), findsOneWidget);
    state.dispose();
  });

  testWidgets('sells offline: scan, tap, pay cash, give change, and queue the sale to upload', (tester) async {
    tester.view.physicalSize = const Size(1400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final state = await offlineTill();
    await tester.pumpWidget(TillApp(state: state));
    await tester.pumpAndSettle();
    expect(find.text('Main Store'), findsWidgets);

    // A barcode scanner types the code and presses Enter.
    await tester.enterText(find.byType(TextField).first, '600100');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(find.text(r'Charge $1.00'), findsOneWidget);

    await tester.tap(find.text('Coke 500ml').first);
    await tester.pumpAndSettle();
    expect(find.text(r'Charge $2.00'), findsOneWidget);
    expect(find.text('VAT included'), findsOneWidget);

    await tester.tap(find.text(r'Charge $2.00'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ActionChip, r'$5.00'));
    await tester.pumpAndSettle();
    expect(find.text('Change to give'), findsOneWidget);

    await tester.tap(find.text('Complete sale'));
    await tester.pumpAndSettle();
    expect(find.text('Give change'), findsOneWidget);
    expect(find.textContaining('Saved on this till'), findsOneWidget);
    expect(find.text('Receipt T01-000001'), findsOneWidget);

    final sale = state.outbox.single.payload;
    expect(sale['storeId'], 's1');
    expect(sale['deviceId'], 'd1');
    expect(sale['salespersonId'], 'u1');
    expect(sale['currencyCode'], 'USD');
    expect(sale['lines'], [
      {'variantId': 'v-coke', 'quantity': '2.000', 'unitPrice': '1.00', 'discount': '0.00'},
    ]);
    expect(sale['payments'], [
      {'method': 'cash', 'currencyCode': 'USD', 'amount': '5.00'},
    ]);
    expect(state.cart, isEmpty);

    await tester.tap(find.text('New sale'));
    await tester.pumpAndSettle();
    expect(find.text('Scan or tap a product to start a sale'), findsOneWidget);
    state.dispose();
  });

  testWidgets('on a phone the basket opens from the bottom bar', (tester) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final state = await offlineTill();
    await tester.pumpWidget(TillApp(state: state));
    await tester.pumpAndSettle();
    await tester.tap(find.text('T-shirt'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Large'));
    await tester.pumpAndSettle();
    // 12.00 plus 15.5% VAT.
    expect(find.text(r'$13.86'), findsOneWidget);
    await tester.tap(find.text('1 item'));
    await tester.pumpAndSettle();
    expect(find.text(r'Charge $13.86'), findsOneWidget);
    state.dispose();
  });
}
