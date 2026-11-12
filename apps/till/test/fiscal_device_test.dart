import 'package:floatly_till/core/local_store.dart';
import 'package:floatly_till/fiscal/fdms.dart';
import 'package:floatly_till/fiscal/fdms_client.dart';
import 'package:floatly_till/fiscal/fiscal_device.dart';
import 'package:floatly_till/models/catalog.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_fdms.dart';

void main() {
  late FakeFdms zimra;
  late MemoryStore store;
  late DateTime now;
  late FiscalDevice device;

  FiscalDevice newDevice() => FiscalDevice(store: store, transport: zimra, clock: () => now, pollDelay: Duration.zero);

  Future<void> register() => device.register(environment: FdmsEnvironment.test, deviceId: 321, activationKey: 'abc12345', serialNo: 'FLT-0001');

  final vat = FdmsTax.fromJson(FakeFdms.taxes[2]);
  final exempt = FdmsTax.fromJson(FakeFdms.taxes[0]);

  FiscalItem bread([int qty = 1000]) => FiscalItem(name: 'Bread', quantity: qty, unitPrice: 155, total: 155 * qty ~/ 1000, tax: vat, hsCode: '1905');

  Future<IssuedReceipt> sell(String id, {List<FiscalItem>? items, int? pay}) {
    final list = items ?? [bread()];
    return device.issue(
      clientId: id,
      type: FdmsReceiptType.fiscalInvoice,
      currency: 'USD',
      items: list,
      payments: [FiscalPay(MoneyType.cash, pay ?? list.fold(0, (a, i) => a + i.total))],
      username: 'Rudo',
    );
  }

  setUp(() async {
    zimra = FakeFdms(lastGlobalNo: 41, lastDayNo: 6);
    store = MemoryStore();
    now = DateTime(2026, 11, 12, 8, 0, 0);
    device = newDevice();
    await device.load();
  });

  group('registering', () {
    test('checks the device with ZIMRA, then registers it carrying on its numbers', () async {
      final who = await device.verify(environment: FdmsEnvironment.test, deviceId: 321, activationKey: 'abc12345', serialNo: 'FLT-0001');
      expect(who['taxPayerName'], 'Fiscal Shop (Pvt) Ltd');
      expect(device.registered, isFalse);

      await register();
      expect(device.registered, isTrue);
      expect(device.active, isTrue);
      expect(device.config!.taxpayerName, 'Fiscal Shop (Pvt) Ltd');
      expect(device.config!.vatPayer, isTrue);
      expect(device.config!.branchAddress, '12, Samora Machel Ave, Harare, Harare');
      expect(device.config!.taxes.map((t) => t.id), [1, 2, 517]);
      expect(device.globalNo, 41);
      expect(device.lastClosedDayNo, 6);
      expect(store.secrets.keys, containsAll(['fiscal_key', 'fiscal_cert']));
      expect(store.secrets['fiscal_key'], startsWith('-----BEGIN EC PRIVATE KEY-----'));
      expect(store.values['fiscal'], isNot(contains('PRIVATE KEY')), reason: 'the key only goes to secure storage');

      final again = newDevice();
      await again.load();
      expect(again.registered, isTrue);
      expect(again.deviceId, 321);
      expect(again.config!.qrUrl, 'https://fdmstest.zimra.co.zw');
    });

    test('says plainly what ZIMRA refused, and keeps nothing', () async {
      await expectLater(
        device.register(environment: FdmsEnvironment.test, deviceId: 321, activationKey: 'WRONG123', serialNo: 'FLT-0001'),
        throwsA(isA<FdmsException>().having((e) => e.message, 'message', 'The activation key is wrong.').having((e) => e.code, 'code', 'DEV02')),
      );
      await expectLater(
        device.register(environment: FdmsEnvironment.test, deviceId: 321, activationKey: 'abc12345', serialNo: 'OTHER'),
        throwsA(isA<FdmsException>().having((e) => e.code, 'code', 'DEV03')),
      );
      expect(device.registered, isFalse);
      expect(store.secrets, isEmpty);
      expect(store.values, isEmpty);
    });
  });

  group('selling', () {
    setUp(register);

    test('signs receipts offline, prints the QR code, and sends them in order once online', () async {
      zimra.offline = true;
      final first = await sell('sale-1');
      now = now.add(const Duration(minutes: 3));
      final second = await sell('sale-2', items: [bread(2000), FiscalItem(name: 'Maize meal', quantity: 1000, unitPrice: 900, total: 900, tax: exempt, hsCode: '11022000')]);
      expect(first.receipt.globalNo, 42);
      expect(first.receipt.counter, 1);
      expect(first.dayNo, 7);
      expect(first.receipt.invoiceNo, '321-42');
      expect(second.receipt.globalNo, 43);
      expect(second.receipt.counter, 2);
      expect(first.qrCode, matches(RegExp(r'^https://fdmstest\.zimra\.co\.zw/0000000321121120260000000042[0-9A-F]{16}$')));
      expect(first.verificationCode, matches(RegExp(r'^[0-9A-F]{4}(-[0-9A-F]{4}){3}$')));
      expect(first.forFloatly(), containsPair('date', '2026-11-12T08:00:01'));

      await device.send();
      expect(device.online, isFalse);
      expect(device.unsent, 2);
      expect(device.day!.openSent, isFalse);

      zimra.offline = false;
      await device.send();
      expect(zimra.calls.where((c) => c != 'GetConfig' && c != 'GetStatus'), ['RegisterDevice', 'OpenDay', 'SubmitReceipt', 'SubmitReceipt']);
      expect(zimra.errorsFor, {'321-42': isEmpty, '321-43': isEmpty}, reason: 'chain, signatures and totals all check out');
      expect(device.unsent, 0);
      expect(device.online, isTrue);

      final report = device.reportBody(device.unreported);
      expect(report, [
        {'clientId': 'sale-1', 'status': 'submitted', 'receiptId': 9001, 'serverDate': '2026-11-12T08:00:03'},
        {'clientId': 'sale-2', 'status': 'submitted', 'receiptId': 9002, 'serverDate': '2026-11-12T08:03:02'},
      ]);
      await device.markReported(['sale-1', 'sale-2']);
      expect(device.queue, isEmpty);
    });

    test('keeps the day, numbers and chain across a restart', () async {
      await sell('a');
      device = newDevice();
      await device.load();
      now = now.add(const Duration(seconds: 30));
      final next = await sell('b');
      expect(next.receipt.counter, 2);
      await device.send();
      expect(zimra.errorsFor.values.every((e) => e.isEmpty), isTrue);
    });

    test("won't issue what ZIMRA would reject", () async {
      expect(
        () => sell('x', items: [const FiscalItem(name: 'Soap', quantity: 1000, unitPrice: 100, total: 100, tax: FdmsTax(id: 517, percent: 1550, name: ''))]),
        throwsA(isA<FiscalBlocked>().having((e) => e.message, 'message', contains('“Soap” needs an HS code'))),
      );
      expect(
        () => sell('x', items: [FiscalItem(name: 'Rice', quantity: 1000, unitPrice: 100, total: 100, tax: exempt, hsCode: '1006')]),
        throwsA(isA<FiscalBlocked>().having((e) => e.message, 'message', contains('8 digits'))),
      );
      TaxRate rate(String pct) => TaxRate.fromJson({'id': 'r', 'name': 'VAT', 'rate': pct});
      expect(device.taxFor(rate('15.50')).id, 517);
      expect(() => device.taxFor(rate('14.00')), throwsA(isA<FiscalBlocked>().having((e) => e.message, 'message', contains('VAT (14.00%)'))));
      expect(device.queue, isEmpty);
      expect(device.globalNo, 41, reason: 'nothing was numbered');
    });

    test("stops selling at ZIMRA's day limit and warns before it", () async {
      await sell('a');
      expect(device.dayWarning, isNull);
      now = now.add(const Duration(hours: 22, minutes: 30));
      expect(device.dayWarning, 'Close the fiscal day (Z report) within 1 hour: ZIMRA allows 24 hours.');
      now = now.add(const Duration(hours: 2));
      expect(device.dayWarning, contains('reached ZIMRA’s 24-hour limit'));
      expect(() => sell('b'), throwsA(isA<FiscalBlocked>()));
    });

    test('holds the queue at a receipt ZIMRA refuses, until a manager tries again', () async {
      zimra.failNext['SubmitReceipt'] = (422, {'title': 'Receipt structure invalid', 'errorCode': 'RCPT02'});
      await sell('a');
      now = now.add(const Duration(seconds: 5));
      await sell('b');
      await device.send();
      expect(device.queue.first.refusal, 'Receipt structure invalid');
      expect(device.queue.first.status, 'failed');
      expect(device.queue.last.accepted, isFalse, reason: "the next one waits: ZIMRA wants them in order");
      expect(device.lastError, contains('ZIMRA refused receipt 321-42'));
      expect(device.reportBody(device.unreported).single, {
        'clientId': 'a',
        'status': 'failed',
        'errors': [
          {'code': 'REFUSED', 'color': 'Red', 'description': 'Receipt structure invalid'},
        ],
      });

      await device.retry(device.queue.first);
      expect(device.unsent, 0);
      expect(zimra.errorsFor.values.every((e) => e.isEmpty), isTrue);
    });
  });

  group('closing the day', () {
    setUp(register);

    test('sends the totals and signature, then starts the next day afresh', () async {
      await sell('a', items: [bread(3000)]);
      now = now.add(const Duration(minutes: 10));
      await device.issue(
        clientId: 'refund-a',
        type: FdmsReceiptType.creditNote,
        currency: 'USD',
        items: [bread()],
        payments: const [FiscalPay(MoneyType.cash, 155)],
        notes: 'Stale',
        noteRef: const FdmsNoteRef(deviceId: 321, globalNo: 42, fiscalDayNo: 7),
      );
      now = now.add(const Duration(hours: 9));
      await device.closeDay();
      expect(zimra.dayStatus, 'FiscalDayClosed', reason: 'ZIMRA agreed with the totals and the signature');
      expect(device.day, isNull);
      expect(device.lastClosedDayNo, 7);
      final z = device.lastZ!;
      expect(z.receipts, 2);
      expect(z.documents, {
        'FiscalInvoice|USD': [1, 465],
        'CreditNote|USD': [1, -155],
      });
      expect({for (final c in z.counters) '${c.type.wire} ${c.moneyType?.wire ?? c.taxId}': c.value}, {
        'SaleByTax 517': 465,
        'SaleTaxByTax 517': 62,
        'CreditNoteByTax 517': -155,
        'CreditNoteTaxByTax 517': -21,
        'BalanceByMoneyType Cash': 310,
      });

      now = now.add(const Duration(hours: 10));
      final next = await sell('b');
      expect(next.dayNo, 8);
      expect(next.receipt.counter, 1);
      await device.send();
      expect(zimra.lastDayNo, 8);
      expect(zimra.errorsFor['321-44'], isEmpty, reason: 'the first receipt of a day signs without a previous hash');
    });

    test("won't close with receipts still to send", () async {
      await sell('a');
      zimra.offline = true;
      await expectLater(device.closeDay(), throwsA(isA<FiscalBlocked>().having((e) => e.message, 'message', contains("1 receipt hasn't reached ZIMRA yet: connect to the internet"))));
      expect(device.day!.state, DayState.open);
    });

    test("says why when ZIMRA won't close it", () async {
      await sell('a');
      await device.send();
      // Make ZIMRA's own record differ from the till's.
      zimra.receipts.clear();
      await expectLater(device.closeDay(), throwsA(isA<FiscalBlocked>().having((e) => e.message, 'message', contains('don’t match'))));
      expect(device.day!.state, DayState.closeFailed);
      expect(device.statusForFloatly()['state'], containsPair('dayStatus', 'FiscalDayCloseFailed'));
    });
  });

  test('a credit note for a refund approved on a phone goes to Floatly whole', () async {
    await register();
    await device.issue(
      clientId: 'local-1',
      saleId: 'sale-uuid',
      attach: true,
      type: FdmsReceiptType.creditNote,
      currency: 'USD',
      items: [bread()],
      payments: const [FiscalPay(MoneyType.cash, 155)],
      notes: 'Approved on phone',
      noteRef: const FdmsNoteRef(deviceId: 321, globalNo: 40, fiscalDayNo: 6),
    );
    final body = device.reportBody(device.unreported).single;
    expect(body['saleId'], 'sale-uuid');
    expect(body['status'], 'pending');
    expect(body['receipt'], containsPair('receiptType', 'CreditNote'));
    expect(body['receipt'], containsPair('invoiceNo', '321-42'));
    expect(device.statusForFloatly(), {
      'fiscalDeviceId': 321,
      'serialNo': 'FLT-0001',
      'state': containsPair('unsent', 1),
    });
  });
}
