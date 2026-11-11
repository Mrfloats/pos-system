import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';

import '../core/api.dart';
import '../core/money.dart';
import '../screens/scanner_screen.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'admin_widgets.dart';
import 'paged_list.dart';
import 'pin_confirm.dart';

const _uuid = Uuid();

/// "Tea · 100 bags", or just "Tea" for a product with one kind.
String itemName(Map item) {
  final variant = item['variantName'] as String?;
  return variant == null || variant == 'Default' ? item['productName'] as String : '${item['productName']} · $variant';
}

/// Thousandths of a unit as people say them: "12", "2.5".
String qty(Object? v) => formatQty(parseFixed(v, 3));

bool _isLow(Map item) {
  final reorder = item['reorderLevel'];
  return reorder != null && parseFixed(item['onHand'], 3) <= parseFixed(reorder, 3);
}

/// Stock levels: search or scan, low stock, and each item's own page.
class InventoryScreen extends StatelessWidget {
  const InventoryScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final admin = AdminScope.of(context);
    final canAdd = admin.session!.can('products.edit');
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: ItemList(
        onPick: (context, item, reload) async {
          await Navigator.push(context, MaterialPageRoute(builder: (_) => ItemScreen(variantId: item['variantId'] as String)));
          reload();
        },
      ),
      floatingActionButton: canAdd
          ? FloatingActionButton.extended(
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const AddProductScreen())),
              icon: const Icon(Icons.add),
              label: const Text('Add product'),
            )
          : null,
    );
  }
}

/// Searchable stock list. Tapping an item calls [onPick]; a scanned barcode opens that item.
class ItemList extends StatefulWidget {
  const ItemList({super.key, required this.onPick, this.lowStockFirst = false});

  /// [reload] refreshes the list (after the item was changed).
  final Future<void> Function(BuildContext context, Map<String, dynamic> item, VoidCallback reload) onPick;
  final bool lowStockFirst;

  @override
  State<ItemList> createState() => _ItemListState();
}

class _ItemListState extends State<ItemList> {
  late final PagedLoader _loader = PagedLoader(_fetch);
  String _search = '';
  late bool _lowOnly = widget.lowStockFirst;
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
      '/inventory/levels',
      query: {'page': '$page', 'pageSize': '$pageSize', 'storeId': ?admin.storeId, if (_search.isNotEmpty) 'search': _search, if (_lowOnly) 'lowStock': 'true'},
    );
    return (res as Map).cast();
  }

  Future<void> _scan() async {
    final code = await Navigator.push<String>(context, MaterialPageRoute(builder: (_) => const ScannerScreen()));
    if (code == null || !mounted) return;
    final admin = AdminScope.read(context);
    try {
      final found = await admin.fetch('/products/barcode/${Uri.encodeComponent(code)}') as Map;
      if (!mounted) return;
      final variantId = found['variantId'] as String;
      final product = (found['product'] as Map).cast<String, dynamic>();
      final variant = (product['variants'] as List).cast<Map>().firstWhere((v) => v['id'] == variantId);
      await widget.onPick(context, {'variantId': variantId, 'productName': product['name'], 'variantName': variant['name']}, () => _loader.reload(keep: true));
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.status == 404) {
        final canAdd = admin.session!.can('products.edit');
        final add = canAdd && await confirm(context, title: 'Not found', message: 'No item has the barcode $code. Add a new product with it?', yes: 'Add product');
        if (add && mounted) await Navigator.push(context, MaterialPageRoute(builder: (_) => AddProductScreen(barcode: code)));
        if (!canAdd && mounted) showMessage(context, 'No item has the barcode $code', error: true);
      } else {
        showMessage(context, e.message, error: true);
      }
    }
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
            hint: 'Name, SKU or barcode',
            onChanged: (v) {
              _search = v;
              _loader.reload();
            },
            trailing: hasCameraScanner ? IconButton(tooltip: 'Scan a barcode', icon: const Icon(Icons.qr_code_scanner), onPressed: _scan) : null,
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
          child: Row(
            children: [
              FilterChip(
                avatar: Icon(Icons.warning_amber_rounded, size: 16, color: _lowOnly ? scheme.primary : Brand.amber),
                label: const Text('Low stock only'),
                selected: _lowOnly,
                showCheckmark: false,
                onSelected: (v) {
                  setState(() => _lowOnly = v);
                  _loader.reload();
                },
              ),
            ],
          ),
        ),
        ListenableBuilder(
          listenable: _loader,
          builder: (context, _) => Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 6),
            child: Text(
              _loader.first == null ? '' : '${_loader.total} item${_loader.total == 1 ? '' : 's'} · ${admin.currentStore?.name ?? 'All stores together'}',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: scheme.onSurfaceVariant),
            ),
          ),
        ),
      ],
    );
    return PagedListView(
      loader: _loader,
      header: header,
      empty: EmptyState(
        icon: _lowOnly ? Icons.check_circle_outline : Icons.inventory_2_outlined,
        title: _lowOnly ? 'Nothing is running low' : 'No items found',
        message: _search.isNotEmpty ? 'Nothing matches "$_search".' : (_lowOnly ? 'Items show here when they reach their reorder level.' : 'Items that keep stock show here.'),
      ),
      itemBuilder: (context, item) => _ItemRow(item: item, onTap: () => widget.onPick(context, item, () => _loader.reload(keep: true))),
    );
  }
}

class _ItemRow extends StatelessWidget {
  const _ItemRow({required this.item, required this.onTap});

  final Map<String, dynamic> item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final admin = AdminScope.of(context);
    final scheme = Theme.of(context).colorScheme;
    final low = _isLow(item);
    final onHand = parseFixed(item['onHand'], 3);
    final codes = [item['sku'], item['barcode']].whereType<String>().join(' · ');
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(itemName(item), overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
                  const SizedBox(height: 2),
                  Text(
                    [admin.money(item['price']), if (codes.isNotEmpty) codes].join(' · '),
                    overflow: TextOverflow.ellipsis,
                    style: tabular.copyWith(fontSize: 12.5, color: scheme.onSurfaceVariant),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  formatQty(onHand),
                  style: tabular.copyWith(fontWeight: FontWeight.w700, fontSize: 17, color: onHand < 0 ? scheme.error : null),
                ),
                if (low) const Tag(icon: Icons.warning_amber_rounded, label: 'Low', color: Brand.amberInk) else Text('in stock', style: TextStyle(fontSize: 11.5, color: scheme.onSurfaceVariant)),
              ],
            ),
            const SizedBox(width: 4),
            Icon(Icons.chevron_right, color: scheme.onSurfaceVariant.withValues(alpha: 0.6)),
          ],
        ),
      ),
    );
  }
}

const _movementLabels = {
  'opening': 'Opening stock',
  'receive': 'Received',
  'sale': 'Sold',
  'return': 'Returned by customer',
  'adjustment': 'Adjusted',
  'transfer_in': 'Transferred in',
  'transfer_out': 'Transferred out',
  'waste': 'Written off',
};

/// One item: what it sells for, how many are in each branch, its recent movements,
/// and the things a manager does to it.
class ItemScreen extends StatefulWidget {
  const ItemScreen({super.key, required this.variantId});

  final String variantId;

  @override
  State<ItemScreen> createState() => _ItemScreenState();
}

class _ItemScreenState extends State<ItemScreen> {
  Map<String, dynamic>? _item;
  List<Map>? _moves;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final admin = AdminScope.read(context);
    setState(() => _error = null);
    try {
      final results = await Future.wait([
        admin.fetch('/inventory/items/${widget.variantId}'),
        admin.fetch('/inventory/movements', query: {'variantId': widget.variantId, 'pageSize': '15', 'storeId': ?admin.storeId}),
      ]);
      if (!mounted) return;
      setState(() {
        _item = (results[0] as Map).cast();
        _moves = ((results[1] as Map)['items'] as List).cast<Map>();
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _changePrice() async {
    final admin = AdminScope.read(context);
    final item = _item!;
    final price = await showDialog<String>(context: context, builder: (_) => _PriceDialog(item: item, symbol: admin.symbol));
    final cents = price == null ? null : tryParseFixed(price, 2);
    if (cents == null || !mounted) return;
    if (cents == toCents(item['price'])) return;
    final done = await confirmWithPin<bool>(
      context,
      title: 'Confirm the new price',
      message: '${itemName(item)}: ${admin.money(item['price'])} → ${formatMoney(cents, admin.symbol)}.',
      action: (pin) async {
        await admin.call((api) => api.patch('/products/variants/${widget.variantId}', {'price': fromCents(cents)}), pin: pin);
        return true;
      },
    );
    if (done == true && mounted) {
      showMessage(context, 'Price changed to ${formatMoney(cents, admin.symbol)}');
      _load();
    }
  }

  Future<void> _editStockSettings() async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _StockSettingsSheet(item: _item!),
    );
    if (changed == true && mounted) _load();
  }

  Future<void> _move({required bool damaged}) async {
    final done = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => StockMoveSheet(item: _item!, damaged: damaged),
    );
    if (done == true && mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    final admin = AdminScope.of(context);
    final session = admin.session!;
    final scheme = Theme.of(context).colorScheme;
    final item = _item;
    return Scaffold(
      appBar: AppBar(title: Text(item == null ? 'Item' : itemName(item))),
      body: item == null
          ? (_error != null
                ? Center(child: ErrorState(error: _error!, onRetry: _load))
                : const Padding(
                    padding: EdgeInsets.all(16),
                    child: Column(children: [SkeletonCard(lines: 2), SizedBox(height: 12), SkeletonCard(lines: 3)]),
                  ))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                children: [
                  Narrow(
                    maxWidth: 560,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Card(
                          child: Padding(
                            padding: const EdgeInsets.all(18),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('In stock, all stores', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: scheme.onSurfaceVariant)),
                                Row(
                                  crossAxisAlignment: CrossAxisAlignment.end,
                                  children: [
                                    Text(qty(item['onHand']), style: tabular.copyWith(fontSize: 34, fontWeight: FontWeight.w700)),
                                    const SizedBox(width: 10),
                                    if (_isLow(item))
                                      const Padding(padding: EdgeInsets.only(bottom: 8), child: Tag(icon: Icons.warning_amber_rounded, label: 'Low', color: Brand.amberInk)),
                                  ],
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  [item['categoryName'], item['sku'], item['barcode']].whereType<String>().join(' · '),
                                  style: TextStyle(color: scheme.onSurfaceVariant),
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(height: 12),
                        Card(
                          child: Column(
                            children: [
                              ListTile(
                                leading: const Icon(Icons.sell_outlined),
                                title: const Text('Selling price'),
                                trailing: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Text(admin.money(item['price']), style: tabular.copyWith(fontWeight: FontWeight.w700, fontSize: 16)),
                                    if (session.can('products.price')) const Icon(Icons.chevron_right),
                                  ],
                                ),
                                onTap: session.can('products.price') ? _changePrice : null,
                              ),
                              const Divider(height: 1, indent: 56),
                              ListTile(
                                leading: const Icon(Icons.tune),
                                title: const Text('Cost and reorder level'),
                                subtitle: Text(
                                  'Cost ${item['costPrice'] == null ? 'not set' : admin.money(item['costPrice'])} · '
                                  '${item['reorderLevel'] == null ? 'no reorder level' : 'reorder at ${qty(item['reorderLevel'])}'}',
                                ),
                                trailing: session.can('products.edit') ? const Icon(Icons.chevron_right) : null,
                                onTap: session.can('products.edit') ? _editStockSettings : null,
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 12),
                        if (session.can('inventory.adjust') || session.can('damaged.record'))
                          Row(
                            children: [
                              if (session.can('inventory.adjust'))
                                Expanded(
                                  child: FilledButton.tonalIcon(onPressed: () => _move(damaged: false), icon: const Icon(Icons.exposure), label: const Text('Adjust stock')),
                                ),
                              if (session.can('inventory.adjust') && session.can('damaged.record')) const SizedBox(width: 10),
                              if (session.can('damaged.record'))
                                Expanded(
                                  child: OutlinedButton.icon(onPressed: () => _move(damaged: true), icon: const Icon(Icons.heart_broken_outlined), label: const Text('Damaged')),
                                ),
                            ],
                          ),
                        const SizedBox(height: 12),
                        SectionCard(
                          title: 'By store',
                          child: Column(
                            children: [
                              for (final s in (item['stores'] as List).cast<Map>())
                                Padding(
                                  padding: const EdgeInsets.symmetric(vertical: 6),
                                  child: Row(
                                    children: [
                                      Icon(s['storeType'] == 'warehouse' ? Icons.warehouse_outlined : Icons.storefront_outlined, size: 20, color: scheme.onSurfaceVariant),
                                      const SizedBox(width: 10),
                                      Expanded(
                                        child: Text(
                                          s['storeName'] as String,
                                          style: TextStyle(fontWeight: s['storeId'] == admin.storeId ? FontWeight.w700 : FontWeight.w500),
                                        ),
                                      ),
                                      Text(qty(s['onHand']), style: tabular.copyWith(fontWeight: FontWeight.w600)),
                                    ],
                                  ),
                                ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 12),
                        SectionCard(
                          title: admin.currentStore == null ? 'Recent movements' : 'Recent movements, ${admin.currentStore!.name}',
                          child: _moves!.isEmpty
                              ? const EmptyState(icon: Icons.swap_vert, title: 'No movements yet')
                              : Column(children: [for (final m in _moves!) _MovementRow(move: m, showStore: admin.storeId == null)]),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

class _MovementRow extends StatelessWidget {
  const _MovementRow({required this.move, required this.showStore});

  final Map move;
  final bool showStore;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final q = parseFixed(move['quantity'], 3);
    final details = [
      shortDateTime(move['createdAt']),
      if (showStore) move['storeName'] as String,
      if (move['createdByName'] != null) move['createdByName'] as String,
    ].join(' · ');
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_movementLabels[move['type']] ?? move['type'] as String, style: const TextStyle(fontWeight: FontWeight.w500)),
                Text(details, style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant)),
                if (move['note'] != null) Text(move['note'] as String, style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant, fontStyle: FontStyle.italic)),
              ],
            ),
          ),
          Text('${q > 0 ? '+' : ''}${formatQty(q)}', style: tabular.copyWith(fontWeight: FontWeight.w700, color: q < 0 ? scheme.error : Brand.ledger)),
        ],
      ),
    );
  }
}

const _adjustReasons = ['Counted again', 'Found', 'Missing or stolen', 'Delivered without paperwork', 'Other'];
const damagedReasons = ['Damaged', 'Expired', 'Spoiled', 'Other'];

/// Puts stock up or down with a reason, or writes off damaged stock, in one store.
class StockMoveSheet extends StatefulWidget {
  const StockMoveSheet({super.key, required this.item, this.damaged = false});

  final Map<String, dynamic> item;

  /// Writing off damaged stock, rather than adjusting it up or down.
  final bool damaged;

  @override
  State<StockMoveSheet> createState() => _StockMoveSheetState();
}

class _StockMoveSheetState extends State<StockMoveSheet> {
  final _qty = TextEditingController();
  final _note = TextEditingController();
  bool _add = true;
  String? _reason;
  String? _storeId;
  bool _busy = false;
  String? _error;

  bool get _damaged => widget.damaged;
  List<Map> get _stores => (widget.item['stores'] as List).cast<Map>();

  @override
  void initState() {
    super.initState();
    final chosen = AdminScope.read(context).storeId;
    _storeId = _stores.any((s) => s['storeId'] == chosen) ? chosen : (_stores.where((s) => s['storeType'] != 'warehouse').firstOrNull ?? _stores.firstOrNull)?['storeId'] as String?;
  }

  @override
  void dispose() {
    _qty.dispose();
    _note.dispose();
    super.dispose();
  }

  int get _onHandHere => parseFixed(_stores.where((s) => s['storeId'] == _storeId).firstOrNull?['onHand'], 3);

  Future<void> _save() async {
    final amount = tryParseFixed(_qty.text, 3);
    final note = _note.text.trim();
    final error = _storeId == null
        ? 'Choose a store'
        : amount == null || amount <= 0
        ? 'Enter how many'
        : _reason == null
        ? 'Choose a reason'
        : _reason == 'Other' && note.isEmpty
        ? 'Say what happened'
        : null;
    if (error != null) {
      setState(() => _error = error);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final signed = _damaged || _add ? amount! : -amount!;
    final reason = _reason == 'Other' ? note : (note.isEmpty ? _reason! : '$_reason: $note');
    try {
      final what = _damaged ? '${formatQty(amount)} written off' : 'Stock ${_add ? 'up' : 'down'} by ${formatQty(amount)}';
      // Offline, it waits on the phone and uploads when the connection is back.
      final sent = await AdminScope.read(context).sendOrQueue(
        '/inventory/movements',
        {
          'storeId': _storeId,
          'type': _damaged ? 'waste' : 'adjustment',
          'note': reason,
          'lines': [
            {'variantId': widget.item['variantId'], 'quantity': formatFixed(signed, 3), 'clientId': _uuid.v7()},
          ],
        },
        label: '${itemName(widget.item)}: ${what.toLowerCase()}',
      );
      if (!mounted) return;
      showMessage(context, sent ? what : '$what. No connection: saved on this phone, it uploads when you\'re back online.');
      Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = e.message;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final amount = tryParseFixed(_qty.text, 3) ?? 0;
    final taking = _damaged || !_add;
    final after = _onHandHere + (taking ? -amount : amount);
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(_damaged ? 'Record damaged stock' : 'Adjust stock', style: Theme.of(context).textTheme.titleLarge!.copyWith(fontWeight: FontWeight.w700)),
            Text(itemName(widget.item), style: TextStyle(color: scheme.onSurfaceVariant)),
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              initialValue: _storeId,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Store'),
              items: [
                for (final s in _stores) DropdownMenuItem(value: s['storeId'] as String, child: Text('${s['storeName']} (${qty(s['onHand'])} in stock)', overflow: TextOverflow.ellipsis)),
              ],
              onChanged: _busy ? null : (v) => setState(() => _storeId = v),
            ),
            const SizedBox(height: 12),
            if (!_damaged) ...[
              SegmentedButton<bool>(
                segments: const [
                  ButtonSegment(value: true, label: Text('Add'), icon: Icon(Icons.add)),
                  ButtonSegment(value: false, label: Text('Remove'), icon: Icon(Icons.remove)),
                ],
                selected: {_add},
                onSelectionChanged: _busy ? null : (v) => setState(() => _add = v.first),
              ),
              const SizedBox(height: 12),
            ],
            AmountField(controller: _qty, label: _damaged ? 'How many are damaged' : 'How many', decimals: 3, autofocus: true, onChanged: (_) => setState(() {})),
            if (amount > 0)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  'Leaves ${formatQty(after)} in this store${after < 0 ? " — that's fewer than none; check the count" : ''}.',
                  style: TextStyle(fontSize: 13, color: after < 0 ? scheme.error : scheme.onSurfaceVariant),
                ),
              ),
            const SizedBox(height: 14),
            Text('Reason', style: TextStyle(fontWeight: FontWeight.w600, color: scheme.onSurfaceVariant)),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final r in _damaged ? damagedReasons : _adjustReasons)
                  ChoiceChip(label: Text(r), selected: _reason == r, onSelected: _busy ? null : (_) => setState(() => _reason = r)),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _note,
              enabled: !_busy,
              maxLength: 200,
              decoration: InputDecoration(labelText: _reason == 'Other' ? 'What happened' : 'Note (optional)', counterText: ''),
            ),
            if (_error != null) ...[const SizedBox(height: 10), Text(_error!, style: TextStyle(color: scheme.error))],
            const SizedBox(height: 16),
            FilledButton(
              style: _damaged ? FilledButton.styleFrom(backgroundColor: scheme.error, foregroundColor: scheme.onError) : null,
              onPressed: _busy ? null : _save,
              child: _busy
                  ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2.4))
                  : Text(_damaged ? 'Write off' : 'Save'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Step one of a price change: the new price. (The PIN comes next.)
class _PriceDialog extends StatefulWidget {
  const _PriceDialog({required this.item, required this.symbol});

  final Map<String, dynamic> item;
  final String symbol;

  @override
  State<_PriceDialog> createState() => _PriceDialogState();
}

class _PriceDialogState extends State<_PriceDialog> {
  late final _text = TextEditingController(text: fromCents(toCents(widget.item['price'])));

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Selling price'),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('${itemName(widget.item)}, in every store without a price of its own.'),
        const SizedBox(height: 12),
        AmountField(controller: _text, label: 'New price', prefix: widget.symbol, autofocus: true, onSubmitted: (v) => Navigator.pop(context, v)),
      ],
    ),
    actions: [
      TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
      FilledButton(onPressed: () => Navigator.pop(context, _text.text), child: const Text('Next')),
    ],
  );
}

/// Cost price and reorder level: no PIN needed, they don't change what customers pay.
class _StockSettingsSheet extends StatefulWidget {
  const _StockSettingsSheet({required this.item});

  final Map<String, dynamic> item;

  @override
  State<_StockSettingsSheet> createState() => _StockSettingsSheetState();
}

class _StockSettingsSheetState extends State<_StockSettingsSheet> {
  late final _cost = TextEditingController(text: widget.item['costPrice'] == null ? '' : fromCents(toCents(widget.item['costPrice'])));
  late final _reorder = TextEditingController(text: widget.item['reorderLevel'] == null ? '' : qty(widget.item['reorderLevel']));
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _cost.dispose();
    _reorder.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final cost = _cost.text.trim().isEmpty ? null : tryParseFixed(_cost.text, 2);
    final reorder = _reorder.text.trim().isEmpty ? null : tryParseFixed(_reorder.text, 3);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await AdminScope.read(context).call(
        (api) => api.patch('/products/variants/${widget.item['variantId']}', {
          'costPrice': cost == null ? null : fromCents(cost),
          'reorderLevel': reorder == null ? null : formatFixed(reorder, 3),
        }),
      );
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = e.message;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final admin = AdminScope.of(context);
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Cost and reorder level', style: Theme.of(context).textTheme.titleLarge!.copyWith(fontWeight: FontWeight.w700)),
          Text(itemName(widget.item), style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
          const SizedBox(height: 16),
          AmountField(controller: _cost, label: 'Cost price', prefix: admin.symbol),
          const SizedBox(height: 12),
          AmountField(controller: _reorder, label: 'Reorder when down to', decimals: 3),
          const SizedBox(height: 6),
          Text('Leave empty for no low-stock warning.', style: TextStyle(fontSize: 12.5, color: Theme.of(context).colorScheme.onSurfaceVariant)),
          if (_error != null) ...[const SizedBox(height: 10), Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))],
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _busy ? null : _save,
            child: _busy ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2.4)) : const Text('Save'),
          ),
        ],
      ),
    );
  }
}

/// A new stocked product with the basics: name, price, cost, codes, category, reorder level and opening stock.
class AddProductScreen extends StatefulWidget {
  const AddProductScreen({super.key, this.barcode});

  /// A barcode just scanned that no item has.
  final String? barcode;

  @override
  State<AddProductScreen> createState() => _AddProductScreenState();
}

class _AddProductScreenState extends State<AddProductScreen> {
  final _name = TextEditingController();
  final _price = TextEditingController();
  final _cost = TextEditingController();
  late final _barcode = TextEditingController(text: widget.barcode ?? '');
  final _sku = TextEditingController();
  final _reorder = TextEditingController();
  final _opening = TextEditingController();
  List<Map> _categories = const [];
  String? _categoryId;
  String? _storeId;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final admin = AdminScope.read(context);
    _storeId = admin.storeId ?? (admin.stores.where((s) => s.type != 'warehouse').firstOrNull ?? admin.stores.firstOrNull)?.id;
    admin.fetch('/categories', query: {'active': 'true'}).then((list) {
      if (mounted) setState(() => _categories = (list as List).cast<Map>());
    }, onError: (_) {});
  }

  @override
  void dispose() {
    for (final c in [_name, _price, _cost, _barcode, _sku, _reorder, _opening]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _scan() async {
    final code = await Navigator.push<String>(context, MaterialPageRoute(builder: (_) => const ScannerScreen()));
    if (code != null) setState(() => _barcode.text = code);
  }

  Future<void> _save() async {
    final admin = AdminScope.read(context);
    final price = tryParseFixed(_price.text, 2);
    final cost = _cost.text.trim().isEmpty ? null : tryParseFixed(_cost.text, 2);
    final reorder = _reorder.text.trim().isEmpty ? null : tryParseFixed(_reorder.text, 3);
    final opening = _opening.text.trim().isEmpty ? 0 : tryParseFixed(_opening.text, 3) ?? -1;
    final error = _name.text.trim().isEmpty
        ? 'Give it a name'
        : price == null
        ? 'Enter the selling price'
        : opening < 0
        ? 'Opening stock should be a number'
        : opening > 0 && _storeId == null
        ? 'Choose the store the opening stock is in'
        : null;
    if (error != null) {
      setState(() => _error = error);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final product = await admin.call(
        (api) => api.post('/products', {
          'name': _name.text.trim(),
          'categoryId': ?_categoryId,
          'variants': [
            {
              'price': fromCents(price!),
              if (cost != null) 'costPrice': fromCents(cost),
              if (_barcode.text.trim().isNotEmpty) 'barcode': _barcode.text.trim(),
              if (_sku.text.trim().isNotEmpty) 'sku': _sku.text.trim(),
              if (reorder != null) 'reorderLevel': formatFixed(reorder, 3),
            },
          ],
        }),
      ) as Map;
      final variantId = ((product['variants'] as List).first as Map)['id'] as String;
      if (opening > 0) {
        await admin.call(
          (api) => api.post('/inventory/movements', {
            'storeId': _storeId,
            'type': 'opening',
            'note': 'Added on the phone',
            'lines': [
              {'variantId': variantId, 'quantity': formatFixed(opening, 3), if (cost != null) 'unitCost': fromCents(cost), 'clientId': _uuid.v7()},
            ],
          }),
        );
      }
      if (!mounted) return;
      showMessage(context, '${_name.text.trim()} added');
      Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => ItemScreen(variantId: variantId)));
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = e.message;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final admin = AdminScope.of(context);
    final canStock = admin.session!.can('inventory.adjust');
    const gap = SizedBox(height: 12);
    return Scaffold(
      appBar: AppBar(title: const Text('Add product')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Narrow(
          maxWidth: 520,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(controller: _name, autofocus: widget.barcode == null, textCapitalization: TextCapitalization.sentences, decoration: const InputDecoration(labelText: 'Name')),
              gap,
              Row(
                children: [
                  Expanded(child: AmountField(controller: _price, label: 'Selling price', prefix: admin.symbol)),
                  const SizedBox(width: 12),
                  Expanded(child: AmountField(controller: _cost, label: 'Cost (optional)', prefix: admin.symbol)),
                ],
              ),
              gap,
              TextField(
                controller: _barcode,
                decoration: InputDecoration(
                  labelText: 'Barcode (optional)',
                  suffixIcon: hasCameraScanner ? IconButton(tooltip: 'Scan a barcode', icon: const Icon(Icons.qr_code_scanner), onPressed: _scan) : null,
                ),
              ),
              gap,
              TextField(controller: _sku, decoration: const InputDecoration(labelText: 'SKU (optional)')),
              gap,
              DropdownButtonFormField<String>(
                initialValue: _categoryId,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Category'),
                items: [
                  const DropdownMenuItem<String>(child: Text('No category')),
                  for (final c in _categories) DropdownMenuItem(value: c['id'] as String, child: Text(c['name'] as String)),
                ],
                onChanged: (v) => setState(() => _categoryId = v),
              ),
              gap,
              AmountField(controller: _reorder, label: 'Reorder when down to (optional)', decimals: 3),
              if (canStock) ...[
                const SizedBox(height: 20),
                Text('Opening stock', style: TextStyle(fontWeight: FontWeight.w600, color: Theme.of(context).colorScheme.onSurfaceVariant)),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(child: AmountField(controller: _opening, label: 'How many', decimals: 3)),
                    const SizedBox(width: 12),
                    Expanded(
                      flex: 2,
                      child: DropdownButtonFormField<String>(
                        initialValue: _storeId,
                        isExpanded: true,
                        decoration: const InputDecoration(labelText: 'In store'),
                        items: [for (final s in admin.stores) DropdownMenuItem(value: s.id, child: Text(s.name, overflow: TextOverflow.ellipsis))],
                        onChanged: (v) => setState(() => _storeId = v),
                      ),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 8),
              Text(
                'Tax, packs, variants and price lists can be set on the web backoffice.',
                style: TextStyle(fontSize: 12.5, color: Theme.of(context).colorScheme.onSurfaceVariant),
              ),
              if (_error != null) ...[const SizedBox(height: 12), Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))],
              const SizedBox(height: 16),
              FilledButton(
                onPressed: _busy ? null : _save,
                child: _busy ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2.4)) : const Text('Add product'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
