import 'dart:typed_data';

import '../core/money.dart';
import '../models/receipt.dart';

/// Characters per line in the printer's normal font.
int lineWidth(int paperWidth) => paperWidth == 58 ? 32 : 48;

enum Align { left, center, right }

/// Builds ESC/POS commands, which nearly every receipt printer understands
/// (Epson, Xprinter, Sunmi, iMin, Star in ESC/POS mode…).
///
/// Text is sent as plain ASCII so it prints the same on every printer, whatever
/// code page it is set to; accented letters lose their accents.
class EscPos {
  EscPos({required this.width}) {
    _out.add(const [0x1B, 0x40]); // ESC @: reset
  }

  /// Characters per line in the normal font.
  final int width;
  final _out = BytesBuilder(copy: false);
  bool _big = false;

  int get _cols => _big ? width ~/ 2 : width;

  void align(Align a) => _out.add([0x1B, 0x61, a.index]);
  void bold(bool on) => _out.add([0x1B, 0x45, on ? 1 : 0]);

  /// Double width and height, for the total.
  void big(bool on) {
    _big = on;
    _out.add([0x1D, 0x21, on ? 0x11 : 0x00]);
  }

  /// One or more lines, wrapped at word boundaries.
  void text(String s) {
    for (final line in wrap(ascii(s), _cols)) {
      _out.add(line.codeUnits);
      _out.addByte(0x0A);
    }
  }

  /// Text on the left, an amount on the right; the left side wraps when it is long.
  void row(String left, String right) {
    final r = ascii(right);
    final lines = wrap(ascii(left), _cols);
    final last = lines.removeLast();
    for (final l in lines) {
      text(l);
    }
    if (last.length + 1 + r.length <= _cols) {
      _out.add('$last${' ' * (_cols - last.length - r.length)}$r'.codeUnits);
      _out.addByte(0x0A);
    } else {
      text(last);
      _out.add('${' ' * (_cols - r.length).clamp(0, _cols)}$r'.codeUnits);
      _out.addByte(0x0A);
    }
  }

  void rule() => text('-' * _cols);
  void feed(int lines) => _out.add([0x1B, 0x64, lines]);

  /// Feeds the paper past the cutter and cuts (printers without a cutter ignore it).
  void cut() {
    feed(4);
    _out.add(const [0x1D, 0x56, 0x42, 0x00]);
  }

  /// Opens the cash drawer plugged into the printer.
  void openDrawer() => _out.add(const [0x1B, 0x70, 0x00, 0x19, 0xFA]);

  Uint8List get bytes => _out.toBytes();
}

const _replacements = {
  '×': 'x',
  '·': '-',
  '–': '-',
  '—': '-',
  '−': '-',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '…': '...',
  '€': 'EUR',
  '£': 'GBP',
  '₦': 'NGN',
  '₹': 'INR',
  'ß': 'ss',
  'Æ': 'AE',
  'æ': 'ae',
  'Ø': 'O',
  'ø': 'o',
};
const _accented = 'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖòóôõöÙÚÛÜùúûüÝýÿ';
const _plain = 'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOoooooUUUUuuuuYyy';

/// Plain printable ASCII: accents dropped, symbols spelled out, anything else "?".
String ascii(String s) {
  final out = StringBuffer();
  for (final code in s.runes) {
    final ch = String.fromCharCode(code);
    if (code >= 0x20 && code < 0x7F) {
      out.write(ch);
    } else if (_replacements.containsKey(ch)) {
      out.write(_replacements[ch]);
    } else if (_accented.contains(ch)) {
      out.write(_plain[_accented.indexOf(ch)]);
    } else if (ch == '\n' || ch == '\t') {
      out.write(' ');
    } else {
      out.write('?');
    }
  }
  return out.toString();
}

/// Splits text into lines of at most [width], breaking at spaces where it can.
List<String> wrap(String s, int width) {
  final lines = <String>[];
  var current = '';
  for (var word in s.split(' ')) {
    while (word.length > width) {
      if (current.isNotEmpty) {
        lines.add(current);
        current = '';
      }
      lines.add(word.substring(0, width));
      word = word.substring(width);
    }
    if (current.isEmpty) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current = '$current $word';
    } else {
      lines.add(current);
      current = word;
    }
  }
  lines.add(current);
  return lines;
}

String _two(int n) => n.toString().padLeft(2, '0');

/// A sale's receipt as ESC/POS: the same content as the printed PDF.
Uint8List receiptEscPos(Receipt r, {required int paperWidth, bool openDrawer = false}) {
  final p = EscPos(width: lineWidth(paperWidth));
  String m(int cents) => formatMoney(cents, r.symbol);
  if (openDrawer) p.openDrawer();

  p.align(Align.center);
  p.bold(true);
  p.big(true);
  p.text(r.businessName);
  p.big(false);
  p.bold(false);
  p.text(r.storeName);
  for (final line in [r.address, if (r.phone != null) 'Tel ${r.phone}', if (r.tin != null) 'TIN ${r.tin}', if (r.vatNumber != null) 'VAT No ${r.vatNumber}']) {
    if (line != null) p.text(line);
  }
  p.align(Align.left);
  p.rule();
  final d = r.soldAt;
  p.bold(true);
  p.row(r.number != null ? 'Sale ${r.number}' : 'Receipt ${r.reference}', '${d.year}-${_two(d.month)}-${_two(d.day)} ${_two(d.hour)}:${_two(d.minute)}');
  p.bold(false);
  if (r.number != null) p.row('Till ref', r.reference);
  p.row('Cashier', r.cashier);
  if (r.customerName != null) p.row('Customer', r.customerName!);
  if (r.customerTin != null) p.row('Customer TIN', r.customerTin!);
  if (r.customerVat != null) p.row('Customer VAT No', r.customerVat!);
  p.rule();
  for (final l in r.lines) {
    p.row(l.name, m(l.total));
    p.text('  ${formatQty(l.quantity)} x ${m(l.unitPrice)}${l.discount > 0 ? '  less ${m(l.discount)}' : ''}');
    if (l.choices.isNotEmpty) p.text('  ${l.choices.join(', ')}');
    if (l.note != null) p.text('  ${l.note}');
  }
  p.rule();
  if (r.discountTotal > 0) {
    p.row('Subtotal', m(r.subtotal));
    p.row('Discount', '-${m(r.discountTotal)}');
  }
  p.bold(true);
  p.big(true);
  p.row('TOTAL', m(r.total));
  p.big(false);
  p.bold(false);
  if (r.taxTotal > 0) p.row(r.taxIncluded ? 'VAT included' : 'VAT', m(r.taxTotal));
  p.rule();
  for (final pay in r.payments) {
    p.row(pay.method.label, formatMoney(pay.amount, pay.symbol));
    if (pay.change > 0) {
      p.bold(true);
      p.row('Change', formatMoney(pay.change, pay.symbol));
      p.bold(false);
    }
  }
  p.rule();
  p.align(Align.center);
  if (r.number == null) p.text('Recorded offline. It uploads to Floatly automatically.');
  p.bold(true);
  p.text('Thank you!');
  p.bold(false);
  p.cut();
  return p.bytes;
}

/// A short page to check the printer, paper width and cutter.
Uint8List testPageEscPos({required int paperWidth, required String tillName}) {
  final p = EscPos(width: lineWidth(paperWidth));
  p.align(Align.center);
  p.bold(true);
  p.big(true);
  p.text('Floatly Till');
  p.big(false);
  p.bold(false);
  p.text('Printer test');
  p.text(tillName);
  p.align(Align.left);
  p.rule();
  p.row('Paper', '$paperWidth mm, ${lineWidth(paperWidth)} characters');
  p.row('Left', 'Right');
  p.text('The dashes below should fill one line:');
  p.rule();
  p.align(Align.center);
  p.text('If this prints, receipts will too.');
  p.cut();
  return p.bytes;
}

/// Just the drawer kick.
Uint8List drawerKick() => (EscPos(width: 32)..openDrawer()).bytes;
