// Sends raw ESC/POS bytes to a printer installed in Windows (USB, Bluetooth or
// network, through its Windows driver), using the print spooler in winspool.drv.
import 'dart:ffi';
import 'dart:typed_data';

import 'package:ffi/ffi.dart';

import 'printer_error.dart';

final class _DocInfo1 extends Struct {
  external Pointer<Utf16> docName;
  external Pointer<Utf16> outputFile;
  external Pointer<Utf16> datatype;
}

final class _PrinterInfo4 extends Struct {
  external Pointer<Utf16> printerName;
  external Pointer<Utf16> serverName;
  @Uint32()
  external int attributes;
}

// Looked up the first time they are used, so other platforms never load winspool.drv.
final _winspool = DynamicLibrary.open('winspool.drv');
final _openPrinter = _winspool
    .lookupFunction<Int32 Function(Pointer<Utf16>, Pointer<IntPtr>, Pointer<Void>), int Function(Pointer<Utf16>, Pointer<IntPtr>, Pointer<Void>)>(
      'OpenPrinterW',
    );
final _closePrinter = _winspool.lookupFunction<Int32 Function(IntPtr), int Function(int)>('ClosePrinter');
final _startDocPrinter = _winspool.lookupFunction<Uint32 Function(IntPtr, Uint32, Pointer<Void>), int Function(int, int, Pointer<Void>)>('StartDocPrinterW');
final _endDocPrinter = _winspool.lookupFunction<Int32 Function(IntPtr), int Function(int)>('EndDocPrinter');
final _startPagePrinter = _winspool.lookupFunction<Int32 Function(IntPtr), int Function(int)>('StartPagePrinter');
final _endPagePrinter = _winspool.lookupFunction<Int32 Function(IntPtr), int Function(int)>('EndPagePrinter');
final _writePrinter = _winspool
    .lookupFunction<Int32 Function(IntPtr, Pointer<Void>, Uint32, Pointer<Uint32>), int Function(int, Pointer<Void>, int, Pointer<Uint32>)>('WritePrinter');
final _enumPrinters = _winspool
    .lookupFunction<
      Int32 Function(Uint32, Pointer<Utf16>, Uint32, Pointer<Uint8>, Uint32, Pointer<Uint32>, Pointer<Uint32>),
      int Function(int, Pointer<Utf16>, int, Pointer<Uint8>, int, Pointer<Uint32>, Pointer<Uint32>)
    >('EnumPrintersW');

const _printerEnumLocal = 0x2;
const _printerEnumConnections = 0x4;

/// The names of the printers installed on this computer.
List<String> windowsPrinters() => using((arena) {
  final needed = arena<Uint32>();
  final count = arena<Uint32>();
  const flags = _printerEnumLocal | _printerEnumConnections;
  _enumPrinters(flags, nullptr, 4, nullptr, 0, needed, count);
  if (needed.value == 0) return <String>[];
  final buffer = arena<Uint8>(needed.value);
  if (_enumPrinters(flags, nullptr, 4, buffer, needed.value, needed, count) == 0) {
    throw const PrinterException("Couldn't list the printers installed in Windows.");
  }
  final infos = buffer.cast<_PrinterInfo4>();
  return [for (var i = 0; i < count.value; i++) infos[i].printerName.toDartString()];
});

/// Sends [bytes] to the printer as a raw job, untouched by the Windows driver.
void sendToWindowsPrinter(String printerName, Uint8List bytes, {String jobName = 'Floatly receipt'}) => using((arena) {
  final handle = arena<IntPtr>();
  if (_openPrinter(printerName.toNativeUtf16(allocator: arena), handle, nullptr) == 0) {
    throw PrinterException('Windows can\'t find the printer "$printerName". Check it is installed and switched on.');
  }
  final h = handle.value;
  try {
    final doc = arena<_DocInfo1>();
    doc.ref
      ..docName = jobName.toNativeUtf16(allocator: arena)
      ..outputFile = nullptr
      ..datatype = 'RAW'.toNativeUtf16(allocator: arena);
    if (_startDocPrinter(h, 1, doc.cast()) == 0) {
      throw PrinterException('"$printerName" refused the receipt. Its Windows driver must accept raw printing (most receipt printer drivers do).');
    }
    try {
      _startPagePrinter(h);
      final data = arena<Uint8>(bytes.length);
      data.asTypedList(bytes.length).setAll(0, bytes);
      final written = arena<Uint32>();
      if (_writePrinter(h, data.cast(), bytes.length, written) == 0 || written.value != bytes.length) {
        throw PrinterException('Couldn\'t send the receipt to "$printerName".');
      }
      _endPagePrinter(h);
    } finally {
      _endDocPrinter(h);
    }
  } finally {
    _closePrinter(h);
  }
});
