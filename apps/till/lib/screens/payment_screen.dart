import 'package:flutter/material.dart';

import '../core/money.dart';
import '../models/catalog.dart';
import '../models/sale.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'receipt_screen.dart';

/// Take the money: any method and currency the business accepts, split across
/// several if needed. Cash can be more than due; the change is worked out.
class PaymentScreen extends StatefulWidget {
  const PaymentScreen({super.key});

  @override
  State<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends State<PaymentScreen> {
  late final PricedCart _cart;
  late Currency _currency;
  final List<Payment> _payments = [];
  PayMethod _method = PayMethod.cash;
  final _amount = TextEditingController();
  final _reference = TextEditingController();
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    // The basket can't change while paying, and it empties once the sale is done.
    _cart = TillScope.read(context).priced;
    _currency = _cart.currency;
    _fillRemaining();
  }

  @override
  void dispose() {
    _amount.dispose();
    _reference.dispose();
    super.dispose();
  }

  int get _remainingBase => settle(_payments, _cart).remainingBase;

  /// What's still due, in the currency being taken.
  int _due(Currency c) => inCurrency(_remainingBase, c, _cart);

  void _fillRemaining() => _amount.text = _remainingBase > 0 ? fromCents(_due(_currency)) : '';

  Payment? get _entry {
    final cents = tryParseFixed(_amount.text, 2);
    if (cents == null || cents <= 0) return null;
    return Payment(method: _method, currency: _currency, amount: cents, reference: _method == PayMethod.cash ? null : _reference.text.trim());
  }

  List<Payment> get _all => [..._payments, ?_entry];

  void _addSplit() {
    final e = _entry;
    if (e == null) return;
    setState(() {
      _payments.add(e);
      _reference.clear();
      _method = PayMethod.cash;
      _fillRemaining();
    });
  }

  Future<void> _complete() async {
    setState(() => _busy = true);
    try {
      final receipt = await TillScope.read(context).completeSale(_all);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => ReceiptScreen(receipt: receipt, justSold: true)));
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      showMessage(context, '$e', error: true);
    }
  }

  /// Exact, then the next round amounts a customer is likely to hand over.
  List<int> _quickAmounts(int due) {
    if (due <= 0) return [];
    final out = <int>{due};
    for (final step in [100, 500, 1000, 2000, 5000, 10000]) {
      final up = ((due + step - 1) ~/ step) * step;
      if (up > due) out.add(up);
      if (out.length >= 5) break;
    }
    return out.toList()..sort();
  }

  @override
  Widget build(BuildContext context) {
    final catalog = TillScope.of(context).catalog!;
    final scheme = Theme.of(context).colorScheme;
    final symbol = _cart.currency.label;
    final result = settle(_all, _cart);
    final entry = _entry;
    final dueNow = _due(_currency);

    return Scaffold(
      appBar: AppBar(title: const Text('Payment')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Narrow(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      children: [
                        Text('Total', style: TextStyle(color: scheme.onSurfaceVariant)),
                        Text(formatMoney(_cart.total, symbol), style: tabular.copyWith(fontSize: 40, fontWeight: FontWeight.w800)),
                        if (catalog.currencies.length > 1)
                          Text(
                            [
                              for (final c in catalog.currencies)
                                if (c.code != _cart.currency.code) formatMoney(inCurrency(_cart.totalBase, c, _cart), c.label),
                            ].join('  ·  '),
                            style: tabular.copyWith(color: scheme.onSurfaceVariant),
                          ),
                        if (_cart.taxTotal > 0)
                          Text(
                            // The total always has the VAT in it, whether prices included it or it was added.
                            'Includes VAT ${formatMoney(_cart.taxTotal, symbol)}',
                            style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12.5),
                          ),
                      ],
                    ),
                  ),
                ),
                if (_payments.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Card(
                    child: Column(
                      children: [
                        for (final p in _payments)
                          ListTile(
                            leading: Icon(_methodIcon(p.method)),
                            title: Text(p.method.label),
                            subtitle: (p.reference ?? '').isEmpty ? null : Text(p.reference!),
                            trailing: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(formatMoney(p.amount, p.currency.label), style: tabular.copyWith(fontWeight: FontWeight.w600)),
                                IconButton(
                                  tooltip: 'Remove',
                                  icon: const Icon(Icons.close),
                                  onPressed: () => setState(() {
                                    _payments.remove(p);
                                    _fillRemaining();
                                  }),
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                SegmentedButton<PayMethod>(
                  segments: [
                    for (final m in PayMethod.values)
                      ButtonSegment(value: m, icon: Icon(_methodIcon(m)), label: Text(m == PayMethod.bank ? 'Bank' : m.label.split(' ').first)),
                  ],
                  selected: {_method},
                  showSelectedIcon: false,
                  onSelectionChanged: (s) => setState(() {
                    _method = s.first;
                    // Card and mobile money can't be more than due.
                    if (_method != PayMethod.cash && (entry?.amount ?? 0) > dueNow && dueNow > 0) _amount.text = fromCents(dueNow);
                  }),
                ),
                if (catalog.currencies.length > 1) ...[
                  const SizedBox(height: 10),
                  SegmentedButton<String>(
                    segments: [for (final c in catalog.currencies) ButtonSegment(value: c.code, label: Text(c.code))],
                    selected: {_currency.code},
                    showSelectedIcon: false,
                    onSelectionChanged: (s) => setState(() {
                      _currency = catalog.currency(s.first);
                      _fillRemaining();
                    }),
                  ),
                ],
                const SizedBox(height: 14),
                AmountField(
                  controller: _amount,
                  label: _method == PayMethod.cash ? 'Cash handed over' : 'Amount',
                  prefix: _currency.label,
                  autofocus: isWide(context),
                  onChanged: (_) => setState(() {}),
                  onSubmitted: (_) => result.complete && !_busy ? _complete() : null,
                ),
                if (_method == PayMethod.cash && dueNow > 0) ...[
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final a in _quickAmounts(dueNow))
                        ActionChip(
                          label: Text(a == dueNow ? 'Exact ${formatMoney(a, _currency.label)}' : formatMoney(a, _currency.label), style: tabular),
                          onPressed: () => setState(() => _amount.text = fromCents(a)),
                        ),
                    ],
                  ),
                ],
                if (_method != PayMethod.cash) ...[
                  const SizedBox(height: 10),
                  TextField(
                    controller: _reference,
                    decoration: InputDecoration(labelText: _method == PayMethod.mobile ? 'Transaction reference (optional)' : 'Reference (optional)'),
                  ),
                ],
                const SizedBox(height: 16),
                _Outcome(result: result, cart: _cart, entryCurrency: _currency),
                const SizedBox(height: 16),
                if (entry != null && !result.complete && result.problem == null)
                  OutlinedButton.icon(
                    onPressed: _addSplit,
                    icon: const Icon(Icons.call_split),
                    label: Text('Add ${formatMoney(entry.amount, entry.currency.label)} and take the rest another way'),
                  ),
                const SizedBox(height: 10),
                FilledButton(
                  onPressed: result.complete && !_busy ? _complete : null,
                  child: _busy
                      ? const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white))
                      : const Text('Complete sale'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

IconData _methodIcon(PayMethod m) => switch (m) {
  PayMethod.cash => Icons.payments_outlined,
  PayMethod.card => Icons.credit_card,
  PayMethod.mobile => Icons.phone_android,
  PayMethod.bank => Icons.account_balance_outlined,
};

class _Outcome extends StatelessWidget {
  const _Outcome({required this.result, required this.cart, required this.entryCurrency});

  final Settlement result;
  final PricedCart cart;
  final Currency entryCurrency;

  @override
  Widget build(BuildContext context) {
    final (String label, String value, Color bg, Color fg) = switch (result) {
      Settlement(problem: final String p) => (
        'Can\'t take this',
        p,
        Theme.of(context).colorScheme.errorContainer,
        Theme.of(context).colorScheme.onErrorContainer,
      ),
      Settlement(complete: false) => (
        'Still to pay',
        formatMoney(inCurrency(result.remainingBase, entryCurrency, cart), entryCurrency.label),
        Brand.amberSoft,
        Brand.amberInk,
      ),
      Settlement(change: > 0) => ('Change to give', formatMoney(result.change, result.changeCurrency!.label), Brand.ledgerSoft, Brand.ledgerDeep),
      _ => ('Paid in full', 'No change', Brand.ledgerSoft, Brand.ledgerDeep),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(14)),
      child: Row(
        children: [
          Text(
            label,
            style: TextStyle(color: fg, fontWeight: FontWeight.w600),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: tabular.copyWith(color: fg, fontSize: 22, fontWeight: FontWeight.w800),
            ),
          ),
        ],
      ),
    );
  }
}
