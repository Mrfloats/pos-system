import 'dart:convert';

import 'package:floatly_till/models/receipt.dart';
import 'package:floatly_till/models/sale.dart';
import 'package:floatly_till/printing/escpos.dart';
import 'package:flutter_test/flutter_test.dart';

Receipt _receipt() => Receipt(
  clientId: 'c1',
  reference: 'T01-000007',
  soldAt: DateTime(2026, 10, 27, 9, 5),
  businessName: 'Sales Shop',
  storeName: 'Main Store',
  cashier: 'Rudo Cashier',
  currencyCode: 'USD',
  symbol: r'$',
  lines: [
    ReceiptLine(name: 'Burger', quantity: 2000, unitPrice: 800, discount: 0, total: 1600, choices: ['Salad', 'Cheese']),
    ReceiptLine(name: 'Water 500ml · Case of 24', quantity: 1000, unitPrice: 1000, discount: 0, total: 1000),
  ],
  subtotal: 2600,
  discountTotal: 0,
  taxTotal: 352,
  taxIncluded: true,
  total: 2600,
  payments: [ReceiptPayment(method: PayMethod.cash, currencyCode: 'USD', symbol: r'$', amount: 3000, change: 400)],
  number: 'S-00042',
);

bool _contains(List<int> haystack, List<int> needle) {
  for (var i = 0; i + needle.length <= haystack.length; i++) {
    var all = true;
    for (var j = 0; j < needle.length && all; j++) {
      all = haystack[i + j] == needle[j];
    }
    if (all) return true;
  }
  return false;
}

void main() {
  test('turns text into plain ASCII any printer can print', () {
    expect(ascii('Café · 2 × 3 – "ok"'), 'Cafe - 2 x 3 - "ok"');
    expect(ascii('€5'), 'EUR5');
    expect(ascii('汉'), '?');
  });

  test('wraps long text at spaces, and breaks words longer than a line', () {
    expect(wrap('Large T-shirt in navy blue', 10), ['Large', 'T-shirt in', 'navy blue']);
    expect(wrap('ABCDEFGHIJKL', 5), ['ABCDE', 'FGHIJ', 'KL']);
  });

  test('lines up amounts on the right, moving them down when the name is long', () {
    final p = EscPos(width: 20)..row('Coke', r'$1.00');
    final text = latin1.decode(p.bytes.sublist(2));
    expect(text, 'Coke           \$1.00\n');
    final long = EscPos(width: 20)..row('A really long product name', r'$12.00');
    expect(latin1.decode(long.bytes.sublist(2)), 'A really long\nproduct name  \$12.00\n');
  });

  test('prints the whole receipt: header, items with choices, total, change, and cuts the paper', () {
    final bytes = receiptEscPos(_receipt(), paperWidth: 58);
    final text = latin1.decode(bytes);
    expect(bytes.sublist(0, 2), [0x1B, 0x40]);
    for (final s in [
      'Sales Shop',
      'Sale S-00042',
      'Till ref',
      'T01-000007',
      'Burger',
      '2 x \$8.00',
      'Salad, Cheese',
      'Water 500ml - Case of 24',
      'TOTAL',
      'Change',
      'Thank you!',
    ]) {
      expect(text, contains(s));
    }
    // Every line fits on 58 mm paper (32 characters), except double-size text, which takes 16.
    for (final line in text.split('\n')) {
      expect(line.replaceAll(RegExp(r'[\x00-\x1f]'), '').length, lessThanOrEqualTo(32 + 4));
    }
    expect(_contains(bytes, const [0x1D, 0x56, 0x42, 0x00]), isTrue, reason: 'cut');
    expect(_contains(bytes, const [0x1B, 0x70, 0x00]), isFalse, reason: 'no drawer unless asked');
    expect(_contains(receiptEscPos(_receipt(), paperWidth: 80, openDrawer: true), const [0x1B, 0x70, 0x00, 0x19, 0xFA]), isTrue);
  });
}
