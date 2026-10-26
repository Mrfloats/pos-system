import 'package:floatly_till/core/money.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('parses and formats exact decimals', () {
    expect(parseFixed('1.5', 3), 1500);
    expect(parseFixed('-0.25', 2), -25);
    expect(parseFixed('26.500000', 6), 26500000);
    expect(parseFixed('', 2), 0);
    expect(formatFixed(1500, 3), '1.500');
    expect(formatFixed(-5, 2), '-0.05');
    expect(tryParseFixed('1,234.5', 2), 123450);
    expect(tryParseFixed('abc', 2), isNull);
  });

  test('rounds half away from zero, like the API', () {
    expect(divRound(5, 2), 3);
    expect(divRound(-5, 2), -3);
    expect(divRound(4, 3), 1);
    expect(divRound(310000, 11550), 27);
  });

  test('converts between a currency and the base currency', () {
    expect(fromBase(100, '26.5'), 2650);
    expect(toBase(2650, '26.500000'), 100);
  });

  test('formats money and quantities for people', () {
    expect(formatMoney(123456789, r'$'), r'$1,234,567.89');
    expect(formatMoney(2650, 'ZiG'), 'ZiG 26.50');
    expect(formatMoney(-150, r'$'), r'-$1.50');
    expect(formatQty(2000), '2');
    expect(formatQty(1500), '1.5');
    expect(formatQty(250), '0.25');
  });
}
