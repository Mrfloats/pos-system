import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import 'printer_error.dart';
import 'printers_io.dart' if (dart.library.js_interop) 'printers_web.dart' as platform;

export 'printer_error.dart';

/// How receipts reach the printer.
enum PrinterKind {
  /// The operating system's print dialog (PDF). Works everywhere, one tap more.
  system('Print dialog', 'Through the system print dialog'),

  /// Paired Bluetooth printers on Android, including the built-in printer of Sunmi tills ("InnerPrinter").
  bluetooth('Bluetooth', 'A printer paired in Android Bluetooth settings'),

  /// USB printers plugged into an Android till.
  usb('USB', 'A printer plugged into this device'),

  /// Printers installed in Windows: USB, Bluetooth or network, through their driver.
  windows('Installed printer', 'A printer installed in Windows'),

  /// Any printer on the shop's network that takes raw print jobs on port 9100.
  network('Network', 'A printer on the shop network (Wi-Fi or cable)');

  const PrinterKind(this.label, this.description);
  final String label, description;

  static PrinterKind parse(String? s) => values.firstWhere((k) => k.name == s, orElse: () => system);
}

/// The ways this device can print receipts.
List<PrinterKind> availablePrinterKinds() {
  if (kIsWeb) return const [PrinterKind.system];
  return switch (defaultTargetPlatform) {
    TargetPlatform.android => const [PrinterKind.system, PrinterKind.bluetooth, PrinterKind.usb, PrinterKind.network],
    TargetPlatform.windows => const [PrinterKind.system, PrinterKind.windows, PrinterKind.network],
    _ => const [PrinterKind.system, PrinterKind.network],
  };
}

/// A printer the till can choose: [address] is a Bluetooth address, USB vendor:product or Windows printer name.
class FoundPrinter {
  const FoundPrinter(this.name, this.address);
  final String name, address;
}

/// The Android side lives in android/app/src/main/kotlin/…/MainActivity.kt.
const _android = MethodChannel('floatly/printer');

/// Printers of [kind] this device can see right now.
Future<List<FoundPrinter>> findPrinters(PrinterKind kind) async {
  try {
    switch (kind) {
      case PrinterKind.bluetooth:
      case PrinterKind.usb:
        final list = await _android.invokeListMethod<Map>(kind == PrinterKind.bluetooth ? 'bluetoothPrinters' : 'usbPrinters') ?? [];
        return [for (final p in list) FoundPrinter(p['name'] as String, p['address'] as String)];
      case PrinterKind.windows:
        return [for (final name in platform.windowsPrinters()) FoundPrinter(name, name)];
      case PrinterKind.system:
      case PrinterKind.network:
        return const [];
    }
  } on PlatformException catch (e) {
    throw PrinterException(e.message ?? e.code);
  }
}

/// Sends ESC/POS [bytes] to the printer.
Future<void> sendToPrinter(PrinterKind kind, String address, Uint8List bytes, {String jobName = 'Floatly receipt'}) async {
  if (address.trim().isEmpty) throw const PrinterException('Choose a receipt printer in Till settings first.');
  try {
    switch (kind) {
      case PrinterKind.network:
        await platform.sendNetwork(address, bytes);
      case PrinterKind.windows:
        await platform.sendWindows(address, bytes, jobName);
      case PrinterKind.bluetooth:
        await _android.invokeMethod<void>('printBluetooth', {'address': address, 'bytes': bytes});
      case PrinterKind.usb:
        await _android.invokeMethod<void>('printUsb', {'address': address, 'bytes': bytes});
      case PrinterKind.system:
        throw const PrinterException('This till prints through the print dialog.');
    }
  } on PlatformException catch (e) {
    throw PrinterException(e.message ?? e.code);
  }
}
