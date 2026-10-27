import 'dart:typed_data';

import 'printer_error.dart';

// Browsers can't open connections to printers; the web till uses the print dialog.

(String, int) parseNetworkAddress(String address) => (address, 9100);

Future<void> sendNetwork(String address, Uint8List bytes) async =>
    throw const PrinterException('The web version prints through the browser. Use the Floatly Till app for receipt printers.');

List<String> windowsPrinters() => const [];

Future<void> sendWindows(String printerName, Uint8List bytes, String jobName) async =>
    throw const PrinterException('The web version prints through the browser.');
