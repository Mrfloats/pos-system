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

  CartLine line(Sellable s, int quantity, {List<Choice> choices = const []}) =>
      CartLine(product: s.product, variant: s.variant, quantity: quantity, pack: s.pack, choices: choices);

  test('prices wholesale from the price list, with its quantity breaks, and retail otherwise', () {
    final water = c.lookup('600500')!;
    int total(int quantity, String? list) => priceCart(lines: [line(water, quantity)], currency: usd, taxRates: c.taxRates, priceListId: list).total;
    expect(total(2000, null), 100);
    expect(total(2000, 'pl-retail'), 100);
    expect(total(2000, 'pl-wholesale'), 80);
    // From 24 the cheaper break applies.
    expect(total(30000, 'pl-wholesale'), 1050);
    // No wholesale price set: the normal price.
    expect(priceCart(lines: [line(coke, 1000)], currency: usd, taxRates: c.taxRates, priceListId: 'pl-wholesale').total, 100);
    // The case has its own retail and wholesale prices.
    expect(priceCart(lines: [line(c.lookup('CASE500')!, 1000)], currency: usd, taxRates: c.taxRates).total, 1000);
    expect(priceCart(lines: [line(c.lookup('CASE500')!, 2000)], currency: usd, taxRates: c.taxRates, priceListId: 'pl-wholesale').total, 1700);
  });

  test('a case barcode sells the case at its own price', () {
    final hit = c.lookup('CASE500')!;
    expect(hit.pack!.name, 'Case of 24');
    expect(hit.pack!.units, 24000);
    final cart = priceCart(lines: [line(hit, 2000)], currency: usd, taxRates: c.taxRates);
    expect(cart.total, 2000);
    expect(cart.lines.single.line.name, 'Water 500ml · Case of 24');
    expect(cart.lines.single.line.partQuantities, isFalse);
  });

  test("adds the choices' prices to each item: a burger with salad and cheese is 8.00", () {
    final burger = c.products.firstWhere((p) => p.name == 'Burger');
    final options = {
      for (final g in burger.choiceGroups)
        for (final o in g.options) o.name: o,
    };
    final cart = priceCart(
      lines: [
        line((product: burger, variant: burger.variants.single, pack: null), 2000, choices: [options['Salad']!, options['Cheese']!]),
      ],
      currency: usd,
      taxRates: c.taxRates,
    );
    expect(cart.lines.single.unitPrice, 800);
    expect(cart.total, 1600);
  });

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
