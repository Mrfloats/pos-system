// Runs the till's ZIMRA code against ZIMRA's real test server.
//
// Just the connection (a made-up device, which ZIMRA should say it doesn't know):
//   FLOATLY_ZIMRA_LIVE=1 flutter test test/zimra_live_test.dart
//
// The whole round (register, sell, refund, close the day) with a test device from ZIMRA:
//   ZIMRA_DEVICE_ID=12345 ZIMRA_ACTIVATION_KEY=ABCD1234 ZIMRA_SERIAL=SN-0001 \
//   [ZIMRA_MODEL=Server ZIMRA_MODEL_VERSION=v1] flutter test test/zimra_live_test.dart
//
// The round registers that device again and opens and closes a fiscal day on
// ZIMRA's test server. Never point it at a live device.
import 'dart:io';

import 'package:floatly_till/core/local_store.dart';
import 'package:floatly_till/fiscal/fdms.dart';
import 'package:floatly_till/fiscal/fdms_client.dart';
import 'package:floatly_till/fiscal/fiscal_device.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final env = Platform.environment;
  final deviceId = int.tryParse(env['ZIMRA_DEVICE_ID'] ?? '');
  final probe = env['FLOATLY_ZIMRA_LIVE'] != null || deviceId != null;

  test('reaches ZIMRA’s test server and understands its answers', () async {
    final client = FdmsClient(
      environment: FdmsEnvironment.test,
      deviceId: 999999999,
      modelName: FiscalDevice.defaultModelName,
      modelVersion: FiscalDevice.defaultModelVersion,
      transport: FdmsTransport.platformDefault(),
    );
    final error = await client.verifyTaxpayer(activationKey: 'XXXXXXXX', serialNo: 'FLOATLY-PROBE').then<FdmsException?>((_) => null, onError: (Object e) => e as FdmsException);
    expect(error, isNotNull, reason: 'a made-up device must be refused');
    expect(error!.isOffline, isFalse, reason: error.message);
    expect(error.status, inInclusiveRange(400, 499));
    // ignore: avoid_print
    print('ZIMRA answered ${error.status} ${error.code ?? ''}: ${error.message}');
  }, skip: !probe);

  test('registers a test device, sells, refunds and closes the day on ZIMRA’s test server', () async {
    final device = FiscalDevice(store: MemoryStore(), pollDelay: const Duration(seconds: 5));
    await device.register(
      environment: FdmsEnvironment.test,
      deviceId: deviceId!,
      activationKey: env['ZIMRA_ACTIVATION_KEY']!,
      serialNo: env['ZIMRA_SERIAL']!,
      modelName: env['ZIMRA_MODEL'] ?? FiscalDevice.defaultModelName,
      modelVersion: env['ZIMRA_MODEL_VERSION'] ?? FiscalDevice.defaultModelVersion,
    );
    final c = device.config!;
    // ignore: avoid_print
    print('Registered for ${c.taxpayerName} (VAT ${c.vatNumber ?? 'none'}), taxes ${c.taxes.map((t) => '${t.id}:${t.percent ?? 'exempt'}').join(', ')}');
    expect(device.lastError, isNull, reason: device.lastError);

    final tax = c.vatPayer ? (c.taxes.where((t) => (t.percent ?? 0) > 0 && t.validOn(DateTime.now())).first) : c.taxes.firstWhere((t) => t.validOn(DateTime.now()));
    final item = FiscalItem(name: 'Floatly test item', quantity: 1000, unitPrice: 100, total: 100, tax: tax, hsCode: '22021000');
    final sale = await device.issue(clientId: 'live-sale', type: FdmsReceiptType.fiscalInvoice, currency: 'USD', items: [item], payments: const [FiscalPay(MoneyType.cash, 100)]);
    await device.send();
    final sent = device.queuedFor('live-sale')!;
    expect(sent.refusal, isNull, reason: sent.refusal);
    expect(sent.accepted, isTrue, reason: device.lastError);
    expect(sent.errors, isEmpty, reason: '${sent.errors}');
    // ignore: avoid_print
    print('Receipt ${sale.receipt.invoiceNo} accepted as ZIMRA receipt ${sent.receiptId}: ${sale.qrCode}');

    await Future<void>.delayed(const Duration(seconds: 2));
    await device.issue(
      clientId: 'live-refund',
      type: FdmsReceiptType.creditNote,
      currency: 'USD',
      items: [item],
      payments: const [FiscalPay(MoneyType.cash, 100)],
      notes: 'Floatly test refund',
      noteRef: FdmsNoteRef(deviceId: deviceId, globalNo: sale.receipt.globalNo, fiscalDayNo: sale.dayNo),
    );
    await device.send();
    final refund = device.queuedFor('live-refund')!;
    expect(refund.accepted, isTrue, reason: refund.refusal ?? device.lastError);
    expect(refund.errors, isEmpty, reason: '${refund.errors}');

    await device.closeDay();
    expect(device.day, isNull, reason: 'ZIMRA accepted the day’s totals');
    // ignore: avoid_print
    print('Fiscal day ${device.lastZ!.dayNo} closed: ${device.lastZ!.counters.map((x) => '${x.type.wire} ${x.value}').join(', ')}');
  }, skip: deviceId == null, timeout: const Timeout(Duration(minutes: 3)));
}
