import 'dart:io';
import 'dart:typed_data';

import 'package:floatly_till/printing/printers.dart';
import 'package:floatly_till/printing/printers_io.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('reads a network printer address with or without a port', () {
    expect(parseNetworkAddress('192.168.1.50'), ('192.168.1.50', 9100));
    expect(parseNetworkAddress(' 10.0.0.9:9101 '), ('10.0.0.9', 9101));
  });

  test('sends the receipt to a network printer as it is', () async {
    final printer = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
    final received = <int>[];
    final done = printer.first.then((client) => client.listen(received.addAll).asFuture<void>());
    final bytes = Uint8List.fromList([0x1B, 0x40, ...'Hello'.codeUnits, 0x0A]);
    await sendToPrinter(PrinterKind.network, '127.0.0.1:${printer.port}', bytes);
    await done.timeout(const Duration(seconds: 5));
    await printer.close();
    expect(received, bytes);
  });

  test("says so when a network printer can't be reached", () async {
    final free = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
    final port = free.port;
    await free.close();
    await expectLater(
      sendToPrinter(PrinterKind.network, '127.0.0.1:$port', Uint8List(1)),
      throwsA(isA<PrinterException>().having((e) => e.message, 'message', contains("Can't reach the printer"))),
    );
  });

  test('lists the printers installed in Windows', () async {
    final printers = await findPrinters(PrinterKind.windows);
    // Every Windows machine has at least "Microsoft Print to PDF" unless it was removed.
    expect(printers.map((p) => p.name), isNotEmpty);
    expect(printers.every((p) => p.name == p.address), isTrue);
  }, skip: Platform.isWindows ? false : 'Windows only');

  test('a printer missing from Windows gives a clear message', () async {
    await expectLater(
      sendToPrinter(PrinterKind.windows, 'No Such Printer 12345', Uint8List(1)),
      throwsA(isA<PrinterException>().having((e) => e.message, 'message', contains("can't find the printer"))),
    );
  }, skip: Platform.isWindows ? false : 'Windows only');
}
