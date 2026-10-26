import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/money.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// Opens a shift with the cash in the drawer. [offered]: asked right after signing in.
Future<void> openShift(BuildContext context, {bool offered = false}) async {
  final state = TillScope.read(context);
  final currencies = state.catalog?.currencies ?? [];
  final fields = {for (final c in currencies) c.code: TextEditingController()};
  await showDialog<void>(
    context: context,
    builder: (context) {
      var busy = false;
      String? error;
      return StatefulBuilder(
        builder: (context, setDialog) {
          Future<void> open() async {
            setDialog(() => busy = true);
            try {
              await state.openShift({
                for (final e in fields.entries)
                  if ((tryParseFixed(e.value.text, 2) ?? 0) > 0) e.key: fromCents(tryParseFixed(e.value.text, 2)!),
              });
              if (context.mounted) Navigator.pop(context);
            } on ApiException catch (e) {
              if (e.message.contains('already have')) await state.loadShift().catchError((_) {});
              setDialog(() {
                busy = false;
                error = e.message;
              });
            }
          }

          return AlertDialog(
            title: Text(offered ? 'Open a shift?' : 'Open shift'),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(offered ? 'You have no shift open. Count the cash in the drawer to start one.' : 'Count the cash in the drawer.'),
                  const SizedBox(height: 14),
                  for (final c in currencies) ...[
                    AmountField(controller: fields[c.code]!, label: 'Cash in drawer (${c.code})', prefix: c.label),
                    const SizedBox(height: 10),
                  ],
                  if (error != null) Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                ],
              ),
            ),
            actions: [
              TextButton(onPressed: busy ? null : () => Navigator.pop(context), child: Text(offered ? 'Not now' : 'Cancel')),
              FilledButton(onPressed: busy ? null : open, child: const Text('Open shift')),
            ],
          );
        },
      );
    },
  );
}

Future<void> closeShift(BuildContext context) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const _CloseShiftScreen()));

/// Count the cash and close the shift; shows what was expected against what was counted.
class _CloseShiftScreen extends StatefulWidget {
  const _CloseShiftScreen();

  @override
  State<_CloseShiftScreen> createState() => _CloseShiftScreenState();
}

class _CloseShiftScreenState extends State<_CloseShiftScreen> {
  late final Map<String, TextEditingController> _counted;
  final _note = TextEditingController();
  bool _busy = false;
  String? _error;
  Map<String, dynamic>? _result;

  @override
  void initState() {
    super.initState();
    _counted = {for (final c in TillScope.read(context).catalog?.currencies ?? []) c.code: TextEditingController()};
  }

  @override
  void dispose() {
    for (final c in _counted.values) {
      c.dispose();
    }
    _note.dispose();
    super.dispose();
  }

  Future<void> _close() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await TillScope.read(context)
          .closeShift({for (final e in _counted.entries) e.key: fromCents(tryParseFixed(e.value.text, 2) ?? 0)}, _note.text.trim());
      setState(() => _result = result);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = TillScope.of(context);
    final shift = state.shift;
    final result = _result;
    final scheme = Theme.of(context).colorScheme;
    String symbol(String code) => state.catalog?.currency(code).label ?? code;

    return Scaffold(
      appBar: AppBar(title: Text(result != null ? 'Shift ${result['number']} closed' : 'Close shift ${shift?.number ?? ''}')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Narrow(
          child: result != null
              ? Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            TotalRow('Sales', '${result['salesCount']}'),
                            TotalRow('Returns', '${result['returnsCount']}'),
                            TotalRow('Net sales', formatMoney(toCents(result['netSalesBase']), state.catalog?.baseCurrency.label ?? '')),
                            for (final n in (result['nonCash'] as List).cast<Map>())
                              TotalRow('${n['method']} (${n['currencyCode']})', formatMoney(toCents(n['amount']), symbol(n['currencyCode'] as String))),
                          ],
                        ),
                      ),
                    ),
                    for (final c in (result['cash'] as List).cast<Map>()) ...[
                      const SizedBox(height: 12),
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Text('Cash ${c['currencyCode']}', style: Theme.of(context).textTheme.titleMedium!.copyWith(fontWeight: FontWeight.w600)),
                              const SizedBox(height: 6),
                              for (final (label, key) in [
                                ('Float', 'openingFloat'),
                                ('Cash taken', 'cashTaken'),
                                ('Sent out', 'transferredOut'),
                                ('Expected', 'expected'),
                                ('Counted', 'counted'),
                              ])
                                if (c[key] != null) TotalRow(label, formatMoney(toCents(c[key]), symbol(c['currencyCode'] as String))),
                              if (c['variance'] != null)
                                TotalRow(
                                  toCents(c['variance']) == 0 ? 'Balanced' : (toCents(c['variance']) > 0 ? 'Over' : 'Short'),
                                  formatMoney(toCents(c['variance']), symbol(c['currencyCode'] as String)),
                                  big: true,
                                  color: toCents(c['variance']) == 0 ? Brand.ledger : (toCents(c['variance']) > 0 ? Brand.amberInk : scheme.error),
                                ),
                            ],
                          ),
                        ),
                      ),
                    ],
                    const SizedBox(height: 16),
                    FilledButton(onPressed: () => Navigator.pop(context), child: const Text('Done')),
                  ],
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (shift == null) const Text('You have no shift open.'),
                    if (shift != null) ...[
                      Text('Count the cash in the drawer, by currency.', style: TextStyle(color: scheme.onSurfaceVariant)),
                      const SizedBox(height: 14),
                      for (final e in _counted.entries) ...[
                        AmountField(controller: e.value, label: 'Cash counted (${e.key})', prefix: symbol(e.key)),
                        const SizedBox(height: 10),
                      ],
                      TextField(
                        controller: _note,
                        decoration: const InputDecoration(labelText: 'Note (optional)'),
                        maxLines: 2,
                      ),
                      if (state.outbox.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 12),
                          child: Text(
                            '${state.outbox.length} sales on this till still have to upload. They upload first.',
                            style: const TextStyle(color: Brand.amberInk),
                          ),
                        ),
                      if (_error != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 12),
                          child: Text(_error!, style: TextStyle(color: scheme.error)),
                        ),
                      const SizedBox(height: 16),
                      FilledButton(
                        onPressed: _busy ? null : _close,
                        child: _busy
                            ? const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white))
                            : const Text('Close shift'),
                      ),
                    ],
                  ],
                ),
        ),
      ),
    );
  }
}
