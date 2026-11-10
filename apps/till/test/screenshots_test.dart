// Draws the admin screens to PNG files, to look at them without a phone:
//
//   FLOATLY_SHOTS=1 flutter test test/screenshots_test.dart --update-goldens
//
// The pictures land in build/shots. Skipped without FLOATLY_SHOTS.
import 'dart:io';

import 'package:floatly_till/admin/admin_login_screen.dart';
import 'package:floatly_till/admin/admin_state.dart';
import 'package:floatly_till/admin/admin_widgets.dart';
import 'package:floatly_till/core/local_store.dart';
import 'package:floatly_till/main.dart';
import 'package:floatly_till/state/till_state.dart';
import 'package:floatly_till/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'admin_test.dart' show FakeServer, settle, signedIn;

/// Real fonts instead of the test font's boxes.
Future<void> loadFonts() async {
  final flutter = Platform.environment['FLUTTER_ROOT'] ?? File(Platform.resolvedExecutable).parent.parent.parent.parent.parent.path;
  final dir = '$flutter/bin/cache/artifacts/material_fonts';
  Future<ByteData> font(String name) async => ByteData.sublistView(await File('$dir/$name').readAsBytes());
  final roboto = FontLoader('Roboto');
  for (final f in ['roboto-regular.ttf', 'roboto-medium.ttf', 'roboto-bold.ttf']) {
    roboto.addFont(font(f));
  }
  await roboto.load();
  await (FontLoader('MaterialIcons')..addFont(font('materialicons-regular.otf'))).load();
}

void main() {
  final on = Platform.environment['FLOATLY_SHOTS'] != null;

  Future<(AdminState, FakeServer)> open(WidgetTester tester, Size size, {FakeServer? server, Brightness brightness = Brightness.light}) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1;
    tester.platformDispatcher.platformBrightnessTestValue = brightness;
    addTearDown(tester.view.reset);
    addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
    late AdminState admin;
    late FakeServer fake;
    late TillState till;
    await tester.runAsync(() async {
      await loadFonts();
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
    return (admin, fake);
  }

  Future<void> shot(String name) => expectLater(find.byType(MaterialApp), matchesGoldenFile('../build/shots/$name.png'));

  testWidgets('dashboard on a phone', (tester) async {
    await open(tester, const Size(412, 1560));
    await shot('dashboard');
  }, skip: !on);

  testWidgets('dashboard in the dark', (tester) async {
    await open(tester, const Size(412, 1560), brightness: Brightness.dark);
    await shot('dashboard-dark');
  }, skip: !on);

  testWidgets('menu', (tester) async {
    await open(tester, const Size(412, 900));
    // Outside the test's fake clock, so the idle timer the tap restarts isn't counted as left over.
    await tester.runAsync(() => tester.tap(find.byTooltip('Open navigation menu')));
    await tester.pumpAndSettle();
    await shot('menu');
  }, skip: !on);

  testWidgets('wide', (tester) async {
    await open(tester, const Size(1280, 900));
    await shot('wide');
  }, skip: !on);

  testWidgets('locked', (tester) async {
    final (admin, _) = await open(tester, const Size(412, 900));
    admin.lock();
    await tester.pumpAndSettle();
    await shot('locked');
  }, skip: !on);

  testWidgets('choose a PIN', (tester) async {
    await open(tester, const Size(412, 900), server: FakeServer(hasPin: false));
    await shot('choose-pin');
  }, skip: !on);

  testWidgets('sign-in', (tester) async {
    await tester.runAsync(loadFonts);
    tester.view.physicalSize = const Size(412, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final admin = AdminState(MemoryStore())..ready = true;
    addTearDown(admin.dispose);
    await tester.pumpWidget(AdminScope(state: admin, child: MaterialApp(theme: buildTheme(Brightness.light), home: const AdminLoginScreen())));
    await shot('sign-in');
  }, skip: !on);
}
