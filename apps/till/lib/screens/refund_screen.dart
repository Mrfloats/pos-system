import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/money.dart';
import '../models/sale.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// Give money back for some or all of a sale (managers, online). Goods go back
/// on the shelf unless they are damaged.
class RefundScreen extends StatefulWidget {
  const RefundScreen({super.key, required this.saleId, required this.number});

  final String saleId;
  final String number;

  @override
  State<RefundScreen> createState() => _RefundScreenState();
}

class _RefundScreenState extends State<RefundScreen> {
  Map<String, dynamic>? _sale;
  String? _error;
  final Map<String, int> _qty = {};
  PayMethod _method = PayMethod.cash;
  bool _restock = true;
  bool _busy = false;
  final _reason = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final sale = await TillScope.read(context).loadSale(widget.saleId);
      final payments = (sale['payments'] as List).cast<Map>();
      setState(() {
        _sale = sale;
        if (payments.isNotEmpty) _method = PayMethod.parse(payments.first['method'] as String?);
      });
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    }
  }

  List<Map> get _lines => (_sale!['lines'] as List).cast<Map>();

  int _left(Map l) => parseFixed(l['quantity'], 3) - parseFixed(l['returnedQuantity'], 3);

  /// What goes back for the chosen quantities: each line's total shared out by quantity, as the API does.
  int get _refundTotal {
    var total = 0;
    for (final l in _lines) {
      final q = _qty[l['id']] ?? 0;
      if (q > 0) total += divRound(toCents(l['total']) * q, parseFixed(l['quantity'], 3));
    }
    return total;
  }

  Future<void> _submit() async {
    final lines = [
      for (final e in _qty.entries)
        if (e.value > 0) {'lineId': e.key, 'quantity': formatFixed(e.value, 3)},
    ];
    if (lines.isEmpty || _reason.text.trim().isEmpty) return;
    setState(() => _busy = true);
    try {
      final ret = await TillScope.read(context)
          .refund(widget.saleId, {'lines': lines, 'method': _method.name, 'reason': _reason.text.trim(), 'restock': _restock});
      if (!mounted) return;
      final symbol = TillScope.read(context).catalog?.currency(ret['currencyCode'] as String).label ?? '';
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          icon: const Icon(Icons.check_circle_outline, color: Brand.ledger, size: 40),
          title: Text('Refund ${ret['number']}'),
          content: Text('Give back ${formatMoney(toCents(ret['total']), symbol)} by ${_method.label.toLowerCase()}.', style: const TextStyle(fontSize: 16)),
          actions: [FilledButton(onPressed: () => Navigator.pop(context), child: const Text('Done'))],
        ),
      );
      if (mounted) Navigator.of(context).pop();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      showMessage(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final sale = _sale;
    return Scaffold(
      appBar: AppBar(title: Text('Refund ${widget.number}')),
      body: sale == null
          ? Center(
              child: _error == null ? const CircularProgressIndicator() : Padding(padding: const EdgeInsets.all(24), child: Text(_error!)),
            )
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Narrow(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (sale['status'] != 'completed')
                      Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: Text('This sale is ${sale['status']} and can\'t be refunded.', style: TextStyle(color: scheme.error)),
                      ),
                    Card(
                      child: Column(
                        children: [
                          for (final l in _lines)
                            () {
                              final id = l['id'] as String;
                              final left = _left(l);
                              final q = _qty[id] ?? 0;
                              final whole = left % 1000 == 0;
                              return ListTile(
                                enabled: left > 0,
                                title: Text(l['variantName'] == 'Default' ? l['productName'] as String : '${l['productName']} · ${l['variantName']}'),
                                subtitle: Text(left > 0 ? '${formatQty(left)} can be returned' : 'Already returned'),
                                trailing: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    IconButton(
                                      onPressed: q > 0 ? () => setState(() => _qty[id] = whole ? q - 1000 : 0) : null,
                                      icon: const Icon(Icons.remove_circle_outline),
                                    ),
                                    SizedBox(
                                      width: 36,
                                      child: Text(
                                        formatQty(q),
                                        textAlign: TextAlign.center,
                                        style: tabular.copyWith(fontWeight: FontWeight.w600),
                                      ),
                                    ),
                                    IconButton(
                                      onPressed: q < left ? () => setState(() => _qty[id] = whole ? q + 1000 : left) : null,
                                      icon: const Icon(Icons.add_circle_outline),
                                    ),
                                  ],
                                ),
                              );
                            }(),
                        ],
                      ),
                    ),
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton(
                        onPressed: () => setState(() {
                          for (final l in _lines) {
                            _qty[l['id'] as String] = _left(l);
                          }
                        }),
                        child: const Text('Return everything'),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text('Give the money back by', style: Theme.of(context).textTheme.labelLarge),
                    const SizedBox(height: 8),
                    SegmentedButton<PayMethod>(
                      segments: [
                        for (final m in PayMethod.values) ButtonSegment(value: m, label: Text(m == PayMethod.bank ? 'Bank' : m.label.split(' ').first)),
                      ],
                      selected: {_method},
                      showSelectedIcon: false,
                      onSelectionChanged: (s) => setState(() => _method = s.first),
                    ),
                    const SizedBox(height: 14),
                    TextField(
                      controller: _reason,
                      decoration: const InputDecoration(labelText: 'Reason'),
                      onChanged: (_) => setState(() {}),
                    ),
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      title: const Text('Put the goods back on the shelf'),
                      subtitle: const Text('Turn off for damaged goods'),
                      value: _restock,
                      onChanged: (v) => setState(() => _restock = v),
                    ),
                    const SizedBox(height: 8),
                    FilledButton(
                      onPressed: !_busy && _refundTotal > 0 && _reason.text.trim().isNotEmpty ? _submit : null,
                      child: Text(
                        _refundTotal > 0
                            ? 'Refund ${formatMoney(_refundTotal, TillScope.of(context).catalog?.currency(sale['currencyCode'] as String).label ?? '')}'
                            : 'Choose what is coming back',
                      ),
                    ),
                  ],
                ),
              ),
            ),
    );
  }
}
