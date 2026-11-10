import 'dart:async';

import 'package:flutter/material.dart';

import '../core/money.dart';
import '../models/receipt.dart';
import '../printing/print_receipt.dart';
import '../printing/receipt_pdf.dart';
import '../screens/printer_screen.dart';
import '../screens/receipt_screen.dart' show ReceiptView;
import '../theme.dart';
import '../widgets/common.dart';
import 'admin_state.dart';
import 'admin_widgets.dart';
import 'paged_list.dart';

const _methodLabels = {'cash': 'Cash', 'card': 'Card', 'mobile': 'Mobile money', 'bank': 'Bank transfer'};
const _methodIcons = {
  'cash': Icons.payments_outlined,
  'card': Icons.credit_card,
  'mobile': Icons.phone_android,
  'bank': Icons.account_balance_outlined,
};

/// A stretch of days to list, with the words for it.
class _Period {
  const _Period(this.label, this.from, this.to);

  final String label;
  final DateTime? from, to;

  static DateTime get _today {
    final n = DateTime.now();
    return DateTime(n.year, n.month, n.day);
  }

  static _Period today() => _Period('Today', _today, _today);
  static _Period yesterday() => _Period('Yesterday', _today.subtract(const Duration(days: 1)), _today.subtract(const Duration(days: 1)));
  static _Period lastDays(int n) => _Period('Last $n days', _today.subtract(Duration(days: n - 1)), _today);
  static const allTime = _Period('All dates', null, null);

  bool get includesToday => to == null || !to!.isBefore(_today);
}

/// What kind of transaction: a row's label and colour.
(IconData, String, Color)? _saleTag(BuildContext context, Map<String, dynamic> s) {
  final scheme = Theme.of(context).colorScheme;
  if (s['status'] == 'void') return (Icons.block, 'Voided', scheme.error);
  if (s['type'] == 'return') return (Icons.undo, 'Refund', Brand.amberInk);
  if (s['type'] == 'quotation') return (Icons.request_quote_outlined, 'Quotation', scheme.onSurfaceVariant);
  return null;
}

/// Sales as they happen: who sold what, where and how it was paid, with filters.
class SalesActivityScreen extends StatelessWidget {
  const SalesActivityScreen({super.key});

  @override
  Widget build(BuildContext context) => const _SalesList(receipts: false);
}

/// Find a receipt by its number, the customer or the day, to look at, print again or send.
class ReceiptsScreen extends StatelessWidget {
  const ReceiptsScreen({super.key});

  @override
  Widget build(BuildContext context) => const _SalesList(receipts: true);
}

class _SalesList extends StatefulWidget {
  const _SalesList({required this.receipts});

  /// The receipts finder (search first, opens the receipt) rather than the activity list.
  final bool receipts;

  @override
  State<_SalesList> createState() => _SalesListState();
}

class _SalesListState extends State<_SalesList> {
  late final PagedLoader _loader = PagedLoader(_fetch);
  late _Period _period = widget.receipts ? _Period.allTime : _Period.today();
  String _search = '';
  String? _cashierId;
  String? _method;

  /// sale, return or void; null for everything.
  String? _kind;
  List<(String?, String)> _cashiers = const [];
  String? _storeId;
  bool _started = false;
  Timer? _live;

  @override
  void initState() {
    super.initState();
    // New sales show up by themselves while the list is on today and near its top.
    if (!widget.receipts) {
      _live = Timer.periodic(const Duration(seconds: 30), (_) {
        if (_period.includesToday && !_loader.loading && _loader.items.length <= _loader.pageSize) _loader.reload(keep: true);
      });
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final admin = AdminScope.of(context);
    if (!_started || admin.storeId != _storeId) {
      _storeId = admin.storeId;
      _loader.reload();
    }
    if (!_started && !widget.receipts) _loadCashiers(admin);
    _started = true;
  }

  @override
  void dispose() {
    _live?.cancel();
    _loader.dispose();
    super.dispose();
  }

  Future<void> _loadCashiers(AdminState admin) async {
    try {
      final staff = await admin.call((api) => api.get('/staff')) as List;
      if (!mounted) return;
      setState(() {
        _cashiers = [
          (null, 'Any cashier'),
          for (final s in staff.cast<Map>()) (s['userId'] as String, s['fullName'] as String),
        ];
      });
    } catch (_) {
      // The list still works without this filter.
    }
  }

  Future<Map<String, dynamic>> _fetch(int page, int pageSize) async {
    final admin = AdminScope.read(context);
    final res = await admin.call(
      (api) => api.get(
        '/sales',
        query: {
          'page': '$page',
          'pageSize': '$pageSize',
          'excludeQuotations': 'true',
          'storeId': ?admin.storeId,
          if (_period.from != null) 'from': isoDay(_period.from!),
          if (_period.to != null) 'to': isoDay(_period.to!),
          if (_search.isNotEmpty) 'search': _search,
          'cashierId': ?_cashierId,
          'paymentMethod': ?_method,
          if (_kind == 'void') 'status': 'void' else if (_kind != null) ...{'type': _kind!, 'status': 'completed'},
        },
      ),
    );
    return (res as Map).cast();
  }

  void _apply(VoidCallback change) {
    setState(change);
    _loader.reload();
  }

  Future<void> _choosePeriod(int choice) async {
    switch (choice) {
      case 0:
        _apply(() => _period = _Period.today());
      case 1:
        _apply(() => _period = _Period.yesterday());
      case 2:
        _apply(() => _period = _Period.lastDays(7));
      case 3:
        _apply(() => _period = _Period.lastDays(30));
      case 4:
        _apply(() => _period = _Period.allTime);
      case 5:
        final now = DateTime.now();
        final picked = await showDateRangePicker(context: context, firstDate: DateTime(now.year - 5), lastDate: now, helpText: 'Sales between');
        if (picked == null) return;
        final same = picked.start == picked.end;
        _apply(
          () => _period = _Period(
            same ? shortDay(isoDay(picked.start)) : '${shortDay(isoDay(picked.start), weekday: false)} – ${shortDay(isoDay(picked.end), weekday: false)}',
            picked.start,
            picked.end,
          ),
        );
    }
  }

  void _open(Map<String, dynamic> sale) {
    final id = sale['id'] as String;
    Navigator.push(context, MaterialPageRoute(builder: (_) => widget.receipts ? AdminReceiptScreen(saleId: id) : SaleDetailScreen(saleId: id)));
  }

  @override
  Widget build(BuildContext context) {
    final admin = AdminScope.of(context);
    final scheme = Theme.of(context).colorScheme;

    final periodChip = PopupMenuButton<int>(
      tooltip: 'Dates',
      onSelected: _choosePeriod,
      itemBuilder: (_) => const [
        PopupMenuItem(value: 0, child: Text('Today')),
        PopupMenuItem(value: 1, child: Text('Yesterday')),
        PopupMenuItem(value: 2, child: Text('Last 7 days')),
        PopupMenuItem(value: 3, child: Text('Last 30 days')),
        PopupMenuItem(value: 4, child: Text('All dates')),
        PopupMenuDivider(),
        PopupMenuItem(value: 5, child: Text('Choose dates…')),
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

    final header = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
          child: SearchBox(
            hint: widget.receipts ? 'Receipt number or customer' : 'Search number or customer',
            onChanged: (v) => _apply(() => _search = v),
          ),
        ),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
          child: Row(
            spacing: 8,
            children: [
              periodChip,
              if (!widget.receipts) ...[
                if (_cashiers.isNotEmpty)
                  FilterMenu<String>(label: 'Cashier', icon: Icons.person_outline, value: _cashierId, options: _cashiers, onChanged: (v) => _apply(() => _cashierId = v)),
                FilterMenu<String>(
                  label: 'Payment',
                  icon: Icons.payments_outlined,
                  value: _method,
                  options: [(null, 'Any payment'), for (final m in _methodLabels.entries) (m.key, m.value)],
                  onChanged: (v) => _apply(() => _method = v),
                ),
                FilterMenu<String>(
                  label: 'Kind',
                  value: _kind,
                  options: const [(null, 'Sales and refunds'), ('sale', 'Sales'), ('return', 'Refunds'), ('void', 'Voided')],
                  onChanged: (v) => _apply(() => _kind = v),
                ),
              ],
            ],
          ),
        ),
        ListenableBuilder(
          listenable: _loader,
          builder: (context, _) {
            final first = _loader.first;
            if (first == null) return const SizedBox(height: 8);
            final n = _loader.total;
            final where = admin.currentStore?.name ?? 'All stores';
            return Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 6),
              child: Text(
                widget.receipts
                    ? '$n receipt${n == 1 ? '' : 's'} · $where'
                    : '$n transaction${n == 1 ? '' : 's'} · ${admin.money(first['totalBase'])} · $where',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: scheme.onSurfaceVariant),
              ),
            );
          },
        ),
      ],
    );

    return PagedListView(
      loader: _loader,
      header: header,
      empty: EmptyState(
        icon: widget.receipts ? Icons.receipt_long_outlined : Icons.point_of_sale_outlined,
        title: widget.receipts ? 'No receipts found' : 'No transactions',
        message: _search.isNotEmpty ? 'Nothing matches "$_search". Check the number, or try other dates.' : 'Nothing for ${_period.label.toLowerCase()} with these filters.',
      ),
      itemBuilder: (context, sale) => _SaleRow(sale: sale, onTap: () => _open(sale)),
    );
  }
}

class _SaleRow extends StatelessWidget {
  const _SaleRow({required this.sale, required this.onTap});

  final Map<String, dynamic> sale;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final admin = AdminScope.of(context);
    final scheme = Theme.of(context).colorScheme;
    final tag = _saleTag(context, sale);
    final voided = sale['status'] == 'void';
    final refund = sale['type'] == 'return';
    final methods = (sale['paymentMethods'] as List? ?? const []).cast<String>();
    final who = [
      shortDateTime(sale['soldAt']),
      if (sale['salesperson'] != null) sale['salesperson'] as String,
      if (admin.storeId == null) sale['storeName'] as String,
    ].join(' · ');
    final amount = admin.moneyIn(sale['total'], sale['currencyCode'] as String);

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
                  Row(
                    children: [
                      Flexible(
                        child: Text(sale['number'] as String, overflow: TextOverflow.ellipsis, style: tabular.copyWith(fontWeight: FontWeight.w700, fontSize: 15)),
                      ),
                      if (tag != null) ...[const SizedBox(width: 8), Tag(icon: tag.$1, label: tag.$2, color: tag.$3)],
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(who, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant)),
                  if (sale['customerName'] != null && sale['customerName'] != 'Cash Customer')
                    Text(sale['customerName'] as String, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant)),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  refund ? '−$amount' : amount,
                  style: tabular.copyWith(
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                    color: voided ? scheme.onSurfaceVariant : null,
                    decoration: voided ? TextDecoration.lineThrough : null,
                  ),
                ),
                const SizedBox(height: 3),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    for (final m in methods)
                      Padding(
                        padding: const EdgeInsets.only(left: 4),
                        child: Icon(_methodIcons[m] ?? Icons.payments_outlined, size: 15, color: scheme.onSurfaceVariant, semanticLabel: _methodLabels[m] ?? m),
                      ),
                  ],
                ),
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

/// Loads one sale and hands it to [builder], with a skeleton and a retry around it.
class _SaleLoader extends StatefulWidget {
  const _SaleLoader({required this.saleId, required this.title, required this.builder, this.actions});

  final String saleId;
  final String title;
  final Widget Function(BuildContext context, Map<String, dynamic> sale, VoidCallback reload) builder;
  final List<Widget> Function(Map<String, dynamic>? sale)? actions;

  @override
  State<_SaleLoader> createState() => _SaleLoaderState();
}

class _SaleLoaderState extends State<_SaleLoader> {
  Map<String, dynamic>? _sale;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final res = await AdminScope.read(context).call((api) => api.get('/sales/${widget.saleId}')) as Map;
      if (mounted) setState(() => _sale = res.cast());
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final sale = _sale;
    return Scaffold(
      appBar: AppBar(title: Text((sale?['number'] as String?) ?? widget.title), actions: widget.actions?.call(sale)),
      body: sale != null
          ? widget.builder(context, sale, _load)
          : _error != null
          ? Center(child: ErrorState(error: _error!, onRetry: _load))
          : const Padding(
              padding: EdgeInsets.all(16),
              child: Narrow(
                maxWidth: 560,
                child: Column(children: [SkeletonCard(lines: 2), SizedBox(height: 12), SkeletonCard(lines: 4), SizedBox(height: 12), SkeletonCard(lines: 2)]),
              ),
            ),
    );
  }
}

/// Everything about one transaction: what was sold, who by, how it was paid, and anything refunded from it.
class SaleDetailScreen extends StatelessWidget {
  const SaleDetailScreen({super.key, required this.saleId});

  final String saleId;

  @override
  Widget build(BuildContext context) => _SaleLoader(
    saleId: saleId,
    title: 'Transaction',
    builder: (context, sale, reload) => _SaleDetail(sale: sale, onRefresh: reload),
  );
}

class _SaleDetail extends StatelessWidget {
  const _SaleDetail({required this.sale, required this.onRefresh});

  final Map<String, dynamic> sale;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    final admin = AdminScope.of(context);
    final scheme = Theme.of(context).colorScheme;
    final currency = sale['currencyCode'] as String;
    String m(Object? v) => admin.moneyIn(v, currency);
    final tag = _saleTag(context, sale);
    final refund = sale['type'] == 'return';
    final lines = (sale['lines'] as List).cast<Map>();
    final payments = (sale['payments'] as List).cast<Map>();
    final related = (sale['related'] as List? ?? const []).cast<Map>();
    final foreign = currency != admin.session!.currencyCode;
    final discount = toCents(sale['discountTotal']);

    Widget info(String label, Object? value) => value == null || '$value'.isEmpty
        ? const SizedBox.shrink()
        : Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(width: 96, child: Text(label, style: TextStyle(color: scheme.onSurfaceVariant))),
                Expanded(child: Text('$value', style: const TextStyle(fontWeight: FontWeight.w500))),
              ],
            ),
          );

    return RefreshIndicator(
      onRefresh: () async => onRefresh(),
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
                        Row(
                          children: [
                            Text(refund ? 'Refunded' : 'Total', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: scheme.onSurfaceVariant)),
                            if (tag != null) ...[const SizedBox(width: 8), Tag(icon: tag.$1, label: tag.$2, color: tag.$3)],
                          ],
                        ),
                        const SizedBox(height: 4),
                        FittedBox(
                          fit: BoxFit.scaleDown,
                          alignment: Alignment.centerLeft,
                          child: Text(
                            m(sale['total']),
                            style: tabular.copyWith(fontSize: 34, fontWeight: FontWeight.w700, decoration: sale['status'] == 'void' ? TextDecoration.lineThrough : null),
                          ),
                        ),
                        if (foreign) Text('${admin.money(sale['totalBase'])} in ${admin.session!.currencyCode}', style: TextStyle(color: scheme.onSurfaceVariant)),
                        const SizedBox(height: 10),
                        info('When', shortDateTime(sale['soldAt'])),
                        info('Store', sale['storeName']),
                        info('Till', sale['deviceName']),
                        info('Cashier', sale['salesperson']),
                        info('Customer', sale['customerName']),
                        info(refund ? 'Reason' : 'Note', sale['note']),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                SectionCard(
                  title: '${lines.length} item${lines.length == 1 ? '' : 's'}',
                  child: Column(
                    children: [
                      for (final l in lines) _LineRow(line: l, money: m),
                      const Divider(height: 20),
                      if (discount > 0) ...[TotalRow('Subtotal', m(sale['subtotal'])), TotalRow('Discount', '−${m(sale['discountTotal'])}')],
                      if (toCents(sale['taxTotal']) > 0) TotalRow('VAT included', m(sale['taxTotal'])),
                      TotalRow('Total', m(sale['total']), big: true),
                    ],
                  ),
                ),
                if (payments.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  SectionCard(
                    title: refund ? 'Given back' : 'Paid',
                    child: Column(
                      children: [
                        for (final p in payments) ...[
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 5),
                            child: Row(
                              children: [
                                Icon(_methodIcons[p['method']] ?? Icons.payments_outlined, size: 20, color: scheme.onSurfaceVariant),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Text(
                                    '${_methodLabels[p['method']] ?? p['method']}${p['reference'] != null ? ' · ${p['reference']}' : ''}',
                                    style: const TextStyle(fontWeight: FontWeight.w500),
                                  ),
                                ),
                                Text(
                                  formatMoney(toCents(p['amount']).abs(), admin.symbolFor(p['currencyCode'] as String)),
                                  style: tabular.copyWith(fontWeight: FontWeight.w600),
                                ),
                              ],
                            ),
                          ),
                          if (toCents(p['change']) > 0) TotalRow('Change given', admin.moneyIn(p['change'], p['currencyCode'] as String)),
                        ],
                      ],
                    ),
                  ),
                ],
                if (related.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  SectionCard(
                    title: refund ? 'Refund of' : 'Refunds and related',
                    child: Column(
                      children: [
                        for (final r in related)
                          InkWell(
                            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => SaleDetailScreen(saleId: r['id'] as String))),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(vertical: 8),
                              child: Row(
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(r['number'] as String, style: tabular.copyWith(fontWeight: FontWeight.w600)),
                                        Text(
                                          '${r['type'] == 'return' ? 'Refund' : r['type'] == 'quotation' ? 'Quotation' : 'Sale'}'
                                          '${r['status'] == 'void' ? ', voided' : ''} · ${shortDateTime(r['soldAt'])}',
                                          style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant),
                                        ),
                                      ],
                                    ),
                                  ),
                                  Text(m(r['total']), style: tabular.copyWith(fontWeight: FontWeight.w600)),
                                  Icon(Icons.chevron_right, color: scheme.onSurfaceVariant.withValues(alpha: 0.6)),
                                ],
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                if (sale['type'] != 'quotation')
                  FilledButton.tonalIcon(
                    onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => AdminReceiptScreen(saleId: sale['id'] as String, sale: sale))),
                    icon: const Icon(Icons.receipt_long_outlined),
                    label: const Text('View receipt'),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _LineRow extends StatelessWidget {
  const _LineRow({required this.line, required this.money});

  final Map line;
  final String Function(Object?) money;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final variant = line['variantName'] as String?;
    final pack = line['packName'] as String?;
    final choices = [for (final c in (line['modifiers'] as List? ?? const [])) (c as Map)['name'] as String];
    final returned = parseFixed(line['returnedQuantity'], 3);
    final discount = toCents(line['discount']);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${line['productName']}${variant != null && variant != 'Default' ? ' · $variant' : ''}${pack != null ? ' ($pack)' : ''}',
                  style: const TextStyle(fontWeight: FontWeight.w500),
                ),
                Text(
                  '${formatQty(parseFixed(line['quantity'], 3))} × ${money(line['unitPrice'])}${discount > 0 ? ', less ${money(line['discount'])}' : ''}',
                  style: tabular.copyWith(fontSize: 12.5, color: scheme.onSurfaceVariant),
                ),
                if (choices.isNotEmpty) Text(choices.join(', '), style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant)),
                if (line['note'] != null) Text(line['note'] as String, style: TextStyle(fontSize: 12.5, fontStyle: FontStyle.italic, color: scheme.onSurfaceVariant)),
                if (returned > 0)
                  Padding(
                    padding: const EdgeInsets.only(top: 3),
                    child: Tag(icon: Icons.undo, label: '${formatQty(returned)} refunded', color: Brand.amberInk),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Text(money(line['total']), style: tabular.copyWith(fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}

/// A receipt looked up from the admin area: as it printed, to print again or send as a PDF
/// (the phone's share sheet offers WhatsApp, email and the rest).
class AdminReceiptScreen extends StatelessWidget {
  const AdminReceiptScreen({super.key, required this.saleId, this.sale});

  final String saleId;

  /// The sale, when the caller already has it.
  final Map<String, dynamic>? sale;

  @override
  Widget build(BuildContext context) {
    final given = sale;
    if (given != null) {
      return Scaffold(
        appBar: AppBar(title: Text(given['number'] as String), actions: _actions(context)),
        body: _ReceiptBody(sale: given),
      );
    }
    return _SaleLoader(saleId: saleId, title: 'Receipt', actions: (_) => _actions(context), builder: (context, sale, _) => _ReceiptBody(sale: sale));
  }

  List<Widget> _actions(BuildContext context) => [
    IconButton(
      tooltip: 'Receipt printer',
      icon: const Icon(Icons.settings_outlined),
      onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const PrinterScreen())),
    ),
  ];
}

class _ReceiptBody extends StatefulWidget {
  const _ReceiptBody({required this.sale});

  final Map<String, dynamic> sale;

  @override
  State<_ReceiptBody> createState() => _ReceiptBodyState();
}

class _ReceiptBodyState extends State<_ReceiptBody> {
  bool _busy = false;

  Receipt _receipt(AdminState admin) {
    final session = admin.session!;
    final store = admin.stores.where((s) => s.id == widget.sale['storeId']).firstOrNull;
    return Receipt.fromApiSale(
      widget.sale,
      businessName: session.businessName,
      address: store?.address ?? session.address,
      phone: store?.phone ?? session.phone,
      tin: session.tin,
      vatNumber: session.vatNumber,
      symbolOf: admin.symbolFor,
    );
  }

  Future<void> _run(Future<void> Function() action, String failed) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await action();
    } catch (e) {
      if (mounted) showMessage(context, '$failed: $e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final admin = AdminScope.of(context);
    final settings = TillScope.of(context).settings;
    final scheme = Theme.of(context).colorScheme;
    final r = _receipt(admin);
    final voided = widget.sale['status'] == 'void';
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Narrow(
        maxWidth: 440,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (voided) ...[
              Material(
                color: scheme.errorContainer,
                borderRadius: BorderRadius.circular(12),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    children: [
                      Icon(Icons.block, color: scheme.onErrorContainer, size: 20),
                      const SizedBox(width: 8),
                      Expanded(child: Text('This ${r.isReturn ? 'refund' : 'sale'} was voided.', style: TextStyle(color: scheme.onErrorContainer))),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],
            ReceiptView(receipt: r),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _busy ? null : () => _run(() => printSaleReceipt(settings, r), "Couldn't print"),
                    icon: const Icon(Icons.print_outlined),
                    label: const Text('Print again'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: _busy ? null : () => _run(() => shareReceipt(r, paperWidth: settings.paperWidth), "Couldn't share"),
                    icon: const Icon(Icons.ios_share),
                    label: const Text('Share PDF'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              settings.direct ? 'Prints on ${settings.printerName.isEmpty ? 'the receipt printer' : settings.printerName}.' : 'Prints through the phone\'s print dialog. Choose a Bluetooth receipt printer with the settings button above.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}
