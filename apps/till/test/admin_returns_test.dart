import 'dart:convert';

import 'package:floatly_till/core/api.dart';
import 'package:floatly_till/core/local_store.dart';
import 'package:floatly_till/models/receipt.dart';
import 'package:floatly_till/screens/receipt_screen.dart';
import 'package:floatly_till/state/till_state.dart';
import 'package:floatly_till/theme.dart';
import 'package:floatly_till/widgets/common.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'admin_support.dart';
import 'fixtures.dart';

Finder field(String label) => find.widgetWithText(TextField, label);

void main() {
  group('returns on the phone', () {
    testWidgets('lists requests waiting and opens one in full', (tester) async {
      await openAdmin(tester);
      await goTo(tester, 'Returns');
      expect(find.text('Waiting (2)'), findsOneWidget);
      expect(find.text('Refund of S-00103'), findsOneWidget);
      expect(find.text('"Rice bag torn"'), findsOneWidget);
      expect(find.text('Rice 5kg × 1'), findsOneWidget);
      expect(find.text('Void of S-00101'), findsOneWidget);

      await tapAndSettle(tester, find.text('Refund of S-00103'));
      expect(find.text('To give back'), findsOneWidget);
      expect(find.text(r'$10.00'), findsWidgets);
      expect(find.text('Chipo Cashier'), findsOneWidget);
      expect(find.text('Written off (damaged)'), findsOneWidget);
      expect(find.text('Cash'), findsOneWidget);
      expect(find.text('Approve'), findsOneWidget);
      expect(find.text('Turn down'), findsOneWidget);
    });

    testWidgets('approves with the PIN', (tester) async {
      final (_, fake, _) = await openAdmin(tester);
      await goTo(tester, 'Returns');
      await tapAndSettle(tester, find.text('Refund of S-00103'));
      await tester.ensureVisible(find.text('Approve'));
      await tester.tap(find.text('Approve'));
      await tester.pumpAndSettle();
      expect(find.text('Approve the refund'), findsOneWidget);
      expect(find.textContaining(r'Chipo Cashier gives back $10.00 for S-00103'), findsOneWidget);
      await tester.enterText(field('Your PIN'), '9999');
      await tapAndSettle(tester, find.text('Confirm'));
      expect(find.text('Wrong PIN'), findsOneWidget);
      await tester.enterText(field('Your PIN'), '4321');
      await tapAndSettle(tester, find.text('Confirm'));
      expect(fake.decisions.last.$2, 'approve');
      expect(fake.decisions.last.$4, '4321');
      expect(find.text('Refund R-00200 made'), findsOneWidget);
      expect(find.textContaining('Admin User approved it'), findsOneWidget);
      expect(find.text('Approve'), findsNothing);

      // Back on the list it has moved to Decided.
      Navigator.of(tester.element(find.text('To give back'))).maybePop();
      await settle(tester);
      expect(find.text('Waiting (1)'), findsOneWidget);
      await tester.tap(find.text('Decided'));
      await tester.pumpAndSettle();
      expect(find.text('Approved'), findsOneWidget);
    });

    testWidgets('turns one down only with a note for the cashier', (tester) async {
      final (_, fake, _) = await openAdmin(tester);
      await goTo(tester, 'Returns');
      await tapAndSettle(tester, find.text('Refund of S-00103'));
      await tester.ensureVisible(find.text('Turn down'));
      await tester.tap(find.text('Turn down'));
      await tester.pumpAndSettle();
      final confirmButton = find.widgetWithText(FilledButton, 'Turn down');
      expect(tester.widget<FilledButton>(confirmButton).onPressed, isNull);
      await tester.enterText(field('Tell the cashier why'), 'Bring the bag back first');
      await tester.pump();
      await tapAndSettle(tester, confirmButton);
      expect(fake.decisions.single.$3, {'note': 'Bring the bag back first'});
      expect(fake.decisions.single.$4, isNull); // no PIN needed to say no
      expect(find.textContaining('turned it down'), findsOneWidget);
      expect(find.textContaining('"Bring the bag back first"'), findsOneWidget);
    });

    testWidgets("won't let someone decide their own request", (tester) async {
      await openAdmin(tester);
      await goTo(tester, 'Returns');
      await tapAndSettle(tester, find.text('Void of S-00101'));
      expect(find.text('You asked for this, so someone else has to decide it.'), findsOneWidget);
      expect(find.text('Approve'), findsNothing);
    });

    testWidgets('the dashboard says when requests are waiting', (tester) async {
      await openAdmin(tester);
      expect(find.text('2 refund or void requests waiting for you'), findsOneWidget);
      await tester.tap(find.text('2 refund or void requests waiting for you'));
      await tester.pumpAndSettle();
      await settle(tester);
      expect(find.text('Refund of S-00103'), findsOneWidget);
    });
  });

  group('asking a manager on the till', () {
    late List<http.Request> sent;
    late Map<String, dynamic> request;

    TillState cashierTill() {
      final store = MemoryStore();
      store.values['device'] = jsonEncode(
        DeviceConfig(server: 'http://localhost:4000', deviceId: 'd1', deviceCode: 'T01', deviceName: 'Front till', storeId: 's1', storeName: 'Main Store', businessName: 'Sales Shop').toJson(),
      );
      store.secrets['device_token'] = 'dev_test-token';
      store.values['catalog'] = jsonEncode(catalogJson());
      return TillState(store);
    }

    setUp(() {
      sent = [];
      request = {
        'id': 'rq-9',
        'saleId': 'sale-9',
        'saleNumber': 'S-00009',
        'kind': 'refund',
        'status': 'pending',
        'amount': '4.00',
        'currencyCode': 'USD',
        'method': 'cash',
        'reason': 'Stale',
      };
      Api.httpClient = MockClient((req) async {
        sent.add(req);
        final path = req.url.path.replaceFirst('/api/v1', '');
        if (path == '/sales/sale-9/requests') return http.Response(jsonEncode(request), 201, headers: {'content-type': 'application/json'});
        if (path == '/sale-requests') return http.Response(jsonEncode({'items': [request], 'total': 1}), 200, headers: {'content-type': 'application/json'});
        if (path == '/sale-requests/rq-9/cancel') return http.Response(jsonEncode({...request, 'status': 'cancelled'}), 200, headers: {'content-type': 'application/json'});
        return http.Response('{}', 404);
      });
    });
    tearDown(() => Api.httpClient = http.Client());

    test('sends the request with the shift, and tells the cashier when a manager answers', () async {
      final state = cashierTill();
      await state.init();
      state.session = Session(userId: 'u2', fullName: 'Rudo Cashier', role: 'cashier', token: 't');
      state.shift = ShiftInfo.fromJson({'id': 'sh-1', 'number': 'SH-1', 'openedAt': '2026-11-10T08:00:00.000Z'});
      await state.askManager('sale-9', {'kind': 'refund', 'lines': [], 'method': 'cash', 'reason': 'Stale'});
      expect(jsonDecode(sent.single.body), containsPair('shiftId', 'sh-1'));
      expect(state.requestFor('sale-9')!['status'], 'pending');

      // Nothing yet.
      await state.loadMyRequests();
      expect(state.requestNotice, isNull);
      expect(sent.last.url.queryParameters['mine'], 'true');

      request = {...request, 'status': 'approved', 'decidedByName': 'Tino Manager', 'resultNumber': 'R-00012'};
      await state.loadMyRequests();
      expect(state.requestNotice, r'Tino Manager approved the refund for S-00009: give back $4.00 by cash (R-00012).');
      state.dismissRequestNotice();
      expect(state.requestNotice, isNull);

      request = {...request, 'id': 'rq-10', 'kind': 'void', 'status': 'pending'};
      await state.loadMyRequests();
      request = {...request, 'status': 'rejected', 'decisionNote': 'Two customers bought it'};
      await state.loadMyRequests();
      expect(state.requestNotice, 'Tino Manager turned down the void of S-00009: Two customers bought it');
      state.dispose();
    });

    test("doesn't ask on behalf of managers, who refund themselves", () async {
      final state = cashierTill();
      await state.init();
      state.session = Session(userId: 'u1', fullName: 'Tino Manager', role: 'manager', token: 't');
      await state.loadMyRequests();
      expect(sent, isEmpty);
      state.dispose();
    });

    testWidgets("a cashier's receipt offers to ask, and shows where the request stands", (tester) async {
      late TillState state;
      await tester.runAsync(() async {
        state = cashierTill();
        await state.init();
      });
      state.session = Session(userId: 'u2', fullName: 'Rudo Cashier', role: 'cashier', token: 't');
      state.online = true;
      addTearDown(state.dispose);
      final receipt = Receipt.fromJson({
        'clientId': 'c9',
        'reference': 'T01-000009',
        'soldAt': '2026-11-10T09:00:00.000Z',
        'businessName': 'Sales Shop',
        'storeName': 'Main Store',
        'cashier': 'Rudo Cashier',
        'currencyCode': 'USD',
        'symbol': r'$',
        'lines': [
          {'name': 'Bread', 'quantity': 2000, 'unitPrice': 200, 'discount': 0, 'total': 400},
        ],
        'subtotal': 400,
        'discountTotal': 0,
        'taxTotal': 0,
        'total': 400,
        'payments': [
          {'method': 'cash', 'currencyCode': 'USD', 'symbol': r'$', 'amount': 400, 'change': 0},
        ],
        'number': 'S-00009',
        'saleId': 'sale-9',
      });
      await tester.pumpWidget(TillScope(state: state, child: MaterialApp(theme: buildTheme(Brightness.light), home: ReceiptScreen(receipt: receipt))));
      await tester.scrollUntilVisible(find.text('Ask a manager to void this sale'), 200);
      expect(find.text('Ask for a refund'), findsOneWidget);
      expect(find.text('Refund'), findsNothing);

      await tester.tap(find.text('Ask a manager to void this sale'));
      await tester.pumpAndSettle();
      final ask = find.widgetWithText(FilledButton, 'Ask a manager');
      expect(tester.widget<FilledButton>(ask).onPressed, isNull);
      await tester.enterText(field('Why'), 'Rang it twice');
      await tester.pump();
      request = {...request, 'kind': 'void'};
      await tester.runAsync(() async {
        await tester.tap(ask);
        await Future<void>.delayed(const Duration(milliseconds: 50));
      });
      await tester.pumpAndSettle();
      expect(jsonDecode(sent.single.body), {'kind': 'void', 'reason': 'Rang it twice'});
      expect(find.textContaining('You asked for a void. Waiting for a manager'), findsOneWidget);
      expect(find.text('Ask for a refund'), findsNothing);
      expect(find.text('Ask a manager to void this sale'), findsNothing);

      await tester.ensureVisible(find.text('Take back'));
      await tester.pumpAndSettle();
      await tester.runAsync(() async {
        await tester.tap(find.text('Take back'));
        await Future<void>.delayed(const Duration(milliseconds: 50));
      });
      await tester.pumpAndSettle();
      expect(find.text('You took back your request for a void.'), findsOneWidget);
      expect(find.text('Ask for a refund'), findsOneWidget);
    });
  });
}
