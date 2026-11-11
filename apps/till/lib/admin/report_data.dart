import '../core/money.dart';

/// How a column's values are written: on screen with a currency symbol or
/// thousands separators, in a CSV file as plain numbers.
enum ColumnKind { text, money, quantity, count, percent }

class ReportColumn {
  const ReportColumn(this.label, [this.kind = ColumnKind.text]);

  final String label;
  final ColumnKind kind;

  bool get numeric => kind != ColumnKind.text;
}

/// The figures behind a report, as plain strings from the API ("1234.50", "12.000", "23.4").
class ReportTable {
  ReportTable({required this.columns, required this.rows, this.totals});

  final List<ReportColumn> columns;
  final List<List<String?>> rows;

  /// The totals line, if the report has one (null cells stay empty).
  final List<String?>? totals;
}

/// A headline figure shown above the chart.
class ReportStat {
  const ReportStat(this.label, this.value, {this.kind = ColumnKind.money, this.note, this.negativeIsBad = false});

  final String label;
  final String? value;
  final ColumnKind kind;
  final String? note;

  /// A loss shows in red.
  final bool negativeIsBad;
}

/// One bar: what it's for, how big (cents or thousandths), and a line for when it's tapped.
class ReportBar {
  const ReportBar(this.label, this.value, this.detail);

  final String label;
  final int value;
  final String detail;
}

enum ChartShape {
  /// Over time, left to right.
  columns,

  /// Biggest first, top to bottom.
  ranking,
}

class ReportChart {
  const ReportChart({required this.title, required this.shape, required this.bars, this.valueKind = ColumnKind.money});

  final String title;
  final ChartShape shape;
  final List<ReportBar> bars;
  final ColumnKind valueKind;
}

/// Everything one report shows, and exports.
class ReportResult {
  ReportResult({required this.title, required this.stats, required this.table, this.chart, this.notes = const []});

  final String title;
  final List<ReportStat> stats;
  final ReportChart? chart;
  final ReportTable table;
  final List<String> notes;
}

/// A cell as people read it.
String showCell(String? v, ColumnKind kind, String symbol) {
  if (v == null || v.isEmpty) return kind == ColumnKind.text ? '' : '—';
  return switch (kind) {
    ColumnKind.text => v,
    ColumnKind.money => formatMoney(toCents(v), symbol),
    ColumnKind.quantity => formatQty(parseFixed(v, 3)),
    ColumnKind.count => v,
    ColumnKind.percent => '$v%',
  };
}

/// "Mon 3 Nov" / "Nov 2026" headings.
const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ----- Reports from the API's answers ----------------------------------------------------

String _plural(Object n, String one) => '$n $one${n == 1 ? '' : 's'}';

String _dayName(String iso) {
  final day = DateTime.parse(iso);
  return '${_weekdays[day.weekday - 1]} ${day.day} ${_months[day.month - 1]}';
}

/// The API lists only days that had sales; a chart needs every day of the period,
/// quiet ones at nothing, so the bars line up with the calendar.
List<Map> everyDay(Map<String, dynamic> d) {
  final rows = (d['rows'] as List).cast<Map>();
  final from = DateTime.tryParse('${d['from']}');
  final to = DateTime.tryParse('${d['to']}');
  if (from == null || to == null || to.isBefore(from) || to.difference(from).inDays > 400) return rows;
  final byDay = {for (final r in rows) r['day'] as String: r};
  return [
    for (var day = DateTime.utc(from.year, from.month, from.day); !day.isAfter(DateTime.utc(to.year, to.month, to.day)); day = day.add(const Duration(days: 1)))
      byDay[day.toIso8601String().substring(0, 10)] ??
          {'day': day.toIso8601String().substring(0, 10), 'sales': 0, 'returns': 0, 'gross': '0.00', 'net': '0.00', 'tax': '0.00', 'profit': '0.00'},
  ];
}

/// Sales by day: takings with and without VAT, profit, and how people paid.
ReportResult dailyReport(Map<String, dynamic> d, String Function(int cents) money) {
  final rows = (d['rows'] as List).cast<Map>();
  final days = everyDay(d);
  final t = (d['totals'] as Map).cast<String, dynamic>();
  // Long periods read better a month at a time.
  final byMonth = days.length > 62;
  final bars = <ReportBar>[];
  if (byMonth) {
    final months = <String, (int, int)>{};
    for (final r in days) {
      final key = (r['day'] as String).substring(0, 7);
      final m = months[key] ?? (0, 0);
      months[key] = (m.$1 + toCents(r['gross']), m.$2 + (r['sales'] as int));
    }
    for (final e in months.entries) {
      final label = '${_months[int.parse(e.key.substring(5)) - 1]} ${e.key.substring(2, 4)}';
      bars.add(ReportBar(label, e.value.$1, '$label · ${money(e.value.$1)} · ${_plural(e.value.$2, 'sale')}'));
    }
  } else {
    for (final r in days) {
      final day = DateTime.parse(r['day'] as String);
      final label = days.length <= 8 ? _weekdays[day.weekday - 1] : '${day.day}';
      bars.add(ReportBar(label, toCents(r['gross']), '${_dayName(r['day'] as String)} · ${money(toCents(r['gross']))} · ${_plural(r['sales'] as int, 'sale')}'));
    }
  }
  final sales = t['sales'] as int;
  return ReportResult(
    title: 'Sales by day',
    stats: [
      ReportStat('Sales', t['gross'] as String, note: 'VAT included, refunds taken off'),
      ReportStat('Transactions', '$sales', kind: ColumnKind.count, note: _plural(t['returns'] as int, 'refund')),
      ReportStat('Average sale', sales == 0 ? '0.00' : fromCents(toCents(t['gross']) ~/ sales)),
      ReportStat('Gross profit', t['profit'] as String, negativeIsBad: true, note: 'Before expenses'),
    ],
    chart: rows.isEmpty ? null : ReportChart(title: byMonth ? 'Sales by month' : 'Sales by day', shape: ChartShape.columns, bars: bars),
    table: ReportTable(
      columns: const [
        ReportColumn('Day'),
        ReportColumn('Sales', ColumnKind.count),
        ReportColumn('Refunds', ColumnKind.count),
        ReportColumn('Takings', ColumnKind.money),
        ReportColumn('VAT', ColumnKind.money),
        ReportColumn('Without VAT', ColumnKind.money),
        ReportColumn('Profit', ColumnKind.money),
        ReportColumn('Cash', ColumnKind.money),
        ReportColumn('Card', ColumnKind.money),
        ReportColumn('Mobile', ColumnKind.money),
        ReportColumn('Bank', ColumnKind.money),
      ],
      rows: [
        for (final r in rows.reversed) [r['day'], '${r['sales']}', '${r['returns']}', r['gross'], r['tax'], r['net'], r['profit'], r['cash'], r['card'], r['mobile'], r['bank']].cast<String?>(),
      ],
      totals: ['Total', '${t['sales']}', '${t['returns']}', t['gross'], t['tax'], t['net'], t['profit'], t['cash'], t['card'], t['mobile'], t['bank']].cast<String?>(),
    ),
  );
}

/// Revenue, cost and profit by item, category or cashier.
ReportResult profitReport(Map<String, dynamic> d, String by, String Function(int cents) money) {
  final rows = (d['rows'] as List).cast<Map>();
  final t = (d['totals'] as Map).cast<String, dynamic>();
  final what = switch (by) {
    'item' => 'product',
    'category' => 'category',
    'cashier' => 'cashier',
    _ => 'store',
  };
  final top = [...rows]..sort((a, b) => toCents(b['revenue']).compareTo(toCents(a['revenue'])));
  return ReportResult(
    title: switch (by) {
      'item' => 'Sales by product',
      'category' => 'Sales by category',
      'cashier' => 'Sales by cashier',
      _ => 'Sales by store',
    },
    stats: [
      ReportStat('Sales without VAT', t['revenue'] as String),
      ReportStat('Gross profit', t['profit'] as String, negativeIsBad: true),
      ReportStat('Margin', t['margin'] as String?, kind: ColumnKind.percent),
      ReportStat(by == 'item' ? 'Products sold' : '${what[0].toUpperCase()}${what.substring(1)}s', '${rows.length}', kind: ColumnKind.count),
    ],
    chart: rows.isEmpty
        ? null
        : ReportChart(
            title: rows.length > 10 ? 'Top 10 by sales' : 'By sales',
            shape: ChartShape.ranking,
            bars: [
              for (final r in top.take(10))
                ReportBar(
                  r['name'] as String,
                  toCents(r['revenue']),
                  '${r['name']} · ${money(toCents(r['revenue']))} · profit ${money(toCents(r['profit']))}${r['margin'] == null ? '' : ' (${r['margin']}%)'}',
                ),
            ],
          ),
    table: ReportTable(
      columns: [
        ReportColumn(what[0].toUpperCase() + what.substring(1)),
        if (by == 'item' || by == 'category') const ReportColumn('Quantity', ColumnKind.quantity),
        const ReportColumn('Sales', ColumnKind.count),
        const ReportColumn('Without VAT', ColumnKind.money),
        const ReportColumn('Cost', ColumnKind.money),
        const ReportColumn('Profit', ColumnKind.money),
        const ReportColumn('Margin', ColumnKind.percent),
      ],
      rows: [
        for (final r in top) [r['name'], if (by == 'item' || by == 'category') r['quantity'], '${r['sales']}', r['revenue'], r['cost'], r['profit'], r['margin']].cast<String?>(),
      ],
      totals: ['Total', if (by == 'item' || by == 'category') null, null, t['revenue'], t['cost'], t['profit'], t['margin']].cast<String?>(),
    ),
  );
}

/// Gross profit from sales, by store and over time, and (for bookkeepers) the
/// profit left after expenses from the books.
ReportResult profitSummary(Map<String, dynamic> byStore, Map<String, dynamic> daily, Map<String, dynamic>? pnl, {required bool oneStore, required String Function(int cents) money}) {
  final t = (byStore['totals'] as Map).cast<String, dynamic>();
  final days = everyDay(daily);
  final stores = (byStore['rows'] as List).cast<Map>();
  String? expenses;
  if (pnl != null) {
    final section = (pnl['sections'] as List).cast<Map>().where((s) => s['title'] == 'Expenses').firstOrNull;
    expenses = (section?['total'] as String?) ?? '0.00';
  }
  return ReportResult(
    title: 'Profit summary',
    stats: [
      ReportStat('Sales without VAT', t['revenue'] as String),
      ReportStat('Cost of goods sold', t['cost'] as String),
      ReportStat('Gross profit', t['profit'] as String, negativeIsBad: true, note: t['margin'] == null ? null : '${t['margin']}% margin'),
      if (pnl != null) ...[
        ReportStat('Expenses', expenses, note: 'Rent, wages and other costs in the books'),
        ReportStat('Net profit', pnl['netProfit'] as String, negativeIsBad: true, note: 'From the books'),
      ],
    ],
    chart: days.isEmpty
        ? null
        : ReportChart(
            title: 'Gross profit by day',
            shape: ChartShape.columns,
            bars: [
              for (final r in days)
                ReportBar(
                  days.length <= 8 ? _weekdays[DateTime.parse(r['day'] as String).weekday - 1] : '${DateTime.parse(r['day'] as String).day}',
                  toCents(r['profit']),
                  '${_dayName(r['day'] as String)} · profit ${money(toCents(r['profit']))} on ${money(toCents(r['net']))}',
                ),
            ],
          ),
    table: ReportTable(
      columns: const [
        ReportColumn('Store'),
        ReportColumn('Sales', ColumnKind.count),
        ReportColumn('Without VAT', ColumnKind.money),
        ReportColumn('Cost', ColumnKind.money),
        ReportColumn('Profit', ColumnKind.money),
        ReportColumn('Margin', ColumnKind.percent),
      ],
      rows: [
        for (final r in stores) [r['name'], '${r['sales']}', r['revenue'], r['cost'], r['profit'], r['margin']].cast<String?>(),
      ],
      totals: ['Total', null, t['revenue'], t['cost'], t['profit'], t['margin']].cast<String?>(),
    ),
    notes: [
      if (pnl != null && oneStore) 'Expenses and net profit are for the whole business; the books aren\'t kept per store.',
      if (pnl == null) 'Expenses and net profit come from the books, which your role can\'t see.',
    ],
  );
}

/// What the stock is worth at cost, now.
ReportResult stockValueReport(Map<String, dynamic> d, String Function(int cents) money) {
  final rows = (d['rows'] as List).cast<Map>();
  final byCategory = <String, int>{};
  for (final r in rows) {
    final c = (r['category'] as String?) ?? 'No category';
    byCategory[c] = (byCategory[c] ?? 0) + toCents(r['value']);
  }
  final cats = byCategory.entries.toList()..sort((a, b) => b.value.compareTo(a.value));
  final sorted = [...rows]..sort((a, b) => toCents(b['value']).compareTo(toCents(a['value'])));
  final negative = rows.where((r) => parseFixed(r['quantity'], 3) < 0).length;
  String name(Map r) => r['variantName'] == 'Default' ? r['productName'] as String : '${r['productName']} · ${r['variantName']}';
  return ReportResult(
    title: 'Stock value',
    stats: [
      ReportStat('Stock at cost', d['totalValue'] as String),
      ReportStat('Items in stock', '${d['items']}', kind: ColumnKind.count),
    ],
    chart: cats.isEmpty
        ? null
        : ReportChart(
            title: 'By category',
            shape: ChartShape.ranking,
            bars: [for (final c in cats.take(10)) ReportBar(c.key, c.value, '${c.key} · ${money(c.value)}')],
          ),
    table: ReportTable(
      columns: const [
        ReportColumn('Item'),
        ReportColumn('Category'),
        ReportColumn('In stock', ColumnKind.quantity),
        ReportColumn('Unit cost', ColumnKind.money),
        ReportColumn('Value', ColumnKind.money),
      ],
      rows: [
        for (final r in sorted) [name(r), r['category'] as String?, r['quantity'] as String, r['unitCost'] as String, r['value'] as String],
      ],
      totals: ['Total', null, null, null, d['totalValue'] as String],
    ),
    notes: [
      'Valued at each item\'s cost price.',
      if (negative > 0) '$negative item${negative == 1 ? ' shows' : 's show'} less than none in stock: a count would put that right.',
    ],
  );
}
