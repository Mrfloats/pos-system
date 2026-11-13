import 'dart:convert';
import 'dart:io';

import 'package:floatly_till/core/api.dart';
import 'package:floatly_till/core/local_store.dart';
import 'package:floatly_till/fiscal/fdms_client.dart';
import 'package:floatly_till/fiscal/fiscal_device.dart';
import 'package:floatly_till/models/catalog.dart';
import 'package:floatly_till/models/receipt.dart';
import 'package:floatly_till/models/sale.dart';
import 'package:floatly_till/printing/escpos.dart';
import 'package:floatly_till/printing/receipt_pdf.dart';
import 'package:floatly_till/screens/fiscal_screen.dart';
import 'package:floatly_till/screens/receipt_screen.dart';
import 'package:floatly_till/state/till_state.dart';
import 'package:floatly_till/theme.dart';
import 'package:floatly_till/widgets/common.dart';
import 'package:floatly_till/widgets/qr_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'fake_fdms.dart';
import 'fixtures.dart';
import 'screenshots_test.dart' show loadFonts;

/// Floatly, as far as a fiscalising till needs it.
class FakeFloatly {
  final sales = <Map<String, dynamic>>[];
  final reports = <Map<String, dynamic>>[];
  final devices = <Map<String, dynamic>>[];
  final returns = <String, Map<String, dynamic>>{};

  /// Acts like a Floatly server from before fiscalisation, which refuses fields it doesn't know.
  bool beforeFiscal = false;

  http.Response _json(Object body, [int status = 200]) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

  Future<http.Response> handle(http.Request req) async {
    final path = req.url.path.replaceFirst('/api/v1', '');
    final body = req.body.isEmpty ? <String, dynamic>{} : (jsonDecode(req.body) as Map).cast<String, dynamic>();
    if (req.method == 'POST' && path == '/sales') {
      final existing = sales.indexWhere((s) => s['clientId'] == body['clientId']);
      if (existing < 0) sales.add(body);
      final n = existing < 0 ? sales.length : existing + 1;
      return _json({...body, 'id': 'sale-$n', 'number': 'S-0000$n'}, 201);
    }
    if (req.method == 'POST' && path == '/till/fiscal-receipts') {
      final items = (body['receipts'] as List).cast<Map<String, dynamic>>();
      reports.addAll(items);
      final known = {for (final s in sales) s['clientId'], ...returns.keys};
      final keys = [for (final r in items) (r['saleId'] ?? r['clientId']) as String];
      return _json({'updated': [for (final k in keys) if (known.contains(k)) k], 'missing': [for (final k in keys) if (!known.contains(k)) k]});
    }
    if (req.method == 'PUT' && path == '/till/fiscal-device') {
      devices.add(body);
      return _json(body);
    }
    final returnOf = RegExp(r'^/sales/(sale-\d+)/returns$').firstMatch(path);
    if (req.method == 'POST' && returnOf != null) {
      if (beforeFiscal && body.containsKey('deviceId')) {
        return _json({
          'message': ['property deviceId should not exist'],
        }, 400);
      }
      final id ='ret-${returns.length + 1}';
      returns[id] = {
        'id': id,
        'number': 'R-0000${returns.length + 1}',
        'type': 'return',
        'originalSaleId': returnOf.group(1),
        'deviceId': body['deviceId'],
        'currencyCode': 'USD',
        'storeName': 'Main Store',
        'salesperson': 'Rudo Manager',
        'soldAt': '2026-11-12T10:00:00.000Z',
        'note': body['reason'],
        'subtotal': '1.00',
        'discountTotal': '0.00',
        'taxTotal': '0.13',
        'total': '1.00',
        'lines': [
          {'variantId': 'v-coke', 'productName': 'Coke 500ml', 'variantName': 'Default', 'quantity': '1.000', 'unitPrice': '1.00', 'discount': '0.00', 'total': '1.00', 'taxRateId': 'vat'},
        ],
        'payments': [
          {'method': body['method'], 'currencyCode': 'USD', 'amount': '-1.00', 'change': '0.00'},
        ],
        'fiscal': null,
      };
      return _json(returns[id]!, 201);
    }
    final saleOf = RegExp(r'^/sales/sale-(\d+)$').firstMatch(path);
    if (req.method == 'GET' && saleOf != null) {
      final s = sales[int.parse(saleOf.group(1)!) - 1];
      return _json({...s, 'id': 'sale-${saleOf.group(1)}', 'type': 'sale'});
    }
    return _json({'message': 'Not here: ${req.method} $path'}, 404);
  }
}

void main() {
  late FakeFdms zimra;
  late FakeFloatly floatly;
  late TillState state;

  Map<String, dynamic> catalogWithHsCodes() {
    final c = catalogJson();
    for (final p in c['products'] as List) {
      if (p['id'] == 'p-coke') p['hsCode'] = '22021000';
      if (p['id'] == 'p-tee') p['hsCode'] = '6109';
    }
    return c;
  }

  setUp(() async {
    zimra = FakeFdms(lastGlobalNo: 10, lastDayNo: 2);
    floatly = FakeFloatly();
    Api.httpClient = MockClient(floatly.handle);
    final store = MemoryStore();
    store.values['device'] = jsonEncode(
      DeviceConfig(server: 'http://localhost:4000', deviceId: 'd1', deviceCode: 'T01', deviceName: 'Front till', storeId: 's1', storeName: 'Main Store', businessName: 'Sales Shop').toJson(),
    );
    store.secrets['device_token'] = 'dev_test-token';
    store.values['catalog'] = jsonEncode(catalogWithHsCodes());
    state = TillState(store, fiscalTransport: zimra);
    await state.init();
    state.session = Session(userId: 'u1', fullName: 'Rudo Manager', role: 'manager', token: 'tok');
    await state.fiscal.register(environment: FdmsEnvironment.test, deviceId: 321, activationKey: 'ABC12345', serialNo: 'FLT-0001');
  });

  tearDown(() {
    state.dispose();
    Api.httpClient = http.Client();
  });

  Product product(String id) => state.catalog!.products.firstWhere((p) => p.id == id);
  Currency currency(String code) => state.catalog!.currency(code);

  Future<void> sellCokes(int n, {Payment? pay}) async {
    final coke = product('p-coke');
    state.addItem(coke, coke.variants.first, quantity: n * 1000);
    await state.completeSale([pay ?? Payment(method: PayMethod.cash, currency: currency('USD'), amount: 500)]);
  }

  test('fiscalises a sale at checkout, prints ZIMRA’s details, and sends it to ZIMRA and Floatly', () async {
    final coke = product('p-coke');
    state.addItem(coke, coke.variants.first, quantity: 2000);
    final receipt = await state.completeSale([Payment(method: PayMethod.cash, currency: currency('USD'), amount: 500)]);
    final f = receipt.fiscal!;
    expect(f.label, 'FISCAL TAX INVOICE');
    expect((f.counter, f.globalNo, f.dayNo, f.invoiceNo, f.serialNo), (1, 11, 3, '321-11', 'FLT-0001'));
    expect(f.taxpayerName, 'Fiscal Shop (Pvt) Ltd');
    expect(f.branchAddress, '12, Samora Machel Ave, Harare, Harare');
    expect(f.verificationCode, matches(RegExp(r'^[0-9A-F]{4}(-[0-9A-F]{4}){3}$')));
    expect(f.qrCode, startsWith('https://fdmstest.zimra.co.zw/0000000321'));
    expect([for (final t in f.taxes) (t.label, t.gross, t.tax, t.net)], [('15.5%', 200, 27, 173)]);
    expect(receipt.change, 300);

    await state.fiscalSync();
    await state.sync();
    await state.fiscalSync();
    expect(zimra.receipts.single['receiptPayments'], [
      {'moneyTypeCode': 'Cash', 'paymentAmount': 2.0},
    ], reason: 'the money kept, change given back');
    expect(zimra.errorsFor['321-11'], isEmpty);
    final sent = floatly.sales.single['fiscal'] as Map;
    expect(sent, containsPair('invoiceNo', '321-11'));
    expect(sent, containsPair('verificationCode', f.verificationCode));
    expect([sent['status'], ...floatly.reports.map((r) => r['status'])], contains('submitted'));
    expect(state.fiscal.queue, isEmpty, reason: 'ZIMRA has it and Floatly knows');
    expect(floatly.devices.last, containsPair('fiscalDeviceId', 321));
    expect((floatly.devices.last['state'] as Map)['unsent'], 0);
  });

  test('a sale paid in another currency reaches ZIMRA in the sale’s currency', () async {
    await sellCokes(1, pay: Payment(method: PayMethod.mobile, currency: currency('ZWG'), amount: 2650));
    await state.fiscalSync();
    expect(zimra.receipts.single['receiptCurrency'], 'USD');
    expect(zimra.receipts.single['receiptPayments'], [
      {'moneyTypeCode': 'MobileWallet', 'paymentAmount': 1.0},
    ]);
    expect(zimra.errorsFor.values.single, isEmpty);
  });

  test("won't sell what ZIMRA would reject, and records nothing", () async {
    final mince = product('p-mince');
    state.addItem(mince, mince.variants.first, quantity: 500);
    await expectLater(
      state.completeSale([Payment(method: PayMethod.cash, currency: currency('USD'), amount: 500)]),
      throwsA(isA<FiscalBlocked>().having((e) => e.message, 'message', contains('“Mince” needs an HS code'))),
    );
    expect(state.outbox, isEmpty);
    expect(state.receipts, isEmpty);
    expect(state.fiscal.globalNo, 10);
    expect(state.cart, hasLength(1), reason: 'the basket stays to fix and try again');
  });

  test('a till that is not a ZIMRA device refunds without naming itself, so an older Floatly server takes it', () async {
    await state.fiscal.forget();
    floatly.beforeFiscal = true;
    await sellCokes(1);
    await state.sync();
    final ret = await state.refund('sale-1', {
      'lines': [
        {'lineId': 'l1', 'quantity': '1.000'},
      ],
      'method': 'cash',
      'reason': 'Flat',
      'restock': true,
    });
    expect(ret['number'], 'R-00001');
    expect(ret['fiscalProblem'], isNull);
    expect(state.receiptFor('ret-1')?.fiscal, isNull);
  });

  test('a refund gives the customer a ZIMRA credit note for the original receipt', () async {
    await sellCokes(1);
    await state.sync();
    final ret = await state.refund('sale-1', {
      'lines': [
        {'lineId': 'l1', 'quantity': '1.000'},
      ],
      'method': 'cash',
      'reason': 'Flat',
      'restock': true,
    });
    expect(ret['fiscalProblem'], isNull);
    expect(ret['deviceId'], 'd1', reason: 'Floatly records which till gave the money back');
    final note = state.receiptFor('ret-1')!.fiscal!;
    expect(note.label, 'CREDIT NOTE');
    expect((note.creditedGlobalNo, note.creditedInvoiceNo, note.globalNo), (11, '321-11', 12));
    expect(note.notes, 'Flat');

    await state.fiscalSync();
    final sent = zimra.receipts.last;
    expect(sent['receiptType'], 'CreditNote');
    expect(sent['creditDebitNote'], {'deviceID': 321, 'receiptGlobalNo': 11, 'fiscalDayNo': 3});
    expect(sent['receiptTotal'], -1.0);
    expect(zimra.errorsFor['321-12'], isEmpty);
    final report = floatly.reports.firstWhere((r) => r['saleId'] == 'ret-1');
    expect(report['receipt'], containsPair('receiptType', 'CreditNote'));
  });

  testWidgets('prints the ZIMRA block and QR code on screen, on paper and as a PDF', (tester) async {
    late final Receipt receipt;
    await tester.runAsync(() async {
      final coke = product('p-coke');
      state.addItem(coke, coke.variants.first);
      receipt = await state.completeSale([Payment(method: PayMethod.card, currency: currency('USD'), amount: 100)]);
    });
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: SingleChildScrollView(child: ReceiptView(receipt: receipt)))));
    expect(find.text('FISCAL TAX INVOICE'), findsOneWidget);
    expect(find.text('Invoice No: 1/11'), findsOneWidget);
    expect(find.text('Device Serial No: FLT-0001'), findsOneWidget);
    expect(find.text(receipt.fiscal!.verificationCode), findsOneWidget);
    expect(find.text('VAT (15.5%)'), findsOneWidget);
    expect(find.byType(QrView), findsOneWidget);
    expect(find.text('VAT included'), findsNothing, reason: 'the tax table replaces it');

    final printed = latin1.decode(receiptEscPos(receipt, paperWidth: 80));
    expect(printed, contains('FISCAL TAX INVOICE'));
    expect(printed, contains('Verification code:'));
    expect(printed, contains(receipt.fiscal!.qrCode), reason: 'stored in the QR command');
    expect(printed, contains('\x1D(k'));
    final pdf = await tester.runAsync(() => receiptPdf(receipt, paperWidth: 58));
    expect(pdf!.length, greaterThan(1000));
  });

  // FLOATLY_SHOTS=1 flutter test test/fiscal_till_test.dart --update-goldens → build/shots
  testWidgets('screenshots: a fiscal receipt and the ZIMRA screen', (tester) async {
    tester.view.physicalSize = const Size(420, 1500);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    late final Receipt receipt;
    await tester.runAsync(() async {
      await loadFonts();
      final coke = product('p-coke');
      final tee = product('p-tee');
      state.setCustomer(state.catalog!.customers.firstWhere((c) => c.id == 'c-chipo'));
      state.addItem(coke, coke.variants.first, quantity: 3000);
      state.addItem(tee, tee.variants.first);
      receipt = await state.completeSale([Payment(method: PayMethod.cash, currency: currency('USD'), amount: 2000)]);
    });
    Widget app(Widget home) => TillScope(state: state, child: MaterialApp(debugShowCheckedModeBanner: false, theme: buildTheme(Brightness.light), home: home));
    await tester.pumpWidget(app(Scaffold(body: SingleChildScrollView(padding: const EdgeInsets.all(16), child: ReceiptView(receipt: receipt)))));
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('../build/shots/fiscal-receipt.png'));

    tester.view.physicalSize = const Size(420, 1100);
    await tester.pumpWidget(app(const FiscalScreen()));
    await tester.pump();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('../build/shots/fiscal-screen.png'));
  }, skip: Platform.environment['FLOATLY_SHOTS'] == null);
}
