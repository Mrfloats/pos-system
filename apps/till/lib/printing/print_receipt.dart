import '../models/receipt.dart';
import '../models/sale.dart';
import '../state/till_state.dart';
import 'escpos.dart';
import 'printers.dart';
import 'receipt_pdf.dart';

/// Prints a receipt the way this till is set up: straight to its receipt printer,
/// or through the print dialog. [openDrawer] also opens the cash drawer, when the
/// till is set to.
Future<void> printSaleReceipt(TillSettings s, Receipt r, {bool openDrawer = false}) async {
  if (!s.direct) return printReceiptPdf(r, paperWidth: s.paperWidth);
  await sendToPrinter(
    s.printer,
    s.printerAddress,
    receiptEscPos(r, paperWidth: s.paperWidth, openDrawer: openDrawer && s.openDrawer),
    jobName: 'Receipt ${r.number ?? r.reference}',
  );
}

/// Opens the cash drawer plugged into the receipt printer.
Future<void> openCashDrawer(TillSettings s) async {
  if (!s.direct) throw const PrinterException('Set up a receipt printer in Till settings to open the cash drawer.');
  await sendToPrinter(s.printer, s.printerAddress, drawerKick(), jobName: 'Cash drawer');
}

/// Prints a short test page on the chosen printer.
Future<void> printTestPage(TillSettings s, String tillName) async {
  if (!s.direct) throw const PrinterException('Choose a receipt printer first.');
  await sendToPrinter(
    s.printer,
    s.printerAddress,
    testPageEscPos(paperWidth: s.paperWidth, tillName: tillName),
    jobName: 'Test page',
  );
}

/// Whether some of the money was taken in cash (so the drawer needs opening).
bool paidInCash(Receipt r) => r.payments.any((p) => p.method == PayMethod.cash);
