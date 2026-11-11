import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/money.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'admin_widgets.dart';
import 'report_data.dart';
import 'report_export.dart';

enum ReportKind {
  daily('Sales by day', Icons.calendar_view_day_outlined),
  products('Products', Icons.inventory_2_outlined),
  categories('Categories', Icons.category_outlined),
  cashiers('Cashiers', Icons.badge_outlined),
  profit('Profit', Icons.trending_up),
  stock('Stock value', Icons.warehouse_outlined);

  const ReportKind(this.label, this.icon);
  final String label;
  final IconData icon;
}

/// Days to report on, with the words for them.
class ReportPeriod {
  const ReportPeriod(this.label, this.from, this.to);

  final String label;
  final DateTime from, to;

  static DateTime get _today {
    final n = DateTime.now();
    return DateTime(n.year, n.month, n.day);
  }

  static ReportPeriod today() => ReportPeriod('Today', _today, _today);
  static ReportPeriod yesterday() {
    final d = _today.subtract(const Duration(days: 1));
    return ReportPeriod('Yesterday', d, d);
  }

  static ReportPeriod lastDays(int n) => ReportPeriod('Last $n days', _today.subtract(Duration(days: n - 1)), _today);
  static ReportPeriod thisMonth() => ReportPeriod('This month', DateTime(_today.year, _today.month), _today);
  static ReportPeriod lastMonth() {
    final first = DateTime(_today.year, _today.month - 1);
    return ReportPeriod('Last month', first, DateTime(_today.year, _today.month, 0));
  }

  String get describe => from == to ? shortDay(isoDay(from)) : '${shortDay(isoDay(from), weekday: false)} – ${shortDay(isoDay(to), weekday: false)} ${to.year}';
}

/// Sales by day, product, category or cashier, profit, and stock value: with
/// dates, a chart, the figures, and sharing as a PDF or a spreadsheet.
class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key});

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  ReportKind _kind = ReportKind.daily;
  ReportPeriod _period = ReportPeriod.lastDays(7);
  ReportResult? _result;
  Object? _error;
  bool _loading = false;
  int _generation = 0;
  String? _storeId;
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final admin = AdminScope.of(context);
    if (!_started || admin.storeId != _storeId) {
      _storeId = admin.storeId;
      _load();
    }
    _started = true;
  }

  List<ReportKind> _kinds(AdminScopeData admin) => [
    if (admin.can('reports.view')) ...[ReportKind.daily, ReportKind.products, ReportKind.categories, ReportKind.cashiers, ReportKind.profit],
    if (admin.can('reports.stock')) ReportKind.stock,
  ];

  Future<void> _load() async {
    final gen = ++_generation;
    final admin = AdminScope.read(context);
    String money(int cents) => formatMoney(cents, admin.symbol);
    final range = {'from': isoDay(_period.from), 'to': isoDay(_period.to), 'storeId': ?admin.storeId};
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      Future<Map<String, dynamic>> get(String path, Map<String, String> q) async => ((await admin.fetch(path, query: q)) as Map).cast();
      final ReportResult result = switch (_kind) {
        ReportKind.daily => dailyReport(await get('/sales/reports/daily', range), money),
        ReportKind.products => profitReport(await get('/sales/reports/profitability', {...range, 'by': 'item'}), 'item', money),
        ReportKind.categories => profitReport(await get('/sales/reports/profitability', {...range, 'by': 'category'}), 'category', money),
        ReportKind.cashiers => profitReport(await get('/sales/reports/profitability', {...range, 'by': 'cashier'}), 'cashier', money),
        ReportKind.profit => await () async {
          final parts = await Future.wait([
            get('/sales/reports/profitability', {...range, 'by': 'store'}),
            get('/sales/reports/daily', range),
            // From the books: for bookkeepers only, and for the whole business.
            get('/accounting/reports/profit-and-loss', {'from': range['from']!, 'to': range['to']!}).then<Map<String, dynamic>?>((v) => v, onError: (Object e) {
              if (e is ApiException && e.status == 403) return null;
              throw e;
            }),
          ]);
          return profitSummary(parts[0]!, parts[1]!, parts[2], oneStore: admin.storeId != null, money: money);
        }(),
        ReportKind.stock => stockValueReport(await get('/inventory/reports/valuation', {'storeId': ?admin.storeId}), money),
      };
      if (gen != _generation || !mounted) return;
      setState(() {
        _result = result;
        _loading = false;
      });
    } catch (e) {
      if (gen != _generation || !mounted) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  Future<void> _choosePeriod(int choice) async {
    ReportPeriod? next;
    switch (choice) {
      case 0:
        next = ReportPeriod.today();
      case 1:
        next = ReportPeriod.yesterday();
      case 2:
        next = ReportPeriod.lastDays(7);
      case 3:
        next = ReportPeriod.thisMonth();
      case 4:
        next = ReportPeriod.lastMonth();
      case 5:
        next = ReportPeriod.lastDays(30);
      case 6:
        final now = DateTime.now();
        final picked = await showDateRangePicker(
          context: context,
          firstDate: DateTime(now.year - 5),
          lastDate: now,
          initialDateRange: DateTimeRange(start: _period.from, end: _period.to),
          helpText: 'Report on',
        );
        if (picked == null) return;
        final p = ReportPeriod('', picked.start, picked.end);
        next = ReportPeriod(p.describe, picked.start, picked.end);
    }
    setState(() => _period = next!);
    _load();
  }

  Future<void> _export(bool pdf) async {
    final admin = AdminScope.read(context);
    final r = _result;
    if (r == null) return;
    final session = admin.session!;
    final where = admin.currentStore?.name ?? 'All stores';
    final when = _kind == ReportKind.stock ? 'Now' : _period.describe;
    final file = '${r.title} ${_kind == ReportKind.stock ? isoDay(DateTime.now()) : '${isoDay(_period.from)} to ${isoDay(_period.to)}'}'.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]+'), '-');
    try {
      if (pdf) {
        final bytes = await reportPdf(
          report: r,
          business: session.businessName,
          period: when,
          place: where,
          symbol: admin.symbol,
          generated: '${shortDateTime(DateTime.now().toIso8601String())} by ${session.fullName}',
        );
        await shareFile(bytes, name: '$file.pdf', mimeType: 'application/pdf', subject: '${r.title}, $when');
      } else {
        await shareFile(csvBytes(r.table), name: '$file.csv', mimeType: 'text/csv', subject: '${r.title}, $when');
      }
    } catch (e) {
      if (mounted) showMessage(context, "Couldn't share: $e", error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final admin = AdminScope.of(context);
    final data = AdminScopeData(admin.session!.permissions);
    final kinds = _kinds(data);
    if (!kinds.contains(_kind) && kinds.isNotEmpty) _kind = kinds.first;
    final scheme = Theme.of(context).colorScheme;
    final r = _result;

    final periodChip = _kind == ReportKind.stock
        ? Chip(avatar: const Icon(Icons.schedule, size: 16), label: const Text('Now'), visualDensity: VisualDensity.compact)
        : PopupMenuButton<int>(
            tooltip: 'Dates',
            onSelected: _choosePeriod,
            itemBuilder: (_) => const [
              PopupMenuItem(value: 0, child: Text('Today')),
              PopupMenuItem(value: 1, child: Text('Yesterday')),
              PopupMenuItem(value: 2, child: Text('Last 7 days')),
              PopupMenuItem(value: 3, child: Text('This month')),
              PopupMenuItem(value: 4, child: Text('Last month')),
              PopupMenuItem(value: 5, child: Text('Last 30 days')),
              PopupMenuDivider(),
              PopupMenuItem(value: 6, child: Text('Choose dates…')),
            ],
            child: Container(
              constraints: const BoxConstraints(minHeight: 40),
              padding: const EdgeInsets.symmetric(horizontal: 12),
              decoration: BoxDecoration(
                color: scheme.primary.withValues(alpha: 0.12),
                border: Border.all(color: scheme.primary),
                borderRadius: BorderRadius.circular(20),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.calendar_today_outlined, size: 15, color: scheme.primary),
                  const SizedBox(width: 6),
                  Text(_period.label, style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: scheme.primary)),
                  Icon(Icons.arrow_drop_down, size: 20, color: scheme.primary),
                ],
              ),
            ),
          );

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(bottom: 24),
        children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
            child: Row(
              spacing: 8,
              children: [
                for (final k in kinds)
                  ChoiceChip(
                    avatar: Icon(k.icon, size: 16),
                    label: Text(k.label),
                    selected: _kind == k,
                    showCheckmark: false,
                    onSelected: (_) {
                      setState(() {
                        _kind = k;
                        _result = null;
                      });
                      _load();
                    },
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
            child: Row(
              children: [
                periodChip,
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    '${_kind == ReportKind.stock ? '' : '${_period.describe} · '}${admin.currentStore?.name ?? 'All stores'}',
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant),
                  ),
                ),
                PopupMenuButton<bool>(
                  tooltip: 'Share',
                  enabled: r != null && !_loading,
                  icon: const Icon(Icons.ios_share),
                  onSelected: _export,
                  itemBuilder: (_) => const [
                    PopupMenuItem(value: true, child: ListTile(leading: Icon(Icons.picture_as_pdf_outlined), title: Text('Share as PDF'))),
                    PopupMenuItem(value: false, child: ListTile(leading: Icon(Icons.table_view_outlined), title: Text('Share as spreadsheet (CSV)'))),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 900),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: r == null || (_loading && r.title != _titleFor(_kind))
                    ? (_error != null && !_loading
                          ? ErrorState(error: _error!, onRetry: _load)
                          : const Column(children: [SkeletonCard(lines: 2), SizedBox(height: 12), SkeletonCard(lines: 4), SizedBox(height: 12), SkeletonCard(lines: 4)]))
                    : AnimatedOpacity(opacity: _loading ? 0.5 : 1, duration: const Duration(milliseconds: 150), child: _ReportBody(report: r)),
              ),
            ),
          ),
        ],
      ),
    );
  }

  static String _titleFor(ReportKind k) => switch (k) {
    ReportKind.daily => 'Sales by day',
    ReportKind.products => 'Sales by product',
    ReportKind.categories => 'Sales by category',
    ReportKind.cashiers => 'Sales by cashier',
    ReportKind.profit => 'Profit summary',
    ReportKind.stock => 'Stock value',
  };
}

/// Which reports the person may see.
class AdminScopeData {
  const AdminScopeData(this.permissions);

  final Set<String> permissions;
  bool can(String p) => permissions.contains(p);
}

class _ReportBody extends StatelessWidget {
  const _ReportBody({required this.report});

  final ReportResult report;

  @override
  Widget build(BuildContext context) {
    final r = report;
    final scheme = Theme.of(context).colorScheme;
    final empty = r.table.rows.isEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        LayoutBuilder(
          builder: (context, c) {
            final perRow = c.maxWidth >= 640 ? 4 : 2;
            final width = (c.maxWidth - (perRow - 1) * 12) / perRow;
            return Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [for (final s in r.stats) SizedBox(width: width, child: _StatTile(stat: s))],
            );
          },
        ),
        const SizedBox(height: 12),
        if (empty)
          const Card(child: EmptyState(icon: Icons.bar_chart, title: 'Nothing for these dates', message: 'Try other dates or another store.'))
        else ...[
          if (r.chart != null) ...[SectionCard(title: r.chart!.title, child: _Chart(chart: r.chart!)), const SizedBox(height: 12)],
          SectionCard(
            title: r.table.rows.length > _tableLimit ? 'The $_tableLimit biggest of ${r.table.rows.length} (all of them in the export)' : 'Figures',
            child: _Table(table: r.table),
          ),
        ],
        for (final n in r.notes) Padding(padding: const EdgeInsets.only(top: 10), child: Text(n, style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant))),
      ],
    );
  }
}

const _tableLimit = 100;

class _StatTile extends StatelessWidget {
  const _StatTile({required this.stat});

  final ReportStat stat;

  @override
  Widget build(BuildContext context) {
    final admin = AdminScope.of(context);
    final scheme = Theme.of(context).colorScheme;
    final negative = stat.negativeIsBad && stat.value != null && stat.value!.startsWith('-');
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(stat.label, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: scheme.onSurfaceVariant)),
            const SizedBox(height: 4),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(
                showCell(stat.value, stat.kind, admin.symbol),
                style: tabular.copyWith(fontSize: 22, fontWeight: FontWeight.w700, color: negative ? scheme.error : null),
              ),
            ),
            if (stat.note != null) Text(stat.note!, maxLines: 2, style: TextStyle(fontSize: 11.5, color: scheme.onSurfaceVariant)),
          ],
        ),
      ),
    );
  }
}

/// One hue, thin bars, the chosen one solid; tap a bar for its figures.
class _Chart extends StatefulWidget {
  const _Chart({required this.chart});

  final ReportChart chart;

  @override
  State<_Chart> createState() => _ChartState();
}

class _ChartState extends State<_Chart> {
  int? _picked;

  @override
  void didUpdateWidget(_Chart old) {
    super.didUpdateWidget(old);
    if (old.chart != widget.chart) _picked = null;
  }

  @override
  Widget build(BuildContext context) {
    final chart = widget.chart;
    return chart.shape == ChartShape.ranking ? _ranking(context, chart) : _columns(context, chart);
  }

  Widget _ranking(BuildContext context, ReportChart chart) {
    final admin = AdminScope.of(context);
    final scheme = Theme.of(context).colorScheme;
    final max = chart.bars.fold<int>(0, (m, b) => b.value > m ? b.value : m);
    return Column(
      children: [
        for (final b in chart.bars)
          Semantics(
            label: b.detail,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 5),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Expanded(child: Text(b.label, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13.5))),
                      const SizedBox(width: 8),
                      Text(formatMoney(b.value, admin.symbol), style: tabular.copyWith(fontSize: 13.5, fontWeight: FontWeight.w600)),
                    ],
                  ),
                  const SizedBox(height: 4),
                  LayoutBuilder(
                    builder: (context, c) => Align(
                      alignment: Alignment.centerLeft,
                      child: Container(
                        height: 8,
                        width: max <= 0 || b.value <= 0 ? 2 : (c.maxWidth * b.value / max).clamp(3, c.maxWidth).toDouble(),
                        decoration: BoxDecoration(color: scheme.primary, borderRadius: const BorderRadius.horizontal(right: Radius.circular(4))),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Widget _columns(BuildContext context, ReportChart chart) {
    final scheme = Theme.of(context).colorScheme;
    final bars = chart.bars;
    final maxPos = bars.fold<int>(0, (m, b) => b.value > m ? b.value : m);
    final maxNeg = bars.fold<int>(0, (m, b) => -b.value > m ? -b.value : m);
    final span = (maxPos + maxNeg) == 0 ? 1 : maxPos + maxNeg;
    const height = 140.0;
    final above = height * maxPos / span;
    final below = height - above;
    final shown = _picked ?? bars.length - 1;
    // Many days: label every few, so the names don't run together.
    final every = bars.length <= 12 ? 1 : (bars.length / 8).ceil();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(bars[shown].detail, style: tabular.copyWith(fontWeight: FontWeight.w600)),
        const SizedBox(height: 12),
        SizedBox(
          height: height + 22,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final (i, b) in bars.indexed)
                Expanded(
                  child: Semantics(
                    label: b.detail,
                    button: true,
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: () => setState(() => _picked = i),
                      child: Column(
                        children: [
                          SizedBox(
                            height: above,
                            child: Align(
                              alignment: Alignment.bottomCenter,
                              child: b.value > 0 ? _bar(scheme, i == shown, above * b.value / (maxPos == 0 ? 1 : maxPos), bars.length, top: true) : null,
                            ),
                          ),
                          Container(height: 1, color: scheme.outlineVariant),
                          SizedBox(
                            height: below,
                            child: Align(
                              alignment: Alignment.topCenter,
                              child: b.value < 0 ? _bar(scheme, i == shown, below * -b.value / (maxNeg == 0 ? 1 : maxNeg), bars.length, top: false, loss: true) : null,
                            ),
                          ),
                          const SizedBox(height: 4),
                          SizedBox(
                            height: 16,
                            child: i % every == 0 || i == bars.length - 1
                                ? Text(
                                    b.label,
                                    maxLines: 1,
                                    softWrap: false,
                                    overflow: TextOverflow.visible,
                                    style: TextStyle(fontSize: 10.5, color: scheme.onSurfaceVariant, fontWeight: i == shown ? FontWeight.w700 : FontWeight.w400),
                                  )
                                : null,
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

  Widget _bar(ColorScheme scheme, bool picked, double h, int count, {required bool top, bool loss = false}) {
    final base = loss ? scheme.error : scheme.primary;
    final r = const Radius.circular(4);
    return Padding(
      // The gap between bars is the card showing through.
      padding: EdgeInsets.symmetric(horizontal: count > 20 ? 1 : 3),
      child: Container(
        height: h.clamp(2, 10000).toDouble(),
        decoration: BoxDecoration(
          color: picked ? base : base.withValues(alpha: 0.35),
          borderRadius: top ? BorderRadius.vertical(top: r) : BorderRadius.vertical(bottom: r),
        ),
      ),
    );
  }
}

class _Table extends StatelessWidget {
  const _Table({required this.table});

  final ReportTable table;

  @override
  Widget build(BuildContext context) {
    final admin = AdminScope.of(context);
    final cols = table.columns;
    DataCell cell(String? v, ReportColumn c, {bool bold = false}) => DataCell(
      Text(
        v == null && c.numeric ? '' : showCell(v, c.kind, admin.symbol),
        style: (c.numeric ? tabular : const TextStyle()).copyWith(fontWeight: bold ? FontWeight.w700 : null),
      ),
    );
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: DataTable(
        headingRowHeight: 38,
        dataRowMinHeight: 36,
        dataRowMaxHeight: 44,
        horizontalMargin: 4,
        columnSpacing: 18,
        columns: [for (final c in cols) DataColumn(label: Text(c.label), numeric: c.numeric)],
        rows: [
          for (final row in table.rows.take(_tableLimit)) DataRow(cells: [for (final (i, v) in row.indexed) cell(v, cols[i])]),
          if (table.totals != null) DataRow(cells: [for (final (i, v) in table.totals!.indexed) cell(v, cols[i], bold: true)]),
        ],
      ),
    );
  }
}
