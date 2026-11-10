import 'package:flutter/material.dart';

import '../core/money.dart';
import '../theme.dart';
import 'admin_widgets.dart';

const _methodLabels = {'cash': 'Cash', 'card': 'Card', 'mobile': 'Mobile money', 'bank': 'Bank transfer'};

/// Today at a glance: takings, how that compares, what's selling and what's running low.
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  Map<String, dynamic>? _data;
  Object? _error;
  bool _loading = false;

  /// The branch [_data] is for ('' = all of them).
  String? _loadedFor;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Loads at first, and again when another branch is chosen.
    final store = AdminScope.of(context).storeId ?? '';
    if (store != _loadedFor) {
      _loadedFor = store;
      _data = null;
      _load();
    }
  }

  Future<void> _load() async {
    final admin = AdminScope.read(context);
    final store = admin.storeId;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await admin.call((api) => api.get('/dashboard', query: {'storeId': ?store})) as Map;
      if (!mounted || (admin.storeId ?? '') != (store ?? '')) return;
      setState(() {
        _data = res.cast();
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 720),
              child: data == null
                  ? (_error != null && !_loading ? ErrorState(error: _error!, onRetry: _load) : const _Loading())
                  : _Summary(data: data, stale: _error),
            ),
          ),
        ],
      ),
    );
  }
}

class _Loading extends StatelessWidget {
  const _Loading();

  @override
  Widget build(BuildContext context) => const Column(
    children: [
      SkeletonCard(lines: 2),
      SizedBox(height: 12),
      Row(
        children: [
          Expanded(child: SkeletonCard(lines: 1)),
          SizedBox(width: 12),
          Expanded(child: SkeletonCard(lines: 1)),
        ],
      ),
      SizedBox(height: 12),
      SkeletonCard(lines: 4),
      SizedBox(height: 12),
      SkeletonCard(lines: 3),
    ],
  );
}

class _Summary extends StatelessWidget {
  const _Summary({required this.data, this.stale});

  final Map<String, dynamic> data;

  /// Set when a refresh failed and these are the figures from before.
  final Object? stale;

  @override
  Widget build(BuildContext context) {
    final admin = AdminScope.of(context);
    final scheme = Theme.of(context).colorScheme;
    final today = (data['today'] as Map).cast<String, dynamic>();
    final yesterday = (data['yesterday'] as Map).cast<String, dynamic>();
    final lastWeek = (data['lastWeek'] as Map).cast<String, dynamic>();
    final trend = (data['trend'] as List).cast<Map>();
    final top = (data['topProducts'] as List).cast<Map>();
    final methods = (data['paymentMethods'] as List).cast<Map>();
    final low = (data['lowStock'] as Map).cast<String, dynamic>();
    final lowItems = (low['items'] as List).cast<Map>();
    final lowTotal = low['total'] as int;
    final returns = today['returns'] as int;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (stale != null) ...[
          Material(
            color: Brand.amberSoft,
            borderRadius: BorderRadius.circular(12),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Text("Couldn't refresh: $stale", style: const TextStyle(color: Brand.amberInk)),
            ),
          ),
          const SizedBox(height: 12),
        ],
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  "Today's sales · ${shortDay(data['date'] as String)}",
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: scheme.onSurfaceVariant),
                ),
                const SizedBox(height: 6),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(admin.money(today['gross']), style: tabular.copyWith(fontSize: 38, fontWeight: FontWeight.w700, height: 1.1)),
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    _Change(percent: yesterday['changePercent'] as num?, versus: 'yesterday', amount: admin.money(yesterday['gross'])),
                    _Change(percent: lastWeek['changePercent'] as num?, versus: 'last ${weekdayOf(lastWeek['day'] as String)}', amount: admin.money(lastWeek['gross'])),
                  ],
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: _Stat(
                label: 'Transactions',
                value: '${today['sales']}',
                note: returns == 0 ? 'No returns' : '$returns return${returns == 1 ? '' : 's'}',
              ),
            ),
            const SizedBox(width: 12),
            Expanded(child: _Stat(label: 'Average basket', value: admin.money(today['averageBasket']), note: 'Per sale')),
          ],
        ),
        const SizedBox(height: 12),
        SectionCard(
          title: 'Sales, last 8 days',
          child: _TrendBars(days: trend, money: admin.money),
        ),
        const SizedBox(height: 12),
        SectionCard(
          title: 'Top products today',
          child: top.isEmpty
              ? const EmptyState(icon: Icons.shopping_basket_outlined, title: 'No sales yet today')
              : Column(
                  children: [
                    for (final (i, p) in top.indexed)
                      _Line(
                        leading: '${i + 1}',
                        title: p['name'] as String,
                        subtitle: '${formatQty(parseFixed(p['quantity'], 3))} sold',
                        value: admin.money(p['revenue']),
                      ),
                  ],
                ),
        ),
        if (methods.isNotEmpty) ...[
          const SizedBox(height: 12),
          SectionCard(
            title: 'How people paid today',
            child: Column(
              children: [
                for (final m in methods) _Line(title: _methodLabels[m['method']] ?? m['method'] as String, value: admin.money(m['amount'])),
              ],
            ),
          ),
        ],
        const SizedBox(height: 12),
        SectionCard(
          title: 'Low stock',
          trailing: lowTotal == 0
              ? null
              : Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.warning_amber_rounded, size: 16, color: Brand.amber),
                    const SizedBox(width: 4),
                    Text('$lowTotal item${lowTotal == 1 ? '' : 's'}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                  ],
                ),
          child: lowItems.isEmpty
              ? const EmptyState(icon: Icons.inventory_2_outlined, title: 'Nothing is running low', message: 'Items appear here when they reach their reorder level.')
              : Column(
                  children: [
                    for (final item in lowItems)
                      _Line(
                        title: item['name'] as String,
                        subtitle: 'Reorder at ${formatQty(parseFixed(item['reorderLevel'], 3))}',
                        value: '${formatQty(parseFixed(item['onHand'], 3))} left',
                      ),
                    if (lowTotal > lowItems.length)
                      Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text('and ${lowTotal - lowItems.length} more', style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13)),
                      ),
                  ],
                ),
        ),
        const SizedBox(height: 8),
        Text(
          'Returns are taken off. ${admin.currentStore?.name ?? 'All stores'}.',
          textAlign: TextAlign.center,
          style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12),
        ),
      ],
    );
  }
}

/// Up or down against an earlier day: an arrow and words, never colour alone.
class _Change extends StatelessWidget {
  const _Change({required this.percent, required this.versus, required this.amount});

  final num? percent;
  final String versus, amount;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final p = percent;
    final (icon, color, text) = p == null
        ? (Icons.remove, scheme.onSurfaceVariant, 'No sales $versus')
        : p > 0
        ? (Icons.arrow_upward, Brand.ledger, '${_pct(p)} up on $versus')
        : p < 0
        ? (Icons.arrow_downward, scheme.error, '${_pct(-p)} down on $versus')
        : (Icons.remove, scheme.onSurfaceVariant, 'Same as $versus');
    return Tooltip(
      message: '$amount $versus',
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(20)),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 15, color: color),
            const SizedBox(width: 4),
            Text(text, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: scheme.onSurface)),
          ],
        ),
      ),
    );
  }

  static String _pct(num p) => p >= 1000 ? '${(p / 100).toStringAsFixed(0)}×' : '${p.toStringAsFixed(p == p.roundToDouble() ? 0 : 1)}%';
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value, required this.note});

  final String label, value, note;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: scheme.onSurfaceVariant)),
            const SizedBox(height: 6),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(value, style: tabular.copyWith(fontSize: 24, fontWeight: FontWeight.w700)),
            ),
            const SizedBox(height: 2),
            Text(note, style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant)),
          ],
        ),
      ),
    );
  }
}

class _Line extends StatelessWidget {
  const _Line({this.leading, required this.title, this.subtitle, required this.value});

  final String? leading;
  final String title;
  final String? subtitle;
  final String value;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        children: [
          if (leading != null) SizedBox(width: 24, child: Text(leading!, style: tabular.copyWith(color: scheme.onSurfaceVariant, fontWeight: FontWeight.w600))),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w500)),
                if (subtitle != null) Text(subtitle!, style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant)),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Text(value, style: tabular.copyWith(fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}

/// One bar a day, today's the solid one. Tap a bar for its figure.
class _TrendBars extends StatefulWidget {
  const _TrendBars({required this.days, required this.money});

  final List<Map> days;
  final String Function(Object?) money;

  @override
  State<_TrendBars> createState() => _TrendBarsState();
}

class _TrendBarsState extends State<_TrendBars> {
  int? _picked;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final days = widget.days;
    final values = [for (final d in days) toCents(d['gross'])];
    final max = values.fold<int>(0, (m, v) => v > m ? v : m);
    final shown = _picked ?? days.length - 1;
    final picked = days[shown];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          '${shortDay(picked['day'] as String)} · ${widget.money(picked['gross'])} · ${picked['sales']} sale${picked['sales'] == 1 ? '' : 's'}',
          style: tabular.copyWith(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 12),
        SizedBox(
          // The bars, the baseline and a line of day names under it.
          height: 156,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              for (final (i, d) in days.indexed)
                Expanded(
                  child: Semantics(
                    label: '${shortDay(d['day'] as String)}: ${widget.money(d['gross'])}',
                    button: true,
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: () => setState(() => _picked = i),
                      child: Column(
                        children: [
                          // The bar takes its share of whatever height is left above the day names.
                          Expanded(
                            child: Padding(
                              // The gap between bars is the card showing through.
                              padding: const EdgeInsets.symmetric(horizontal: 3),
                              child: FractionallySizedBox(
                                alignment: Alignment.bottomCenter,
                                widthFactor: 1,
                                heightFactor: max <= 0 || values[i] <= 0 ? 0.015 : (values[i] / max).clamp(0.03, 1.0).toDouble(),
                                child: DecoratedBox(
                                  decoration: BoxDecoration(
                                    color: i == shown ? scheme.primary : scheme.primary.withValues(alpha: 0.35),
                                    borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
                                  ),
                                ),
                              ),
                            ),
                          ),
                          Container(height: 1, color: scheme.outlineVariant),
                          const SizedBox(height: 5),
                          Text(
                            i == days.length - 1 ? 'Today' : weekdayOf(d['day'] as String),
                            maxLines: 1,
                            softWrap: false,
                            overflow: TextOverflow.fade,
                            style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant, fontWeight: i == shown ? FontWeight.w700 : FontWeight.w400),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}
