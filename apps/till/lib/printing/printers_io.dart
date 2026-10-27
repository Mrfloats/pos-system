import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'printer_error.dart';
import 'windows_spooler.dart' as spooler;

/// "192.168.1.50" or "192.168.1.50:9100" → host and port (9100, the usual raw printing port).
(String, int) parseNetworkAddress(String address) {
  final a = address.trim();
  final colon = a.lastIndexOf(':');
  if (colon > 0) {
    final port = int.tryParse(a.substring(colon + 1));
    if (port != null) return (a.substring(0, colon), port);
  }
  return (a, 9100);
}

/// Sends [bytes] straight to a network receipt printer.
Future<void> sendNetwork(String address, Uint8List bytes) async {
  final (host, port) = parseNetworkAddress(address);
  final Socket socket;
  try {
    socket = await Socket.connect(host, port, timeout: const Duration(seconds: 5));
  } on SocketException {
    throw PrinterException("Can't reach the printer at $host:$port. Check it is switched on and on the same network as this till.");
  }
  try {
    socket.add(bytes);
    await socket.flush();
    // Printers often keep the connection open; don't wait long for them to close it.
    await socket.close().timeout(const Duration(seconds: 2), onTimeout: () => socket);
  } on SocketException {
    throw PrinterException('The printer at $host:$port stopped answering while printing.');
  } finally {
    socket.destroy();
  }
}

List<String> windowsPrinters() => spooler.windowsPrinters();

Future<void> sendWindows(String printerName, Uint8List bytes, String jobName) async => spooler.sendToWindowsPrinter(printerName, bytes, jobName: jobName);
