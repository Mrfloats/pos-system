/// Exact money maths, the same as the API's (apps/api/src/accounting/money.ts),
/// so a basket priced on the till comes to exactly what the API records.
///
/// Amounts are whole cents, quantities whole thousandths and exchange rates
/// whole millionths. Nothing is ever a floating-point number.
library;

final _decimal = RegExp(r'^(-?)(\d+)(?:\.(\d+))?$');

int _pow10(int n) {
  var v = 1;
  for (var i = 0; i < n; i++) {
    v *= 10;
  }
  return v;
}

/// Parses a decimal into an integer scaled by 10^places ("1.5", 3 → 1500).
/// Digits past [places] are dropped. Returns 0 for null or empty input.
int parseFixed(Object? value, int places) {
  if (value == null) return 0;
  final s = value.toString().trim();
  if (s.isEmpty) return 0;
  final m = _decimal.firstMatch(s);
  if (m == null) throw FormatException('Not a number: $s');
  final whole = int.parse(m.group(2)!);
  final frac = (m.group(3) ?? '').padRight(places, '0').substring(0, places);
  final v = whole * _pow10(places) + (places == 0 ? 0 : int.parse(frac));
  return m.group(1)!.isEmpty ? v : -v;
}

/// Like [parseFixed], but returns null instead of throwing (for text people type).
int? tryParseFixed(String text, int places) {
  final s = text.trim().replaceAll(',', '');
  if (s.isEmpty || !_decimal.hasMatch(s)) return null;
  return parseFixed(s, places);
}

String formatFixed(int v, int places) {
  final neg = v < 0;
  final abs = v.abs();
  final scale = _pow10(places);
  final frac = places == 0 ? '' : '.${(abs % scale).toString().padLeft(places, '0')}';
  return '${neg ? '-' : ''}${abs ~/ scale}$frac';
}

int toCents(Object? v) => parseFixed(v, 2);
String fromCents(int cents) => formatFixed(cents, 2);

/// a ÷ b, rounded half away from zero.
int divRound(int a, int b) {
  if (b == 0) throw ArgumentError('Division by zero');
  final neg = (a < 0) != (b < 0);
  final x = a.abs();
  final y = b.abs();
  final q = (2 * x + y) ~/ (2 * y);
  return neg ? -q : q;
}

/// Currency cents → base-currency cents. [rate] is units of the currency per 1 base unit.
int toBase(int cents, String rate) => divRound(cents * 1000000, parseFixed(rate, 6));

/// Base-currency cents → currency cents.
int fromBase(int cents, String rate) => divRound(cents * parseFixed(rate, 6), 1000000);

/// 1234567 cents → "12,345.67".
String formatAmount(int cents) {
  final s = fromCents(cents.abs());
  final dot = s.indexOf('.');
  final whole = s.substring(0, dot);
  final grouped = StringBuffer();
  for (var i = 0; i < whole.length; i++) {
    if (i > 0 && (whole.length - i) % 3 == 0) grouped.write(',');
    grouped.write(whole[i]);
  }
  return '${cents < 0 ? '-' : ''}$grouped${s.substring(dot)}';
}

/// Amount with the currency's symbol, e.g. "$12.50" or "ZiG 331.25".
String formatMoney(int cents, String symbol) {
  final amount = formatAmount(cents);
  if (symbol.isEmpty) return amount;
  // Letter symbols read better with a space ("ZiG 10.00"); sign symbols don't ("$10.00").
  final spaced = RegExp(r'[A-Za-z]$').hasMatch(symbol);
  final sign = amount.startsWith('-') ? '-' : '';
  return '$sign$symbol${spaced ? ' ' : ''}${sign.isEmpty ? amount : amount.substring(1)}';
}

/// Thousandths → the shortest way to write it: 2000 → "2", 1500 → "1.5", 250 → "0.25".
String formatQty(int thousandths) {
  var s = formatFixed(thousandths, 3);
  s = s.replaceFirst(RegExp(r'0+$'), '');
  return s.endsWith('.') ? s.substring(0, s.length - 1) : s;
}
