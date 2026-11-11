import 'dart:convert';
import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:share_plus/share_plus.dart';

import 'report_data.dart';

/// A CSV file of the report's table, with plain numbers so a spreadsheet can add them up.
String reportCsv(ReportTable table) {
  String cell(String? v) {
    final s = v ?? '';
    return s.contains(RegExp(r'[",\n\r]')) ? '"${s.replaceAll('"', '""')}"' : s;
  }

  final lines = [
    table.columns.map((c) => cell(c.label)).join(','),
    for (final r in table.rows) r.map(cell).join(','),
    if (table.totals != null) table.totals!.map(cell).join(','),
  ];
  return '${lines.join('\r\n')}\r\n';
}

/// The built-in PDF fonts only cover Western European letters: dashes, curly quotes and the
/// minus sign become their plain forms; anything else becomes "?".
String _latin(String s) => String.fromCharCodes(
  s
      .replaceAll(RegExp('[‒-―−]'), '-')
      .replaceAll(RegExp('[‘’]'), "'")
      .replaceAll(RegExp('[“”]'), '"')
      .replaceAll('…', '...')
      .runes
      .map((c) => c <= 0x7E || (c >= 0xA0 && c <= 0xFF) ? c : 0x3F),
);

/// The report as a PDF: heading, the headline figures and the table, A4, landscape when wide.
Future<Uint8List> reportPdf({
  required ReportResult report,
  required String business,
  required String period,
  required String place,
  required String symbol,
  required String generated,
}) async {
  // Symbols the PDF fonts can't draw (₦, ₹…) are left off; the heading says the currency.
  final sym = _latin(symbol) == symbol ? symbol : '';
  final table = report.table;
  final wide = table.columns.length > 6;
  final base = pw.TextStyle(fontSize: wide ? 7.5 : 9);
  final bold = base.copyWith(fontWeight: pw.FontWeight.bold);
  final doc = pw.Document(title: '${report.title} – $business');
  doc.addPage(
    pw.MultiPage(
      pageFormat: wide ? PdfPageFormat.a4.landscape : PdfPageFormat.a4,
      margin: const pw.EdgeInsets.all(28),
      header: (context) => pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          pw.Text(_latin(business), style: pw.TextStyle(fontSize: 10, color: PdfColors.grey700)),
          pw.Text(_latin(report.title), style: pw.TextStyle(fontSize: 16, fontWeight: pw.FontWeight.bold)),
          pw.Text(_latin('$period · $place'), style: pw.TextStyle(fontSize: 10, color: PdfColors.grey700)),
          pw.SizedBox(height: 10),
        ],
      ),
      footer: (context) => pw.Row(
        mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
        children: [
          pw.Text(_latin('Floatly · $generated'), style: pw.TextStyle(fontSize: 8, color: PdfColors.grey600)),
          pw.Text('Page ${context.pageNumber} of ${context.pagesCount}', style: pw.TextStyle(fontSize: 8, color: PdfColors.grey600)),
        ],
      ),
      build: (context) => [
        pw.Wrap(
          spacing: 18,
          runSpacing: 8,
          children: [
            for (final s in report.stats)
              pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: [
                  pw.Text(_latin(s.label), style: pw.TextStyle(fontSize: 8, color: PdfColors.grey700)),
                  pw.Text(_latin(showCell(s.value, s.kind, sym)), style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold)),
                ],
              ),
          ],
        ),
        pw.SizedBox(height: 14),
        pw.TableHelper.fromTextArray(
          headers: [for (final c in table.columns) _latin(c.label)],
          data: [
            for (final r in table.rows) [for (final (i, v) in r.indexed) _latin(showCell(v, table.columns[i].kind, sym))],
            if (table.totals != null) [for (final (i, v) in table.totals!.indexed) _latin(v == null ? '' : showCell(v, table.columns[i].kind, sym))],
          ],
          headerStyle: bold,
          cellStyle: base,
          headerDecoration: const pw.BoxDecoration(color: PdfColors.grey200),
          cellAlignments: {for (final (i, c) in table.columns.indexed) i: c.numeric ? pw.Alignment.centerRight : pw.Alignment.centerLeft},
          cellPadding: const pw.EdgeInsets.symmetric(horizontal: 4, vertical: 3),
          border: const pw.TableBorder(horizontalInside: pw.BorderSide(color: PdfColors.grey300, width: 0.5)),
        ),
        for (final n in report.notes) pw.Padding(padding: const pw.EdgeInsets.only(top: 8), child: pw.Text(_latin(n), style: pw.TextStyle(fontSize: 8, color: PdfColors.grey700))),
      ],
    ),
  );
  return doc.save();
}

/// Hands a file to the phone's share sheet (WhatsApp, email, Drive…), or downloads it on the web.
Future<void> shareFile(Uint8List bytes, {required String name, required String mimeType, required String subject}) async {
  await SharePlus.instance.share(
    ShareParams(
      files: [XFile.fromData(bytes, mimeType: mimeType, name: name)],
      fileNameOverrides: [name],
      subject: subject,
      title: subject,
    ),
  );
}

Uint8List csvBytes(ReportTable table) => Uint8List.fromList([0xEF, 0xBB, 0xBF, ...utf8.encode(reportCsv(table))]);
