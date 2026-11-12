import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/api.dart';
import '../fiscal/fdms_client.dart';
import '../fiscal/fiscal_device.dart';
import '../printing/fiscal_print.dart';
import '../printing/print_receipt.dart';
import '../theme.dart';
import '../widgets/common.dart';

String _two(int n) => n.toString().padLeft(2, '0');
String _when(DateTime d) => '${_two(d.day)}/${_two(d.month)}/${d.year} ${_two(d.hour)}:${_two(d.minute)}';

/// What went wrong, in words: ZIMRA's and Floatly's errors carry their own.
String _problem(Object e) => switch (e) {
  FdmsException() => e.message,
  FiscalBlocked() => e.message,
  ApiException() => e.message,
  _ => '$e',
};

/// The till as a ZIMRA fiscal device: registering it, the fiscal day, and closing it (Z report).
class FiscalScreen extends StatelessWidget {
  const FiscalScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = TillScope.of(context);
    final f = state.fiscal;
    final canManage = state.session?.canManage ?? false;
    return Scaffold(
      appBar: AppBar(title: const Text('ZIMRA fiscal device')),
      body: Narrow(
        maxWidth: 640,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
          children: [
            if (!f.supported)
              const _Note(
                icon: Icons.phonelink_off,
                text: 'ZIMRA fiscalisation needs the Floatly Till app on Android or Windows. The browser version can’t use ZIMRA’s device certificate.',
              )
            else if (!f.registered)
              canManage
                  ? const _RegisterForm()
                  : const _Note(icon: Icons.lock_outline, text: 'This till isn’t registered with ZIMRA. A manager can register it here.')
            else
              _Status(canManage: canManage),
          ],
        ),
      ),
    );
  }
}

class _Note extends StatelessWidget {
  const _Note({required this.icon, required this.text, this.color, this.ink});

  final IconData icon;
  final String text;
  final Color? color, ink;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: color,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: ink ?? scheme.primary),
            const SizedBox(width: 12),
            Expanded(child: Text(text, style: TextStyle(color: ink))),
          ],
        ),
      ),
    );
  }
}

class _RegisterForm extends StatefulWidget {
  const _RegisterForm();

  @override
  State<_RegisterForm> createState() => _RegisterFormState();
}

class _RegisterFormState extends State<_RegisterForm> {
  var _environment = FdmsEnvironment.test;
  final _deviceId = TextEditingController();
  final _key = TextEditingController();
  final _serial = TextEditingController();
  final _model = TextEditingController(text: FiscalDevice.defaultModelName);
  final _version = TextEditingController(text: FiscalDevice.defaultModelVersion);
  Map<String, dynamic>? _taxpayer;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [_deviceId, _key, _serial, _model, _version]) {
      c.dispose();
    }
    super.dispose();
  }

  bool get _complete => int.tryParse(_deviceId.text.trim()) != null && _key.text.trim().length == 8 && _serial.text.trim().isNotEmpty;

  void _changed() => setState(() {
    _taxpayer = null;
    _error = null;
  });

  Future<void> _run(Future<void> Function() task) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await task();
    } catch (e) {
      if (mounted) setState(() => _error = _problem(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _check() => _run(() async {
    final who = await TillScope.read(context).fiscal.verify(
      environment: _environment,
      deviceId: int.parse(_deviceId.text.trim()),
      activationKey: _key.text,
      serialNo: _serial.text,
      modelName: _model.text.trim(),
      modelVersion: _version.text.trim(),
    );
    setState(() => _taxpayer = who);
  });

  Future<void> _register() => _run(() async {
    await TillScope.read(context).registerFiscal(
      environment: _environment,
      deviceId: int.parse(_deviceId.text.trim()),
      activationKey: _key.text,
      serialNo: _serial.text,
      modelName: _model.text.trim(),
      modelVersion: _version.text.trim(),
    );
    if (mounted) showMessage(context, 'Registered with ZIMRA. Every sale on this till is now fiscalised.');
  });

  @override
  Widget build(BuildContext context) {
    final t = _taxpayer;
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _Note(
          icon: Icons.info_outline,
          text:
              'Each till is its own ZIMRA fiscal device. Enter the device ID, activation key and serial number ZIMRA gave for this till. '
              'Once it’s registered, every sale and refund here is signed, printed with ZIMRA’s QR code and sent to ZIMRA, even after time offline.',
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SegmentedButton<FdmsEnvironment>(
                  segments: const [
                    ButtonSegment(value: FdmsEnvironment.test, label: Text('ZIMRA test'), icon: Icon(Icons.science_outlined)),
                    ButtonSegment(value: FdmsEnvironment.live, label: Text('Live'), icon: Icon(Icons.verified_outlined)),
                  ],
                  selected: {_environment},
                  onSelectionChanged: _busy
                      ? null
                      : (s) {
                          _environment = s.first;
                          _changed();
                        },
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: _deviceId,
                  enabled: !_busy,
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: const InputDecoration(labelText: 'Device ID'),
                  onChanged: (_) => _changed(),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _key,
                  enabled: !_busy,
                  maxLength: 8,
                  textCapitalization: TextCapitalization.characters,
                  decoration: const InputDecoration(labelText: 'Activation key', counterText: '', helperText: '8 letters and numbers'),
                  onChanged: (_) => _changed(),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _serial,
                  enabled: !_busy,
                  maxLength: 20,
                  decoration: const InputDecoration(labelText: 'Device serial number', counterText: ''),
                  onChanged: (_) => _changed(),
                ),
                Theme(
                  data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
                  child: ExpansionTile(
                    tilePadding: EdgeInsets.zero,
                    title: const Text('Device model'),
                    subtitle: Text('${_model.text} ${_version.text} · as registered with ZIMRA'),
                    children: [
                      TextField(controller: _model, enabled: !_busy, decoration: const InputDecoration(labelText: 'Model name'), onChanged: (_) => _changed()),
                      const SizedBox(height: 12),
                      TextField(controller: _version, enabled: !_busy, decoration: const InputDecoration(labelText: 'Model version'), onChanged: (_) => _changed()),
                      const SizedBox(height: 8),
                    ],
                  ),
                ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(_error!, style: TextStyle(color: scheme.error)),
                  ),
                if (t == null)
                  FilledButton.icon(
                    onPressed: _busy || !_complete ? null : _check,
                    icon: _busy ? const _Spinner() : const Icon(Icons.search),
                    label: const Text('Check with ZIMRA'),
                  )
                else ...[
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(color: Brand.ledgerSoft, borderRadius: BorderRadius.circular(12)),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('ZIMRA says this device belongs to', style: TextStyle(color: Brand.ledgerDeep.withValues(alpha: 0.8))),
                        const SizedBox(height: 4),
                        Text('${t['taxPayerName']}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16, color: Brand.ledgerDeep)),
                        Text('TIN ${t['taxPayerTIN']}${t['vatNumber'] != null ? ' · VAT ${t['vatNumber']}' : ' · not VAT-registered'}', style: const TextStyle(color: Brand.ledgerDeep)),
                        if (t['deviceBranchName'] != null) Text('${t['deviceBranchName']}', style: const TextStyle(color: Brand.ledgerDeep)),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: _busy ? null : _register,
                    icon: _busy ? const _Spinner() : const Icon(Icons.verified_outlined),
                    label: const Text('Register this till'),
                  ),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _Spinner extends StatelessWidget {
  const _Spinner();

  @override
  Widget build(BuildContext context) => const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2));
}

class _Status extends StatefulWidget {
  const _Status({required this.canManage});

  final bool canManage;

  @override
  State<_Status> createState() => _StatusState();
}

class _StatusState extends State<_Status> {
  String? _busy;

  Future<void> _run(String what, Future<void> Function() task, {String? done}) async {
    setState(() => _busy = what);
    try {
      await task();
      if (mounted && done != null) showMessage(context, done);
    } catch (e) {
      if (mounted) showMessage(context, _problem(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _printZ() async {
    final state = TillScope.read(context);
    final f = state.fiscal;
    final z = f.lastZ;
    if (z == null) return;
    await _run(
      'print',
      () => printItems(state.settings, zReportItems(z, config: f.config!, deviceId: f.deviceId!, serialNo: f.serialNo), title: 'Z report, fiscal day ${z.dayNo}'),
    );
  }

  Future<void> _closeDay() async {
    final f = TillScope.read(context).fiscal;
    final d = f.day!;
    final ok = await confirm(
      context,
      title: 'Close fiscal day ${d.no}?',
      message: 'This sends the day’s totals to ZIMRA (the Z report). ${d.counter} receipt${d.counter == 1 ? '' : 's'} so far. A new day opens with the next sale.',
      yes: 'Close the day',
    );
    if (!ok || !mounted) return;
    await _run('close', () => TillScope.read(context).closeFiscalDay());
    if (!mounted || f.day != null || f.lastZ == null) return;
    final print = await confirm(context, title: 'Fiscal day ${f.lastZ!.dayNo} is closed', message: 'ZIMRA accepted the day’s totals. Print the Z report?', yes: 'Print');
    if (print && mounted) await _printZ();
  }

  Future<void> _forget() async {
    final ok = await confirm(
      context,
      title: 'Remove the ZIMRA registration?',
      message: 'This till stops fiscalising. ZIMRA keeps the device; registering again needs its activation key.',
      yes: 'Remove',
      danger: true,
    );
    if (ok && mounted) await _run('forget', () => TillScope.read(context).forgetFiscal(), done: 'This till is no longer registered with ZIMRA');
  }

  @override
  Widget build(BuildContext context) {
    final state = TillScope.of(context);
    final f = state.fiscal;
    final c = f.config!;
    final d = f.day;
    final scheme = Theme.of(context).colorScheme;
    final refused = f.queue.where((q) => q.refusal != null).toList();
    final warning = f.dayWarning;
    final manage = widget.canManage;

    Widget card(String title, List<Widget> children) => Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(title, style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 8),
              ...children,
            ],
          ),
        ),
      ),
    );
    Widget line(String label, String value) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 140, child: Text(label, style: TextStyle(color: scheme.onSurfaceVariant))),
          Expanded(child: Text(value)),
        ],
      ),
    );

    final dayText = switch (d?.state) {
      null => 'No day open. A new fiscal day opens with the next sale.',
      DayState.open => 'Day ${d!.no} open since ${_when(d.openedAt)}: ${d.counter} receipt${d.counter == 1 ? '' : 's'}.',
      DayState.closing => 'Day ${d!.no} is closing: ZIMRA is checking the totals.',
      DayState.closeFailed => 'Day ${d!.no} didn’t close: ${d.closeError ?? 'ZIMRA found a problem'}',
    };

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (f.environment == FdmsEnvironment.test)
          const Padding(
            padding: EdgeInsets.only(bottom: 12),
            child: _Note(
              icon: Icons.science_outlined,
              color: Brand.amberSoft,
              ink: Brand.amberInk,
              text: 'Registered with ZIMRA’s test server: receipts are for trying things out, not real fiscal receipts.',
            ),
          ),
        if (warning != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _Note(icon: Icons.timer_outlined, color: Brand.amberSoft, ink: Brand.amberInk, text: warning),
          ),
        if (f.lastError != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _Note(icon: Icons.error_outline, color: scheme.errorContainer, ink: scheme.onErrorContainer, text: f.lastError!),
          ),
        card('Fiscal day', [
          Text(dayText),
          const SizedBox(height: 6),
          Text(
            f.unsent == 0 ? 'Every receipt is with ZIMRA.' : '${f.unsent} receipt${f.unsent == 1 ? '' : 's'} waiting to go to ZIMRA${f.online ? '' : ' (no connection to ZIMRA)'}.',
            style: TextStyle(color: f.unsent == 0 ? Brand.ledgerDeep : Brand.amberInk),
          ),
          if (manage) ...[
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (d != null)
                  FilledButton.icon(
                    onPressed: _busy != null ? null : _closeDay,
                    icon: _busy == 'close' ? const _Spinner() : const Icon(Icons.event_available_outlined),
                    label: Text(d.state == DayState.open ? 'Close the day (Z report)' : 'Try closing again'),
                  ),
                OutlinedButton.icon(
                  onPressed: _busy != null ? null : () => _run('send', state.fiscalSync, done: f.unsent == 0 ? 'Every receipt is with ZIMRA' : null),
                  icon: _busy == 'send' ? const _Spinner() : const Icon(Icons.cloud_upload_outlined),
                  label: const Text('Send now'),
                ),
                if (f.lastZ != null)
                  OutlinedButton.icon(
                    onPressed: _busy != null ? null : _printZ,
                    icon: _busy == 'print' ? const _Spinner() : const Icon(Icons.print_outlined),
                    label: Text('Print Z report, day ${f.lastZ!.dayNo}'),
                  ),
              ],
            ),
          ],
        ]),
        if (refused.isNotEmpty)
          card('Refused by ZIMRA', [
            for (final q in refused)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(Icons.error_outline, color: scheme.error),
                title: Text('Receipt ${q.receipt.invoiceNo}'),
                subtitle: Text(q.refusal!),
                trailing: manage ? TextButton(onPressed: _busy != null ? null : () => _run('retry', () => f.retry(q)), child: const Text('Try again')) : null,
              ),
          ]),
        card('Taxpayer', [
          line('Name', c.taxpayerName),
          line('TIN', c.taxpayerTin),
          line('VAT number', c.vatNumber ?? 'Not VAT-registered'),
          line('Branch', c.branchName),
          if (c.branchAddress.isNotEmpty) line('Address', c.branchAddress),
        ]),
        card('Device', [
          line('ZIMRA server', f.environment.label),
          line('Device ID', '${f.deviceId}'),
          line('Serial number', f.serialNo),
          line('Model', '${f.modelName} ${f.modelVersion}'),
          line('Last receipt no.', '${f.globalNo}'),
          if (c.certificateValidTill != null) line('Certificate until', _when(c.certificateValidTill!)),
          line('Day limit', '${c.dayMaxHours} hours'),
          if (manage) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                OutlinedButton.icon(
                  onPressed: _busy != null ? null : () => _run('refresh', f.refresh, done: 'Up to date with ZIMRA'),
                  icon: _busy == 'refresh' ? const _Spinner() : const Icon(Icons.sync),
                  label: const Text('Refresh from ZIMRA'),
                ),
                TextButton.icon(
                  style: TextButton.styleFrom(foregroundColor: scheme.error),
                  onPressed: _busy != null ? null : _forget,
                  icon: const Icon(Icons.link_off),
                  label: const Text('Remove registration'),
                ),
              ],
            ),
          ],
        ]),
      ],
    );
  }
}
