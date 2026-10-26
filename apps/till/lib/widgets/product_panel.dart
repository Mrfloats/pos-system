import 'package:flutter/material.dart';

import '../core/money.dart';
import '../models/catalog.dart';
import '../screens/scanner_screen.dart';
import '../theme.dart';
import 'common.dart';

/// Search or scan, pick a category, tap a product.
class ProductPanel extends StatefulWidget {
  const ProductPanel({super.key});

  @override
  State<ProductPanel> createState() => _ProductPanelState();
}

class _ProductPanelState extends State<ProductPanel> {
  final _search = TextEditingController();
  final _searchFocus = FocusNode();
  String? _categoryId;

  @override
  void dispose() {
    _search.dispose();
    _searchFocus.dispose();
    super.dispose();
  }

  /// Barcode scanners type the code and press Enter.
  void _submitted(String text) {
    final code = text.trim();
    if (code.isEmpty) return;
    final catalog = TillScope.read(context).catalog!;
    final hit = catalog.lookup(code);
    if (hit != null) {
      _add(hit.product, hit.variant);
      _search.clear();
    } else {
      final matches = catalog.search(code, categoryId: _categoryId);
      if (matches.length == 1 && matches.first.variants.length == 1) {
        _add(matches.first, matches.first.variants.first);
        _search.clear();
      } else if (matches.isEmpty) {
        showMessage(context, 'Nothing found for "$code"', error: true);
        _search.clear();
      }
    }
    setState(() {});
    _searchFocus.requestFocus();
  }

  Future<void> _scanWithCamera() async {
    final code = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => const ScannerScreen()));
    if (code != null && mounted) _submitted(code);
  }

  Future<void> _tap(Product p) async {
    var variant = p.variants.first;
    if (p.variants.length > 1) {
      final chosen = await _chooseVariant(p);
      if (chosen == null) return;
      variant = chosen;
    }
    if (!mounted) return;
    await _add(p, variant);
    // Keep the search box ready for the barcode scanner (on phones this would pop up the keyboard).
    if (mounted && isWide(context)) _searchFocus.requestFocus();
  }

  Future<void> _add(Product p, Variant v) async {
    final state = TillScope.read(context);
    var quantity = 1000;
    if (p.partQuantities) {
      final q = await askQuantity(context, p.nameOf(v), unit: p.unit);
      if (q == null) return;
      quantity = q;
    }
    state.addItem(p, v, quantity: quantity);
  }

  Future<Variant?> _chooseVariant(Product p) {
    final state = TillScope.read(context);
    final currency = state.saleCurrency;
    return showModalBottomSheet<Variant>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
              child: Text(p.name, style: Theme.of(context).textTheme.titleMedium!.copyWith(fontWeight: FontWeight.w600)),
            ),
            for (final v in p.variants)
              ListTile(
                title: Text(v.name),
                subtitle: v.sku == null ? null : Text(v.sku!),
                trailing: Text(formatMoney(currency.isBase ? v.price : fromBase(v.price, currency.rate), currency.label), style: tabular),
                onTap: () => Navigator.pop(context, v),
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = TillScope.of(context);
    final catalog = state.catalog!;
    final products = catalog.search(_search.text, categoryId: _categoryId);
    final topCategories = catalog.categories.where((c) => c.parentId == null || !catalog.categories.any((p) => p.id == c.parentId)).toList();
    final currency = state.saleCurrency;
    final scheme = Theme.of(context).colorScheme;

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 6),
          child: TextField(
            controller: _search,
            focusNode: _searchFocus,
            autofocus: isWide(context),
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: 'Scan a barcode or search products',
              prefixIcon: const Icon(Icons.qr_code_scanner),
              suffixIcon: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (_search.text.isNotEmpty) IconButton(tooltip: 'Clear', icon: const Icon(Icons.close), onPressed: () => setState(_search.clear)),
                  if (hasCameraScanner) IconButton(tooltip: 'Scan with camera', icon: const Icon(Icons.photo_camera_outlined), onPressed: _scanWithCamera),
                ],
              ),
              isDense: true,
            ),
            onChanged: (_) => setState(() {}),
            onSubmitted: _submitted,
          ),
        ),
        if (topCategories.isNotEmpty)
          SizedBox(
            height: 48,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              children: [
                _CategoryChip(label: 'All', selected: _categoryId == null, onTap: () => setState(() => _categoryId = null)),
                for (final c in topCategories)
                  _CategoryChip(
                    label: c.name,
                    color: parseColor(c.color),
                    selected: _categoryId == c.id,
                    onTap: () => setState(() => _categoryId = _categoryId == c.id ? null : c.id),
                  ),
              ],
            ),
          ),
        Expanded(
          child: products.isEmpty
              ? Center(
                  child: Text(
                    catalog.products.isEmpty ? 'No products yet. Add them in the backoffice.' : 'No products match',
                    style: TextStyle(color: scheme.onSurfaceVariant),
                  ),
                )
              : GridView.builder(
                  padding: const EdgeInsets.fromLTRB(12, 6, 12, 12),
                  gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                    maxCrossAxisExtent: 190,
                    mainAxisExtent: 112,
                    crossAxisSpacing: 10,
                    mainAxisSpacing: 10,
                  ),
                  itemCount: products.length,
                  itemBuilder: (context, i) {
                    final p = products[i];
                    final category = catalog.categories.where((c) => c.id == p.categoryId).firstOrNull;
                    return _ProductTile(product: p, currency: currency, color: parseColor(category?.color), onTap: () => _tap(p));
                  },
                ),
        ),
      ],
    );
  }
}

/// "#e8a317" → a colour, or null.
Color? parseColor(String? hex) {
  if (hex == null) return null;
  final h = hex.replaceFirst('#', '');
  if (h.length != 6) return null;
  final v = int.tryParse(h, radix: 16);
  return v == null ? null : Color(0xFF000000 | v);
}

/// Asks how much of something sold by weight or volume.
Future<int?> askQuantity(BuildContext context, String name, {String? unit, int? current}) {
  final controller = TextEditingController(text: current == null ? '' : formatQty(current));
  return showDialog<int>(
    context: context,
    builder: (context) {
      void done() {
        final q = tryParseFixed(controller.text, 3);
        if (q != null && q > 0) Navigator.pop(context, q);
      }

      return AlertDialog(
        title: Text(name),
        content: AmountField(
          controller: controller,
          label: 'Quantity${unit == null ? '' : ' ($unit)'}',
          autofocus: true,
          decimals: 3,
          onSubmitted: (_) => done(),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(onPressed: done, child: const Text('Add')),
        ],
      );
    },
  );
}

class _CategoryChip extends StatelessWidget {
  const _CategoryChip({required this.label, required this.selected, required this.onTap, this.color});

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: ChoiceChip(
        label: Text(label),
        selected: selected,
        onSelected: (_) => onTap(),
        avatar: color == null ? null : CircleAvatar(backgroundColor: color, radius: 6),
        showCheckmark: false,
      ),
    );
  }
}

class _ProductTile extends StatelessWidget {
  const _ProductTile({required this.product, required this.currency, required this.onTap, this.color});

  final Product product;
  final Currency currency;
  final VoidCallback onTap;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final prices = product.variants.map((v) => currency.isBase ? v.price : fromBase(v.price, currency.rate)).toList()..sort();
    final price = prices.first == prices.last ? formatMoney(prices.first, currency.label) : 'from ${formatMoney(prices.first, currency.label)}';
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(height: 5, color: color ?? Brand.ledger.withValues(alpha: 0.35)),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(
                        product.name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w600, height: 1.25),
                      ),
                    ),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            price,
                            style: tabular.copyWith(color: scheme.primary, fontWeight: FontWeight.w700),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (product.variants.length > 1) Icon(Icons.unfold_more, size: 16, color: scheme.onSurfaceVariant),
                        if (product.partQuantities) Icon(Icons.scale_outlined, size: 16, color: scheme.onSurfaceVariant),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
