// Runs the till against a real Floatly API loaded with the demo data (npm run db:seed):
//
//   FLOATLY_LIVE_API=http://localhost:4000 flutter test test/live_api_test.dart
//
// It pairs a new till, signs the demo cashier in by PIN, downloads the catalog,
// opens a shift, sells, uploads, refunds and closes the shift. Skipped without
// FLOATLY_LIVE_API. It adds a till and a few sales to that database.
import 'dart:io';
import 'dart:math';

import 'package:floatly_till/core/api.dart';
import 'package:floatly_till/core/local_store.dart';
import 'package:floatly_till/core/money.dart';
import 'package:floatly_till/models/sale.dart';
import 'package:floatly_till/state/till_state.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final server = Platform.environment['FLOATLY_LIVE_API'];

  test(
    'pairs, signs in by PIN, sells, uploads, refunds and cashes up against the real API',
    () async {
      // The owner pairs the till, as the setup screen does.
      final login = await Api(server: server!).post('/auth/login', {'email': 'demo@pos.local', 'password': 'demo1234'}) as Map;
      final shop = (login['businesses'] as List).cast<Map>().firstWhere((b) => b['businessType'] != 'restaurant');
      final switched = await Api(server: server, token: login['accessToken'] as String).post('/auth/switch-tenant', {'tenantId': shop['tenantId']}) as Map;
      final owner = Api(server: server, token: switched['accessToken'] as String);
      final store = (await owner.get('/stores') as List).cast<Map>().firstWhere((s) => s['code'] == 'MAIN');
      final code = 'L${Random().nextInt(99999)}';
      final device = await owner.post('/devices', {'storeId': store['id'], 'name': 'Live test $code', 'code': code}) as Map;
      final token = (await owner.post('/devices/${device['id']}/token') as Map)['token'] as String;

      final state = TillState(MemoryStore());
      await state.init();
      await state.pair(
        DeviceConfig(
          server: server,
          deviceId: device['id'] as String,
          deviceCode: code,
          deviceName: device['name'] as String,
          storeId: store['id'] as String,
          storeName: store['name'] as String,
          businessName: shop['name'] as String,
        ),
        token,
      );

      expect(await state.signIn('0000'), 'Wrong PIN');
      expect(await state.signIn('1234'), isNull);
      expect(state.session!.role, 'cashier');
      await state.refreshCatalog();
      await state.loadShift();
      final catalog = state.catalog!;
      expect(catalog.products, isNotEmpty);
      expect(catalog.store.id, store['id']);

      if (state.shift == null) await state.openShift({catalog.baseCurrency.code: '10.00'});
      expect(state.shift, isNotNull);

      // Two of something that costs money, one of something else, paid in cash with change.
      final priced = catalog.products.where((p) => !p.partQuantities && p.variants.first.price > 0).toList();
      state.addItem(priced[0], priced[0].variants.first);
      state.addItem(priced[0], priced[0].variants.first);
      state.addItem(priced[1], priced[1].variants.first);
      final cart = state.priced;
      final handed = ((cart.total ~/ 1000) + 1) * 1000;
      final receipt = await state.completeSale([Payment(method: PayMethod.cash, currency: cart.currency, amount: handed)]);
      expect(receipt.number, startsWith('S-'), reason: 'the sale uploaded straight away');
      expect(state.outbox, isEmpty);

      // Floatly recorded exactly what the till worked out.
      final sale = await owner.get('/sales/${receipt.saleId}') as Map;
      expect(toCents(sale['total']), cart.total);
      expect(toCents(sale['taxTotal']), cart.taxTotal);
      expect(sale['deviceId'], device['id']);
      expect(sale['shiftId'], state.shift!.id);
      expect(toCents((sale['payments'] as List).first['change']), handed - cart.total);
      expect(receipt.change, handed - cart.total);

      // Sending the same sale again (a retry after a dropped connection) doesn't record it twice.
      final again = await Api(server: server, token: state.session!.token).post('/sales', {
        'storeId': store['id'],
        'clientId': receipt.clientId,
        'lines': [
          {'variantId': priced[0].variants.first.id, 'quantity': '1'},
        ],
        'payments': [
          {'method': 'cash', 'amount': '1000'},
        ],
      }) as Map;
      expect(again['id'], receipt.saleId);

      // A cashier can't refund; the manager can.
      await expectLater(state.refund(receipt.saleId!, {}), throwsA(isA<ApiException>().having((e) => e.status, 'status', 403)));
      state.lock();
      expect(await state.signIn('5678'), isNull);
      final line = (sale['lines'] as List).cast<Map>().first;
      final refund = await state.refund(receipt.saleId!, {
        'lines': [
          {'lineId': line['id'], 'quantity': '1'},
        ],
        'method': 'cash',
        'reason': 'Live test',
      });
      expect(refund['number'], startsWith('R-'));

      // Back to the cashier to close the shift.
      state.lock();
      expect(await state.signIn('1234'), isNull);
      await state.loadShift();
      final closed = await state.closeShift({catalog.baseCurrency.code: '0'}, 'Live test');
      expect(closed['closedAt'], isNotNull);
      expect(closed['salesCount'], greaterThanOrEqualTo(1));
      expect(state.shift, isNull);

      // A wholesale case: Floatly records it as a case and charges what the till worked out.
      final cased = catalog.products.firstWhere((p) => p.variants.any((v) => v.packs.isNotEmpty));
      final variant = cased.variants.firstWhere((v) => v.packs.isNotEmpty);
      state.addItem(cased, variant, pack: variant.packs.first);
      final caseCart = state.priced;
      final caseReceipt = await state.completeSale([Payment(method: PayMethod.card, currency: caseCart.currency, amount: caseCart.total)]);
      expect(caseReceipt.number, startsWith('S-'));
      final caseSale = await owner.get('/sales/${caseReceipt.saleId}') as Map;
      expect(toCents(caseSale['total']), caseCart.total);
      expect((caseSale['lines'] as List).first, containsPair('packName', variant.packs.first.name));

      // Wholesale prices: Floatly records the sale on the Wholesale list at the till's prices.
      final wholesale = catalog.priceLists.firstWhere((l) => !l.isDefault);
      final listed = catalog.products.firstWhere((p) => p.variants.first.listPrices.any((l) => l.priceListId == wholesale.id));
      state.setPriceList(wholesale.id);
      state.addItem(listed, listed.variants.first, quantity: 3000);
      final wholesaleCart = state.priced;
      expect(wholesaleCart.lines.single.unitPrice, lessThan(listed.variants.first.price));
      final wholesaleReceipt = await state.completeSale([Payment(method: PayMethod.cash, currency: wholesaleCart.currency, amount: wholesaleCart.total)]);
      final wholesaleSale = await owner.get('/sales/${wholesaleReceipt.saleId}') as Map;
      expect(toCents(wholesaleSale['total']), wholesaleCart.total);
      expect(wholesaleSale['priceListId'], wholesale.id);
      expect(wholesaleReceipt.priceListName, wholesale.name);

      // Switched off in the backoffice while signed in: the till stops at its next call to Floatly.
      await owner.patch('/devices/${device['id']}', {'active': false});
      await expectLater(state.refreshCatalog(), throwsA(isA<ApiException>()));
      expect(state.session, isNull);
      expect(state.revoked, contains('switched off'));
      expect(await state.signIn('1234'), contains('switched off'));
      state.dispose();
    },
    skip: server == null ? 'Set FLOATLY_LIVE_API to run against a real API' : false,
    timeout: const Timeout(Duration(minutes: 3)),
  );
}
