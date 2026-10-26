import 'package:floatly_till/models/catalog.dart';
import 'package:floatly_till/models/sale.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fixtures.dart';

// The same baskets as the API's sales tests (apps/api/test/api.e2e-spec.ts), so a
// sale priced offline on the till comes to what the API records.
void main() {
  final c = catalog();
  final coke = c.lookup('600100')!;
  final usd = c.baseCurrency;
  final zig = c.currency('ZWG');

  CartLine line(Sellable s, int quantity) => CartLine(product: s.product, variant: s.variant, quantity: quantity);

  test('finds products by barcode and SKU, and searches inside a parent category', () {
    expect(c.lookup('600100')!.product.name, 'Coke 500ml');
    expect(c.lookup('tee-l')!.variant.name, 'Large');
    expect(c.lookup('nope'), isNull);
    expect(c.search('', categoryId: 'drinks').map((p) => p.name), ['Coke 500ml']);
    expect(c.search('shirt').single.name, 'T-shirt');
  });

  test('takes VAT out of VAT-inclusive prices: 2 Cokes are 2.00 with 0.27 VAT', () {
    final cart = priceCart(lines: [line(coke, 2000)], currency: usd, taxRates: c.taxRates);
    expect(cart.total, 200);
    expect(cart.taxTotal, 27);
    expect(cart.totalBase, 200);
    expect(cart.taxIncluded, isTrue);
  });

  test('adds VAT to VAT-exclusive prices', () {
    final cart = priceCart(lines: [line(c.lookup('700001')!, 1000)], currency: usd, taxRates: c.taxRates);
    expect(cart.subtotal, 1000);
    expect(cart.taxTotal, 155);
    expect(cart.total, 1155);
    expect(cart.taxIncluded, isFalse);
  });

  test("applies the customer group's discount: 10 Cokes for Tendai are 9.00", () {
    final tendai = c.customers.firstWhere((x) => x.name == 'Tendai');
    final cart = priceCart(lines: [line(coke, 10000)], currency: usd, taxRates: c.taxRates, customer: tendai);
    expect(cart.discountTotal, 100);
    expect(cart.total, 900);
  });

  test('a price or discount typed in replaces the shelf price and the group discount', () {
    final tendai = c.customers.firstWhere((x) => x.name == 'Tendai');
    final l = line(coke, 3000)
      ..unitPrice = 90
      ..discount = 20;
    final cart = priceCart(lines: [l], currency: usd, taxRates: c.taxRates, customer: tendai);
    expect(cart.subtotal, 270);
    expect(cart.discountTotal, 20);
    expect(cart.total, 250);
  });

  test('prices part quantities: 0.75 kg of mince at 7.00 is 5.25', () {
    final cart = priceCart(lines: [line(c.lookup('MINCE')!, 750)], currency: usd, taxRates: c.taxRates);
    expect(cart.total, 525);
  });

  test('sells in ZiG and takes US dollars: 26.50 ZiG is 1.00 USD, no change', () {
    final cart = priceCart(lines: [line(coke, 1000)], currency: zig, taxRates: c.taxRates);
    expect(cart.total, 2650);
    expect(cart.totalBase, 100);
    final s = settle([Payment(method: PayMethod.cash, currency: usd, amount: 100)], cart);
    expect(s.complete, isTrue);
    expect(s.change, 0);
  });

  test('gives change from cash, refuses short payments and card overpayments', () {
    final cart = priceCart(lines: [line(coke, 2000)], currency: usd, taxRates: c.taxRates);
    final cash = settle([Payment(method: PayMethod.cash, currency: usd, amount: 500)], cart);
    expect(cash.complete, isTrue);
    expect(cash.change, 300);

    final short = settle([Payment(method: PayMethod.cash, currency: usd, amount: 100)], cart);
    expect(short.complete, isFalse);
    expect(short.remainingBase, 100);

    final card = settle([Payment(method: PayMethod.card, currency: usd, amount: 500)], cart);
    expect(card.complete, isFalse);
    expect(card.problem, 'Only cash can be more than the amount due');
  });

  test('splits a payment across card and cash in two currencies, with change in ZiG', () {
    // 12.00 plus 15.5% VAT.
    final cart = priceCart(lines: [line(c.lookup('700002')!, 1000)], currency: usd, taxRates: c.taxRates);
    expect(cart.total, 1386);
    final s = settle([
      Payment(method: PayMethod.card, currency: usd, amount: 1000),
      // ZiG 150.00 is 5.66 USD; 1.80 USD too much is ZiG 47.70 change.
      Payment(method: PayMethod.cash, currency: zig, amount: 15000),
    ], cart);
    expect(s.complete, isTrue);
    expect(s.changeCurrency!.code, 'ZWG');
    expect(s.change, 4770);
  });
}
