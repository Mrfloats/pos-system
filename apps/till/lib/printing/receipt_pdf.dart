import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../core/money.dart';
import '../models/receipt.dart';
import 'fiscal_print.dart';

/// Prints on the till's receipt printer through the system print dialog
/// (Android print services, Windows and macOS printers, AirPrint).
Future<void> printReceiptPdf(Receipt r, {required int paperWidth}) => Printing.layoutPdf(
  name: 'Receipt ${r.number ?? r.reference}',
  format: _format(paperWidth),
  onLayout: (_) => receiptPdf(r, paperWidth: paperWidth),
);

/// The receipt as a PDF file, to share by WhatsApp or email.
Future<void> shareReceipt(Receipt r, {required int paperWidth}) async => Printing.sharePdf(
  bytes: await receiptPdf(r, paperWidth: paperWidth),
  filename: 'receipt-${r.number ?? r.reference}.pdf',
);

PdfPageFormat _format(int paperWidth) => paperWidth == 58 ? PdfPageFormat.roll57 : PdfPageFormat.roll80;

/// Any list of print items (a Z report…) through the print dialog.
Future<void> printItemsPdf(List<PrintItem> items, {required int paperWidth, required String title}) => Printing.layoutPdf(
  name: title,
  format: _format(paperWidth),
  onLayout: (_) => itemsPdf(items, paperWidth: paperWidth, title: title),
);

Future<Uint8List> itemsPdf(List<PrintItem> items, {required int paperWidth, required String title}) async {
  final small = paperWidth == 58;
  final base = pw.TextStyle(fontSize: small ? 7.5 : 9);
  final bold = base.copyWith(fontWeight: pw.FontWeight.bold);
  final doc = pw.Document(title: title);
  doc.addPage(
    pw.Page(
      pageFormat: _format(paperWidth)
          .copyWith(marginLeft: 3 * PdfPageFormat.mm, marginRight: 3 * PdfPageFormat.mm, marginTop: 4 * PdfPageFormat.mm, marginBottom: 6 * PdfPageFormat.mm),
      build: (_) => pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.stretch,
        children: [
          for (final i in items)
            switch (i) {
              PText() => pw.Text(_latin(i.text), textAlign: i.center ? pw.TextAlign.center : pw.TextAlign.left, style: i.bold ? bold : base),
              PRow() => pw.Row(children: [pw.Expanded(child: pw.Text(_latin(i.left), style: i.bold ? bold : base)), pw.Text(_latin(i.right), style: i.bold ? bold : base)]),
              PRule() => pw.Padding(padding: const pw.EdgeInsets.symmetric(vertical: 3), child: pw.Divider(height: 1, thickness: 0.5, borderStyle: pw.BorderStyle.dashed)),
              PQr() => pw.Center(child: pw.BarcodeWidget(barcode: pw.Barcode.qrCode(), data: i.data, width: 30 * PdfPageFormat.mm, height: 30 * PdfPageFormat.mm)),
            },
        ],
      ),
    ),
  );
  return doc.save();
}

/// The built-in PDF fonts only cover Western European letters; anything else becomes "?".
String _latin(String s) => String.fromCharCodes(s.runes.map((c) => c <= 0xFF || c == 0x20AC ? c : 0x3F));

/// Symbols the PDF fonts can't draw (₦, ₹…) are swapped for the currency code.
String _money(int cents, String symbol, String code) => formatMoney(cents, _latin(symbol) == symbol ? symbol : code);

String _two(int n) => n.toString().padLeft(2, '0');
String _when(DateTime d) => '${d.year}-${_two(d.month)}-${_two(d.day)} ${_two(d.hour)}:${_two(d.minute)}';

Future<Uint8List> receiptPdf(Receipt r, {required int paperWidth}) async {
  final small = paperWidth == 58;
  final base = pw.TextStyle(fontSize: small ? 7.5 : 9);
  final bold = base.copyWith(fontWeight: pw.FontWeight.bold);
  String m(int cents) => _money(cents, r.symbol, r.currencyCode);

  pw.Widget row(String left, String right, {pw.TextStyle? style}) => pw.Row(
    children: [
      pw.Expanded(child: pw.Text(_latin(left), style: style ?? base)),
      pw.Text(_latin(right), style: style ?? base),
    ],
  );
  pw.Widget rule() => pw.Padding(
    padding: const pw.EdgeInsets.symmetric(vertical: 3),
    child: pw.Divider(height: 1, thickness: 0.5, borderStyle: pw.BorderStyle.dashed),
  );

  final f = r.fiscal;
  List<pw.Widget> items(List<PrintItem> list) => [
    for (final i in list)
      switch (i) {
        PText() => pw.Text(_latin(i.text), textAlign: i.center ? pw.TextAlign.center : pw.TextAlign.left, style: i.bold ? bold : base),
        PRow() => row(i.left, i.right, style: i.bold ? bold : null),
        PRule() => rule(),
        PQr() => pw.Padding(
          padding: const pw.EdgeInsets.symmetric(vertical: 4),
          child: pw.Center(
            child: pw.BarcodeWidget(barcode: pw.Barcode.qrCode(), data: i.data, width: (small ? 26 : 32) * PdfPageFormat.mm, height: (small ? 26 : 32) * PdfPageFormat.mm),
          ),
        ),
      },
  ];

  final doc = pw.Document(title: 'Receipt ${r.number ?? r.reference}');
  doc.addPage(
    pw.Page(
      pageFormat: _format(paperWidth)
          .copyWith(marginLeft: 3 * PdfPageFormat.mm, marginRight: 3 * PdfPageFormat.mm, marginTop: 4 * PdfPageFormat.mm, marginBottom: 6 * PdfPageFormat.mm),
      build: (_) => pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.stretch,
        children: [
          pw.Text(
            _latin(r.businessName),
            textAlign: pw.TextAlign.center,
            style: bold.copyWith(fontSize: small ? 10 : 12),
          ),
          if (f != null)
            ...items(fiscalTop(f))
          else ...[
            pw.Text(_latin(r.storeName), textAlign: pw.TextAlign.center, style: base),
            if (r.address != null) pw.Text(_latin(r.address!), textAlign: pw.TextAlign.center, style: base),
            if (r.phone != null) pw.Text('Tel ${_latin(r.phone!)}', textAlign: pw.TextAlign.center, style: base),
            if (r.tin != null) pw.Text('TIN ${_latin(r.tin!)}', textAlign: pw.TextAlign.center, style: base),
            if (r.vatNumber != null) pw.Text('VAT No ${_latin(r.vatNumber!)}', textAlign: pw.TextAlign.center, style: base),
          ],
          rule(),
          row(r.heading, _when(r.soldAt), style: bold),
          if (r.showTillRef) row('Till ref', r.reference),
          row('Cashier', r.cashier),
          if (r.customerName != null) row('Customer', r.customerName!),
          if (r.customerTin != null && f?.buyerTin == null) row('Customer TIN', r.customerTin!),
          if (r.priceListName != null) row('Prices', r.priceListName!),
          if (r.customerVat != null && f?.buyerVat == null) row('Customer VAT No', r.customerVat!),
          rule(),
          for (final l in r.lines) ...[
            pw.Text(_latin(l.name), style: base),
            row('  ${formatQty(l.quantity)} x ${m(l.unitPrice)}${l.discount > 0 ? '  less ${m(l.discount)}' : ''}', m(l.total)),
            if (l.choices.isNotEmpty) pw.Text('  ${_latin(l.choices.join(', '))}', style: base),
            if (l.note != null) pw.Text('  ${_latin(l.note!)}', style: base.copyWith(fontStyle: pw.FontStyle.italic)),
          ],
          rule(),
          if (r.discountTotal > 0) ...[row('Subtotal', m(r.subtotal)), row('Discount', '-${m(r.discountTotal)}')],
          row('TOTAL ${r.currencyCode}', m(r.total), style: bold.copyWith(fontSize: small ? 10 : 12)),
          if (r.taxTotal > 0 && (f == null || f.taxes.isEmpty)) row(r.taxIncluded ? 'VAT included' : 'VAT', m(r.taxTotal)),
          rule(),
          for (final p in r.payments) ...[
            row(p.method.label, _money(p.amount, p.symbol, p.currencyCode)),
            if (p.change > 0) row('Change', _money(p.change, p.symbol, p.currencyCode), style: bold),
          ],
          rule(),
          if (f != null) ...items(fiscalBottom(f, itemCount: r.itemCount, money: m)),
          if (r.number == null) pw.Text('Recorded offline. It uploads to Floatly automatically.', textAlign: pw.TextAlign.center, style: base),
          pw.SizedBox(height: 4),
          pw.Text('Thank you!', textAlign: pw.TextAlign.center, style: bold),
        ],
      ),
    ),
  );
  return doc.save();
}
