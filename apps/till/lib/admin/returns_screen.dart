import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/money.dart';
import '../models/sale.dart' show PayMethod;
import '../theme.dart';
import '../widgets/common.dart';
import 'admin_widgets.dart';
import 'paged_list.dart';
import 'pin_confirm.dart';
import 'sales_screens.dart';

/// Refund and void requests from the tills: the ones waiting, and the ones decided.
class ReturnsScreen extends StatefulWidget {
  const ReturnsScreen({super.key});

  @override
  State<ReturnsScreen> createState() => _ReturnsScreenState();
}

class _ReturnsScreenState extends State<ReturnsScreen> {
  // Kept here so switching tabs doesn't load them again.
  late final _waiting = PagedLoader((page, size) => _fetch('pending', page, size));
  late final _decided = PagedLoader((page, size) => _fetch('decided', page, size));
  String? _storeId;
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final admin = AdminScope.of(context);
    if (!_started || admin.storeId != _storeId) {
      _storeId = admin.storeId;
      _waiting.reload();
      _decided.reload();
    }
    _started = true;
  }

  @override
  void dispose() {
    _waiting.dispose();
    _decided.dispose();
    super.dispose();
  }

  Future<Map<String, dynamic>> _fetch(String status, int page, int pageSize) async {
    final admin = AdminScope.read(context);
    final res = await admin.call((api) => api.get('/sale-requests', query: {'status': status, 'page': '$page', 'pageSize': '$pageSize', 'storeId': ?admin.storeId}));
    return (res as Map).cast();
  }

  Future<void> _open(Map<String, dynamic> r) async {
    final decided = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => RequestScreen(request: r)));
    if (decided == true) {
      _waiting.reload(keep: true);
      _decided.reload(keep: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return DefaultTabController(
      length: 2,
      child: Column(
        children: [
          Material(
            color: scheme.surface,
            child: ListenableBuilder(
              listenable: _waiting,
              builder: (context, _) => TabBar(
                tabs: [
                  Tab(text: _waiting.first == null || _waiting.total == 0 ? 'Waiting' : 'Waiting (${_waiting.total})'),
                  const Tab(text: 'Decided'),
                ],
              ),
            ),
          ),
          Expanded(
            child: TabBarView(
              children: [
                PagedListView(
                  loader: _waiting,
                  empty: const EmptyState(icon: Icons.check_circle_outline, title: 'Nothing waiting', message: 'Refunds and voids cashiers ask for show here.'),
                  itemBuilder: (context, r) => _RequestRow(request: r, onTap: () => _open(r)),
                ),
                PagedListView(
                  loader: _decided,
                  empty: const EmptyState(icon: Icons.history, title: 'Nothing decided yet'),
                  itemBuilder: (context, r) => _RequestRow(request: r, onTap: () => _open(r)),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

String _title(Map r) => '${r['kind'] == 'refund' ? 'Refund' : 'Void'} of ${r['saleNumber']}';

class _RequestRow extends StatelessWidget {
  const _RequestRow({required this.request, required this.onTap});

  final Map<String, dynamic> request;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final admin = AdminScope.of(context);
    final scheme = Theme.of(context).colorScheme;
    final r = request;
    final refund = r['kind'] == 'refund';
    final items = (r['lines'] as List? ?? const []).cast<Map>().map((l) => '${l['name']} × ${formatQty(parseFixed(l['quantity'], 3))}').join(', ');
    final status = r['status'] as String;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 2, right: 12),
              child: Icon(refund ? Icons.undo : Icons.block, color: refund ? Brand.amberInk : scheme.error),
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Wrap(
                    spacing: 8,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(_title(r), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                      if (status == 'approved') const Tag(icon: Icons.check, label: 'Approved', color: Brand.ledger),
                      if (status == 'rejected') Tag(icon: Icons.close, label: 'Turned down', color: scheme.error),
                    ],
                  ),
                  Text('"${r['reason']}"', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13.5)),
                  if (items.isNotEmpty) Text(items, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant)),
                  Text(
                    [r['requestedByName'] ?? 'Someone', if (admin.storeId == null) r['storeName'], shortDateTime(r['createdAt'])].join(' · '),
                    style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 10),
            Text(admin.moneyIn(r['amount'], r['currencyCode'] as String), style: tabular.copyWith(fontWeight: FontWeight.w700, fontSize: 15)),
            Icon(Icons.chevron_right, color: scheme.onSurfaceVariant.withValues(alpha: 0.6)),
          ],
        ),
      ),
    );
  }
}

/// One request in full, with Approve (PIN) and Turn down (with a note).
class RequestScreen extends StatefulWidget {
  const RequestScreen({super.key, required this.request});

  final Map<String, dynamic> request;

  @override
  State<RequestScreen> createState() => _RequestScreenState();
}

class _RequestScreenState extends State<RequestScreen> {
  late Map<String, dynamic> _r = widget.request;
  bool _changed = false;
  bool _busy = false;

  bool get _refund => _r['kind'] == 'refund';

  Future<void> _approve() async {
    final admin = AdminScope.read(context);
    final amount = admin.moneyIn(_r['amount'], _r['currencyCode'] as String);
    final result = await confirmWithPin<Map<String, dynamic>>(
      context,
      title: _refund ? 'Approve the refund' : 'Approve the void',
      message: _refund
          ? '${_r['requestedByName'] ?? 'The cashier'} gives back $amount for ${_r['saleNumber']}. Stock goes back${_r['restock'] == true ? '' : ' (not: damaged)'} and the books are updated.'
          : '${_r['saleNumber']} ($amount) is voided: the stock goes back and the money comes out of the books.',
      action: (pin) async => ((await admin.call((api) => api.post('/sale-requests/${_r['id']}/approve', {}), pin: pin)) as Map).cast<String, dynamic>(),
    );
    if (result == null || !mounted) return;
    setState(() {
      _r = result;
      _changed = true;
    });
    showMessage(context, _refund ? 'Refund ${result['resultNumber']} made' : '${result['saleNumber']} voided');
  }

  Future<void> _reject() async {
    final note = await showDialog<String>(context: context, builder: (_) => const _RejectDialog());
    if (note == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final res = await AdminScope.read(context).call((api) => api.post('/sale-requests/${_r['id']}/reject', {'note': note})) as Map;
      if (!mounted) return;
      setState(() {
        _r = res.cast();
        _changed = true;
        _busy = false;
      });
      showMessage(context, 'Turned down. The cashier sees your note.');
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      showMessage(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final admin = AdminScope.of(context);
    final session = admin.session!;
    final scheme = Theme.of(context).colorScheme;
    final r = _r;
    final pending = r['status'] == 'pending';
    final mine = r['requestedBy'] == session.userId;
    final canDecide = pending && session.can('returns.approve') && !mine;
    final lines = (r['lines'] as List? ?? const []).cast<Map>();

    Widget info(String label, Object? value) => value == null
        ? const SizedBox.shrink()
        : Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(width: 104, child: Text(label, style: TextStyle(color: scheme.onSurfaceVariant))),
                Expanded(child: Text('$value', style: const TextStyle(fontWeight: FontWeight.w500))),
              ],
            ),
          );

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.pop(context, _changed);
      },
      child: Scaffold(
        appBar: AppBar(title: Text(_title(r))),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Narrow(
              maxWidth: 560,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _StatusCard(request: r),
                  const SizedBox(height: 12),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(18),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(_refund ? 'To give back' : 'Sale total', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: scheme.onSurfaceVariant)),
                          Text(admin.moneyIn(r['amount'], r['currencyCode'] as String), style: tabular.copyWith(fontSize: 32, fontWeight: FontWeight.w700)),
                          const SizedBox(height: 8),
                          info('Why', '"${r['reason']}"'),
                          info('Asked by', r['requestedByName']),
                          info('When', shortDateTime(r['createdAt'])),
                          info('Store', r['storeName']),
                          info('Customer', r['customerName']),
                          if (_refund) info('Paid back by', PayMethod.parse(r['method'] as String?).label),
                          if (_refund) info('Stock', r['restock'] == true ? 'Goes back on the shelf' : 'Written off (damaged)'),
                        ],
                      ),
                    ),
                  ),
                  if (lines.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    SectionCard(
                      title: 'Coming back',
                      child: Column(
                        children: [
                          for (final l in lines)
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 5),
                              child: Row(
                                children: [
                                  Expanded(child: Text(l['name'] as String, style: const TextStyle(fontWeight: FontWeight.w500))),
                                  Text('× ${formatQty(parseFixed(l['quantity'], 3))}', style: tabular.copyWith(fontWeight: FontWeight.w600)),
                                ],
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => SaleDetailScreen(saleId: r['saleId'] as String))),
                    icon: const Icon(Icons.receipt_long_outlined),
                    label: Text('See sale ${r['saleNumber']}'),
                  ),
                  if (pending && mine) ...[
                    const SizedBox(height: 12),
                    Text('You asked for this, so someone else has to decide it.', textAlign: TextAlign.center, style: TextStyle(color: scheme.onSurfaceVariant)),
                  ],
                  if (canDecide) ...[
                    const SizedBox(height: 20),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            style: OutlinedButton.styleFrom(foregroundColor: scheme.error),
                            onPressed: _busy ? null : _reject,
                            icon: const Icon(Icons.close),
                            label: const Text('Turn down'),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: FilledButton.icon(onPressed: _busy ? null : _approve, icon: const Icon(Icons.check), label: const Text('Approve')),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.request});

  final Map<String, dynamic> request;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final r = request;
    final who = r['decidedByName'] ?? 'Someone';
    final when = shortDateTime(r['decidedAt']);
    final note = r['decisionNote'] as String?;
    final (IconData icon, Color bg, Color ink, String text) = switch (r['status']) {
      'pending' => (Icons.hourglass_top, Brand.amberSoft, Brand.amberInk, 'Waiting for a decision. The cashier has been told not to give money back yet.'),
      'approved' => (
        Icons.check_circle_outline,
        Brand.ledgerSoft,
        Brand.ledgerDeep,
        '$who approved it, $when.${r['resultNumber'] != null && r['kind'] == 'refund' ? ' Refund ${r['resultNumber']}.' : ''}${note == null ? '' : ' "$note"'}',
      ),
      'rejected' => (Icons.cancel_outlined, scheme.errorContainer, scheme.onErrorContainer, '$who turned it down, $when: "$note"'),
      _ => (Icons.undo, scheme.surfaceContainerHighest, scheme.onSurface, 'The cashier took it back.'),
    };
    return Material(
      color: bg,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Icon(icon, color: ink),
            const SizedBox(width: 10),
            Expanded(child: Text(text, style: TextStyle(color: ink))),
          ],
        ),
      ),
    );
  }
}

class _RejectDialog extends StatefulWidget {
  const _RejectDialog();

  @override
  State<_RejectDialog> createState() => _RejectDialogState();
}

class _RejectDialogState extends State<_RejectDialog> {
  final _note = TextEditingController();

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Turn down'),
    content: TextField(
      controller: _note,
      autofocus: true,
      maxLength: 300,
      minLines: 2,
      maxLines: 4,
      decoration: const InputDecoration(labelText: 'Tell the cashier why', counterText: ''),
      onChanged: (_) => setState(() {}),
    ),
    actions: [
      TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
      FilledButton(onPressed: _note.text.trim().isEmpty ? null : () => Navigator.pop(context, _note.text.trim()), child: const Text('Turn down')),
    ],
  );
}
