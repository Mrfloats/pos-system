import 'package:flutter/material.dart';

import '../printing/print_receipt.dart';
import '../printing/printers.dart';
import '../state/till_state.dart';
import '../widgets/common.dart';

/// Chooses how receipts print: the print dialog, or straight to a receipt printer
/// over Bluetooth, USB, the network or a Windows printer, with the cash drawer.
class PrinterScreen extends StatefulWidget {
  const PrinterScreen({super.key});

  @override
  State<PrinterScreen> createState() => _PrinterScreenState();
}

class _PrinterScreenState extends State<PrinterScreen> {
  late PrinterKind _kind;
  late String _address;
  late String _name;
  late bool _drawer;
  final _ip = TextEditingController();
  List<FoundPrinter>? _found;
  String? _findError;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final s = TillScope.read(context).settings;
    _kind = availablePrinterKinds().contains(s.printer) ? s.printer : PrinterKind.system;
    _address = s.printerAddress;
    _name = s.printerName;
    _drawer = s.openDrawer;
    if (_kind == PrinterKind.network) _ip.text = _address;
    _find();
  }

  @override
  void dispose() {
    _ip.dispose();
    super.dispose();
  }

  /// The settings as chosen on this screen, not yet saved.
  TillSettings get _draft {
    final s = TillScope.read(context).settings;
    return TillSettings(paperWidth: s.paperWidth, autoPrint: s.autoPrint)
      ..printer = _kind
      ..printerAddress = _kind == PrinterKind.network ? _ip.text.trim() : _address
      ..printerName = _kind == PrinterKind.network ? _ip.text.trim() : _name
      ..openDrawer = _drawer;
  }

  Future<void> _find() async {
    if (_kind == PrinterKind.system || _kind == PrinterKind.network) return;
    setState(() {
      _found = null;
      _findError = null;
    });
    try {
      final found = await findPrinters(_kind);
      if (mounted) setState(() => _found = found);
    } on PrinterException catch (e) {
      if (mounted) setState(() => _findError = e.message);
    }
  }

  void _choose(PrinterKind kind) {
    if (kind == _kind) return;
    setState(() {
      _kind = kind;
      _address = '';
      _name = '';
    });
    _find();
  }

  Future<void> _try(Future<void> Function() task, String done) async {
    setState(() => _busy = true);
    try {
      await task();
      if (mounted) showMessage(context, done);
    } on PrinterException catch (e) {
      if (mounted) showMessage(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _save() async {
    final state = TillScope.read(context);
    final d = _draft;
    if (d.printer != PrinterKind.system && d.printerAddress.isEmpty) {
      showMessage(context, 'Choose a printer first', error: true);
      return;
    }
    state.settings
      ..printer = d.printer
      ..printerAddress = d.printer == PrinterKind.system ? '' : d.printerAddress
      ..printerName = d.printer == PrinterKind.system ? '' : d.printerName
      ..openDrawer = d.printer != PrinterKind.system && d.openDrawer;
    await state.saveSettings();
    if (mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final state = TillScope.of(context);
    final scheme = Theme.of(context).colorScheme;
    final direct = _kind != PrinterKind.system;

    return Scaffold(
      appBar: AppBar(title: const Text('Receipt printer')),
      body: Narrow(
        maxWidth: 640,
        child: ListView(
          padding: const EdgeInsets.all(12),
          children: [
            Card(
              child: Column(
                children: [
                  for (final k in availablePrinterKinds())
                    ListTile(
                      leading: Icon(k == _kind ? Icons.radio_button_checked : Icons.radio_button_unchecked, color: k == _kind ? scheme.primary : null),
                      title: Text(k.label),
                      subtitle: Text(k.description),
                      onTap: () => _choose(k),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            if (_kind == PrinterKind.network)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: TextField(
                    controller: _ip,
                    keyboardType: TextInputType.url,
                    decoration: const InputDecoration(
                      labelText: "Printer's IP address",
                      hintText: '192.168.1.50',
                      helperText: 'Printers print it on a self-test page (hold the feed button while switching on). Port 9100 unless you add another, e.g. 192.168.1.50:9100.',
                      helperMaxLines: 3,
                    ),
                    onChanged: (_) => setState(() {}),
                  ),
                ),
              ),
            if (direct && _kind != PrinterKind.network)
              Card(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    ListTile(
                      title: const Text('Printers', style: TextStyle(fontWeight: FontWeight.w600)),
                      subtitle: Text(switch (_kind) {
                        PrinterKind.bluetooth => 'Pair the printer in Android Bluetooth settings first. A Sunmi till\'s own printer is called InnerPrinter.',
                        PrinterKind.usb => 'Plug the printer in. Android asks once whether Floatly Till may use it.',
                        _ => 'Install the printer\'s Windows driver first.',
                      }),
                      trailing: IconButton(tooltip: 'Look again', onPressed: _find, icon: const Icon(Icons.refresh)),
                    ),
                    if (_findError != null)
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                        child: Text(_findError!, style: TextStyle(color: scheme.error)),
                      ),
                    if (_found == null && _findError == null)
                      const Padding(
                        padding: EdgeInsets.all(16),
                        child: Center(child: CircularProgressIndicator()),
                      ),
                    if (_found != null && _found!.isEmpty)
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                        child: Text('No printers found.', style: TextStyle(color: scheme.onSurfaceVariant)),
                      ),
                    for (final p in _found ?? const <FoundPrinter>[])
                      ListTile(
                        leading: Icon(p.address == _address ? Icons.check_circle : Icons.print_outlined, color: p.address == _address ? scheme.primary : null),
                        title: Text(p.name),
                        subtitle: p.name == p.address ? null : Text(p.address),
                        onTap: () => setState(() {
                          _address = p.address;
                          _name = p.name;
                        }),
                      ),
                  ],
                ),
              ),
            if (direct) ...[
              const SizedBox(height: 12),
              Card(
                child: SwitchListTile(
                  secondary: const Icon(Icons.point_of_sale),
                  title: const Text('Open the cash drawer after cash sales'),
                  subtitle: const Text('For a drawer plugged into the receipt printer'),
                  value: _drawer,
                  onChanged: (v) => setState(() => _drawer = v),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _busy || _draft.printerAddress.isEmpty
                          ? null
                          : () => _try(() => printTestPage(_draft, state.device!.deviceName), 'Test page sent'),
                      icon: const Icon(Icons.receipt_long_outlined),
                      label: const Text('Print a test page'),
                    ),
                  ),
                  if (_drawer) ...[
                    const SizedBox(width: 10),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _busy || _draft.printerAddress.isEmpty ? null : () => _try(() => openCashDrawer(_draft), 'Drawer opened'),
                        icon: const Icon(Icons.lock_open_outlined),
                        label: const Text('Test the drawer'),
                      ),
                    ),
                  ],
                ],
              ),
            ],
            const SizedBox(height: 12),
            FilledButton(onPressed: _busy ? null : _save, child: const Text('Save')),
          ],
        ),
      ),
    );
  }
}
