/// The ZIMRA parts of a fiscal receipt (spec 10.1, Receipt48), described once
/// and drawn by the screen, the PDF and the receipt printer alike.
library;

import '../core/money.dart';
import '../fiscal/fdms.dart';
import '../fiscal/fdms_client.dart';
import '../fiscal/fiscal_device.dart';
import '../models/receipt.dart';

sealed class PrintItem {}

class PText extends PrintItem {
  PText(this.text, {this.bold = false, this.center = false});
  final String text;
  final bool bold, center;
}

class PRow extends PrintItem {
  PRow(this.left, this.right, {this.bold = false});
  final String left, right;
  final bool bold;
}

class PRule extends PrintItem {}

class PQr extends PrintItem {
  PQr(this.data);
  final String data;
}

String _two(int n) => n.toString().padLeft(2, '0');

/// 03/07/23 18:48, as on ZIMRA's sample receipts.
String fiscalDate(DateTime d) => '${_two(d.day)}/${_two(d.month)}/${_two(d.year % 100)} ${_two(d.hour)}:${_two(d.minute)}';

/// Under the business name: the taxpayer, the title, the buyer and the
/// receipt's ZIMRA numbers (fields 2 to 28).
List<PrintItem> fiscalTop(ReceiptFiscal f) => [
  PText(f.taxpayerName, bold: true, center: true),
  if (f.taxpayerTin.isNotEmpty) PText('TIN: ${f.taxpayerTin}', center: true),
  if (f.vatNumber != null) PText('VAT No: ${f.vatNumber}', center: true),
  if ((f.branchName ?? '').isNotEmpty && f.branchName != f.taxpayerName) PText(f.branchName!, center: true),
  if ((f.branchAddress ?? '').isNotEmpty) PText(f.branchAddress!, center: true),
  if (f.branchEmail != null) PText(f.branchEmail!, center: true),
  if (f.branchPhone != null) PText(f.branchPhone!, center: true),
  PRule(),
  PText(f.label, bold: true, center: true),
  PRule(),
  if (f.buyerName != null) ...[
    PText('BUYER', bold: true),
    PText(f.buyerName!),
    if (f.buyerTin != null) PText('TIN: ${f.buyerTin}'),
    if (f.buyerVat != null) PText('VAT: ${f.buyerVat}'),
    PRule(),
  ],
  PRow('Invoice No: ${f.counter}/${f.globalNo}', 'Fiscal day No: ${f.dayNo}'),
  PText('Customer reference No: ${f.invoiceNo}'),
  if ((f.serialNo ?? '').isNotEmpty) PText('Device Serial No: ${f.serialNo}'),
  PText('Device ID: ${f.deviceId}'),
  PText('Date: ${fiscalDate(f.date)}'),
  if (f.isCreditNote && f.creditedInvoiceNo != null) ...[
    PRule(),
    PText('CREDITED INVOICE', bold: true),
    PText('Invoice No: ${f.creditedGlobalNo ?? '-'}${f.creditedDate == null ? '' : '  Date: ${fiscalDate(f.creditedDate!)}'}'),
    PText('Customer reference No: ${f.creditedInvoiceNo}'),
  ],
];

/// After the payments: the number of items, the tax table, the note, and the
/// QR code with the verification code (fields 39 to 48).
List<PrintItem> fiscalBottom(ReceiptFiscal f, {required int itemCount, required String Function(int cents) money}) => [
  PRow('Number of items', formatQty(itemCount)),
  for (final t in f.taxes) ...[
    PRule(),
    PRow('Net Amount', money(t.net)),
    PRow('VAT (${t.label})', money(t.tax)),
    PRow('Gross Amount', money(t.gross)),
  ],
  PRule(),
  if ((f.notes ?? '').isNotEmpty) PText(f.notes!),
  PQr(f.qrCode),
  PText('Verification code:', center: true),
  PText(f.verificationCode, bold: true, center: true),
  if (f.verifyUrl.isNotEmpty) ...[PText('You can verify this receipt manually at', center: true), PText(f.verifyUrl, center: true)],
];

String _documentLabel(String type) => switch (type) {
  'CreditNote' => 'Credit notes',
  'DebitNote' => 'Debit notes',
  _ => 'Fiscal invoices',
};

String _counterLabel(FdmsCounter c) {
  final rate = c.percent == null ? 'exempt' : '${fdmsPercentText(c.percent)}%';
  return switch (c.type) {
    CounterType.saleByTax => 'Sales, $rate',
    CounterType.saleTaxByTax => 'VAT on sales, $rate',
    CounterType.creditNoteByTax => 'Credit notes, $rate',
    CounterType.creditNoteTaxByTax => 'VAT on credit notes, $rate',
    CounterType.debitNoteByTax => 'Debit notes, $rate',
    CounterType.debitNoteTaxByTax => 'VAT on debit notes, $rate',
    CounterType.balanceByMoneyType => 'Taken by ${c.moneyType!.wire}',
  };
}

/// The Z report for a closed fiscal day: what it came to, by document and by tax and payment.
List<PrintItem> zReportItems(ZReport z, {required FdmsConfig config, required int deviceId, required String serialNo}) => [
  PText(config.taxpayerName, bold: true, center: true),
  if (config.taxpayerTin.isNotEmpty) PText('TIN: ${config.taxpayerTin}', center: true),
  if (config.vatNumber != null) PText('VAT No: ${config.vatNumber}', center: true),
  if (config.branchName.isNotEmpty && config.branchName != config.taxpayerName) PText(config.branchName, center: true),
  if (config.branchAddress.isNotEmpty) PText(config.branchAddress, center: true),
  PRule(),
  PText('Z REPORT', bold: true, center: true),
  PRule(),
  PText('Fiscal day No: ${z.dayNo}'),
  PText('Opened: ${fiscalDate(z.openedAt)}'),
  PText('Closed: ${fiscalDate(z.closedAt)}'),
  PText('Device ID: $deviceId'),
  if (serialNo.isNotEmpty) PText('Device Serial No: $serialNo'),
  PRule(),
  PText('Documents', bold: true),
  if (z.documents.isEmpty) PText('None'),
  for (final e in z.documents.entries) PRow('${_documentLabel(e.key.split('|').first)} (${e.value[0]})', formatMoney(e.value[1], e.key.split('|').last)),
  PRule(),
  PText('Totals', bold: true),
  if (z.counters.isEmpty) PText('Nothing sold'),
  for (final c in z.counters) PRow(_counterLabel(c), formatMoney(c.value, c.currency)),
  PRule(),
  PRow('Receipts issued', '${z.receipts}'),
];
