import 'package:floatly_till/admin/admin_state.dart';
import 'package:floatly_till/core/api.dart';
import 'package:floatly_till/core/local_store.dart';
import 'package:floatly_till/main.dart';
import 'package:floatly_till/state/till_state.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'admin_support.dart';

void main() {
  tearDown(() => Api.httpClient = http.Client());

  group('admin sign-in', () {
    test('signs in, reads who they are, and keeps the refresh token in the keychain', () async {
      final (admin, fake, store) = await signedIn();
      final s = admin.session!;
      expect([s.fullName, s.roleLabel, s.staffCode, s.businessName, s.initials], ['Admin User', 'Admin', 'ADM-001', 'Corner Shop', 'AU']);
      expect(s.can('dashboard.view'), isTrue);
      expect(s.can('products.price'), isFalse);
      expect(admin.stores.map((x) => x.name), ['Main Store', 'Depot']);
      expect(admin.money('1234.5'), r'$1,234.50');
      expect(store.secrets['admin_refresh'], fake.liveRefresh);
      // The tokens are nowhere in ordinary storage.
      expect(store.values['admin'], isNot(contains('rt_')));
      expect(store.values['admin'], isNot(contains('access-')));
      admin.dispose();
    });

    test('says why a wrong password or a cashier is refused', () async {
      final fake = FakeServer(role: 'cashier');
      Api.httpClient = MockClient(fake.handle);
      final admin = AdminState(MemoryStore());
      await admin.init();
      expect(await admin.signIn(server: 'localhost:4000', email: 'c@shop.test', password: 'nope'), 'Wrong email or password');
      expect(await admin.signIn(server: 'localhost:4000', email: 'c@shop.test', password: 'password123'), contains('owners, admins and managers'));
      expect(admin.signedIn, isFalse);
      admin.dispose();
    });

    test("without a PIN the sign-in isn't kept, until one is chosen", () async {
      final (admin, fake, store) = await signedIn(server: FakeServer(hasPin: false));
      expect(admin.shouldOfferPin, isTrue);
      expect(store.secrets, isEmpty);
      expect(store.values['admin'], isNull);
      expect(await admin.choosePin('2468'), isNull);
      expect(fake.pin, '2468');
      expect(admin.session!.hasPin, isTrue);
      expect(admin.shouldOfferPin, isFalse);
      expect(store.secrets['admin_refresh'], isNotNull);
      admin.dispose();
    });

    test('swaps the refresh token when the access token runs out, once for calls made together', () async {
      var now = DateTime(2026, 11, 10, 9);
      final (admin, fake, store) = await signedIn(clock: () => now);
      expect(fake.refreshes, 0);
      now = now.add(const Duration(minutes: 16));
      final results = await Future.wait([
        admin.call((api) => api.get('/dashboard')),
        admin.call((api) => api.get('/stores')),
        admin.call((api) => api.get('/currencies')),
      ]);
      expect(results, hasLength(3));
      expect(fake.refreshes, 1);
      expect(store.secrets['admin_refresh'], fake.liveRefresh);
      // The server stops honouring the access token early (say, a restart): one more swap, then the call goes through.
      fake.liveAccess = 'gone';
      await admin.call((api) => api.get('/stores'));
      expect(fake.refreshes, 2);
      admin.dispose();
    });

    test('ends the session, and clears the phone, when the refresh token no longer works', () async {
      var now = DateTime(2026, 11, 10, 9);
      final (admin, fake, store) = await signedIn(clock: () => now);
      fake.revoked = true;
      now = now.add(const Duration(minutes: 16));
      await expectLater(admin.call((api) => api.get('/dashboard')), throwsA(isA<ApiException>()));
      expect(admin.signedIn, isFalse);
      expect(admin.notice, 'Your session has ended. Sign in again.');
      expect(store.secrets, isEmpty);
      expect(store.values['admin'], isNull);
      admin.dispose();
    });

    test('logs out on the server and leaves nothing behind', () async {
      final (admin, fake, store) = await signedIn();
      await admin.signOut();
      expect(fake.loggedOut, isTrue);
      expect(admin.signedIn, isFalse);
      expect(store.secrets, isEmpty);
      expect(store.values, isEmpty);
      admin.dispose();
    });

    test('starts locked next time, and the PIN unlocks it', () async {
      final (first, fake, store) = await signedIn();
      await first.setStore('s2');
      first.dispose();

      final admin = AdminState(store);
      await admin.init();
      expect(admin.signedIn, isTrue);
      expect(admin.locked, isTrue);
      expect(admin.storeId, 's2');
      expect(admin.session!.fullName, 'Admin User');
      expect(await admin.unlock('0000'), 'Wrong PIN');
      expect(admin.locked, isTrue);
      expect(await admin.unlock('4321'), isNull);
      expect(admin.locked, isFalse);
      await admin.call((api) => api.get('/stores'));
      expect(fake.lastHeaders['X-Floatly-Pin'], isNull); // only the unlock itself carried it
      admin.dispose();
    });
  });

  group('admin area', () {
    Future<(AdminState, FakeServer, TillState)> open(WidgetTester tester, {Size size = const Size(420, 900), FakeServer? server}) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      late AdminState admin;
      late FakeServer fake;
      late TillState till;
      await tester.runAsync(() async {
        final (a, f, store) = await signedIn(server: server);
        admin = a;
        fake = f;
        till = TillState(store);
        await till.init();
      });
      addTearDown(() {
        admin.dispose();
        till.dispose();
      });
      await tester.pumpWidget(TillApp(state: till, admin: admin));
      await settle(tester);
      return (admin, fake, till);
    }

    testWidgets('shows today on the dashboard', (tester) async {
      await open(tester);
      expect(find.text('Dashboard'), findsOneWidget);
      expect(find.text("Today's sales · Tue 10 Nov"), findsOneWidget);
      expect(find.text(r'$1,234.50'), findsOneWidget);
      expect(find.text('23.5% up on yesterday'), findsOneWidget);
      expect(find.text('17.7% down on last Tue'), findsOneWidget);
      expect(find.text('41'), findsOneWidget);
      expect(find.text('2 returns'), findsOneWidget);
      expect(find.text(r'$31.20'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('Sugar 2kg'), 300);
      expect(find.text('Rice 5kg'), findsOneWidget);
      expect(find.text('8.5 sold'), findsOneWidget);
      expect(find.text('Mobile money'), findsOneWidget);
      expect(find.text('7 items'), findsOneWidget);
      expect(find.text('3 left'), findsOneWidget);
      expect(find.text('and 6 more'), findsOneWidget);
    });

    testWidgets('the menu shows who is signed in, with a red logout that signs out', (tester) async {
      final (admin, fake, _) = await open(tester);
      await tester.tap(find.byTooltip('Open navigation menu'));
      await tester.pumpAndSettle();
      expect(find.text('Admin User'), findsOneWidget);
      expect(find.text('Admin — ID: ADM-001'), findsOneWidget);
      expect(find.text('Corner Shop'), findsOneWidget);
      expect(find.text('Go to the till'), findsNothing); // this phone isn't a till
      final logout = tester.widget<Text>(find.text('Logout'));
      expect(logout.style!.color, const Color(0xFFFF8A80));

      await tester.tap(find.text('More on the web'));
      await tester.pumpAndSettle();
      expect(find.text('Available on the web backoffice'), findsOneWidget);
      expect(find.text('Staff, roles and permissions'), findsOneWidget);
      await tester.tapAt(const Offset(200, 40));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Logout'));
      await tester.pumpAndSettle();
      await tester.runAsync(() async {
        await tester.tap(find.text('Log out'));
        await Future<void>.delayed(const Duration(milliseconds: 50));
      });
      await tester.pumpAndSettle();
      expect(fake.loggedOut, isTrue);
      expect(admin.signedIn, isFalse);
      // Back to the till's own start.
      expect(find.text('Owner or admin sign-in'), findsOneWidget);
      expect(find.text('Manage your business instead'), findsOneWidget);
    });

    testWidgets('switches branch from the top bar', (tester) async {
      final (admin, fake, _) = await open(tester);
      await tester.tap(find.text('All stores'));
      await tester.pumpAndSettle();
      await tester.runAsync(() async {
        await tester.tap(find.text('Depot').last);
        await Future<void>.delayed(const Duration(milliseconds: 50));
      });
      await settle(tester);
      expect(admin.storeId, 's2');
      expect(fake.requests.where((r) => r == 'GET /dashboard'), hasLength(2));
      expect(find.text(r'$0.00'), findsWidgets);
      expect(find.text('No sales yesterday'), findsOneWidget);
      expect(find.text('No sales yet today'), findsOneWidget);
      expect(find.text('Nothing is running low'), findsOneWidget);
    });

    testWidgets('keeps the menu open at the side on a wide screen', (tester) async {
      await open(tester, size: const Size(1200, 800));
      expect(find.text('Admin — ID: ADM-001'), findsOneWidget);
      expect(find.byTooltip('Open navigation menu'), findsNothing);
      expect(find.text(r'$1,234.50'), findsOneWidget);
    });

    testWidgets('locks after five minutes untouched and opens again with the PIN', (tester) async {
      final (admin, _, _) = await open(tester);
      // A touch four minutes in starts the clock again.
      await tester.pump(const Duration(minutes: 4));
      await tester.tapAt(const Offset(200, 500));
      await tester.pump(const Duration(minutes: 4));
      expect(admin.locked, isFalse);
      await tester.pump(const Duration(minutes: 2));
      await tester.pump();
      expect(admin.locked, isTrue);
      expect(find.text('Enter your PIN'), findsOneWidget);
      expect(find.text('Admin — ID: ADM-001 · Corner Shop'), findsOneWidget);
      expect(find.text(r'$1,234.50'), findsNothing);

      await tester.enterText(find.byType(TextField), '1111');
      await tester.runAsync(() async {
        await tester.tap(find.text('Unlock'));
        await Future<void>.delayed(const Duration(milliseconds: 50));
      });
      await tester.pump();
      expect(find.text('Wrong PIN'), findsOneWidget);

      await tester.enterText(find.byType(TextField), '4321');
      await tester.runAsync(() async {
        await tester.tap(find.text('Unlock'));
        await Future<void>.delayed(const Duration(milliseconds: 100));
      });
      await settle(tester);
      expect(admin.locked, isFalse);
      expect(find.text(r'$1,234.50'), findsOneWidget);
    });

    testWidgets('offers a PIN after a first sign-in', (tester) async {
      final (admin, fake, _) = await open(tester, server: FakeServer(hasPin: false));
      expect(find.text('Choose a PIN'), findsOneWidget);
      await tester.enterText(find.byType(TextField).first, '2468');
      await tester.enterText(find.byType(TextField).last, '2469');
      await tester.tap(find.text('Save PIN'));
      await tester.pump();
      expect(find.text("The two PINs don't match"), findsOneWidget);
      await tester.enterText(find.byType(TextField).last, '2468');
      await tester.runAsync(() async {
        await tester.tap(find.text('Save PIN'));
        await Future<void>.delayed(const Duration(milliseconds: 100));
      });
      await settle(tester);
      expect(fake.pin, '2468');
      expect(admin.session!.hasPin, isTrue);
      expect(find.text('Dashboard'), findsOneWidget);
    });
  });
}

