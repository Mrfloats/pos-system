import 'dart:convert';

import 'package:floatly_till/admin/report_data.dart';
import 'package:floatly_till/admin/report_export.dart';
import 'package:floatly_till/core/money.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'admin_support.dart';

String money(int c) => formatMoney(c, r'$');

/// A report's chip (the same words can head a table column).
Finder chip(String label) => find.widgetWithText(ChoiceChip, label);

Map<String, dynamic> _daily(int days) => {
  'rows': [
    for (var i = 0; i < days; i++)
      {
        'day': DateTime(2026, 1, 1).add(Duration(days: i)).toIso8601String().substring(0, 10),
        'sales': 1,
        'returns': 0,
        'gross': '10.00',
        'net': '8.70',
        'tax': '1.30',
        'profit': '3.00',
        'cash': '10.00',
        'card': '0.00',
        'mobile': '0.00',
        'bank': '0.00',
      },
  ],
  'totals': {'gross': '${days * 10}.00', 'net': '0', 'tax': '0', 'profit': '0', 'cash': '0', 'card': '0', 'mobile': '0', 'bank': '0', 'sales': days, 'returns': 0},
};

void main() {
  group('reports from the figures', () {
    test('sales by day: headline figures, a bar a day, newest day first in the table', () {
      final r = dailyReport({
        'rows': [
          {'day': '2026-11-09', 'sales': 4, 'returns': 1, 'gross': '23.00', 'net': '20.00', 'tax': '3.00', 'profit': '-2.00', 'cash': '23.00', 'card': '0', 'mobile': '0', 'bank': '0'},
          {'day': '2026-11-10', 'sales': 6, 'returns': 0, 'gross': '69.00', 'net': '60.00', 'tax': '9.00', 'profit': '18.00', 'cash': '9.00', 'card': '0', 'mobile': '60.00', 'bank': '0'},
        ],
        'totals': {'gross': '92.00', 'net': '80.00', 'tax': '12.00', 'profit': '16.00', 'cash': '32.00', 'card': '0', 'mobile': '60.00', 'bank': '0', 'sales': 10, 'returns': 1},
      }, money);
      expect(r.stats.map((s) => [s.label, s.value]), [
        ['Sales', '92.00'],
        ['Transactions', '10'],
        ['Average sale', '9.20'],
        ['Gross profit', '16.00'],
      ]);
      expect(r.chart!.bars.map((b) => [b.label, b.value]), [
        ['Mon', 2300],
        ['Tue', 6900],
      ]);
      expect(r.chart!.bars.last.detail, r'Tue 10 Nov · $69.00 · 6 sales');
      expect(r.table.rows.first.first, '2026-11-10');
      expect(r.table.totals![3], '92.00');
    });

    test('quiet days get a bar at nothing, so the chart follows the calendar', () {
      final r = dailyReport({
        'from': '2026-11-04',
        'to': '2026-11-10',
        'rows': [
          {'day': '2026-11-05', 'sales': 1, 'returns': 1, 'gross': '5.00', 'net': '4.35', 'tax': '0.65', 'profit': '1.00', 'cash': '5.00', 'card': '0', 'mobile': '0', 'bank': '0'},
          {'day': '2026-11-09', 'sales': 2, 'returns': 0, 'gross': '9.00', 'net': '7.83', 'tax': '1.17', 'profit': '2.00', 'cash': '9.00', 'card': '0', 'mobile': '0', 'bank': '0'},
        ],
        'totals': {'gross': '14.00', 'net': '0', 'tax': '0', 'profit': '3.00', 'cash': '0', 'card': '0', 'mobile': '0', 'bank': '0', 'sales': 3, 'returns': 1},
      }, money);
      expect(r.chart!.bars.map((b) => [b.label, b.value]), [
        ['Wed', 0],
        ['Thu', 500],
        ['Fri', 0],
        ['Sat', 0],
        ['Sun', 0],
        ['Mon', 900],
        ['Tue', 0],
      ]);
      expect(r.chart!.bars[1].detail, r'Thu 5 Nov · $5.00 · 1 sale');
      expect(r.stats[1].note, '1 refund');
      expect(r.table.rows, hasLength(2)); // the table lists only days that had sales
    });

    test('a long period is drawn a month at a time', () {
      final r = dailyReport(_daily(70), money);
      expect(r.chart!.title, 'Sales by month');
      expect(r.chart!.bars.map((b) => [b.label, b.value]), [
        ['Jan 26', 31000],
        ['Feb 26', 28000],
        ['Mar 26', 11000],
      ]);
      expect(r.table.rows, hasLength(70)); // the table keeps every day
    });

    test('by product: biggest sellers first, with quantity and margin', () {
      final r = profitReport({
        'rows': [
          {'name': 'Small', 'quantity': '1.000', 'sales': 1, 'revenue': '5.00', 'cost': '4.00', 'profit': '1.00', 'margin': '20.0'},
          {'name': 'Big', 'quantity': '3.500', 'sales': 2, 'revenue': '50.00', 'cost': '30.00', 'profit': '20.00', 'margin': '40.0'},
        ],
        'totals': {'revenue': '55.00', 'cost': '34.00', 'profit': '21.00', 'margin': '38.2'},
      }, 'item', money);
      expect(r.title, 'Sales by product');
      expect(r.chart!.bars.map((b) => b.label), ['Big', 'Small']);
      expect(r.table.columns.map((c) => c.label), ['Product', 'Quantity', 'Sales', 'Without VAT', 'Cost', 'Profit', 'Margin']);
      expect(r.table.rows.first, ['Big', '3.500', '2', '50.00', '30.00', '20.00', '40.0']);
      expect(r.stats[2].value, '38.2');
    });

    test('profit summary with and without the books', () {
      final byStore = {
        'rows': [
          {'name': 'Main Store', 'sales': 2, 'revenue': '50.00', 'cost': '30.00', 'profit': '20.00', 'margin': '40.0'},
        ],
        'totals': {'revenue': '50.00', 'cost': '30.00', 'profit': '20.00', 'margin': '40.0'},
      };
      final pnl = {
        'sections': [
          {'title': 'Expenses', 'rows': [], 'total': '35.00'},
        ],
        'netProfit': '-15.00',
      };
      final withBooks = profitSummary(byStore, _daily(2), pnl, oneStore: true, money: money);
      expect(withBooks.stats.map((s) => s.label), ['Sales without VAT', 'Cost of goods sold', 'Gross profit', 'Expenses', 'Net profit']);
      expect(withBooks.stats.last.value, '-15.00');
      expect(withBooks.notes.single, contains('whole business'));
      final without = profitSummary(byStore, _daily(2), null, oneStore: false, money: money);
      expect(without.stats, hasLength(3));
      expect(without.notes.single, contains("your role can't see"));
    });

    test('stock value: categories added up, most valuable first, below-zero items pointed out', () {
      final r = stockValueReport({
        'rows': [
          {'productName': 'Cheap', 'variantName': 'Default', 'category': null, 'unitCost': '1.00', 'quantity': '5.000', 'value': '5.00'},
          {'productName': 'Dear', 'variantName': 'Large', 'category': 'Drinks', 'unitCost': '10.00', 'quantity': '3.000', 'value': '30.00'},
          {'productName': 'Short', 'variantName': 'Default', 'category': 'Drinks', 'unitCost': '1.00', 'quantity': '-1.000', 'value': '-1.00'},
        ],
        'totalValue': '34.00',
        'items': 3,
      }, money);
      expect(r.chart!.bars.map((b) => [b.label, b.value]), [
        ['Drinks', 2900],
        ['No category', 500],
      ]);
      expect(r.table.rows.first.first, 'Dear · Large');
      expect(r.notes.last, contains('1 item shows less than none'));
    });

    test('CSV: plain numbers, quotes where needed, a totals line, and a BOM for Excel', () {
      final table = ReportTable(
        columns: const [ReportColumn('Name'), ReportColumn('Sales', ColumnKind.money)],
        rows: [
          ['Cooking oil, 2L', '1234.50'],
          ['Say "hi"', null],
        ],
        totals: ['Total', '1234.50'],
      );
      expect(reportCsv(table), 'Name,Sales\r\n"Cooking oil, 2L",1234.50\r\n"Say ""hi""",\r\nTotal,1234.50\r\n');
      final bytes = csvBytes(table);
      expect(bytes.take(3), [0xEF, 0xBB, 0xBF]);
      expect(utf8.decode(bytes.skip(3).toList()), startsWith('Name,Sales'));
    });

    test('PDF: a real file, with nothing the built-in fonts would print as "?"', () async {
      final report = dailyReport(_daily(40), money);
      final bytes = await reportPdf(report: report, business: 'Corner Shop', period: '1 Jan – 9 Feb 2026', place: 'All stores', symbol: r'$', generated: '10 Nov, 14:00 by Admin');
      expect(String.fromCharCodes(bytes.take(5)), '%PDF-');
      expect(bytes.length, greaterThan(2000));
    });
  });

  group('reports screen', () {
    testWidgets('opens on the last 7 days of sales, with figures, chart and table', (tester) async {
      final (_, fake, _) = await openAdmin(tester);
      await goTo(tester, 'Reports');
      final (path, q) = fake.reportQueries.last;
      expect(path, '/sales/reports/daily');
      expect(DateTime.parse(q['to']!).difference(DateTime.parse(q['from']!)).inDays, 6);
      expect(q.containsKey('storeId'), isFalse);
      expect(find.text(r'$207.00'), findsWidgets);
      expect(find.text('20'), findsWidgets);
      expect(find.text(r'$10.35'), findsOneWidget); // average sale
      expect(chip('Sales by day'), findsOneWidget);
      expect(find.text('Figures'), findsOneWidget);
      expect(find.text('2026-11-10'), findsOneWidget);
    });

    testWidgets('switches report and dates, asking the server each time', (tester) async {
      final (_, fake, _) = await openAdmin(tester);
      await goTo(tester, 'Reports');
      await tapAndSettle(tester, chip('Products'));
      expect(fake.reportQueries.last.$2['by'], 'item');
      expect(find.text('Top 10 by sales'), findsNothing);
      expect(find.text('By sales'), findsOneWidget);
      expect(find.text('Cooking oil, 2L'), findsWidgets);

      await tester.tap(find.text('Last 7 days'));
      await tester.pumpAndSettle();
      await tapAndSettle(tester, find.text('This month'));
      final q = fake.reportQueries.last.$2;
      expect(q['from']!.endsWith('-01'), isTrue);
      expect(q['by'], 'item');

      await tester.ensureVisible(chip('Cashiers'));
      await tapAndSettle(tester, chip('Cashiers'));
      expect(fake.reportQueries.last.$2['by'], 'cashier');
      expect(find.text('Chipo Cashier'), findsWidgets);
    });

    testWidgets('profit adds expenses and net profit from the books, or says why not', (tester) async {
      final (_, fake, _) = await openAdmin(tester);
      await goTo(tester, 'Reports');
      await tester.ensureVisible(chip('Profit'));
      await tapAndSettle(tester, chip('Profit'));
      expect(find.text('Net profit'), findsOneWidget);
      expect(find.text(r'-$14.00'), findsOneWidget);
      expect(fake.reportQueries.map((r) => r.$1), contains('/accounting/reports/profit-and-loss'));

      fake.booksRefused = true;
      await tester.ensureVisible(chip('Sales by day'));
      await tapAndSettle(tester, chip('Sales by day'));
      await tester.ensureVisible(chip('Profit'));
      await tapAndSettle(tester, chip('Profit'));
      expect(find.text('Net profit'), findsNothing);
      expect(find.textContaining("your role can't see"), findsOneWidget);
    });

    testWidgets('stock value is now, not for dates', (tester) async {
      final (_, fake, _) = await openAdmin(tester);
      await goTo(tester, 'Reports');
      await tester.ensureVisible(chip('Stock value'));
      await tapAndSettle(tester, chip('Stock value'));
      expect(fake.reportQueries.last.$1, '/inventory/reports/valuation');
      expect(find.text('Now'), findsOneWidget);
      expect(find.text(r'$257.00'), findsWidgets);
      expect(find.textContaining('less than none'), findsOneWidget);
    });

    testWidgets('hides stock value from someone without permission for it', (tester) async {
      final server = FakeServer()..permissions = ['reports.view'];
      await openAdmin(tester, server: server);
      expect(chip('Profit'), findsOneWidget);
      expect(chip('Stock value'), findsNothing);
    });

    testWidgets('offers PDF and spreadsheet sharing', (tester) async {
      await openAdmin(tester);
      await goTo(tester, 'Reports');
      await tester.tap(find.byTooltip('Share'));
      await tester.pumpAndSettle();
      expect(find.text('Share as PDF'), findsOneWidget);
      expect(find.text('Share as spreadsheet (CSV)'), findsOneWidget);
    });
  });
}
