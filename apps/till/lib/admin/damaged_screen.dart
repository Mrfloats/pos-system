import 'package:flutter/material.dart';

import '../core/money.dart';
import '../theme.dart';
import 'admin_widgets.dart';
import 'inventory_screens.dart';
import 'paged_list.dart';

/// Damaged, expired and spoiled stock written off: the history, and recording more.
class DamagedStockScreen extends StatefulWidget {
  const DamagedStockScreen({super.key});

  @override
  State<DamagedStockScreen> createState() => _DamagedStockScreenState();
}

class _DamagedStockScreenState extends State<DamagedStockScreen> {
  late final PagedLoader _loader = PagedLoader(_fetch);
  String _search = '';
  String? _storeId;
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final admin = AdminScope.of(context);
    if (!_started || admin.storeId != _storeId) {
      _storeId = admin.storeId;
      _loader.reload();
    }
    _started = true;
  }

  @override
  void dispose() {
    _loader.dispose();
    super.dispose();
  }

  Future<Map<String, dynamic>> _fetch(int page, int pageSize) async {
    final admin = AdminScope.read(context);
    final res = await admin.fetch(
      '/inventory/movements',
      query: {'type': 'waste', 'page': '$page', 'pageSize': '$pageSize', 'storeId': ?admin.storeId, if (_search.isNotEmpty) 'search': _search},
    );
    return (res as Map).cast();
  }

  /// Choose the item (search or scan), then say how many and why.
  Future<void> _record() async {
    final done = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => const _PickDamagedItem()));
    if (done == true) _loader.reload(keep: true);
  }

  @override
  Widget build(BuildContext context) {
    final admin = AdminScope.of(context);
    final scheme = Theme.of(context).colorScheme;
    final header = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
          child: SearchBox(
            hint: 'Search by product',
            onChanged: (v) {
              _search = v;
              _loader.reload();
            },
          ),
        ),
        ListenableBuilder(
          listenable: _loader,
          builder: (context, _) => Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 6),
            child: Text(
              _loader.first == null ? '' : '${_loader.total} write-off${_loader.total == 1 ? '' : 's'} · ${admin.currentStore?.name ?? 'All stores'}',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: scheme.onSurfaceVariant),
            ),
          ),
        ),
      ],
    );
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: PagedListView(
        loader: _loader,
        header: header,
        empty: EmptyState(
          icon: Icons.heart_broken_outlined,
          title: 'Nothing written off',
          message: _search.isNotEmpty ? 'Nothing matches "$_search".' : 'Damaged and expired stock you record shows here.',
        ),
        itemBuilder: (context, m) => _WriteOffRow(move: m, showStore: admin.storeId == null),
      ),
      floatingActionButton: admin.session!.can('damaged.record')
          ? FloatingActionButton.extended(onPressed: _record, icon: const Icon(Icons.add), label: const Text('Record damaged'))
          : null,
    );
  }
}

class _WriteOffRow extends StatelessWidget {
  const _WriteOffRow({required this.move, required this.showStore});

  final Map<String, dynamic> move;
  final bool showStore;

  @override
  Widget build(BuildContext context) {
    final admin = AdminScope.of(context);
    final scheme = Theme.of(context).colorScheme;
    final q = -parseFixed(move['quantity'], 3);
    final cost = move['unitCost'] == null ? null : (toCents(move['unitCost']) * q) ~/ 1000;
    final details = [
      shortDateTime(move['createdAt']),
      if (showStore) move['storeName'] as String,
      if (move['createdByName'] != null) move['createdByName'] as String,
    ].join(' · ');
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 2, right: 12),
            child: Icon(Icons.heart_broken_outlined, size: 20, color: scheme.error),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(itemName(move), overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
                if (move['note'] != null) Text(move['note'] as String, style: const TextStyle(fontSize: 13.5)),
                Text(details, style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant)),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text('−${formatQty(q)}', style: tabular.copyWith(fontWeight: FontWeight.w700, fontSize: 16, color: scheme.error)),
              if (cost != null) Text('${formatMoney(cost, admin.symbol)} at cost', style: tabular.copyWith(fontSize: 12, color: scheme.onSurfaceVariant)),
            ],
          ),
        ],
      ),
    );
  }
}

/// Step one of recording damaged stock: find the item.
class _PickDamagedItem extends StatelessWidget {
  const _PickDamagedItem();

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Which item?')),
    body: ItemList(
      onPick: (context, item, reload) async {
        final admin = AdminScope.read(context);
        final full = (await admin.fetch('/inventory/items/${item['variantId']}') as Map).cast<String, dynamic>();
        if (!context.mounted) return;
        final done = await showModalBottomSheet<bool>(
          context: context,
          isScrollControlled: true,
          showDragHandle: true,
          builder: (_) => StockMoveSheet(item: full, damaged: true),
        );
        if (done == true && context.mounted) Navigator.pop(context, true);
      },
    ),
  );
}
