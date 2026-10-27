import 'package:flutter/material.dart';

import '../core/money.dart';
import '../models/catalog.dart';
import '../theme.dart';
import 'common.dart';

String _price(int baseCents, Currency c) => formatMoney(c.isBase ? baseCents : fromBase(baseCents, c.rate), c.label);

/// Which variant, and whether singly or as a pack (a case of 24…).
Future<Sellable?> chooseOption(BuildContext context, Product p) {
  final currency = TillScope.read(context).saleCurrency;
  final scheme = Theme.of(context).colorScheme;
  return showModalBottomSheet<Sellable>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (context) => SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.8),
        child: ListView(
          shrinkWrap: true,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
              child: Text(p.name, style: Theme.of(context).textTheme.titleMedium!.copyWith(fontWeight: FontWeight.w600)),
            ),
            for (final v in p.variants) ...[
              ListTile(
                title: Text(v.name == 'Default' ? (v.packs.isEmpty ? p.name : 'Single') : v.name),
                subtitle: v.sku == null ? null : Text(v.sku!),
                trailing: Text(_price(v.price, currency), style: tabular.copyWith(fontWeight: FontWeight.w600)),
                onTap: () => Navigator.pop(context, (product: p, variant: v, pack: null)),
              ),
              for (final pack in v.packs)
                ListTile(
                  contentPadding: const EdgeInsetsDirectional.only(start: 36, end: 16),
                  leading: Icon(Icons.inventory_2_outlined, color: scheme.primary),
                  title: Text(pack.name),
                  subtitle: Text('${formatQty(pack.units)} × ${v.name == 'Default' ? p.name : v.name}'),
                  trailing: Text(_price(pack.price, currency), style: tabular.copyWith(fontWeight: FontWeight.w600)),
                  onTap: () => Navigator.pop(context, (product: p, variant: v, pack: pack)),
                ),
            ],
          ],
        ),
      ),
    ),
  );
}

/// Asks for the item's sides and extras. Required groups must be answered and
/// no group can have more than it allows. Returns null when cancelled.
Future<List<Choice>?> askChoices(BuildContext context, Product p, Variant v, Currency currency) {
  final picked = <String, List<Choice>>{for (final g in p.choiceGroups) g.id: []};
  final scheme = Theme.of(context).colorScheme;
  String rule(ChoiceGroup g) => switch ((g.minSelect, g.maxSelect)) {
    (1, 1) => 'Choose 1',
    (0, 1) => 'Optional, choose 1',
    (0, final max) => 'Optional, up to $max',
    (final min, final max) when min == max => 'Choose $min',
    (final min, final max) => 'Choose $min to $max',
  };

  return showModalBottomSheet<List<Choice>>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (context) => StatefulBuilder(
      builder: (context, setSheet) {
        final ready = p.choiceGroups.every((g) => picked[g.id]!.length >= g.minSelect);
        final extra = picked.values.expand((l) => l).fold(0, (a, c) => a + c.priceDelta);
        final each = v.price + extra;
        return SafeArea(
          child: ConstrainedBox(
            constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.85),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(p.name, style: Theme.of(context).textTheme.titleMedium!.copyWith(fontWeight: FontWeight.w600)),
                  Flexible(
                    child: SingleChildScrollView(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          for (final g in p.choiceGroups) ...[
                            const SizedBox(height: 14),
                            Row(
                              children: [
                                Text(g.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                                const SizedBox(width: 8),
                                Text(
                                  rule(g),
                                  style: TextStyle(fontSize: 12.5, color: picked[g.id]!.length < g.minSelect ? Brand.amberInk : scheme.onSurfaceVariant),
                                ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            Wrap(
                              spacing: 8,
                              runSpacing: 8,
                              children: [
                                for (final c in g.options)
                                  FilterChip(
                                    label: Text(c.priceDelta == 0 ? c.name : '${c.name}  ${c.priceDelta > 0 ? '+' : ''}${_price(c.priceDelta, currency)}'),
                                    selected: picked[g.id]!.any((x) => x.id == c.id),
                                    onSelected: (on) => setSheet(() {
                                      final list = picked[g.id]!;
                                      if (!on) {
                                        list.removeWhere((x) => x.id == c.id);
                                      } else if (g.maxSelect == 1) {
                                        list
                                          ..clear()
                                          ..add(c);
                                      } else if (list.length < g.maxSelect) {
                                        list.add(c);
                                      }
                                    }),
                                  ),
                              ],
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 18),
                  FilledButton(
                    onPressed: ready
                        ? () => Navigator.pop(context, [
                            // In the order they are offered, so the same choices always make the same line.
                            for (final g in p.choiceGroups)
                              for (final c in g.options)
                                if (picked[g.id]!.any((x) => x.id == c.id)) c,
                          ])
                        : null,
                    child: Text(ready ? 'Add · ${_price(each, currency)}' : 'Choose the required options'),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    ),
  );
}
