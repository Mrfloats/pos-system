import 'package:floatly_till/admin/admin_state.dart';
import 'package:floatly_till/core/api.dart';
import 'package:floatly_till/core/local_store.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import 'admin_support.dart';

Finder field(String label) => find.widgetWithText(TextField, label);

void main() {
  tearDown(() => Api.httpClient = http.Client());

  group('offline', () {
    test('shows the saved copy when the connection drops, and says how old it is', () async {
      var now = DateTime(2026, 11, 10, 9, 15);
      final (admin, fake, store) = await signedIn(clock: () => now);
      final fresh = await admin.fetch('/dashboard', query: {'storeId': 's1'}) as Map;
      expect(admin.offline, isFalse);

      fake.down = true;
      now = now.add(const Duration(minutes: 3));
      final saved = await admin.fetch('/dashboard', query: {'storeId': 's1'}) as Map;
      expect(saved['today'], fresh['today']);
      expect(admin.offline, isTrue);
      expect(admin.showingSavedFrom, DateTime(2026, 11, 10, 9, 15));
      // Nothing saved for this one: the error goes on.
      await expectLater(admin.fetch('/customers'), throwsA(isA<ApiException>().having((e) => e.isOffline, 'offline', isTrue)));

      fake.down = false;
      await admin.fetch('/dashboard', query: {'storeId': 's1'});
      expect([admin.offline, admin.showingSavedFrom], [false, null]);
      // Kept on the phone for next time.
      expect(store.values['admin_cache'], contains('/dashboard?storeId=s1'));
      admin.dispose();
    });

    test('keeps only the most recent screens', () async {
      final (admin, _, store) = await signedIn();
      for (var i = 0; i < 70; i++) {
        await admin.fetch('/sales/sale-${101 - (i % 40)}', query: {'n': '$i'});
      }
      final kept = RegExp(r'"/sales/').allMatches(store.values['admin_cache']!).length;
      expect(kept, 60);
      admin.dispose();
    });

    test("queues a stock change offline, sends it when back, and doesn't send someone else's", () async {
      final (admin, fake, store) = await signedIn();
      fake.down = true;
      final body = {
        'storeId': 's1',
        'type': 'waste',
        'note': 'Expired',
        'lines': [
          {'variantId': 'v-rice', 'quantity': '1.000', 'clientId': 'c-1'},
        ],
      };
      expect(await admin.sendOrQueue('/inventory/movements', body, label: 'Rice: 1 written off'), isFalse);
      expect(admin.waitingCount, 1);
      expect(store.values['admin_outbox'], contains('c-1'));
      await admin.syncOutbox();
      expect(admin.waitingCount, 1); // still offline: still waiting

      fake.down = false;
      await admin.syncOutbox();
      expect(admin.waitingCount, 0);
      expect(fake.posted.single['lines'], body['lines']);
      expect(store.values.containsKey('admin_outbox'), isFalse);
      admin.dispose();

      // A queue left by another person isn't sent under a new sign-in.
      store.values['admin_outbox'] = '[{"id":"1","path":"/inventory/movements","body":{},"label":"x","at":"2026-11-10","userId":"someone-else","tenantId":"t1"}]';
      final next = AdminState(store);
      await next.init();
      expect(next.waitingCount, 1);
      expect(await next.signIn(server: 'http://localhost:4000', email: 'admin@shop.test', password: 'password123'), isNull);
      expect(next.waitingCount, 0);
      next.dispose();
    });

    test('a change the server turns down is set aside with its reason (the server wins)', () async {
      final (admin, fake, _) = await signedIn();
      fake.down = true;
      await admin.sendOrQueue('/inventory/movements', {'storeId': 's1', 'type': 'adjustment', 'lines': []}, label: 'Oil: stock down by 2');
      fake.down = false;
      fake.refuseMovements = 'Unknown store';
      await admin.syncOutbox();
      expect(admin.waitingCount, 0);
      expect(admin.outbox.single['error'], 'Unknown store');
      expect(admin.outboxNotice, '"Oil: stock down by 2" couldn\'t be saved: Unknown store');
      await admin.discardQueued(admin.outbox.single['id'] as String);
      expect(admin.outbox, isEmpty);
      admin.dispose();
    });

    test('logging out clears the saved figures and anything waiting', () async {
      final (admin, fake, store) = await signedIn();
      await admin.fetch('/dashboard');
      fake.down = true;
      await admin.sendOrQueue('/inventory/movements', {'lines': []}, label: 'x');
      fake.down = false;
      await admin.signOut();
      expect(store.values.containsKey('admin_cache'), isFalse);
      expect(store.values.containsKey('admin_outbox'), isFalse);
      expect(store.secrets, isEmpty);
      admin.dispose();
    });

    testWidgets('a write-off made offline waits on the phone, with a banner, and uploads on "Try now"', (tester) async {
      final (_, fake, _) = await openAdmin(tester);
      await goTo(tester, 'Inventory');
      await tapAndSettle(tester, find.text('Rice · 5kg'));
      fake.down = true;
      await tester.tap(find.text('Damaged'));
      await tester.pumpAndSettle();
      await tester.enterText(field('How many are damaged'), '2');
      await tester.tap(find.text('Spoiled'));
      await tapAndSettle(tester, find.text('Write off'));
      expect(find.textContaining('No connection: saved on this phone'), findsOneWidget);
      expect(fake.posted, isEmpty);

      // Back on the list: the banners say what's going on.
      Navigator.of(tester.element(find.text('In stock, all stores'))).pop();
      await settle(tester);
      await tester.runAsync(() => tester.drag(find.byType(ListView).first, const Offset(0, 300)));
      await settle(tester);
      expect(find.textContaining('No connection. Showing what was saved at'), findsOneWidget);
      expect(find.text('1 stock change saved on this phone, waiting to upload.'), findsOneWidget);

      fake.down = false;
      await tapAndSettle(tester, find.text('Try now'));
      expect(fake.posted.single['type'], 'waste');
      expect(find.textContaining('waiting to upload'), findsNothing);
    });

    testWidgets('warns before logging out with changes still waiting', (tester) async {
      final (admin, fake, _) = await openAdmin(tester);
      fake.down = true;
      await tester.runAsync(() => admin.sendOrQueue('/inventory/movements', {'lines': []}, label: 'x'));
      fake.down = false;
      await tester.pump();
      await tester.tap(find.byTooltip('Open navigation menu'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Logout'));
      await tester.pumpAndSettle();
      expect(find.textContaining("1 stock change hasn't uploaded yet and will be lost"), findsOneWidget);
    });
  });

  group('notifications', () {
    testWidgets('the bell counts new ones, lists them, and goes quiet once seen', (tester) async {
      late MemoryStore store;
      final (admin, _, _) = await openAdmin(tester);
      await tester.runAsync(() => admin.loadNotifications());
      await tester.pump();
      expect(find.byTooltip('3 new notifications'), findsOneWidget);

      await tapAndSettle(tester, find.byTooltip('3 new notifications'));
      expect(find.text('Chipo Cashier asks to refund USD 10.00 on S-00103'), findsOneWidget);
      expect(find.text('Sugar 2kg at Main Store and 6 more'), findsOneWidget);
      expect(find.text("Monday's takings: USD 1000.00"), findsOneWidget);
      expect(find.byWidgetPredicate((w) => w is Semantics && w.properties.label == 'New'), findsNWidgets(3));
      expect(admin.unseenCount, 0);
      store = admin.store as MemoryStore;
      expect(store.values['admin_seen'], '2026-11-10T11:00:00.000Z');

      // Opens what it is about.
      await tapAndSettle(tester, find.text('7 items running low'));
      expect(find.widgetWithText(AppBar, 'Low stock'), findsOneWidget);
      expect(find.text('Low stock only'), findsOneWidget);
      Navigator.of(tester.element(find.text('Low stock only'))).pop();
      await tester.pumpAndSettle();
      await settle(tester);
      await tapAndSettle(tester, find.text('Chipo Cashier asks to refund USD 10.00 on S-00103'));
      expect(find.text('To give back'), findsOneWidget);
      Navigator.of(tester.element(find.text('To give back'))).maybePop();
      await tester.pumpAndSettle();
      await settle(tester);
      Navigator.of(tester.element(find.text('7 items running low'))).pop();
      await tester.pumpAndSettle();
      expect(find.byTooltip('Notifications'), findsOneWidget);
    });

    testWidgets('a newer one rings the bell again', (tester) async {
      final (admin, fake, _) = await openAdmin(tester);
      await tester.runAsync(() async {
        await admin.loadNotifications();
        await admin.markNotificationsSeen();
      });
      fake.bell = [
        {
          'id': 'void-9',
          'kind': 'void',
          'title': 'Sale S-00105 voided',
          'body': 'By Admin User',
          'at': '2026-11-10T12:30:00.000Z',
          'attention': false,
          'link': {'to': 'sale', 'id': 'sale-105'},
        },
        ...fake.bell,
      ];
      await tester.runAsync(() => admin.loadNotifications());
      await tester.pump();
      expect(find.byTooltip('1 new notification'), findsOneWidget);
    });

    testWidgets('no bell for someone without the dashboard', (tester) async {
      final server = FakeServer()..permissions = ['sales.view'];
      await openAdmin(tester, server: server);
      expect(find.byTooltip('Notifications'), findsNothing);
    });
  });
}
