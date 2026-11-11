import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/api.dart';
import '../core/money.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'admin_widgets.dart';
import 'paged_list.dart';
import 'sales_screens.dart';

/// Roles that see money owed (the API refuses everyone else).
const _bookkeepers = {'owner', 'admin', 'manager', 'accountant'};

/// Customers or suppliers: which endpoints, words and fields.
class _Kind {
  const _Kind({
    required this.path,
    required this.one,
    required this.many,
    required this.viewPermission,
    required this.editPermission,
    required this.fields,
    required this.icon,
  });

  final String path, one, many, viewPermission, editPermission;
  final IconData icon;
  final List<_Field> fields;
}

class _Field {
  const _Field(this.key, this.label, {this.keyboard = TextInputType.text, this.required = false, this.money = false, this.number = false, this.lines = 1});

  final String key, label;
  final TextInputType keyboard;
  final bool required, money, number;
  final int lines;
}

const _customers = _Kind(
  path: '/customers',
  one: 'customer',
  many: 'customers',
  viewPermission: 'customers.view',
  editPermission: 'customers.edit',
  icon: Icons.people_outline,
  fields: [
    _Field('name', 'Name', required: true),
    _Field('phone', 'Phone', keyboard: TextInputType.phone),
    _Field('email', 'Email', keyboard: TextInputType.emailAddress),
    _Field('address', 'Address', lines: 2),
    _Field('tin', 'TIN'),
    _Field('vatNumber', 'VAT number'),
    _Field('creditLimit', 'Credit limit', money: true),
  ],
);

const _suppliers = _Kind(
  path: '/suppliers',
  one: 'supplier',
  many: 'suppliers',
  viewPermission: 'suppliers.view',
  editPermission: 'suppliers.edit',
  icon: Icons.local_shipping_outlined,
  fields: [
    _Field('name', 'Name', required: true),
    _Field('contactName', 'Contact person'),
    _Field('phone', 'Phone', keyboard: TextInputType.phone),
    _Field('email', 'Email', keyboard: TextInputType.emailAddress),
    _Field('address', 'Address', lines: 2),
    _Field('tin', 'TIN'),
    _Field('vatNumber', 'VAT number'),
    _Field('paymentTermsDays', 'Pays within (days)', number: true),
  ],
);

/// Customers: search, what they owe, their purchases, and adding or editing one.
class CustomersScreen extends StatelessWidget {
  const CustomersScreen({super.key});

  @override
  Widget build(BuildContext context) => const _PeopleList(kind: _customers);
}

/// Suppliers: contact details, what is owed to them and their unpaid bills.
class SuppliersScreen extends StatelessWidget {
  const SuppliersScreen({super.key});

  @override
  Widget build(BuildContext context) => const _PeopleList(kind: _suppliers);
}

class _PeopleList extends StatefulWidget {
  const _PeopleList({required this.kind});

  final _Kind kind;

  @override
  State<_PeopleList> createState() => _PeopleListState();
}

class _PeopleListState extends State<_PeopleList> {
  late final PagedLoader _loader = PagedLoader(_fetch)..reload();
  String _search = '';

  @override
  void dispose() {
    _loader.dispose();
    super.dispose();
  }

  bool get _seesMoney => _bookkeepers.contains(AdminScope.read(context).session!.role);

  Future<Map<String, dynamic>> _fetch(int page, int pageSize) async {
    final admin = AdminScope.read(context);
    final res = await admin.fetch(
      widget.kind.path,
      query: {
        'page': '$page',
        'pageSize': '$pageSize',
        if (_search.isNotEmpty) 'search': _search,
        if (widget.kind == _customers && _seesMoney) 'withBalance': 'true',
      },
    );
    return (res as Map).cast();
  }

  Future<void> _open(Map<String, dynamic> party) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => _PartyScreen(kind: widget.kind, id: party['id'] as String, name: party['name'] as String)));
    _loader.reload(keep: true);
  }

  Future<void> _add() async {
    final created = await Navigator.push<Map<String, dynamic>>(context, MaterialPageRoute(builder: (_) => _PartyForm(kind: widget.kind)));
    if (created == null || !mounted) return;
    _loader.reload(keep: true);
    await _open(created);
  }

  @override
  Widget build(BuildContext context) {
    final admin = AdminScope.of(context);
    final scheme = Theme.of(context).colorScheme;
    final k = widget.kind;
    final header = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
          child: SearchBox(
            hint: k == _customers ? 'Name, phone, email or TIN' : 'Name, phone or TIN',
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
              _loader.first == null ? '' : '${_loader.total} ${_loader.total == 1 ? k.one : k.many}',
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
          icon: k.icon,
          title: 'No ${k.many} found',
          message: _search.isNotEmpty ? 'Nothing matches "$_search".' : null,
        ),
        itemBuilder: (context, p) => _PartyRow(party: p, onTap: () => _open(p)),
      ),
      floatingActionButton: admin.session!.can(k.editPermission)
          ? FloatingActionButton.extended(onPressed: _add, icon: const Icon(Icons.add), label: Text('Add ${k.one}'))
          : null,
    );
  }
}

class _PartyRow extends StatelessWidget {
  const _PartyRow({required this.party, required this.onTap});

  final Map<String, dynamic> party;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final admin = AdminScope.of(context);
    final scheme = Theme.of(context).colorScheme;
    final owed = party['owed'] == null ? 0 : toCents(party['owed']);
    final contact = [party['contactName'], party['phone'], party['email']].whereType<String>().where((s) => s.isNotEmpty).join(' · ');
    final inactive = party['active'] == false;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
        child: Row(
          children: [
            CircleAvatar(
              radius: 19,
              backgroundColor: Brand.ledgerSoft,
              child: Text(_initials(party['name'] as String), style: const TextStyle(color: Brand.ledgerDeep, fontWeight: FontWeight.w700, fontSize: 13.5)),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          party['name'] as String,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontWeight: FontWeight.w600, fontSize: 15, color: inactive ? scheme.onSurfaceVariant : null),
                        ),
                      ),
                      if (inactive) ...[const SizedBox(width: 6), Tag(icon: Icons.block, label: 'Inactive', color: scheme.onSurfaceVariant)],
                    ],
                  ),
                  if (contact.isNotEmpty) Text(contact, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant)),
                ],
              ),
            ),
            if (owed > 0) ...[
              const SizedBox(width: 10),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(formatMoney(owed, admin.symbol), style: tabular.copyWith(fontWeight: FontWeight.w700)),
                  Text(party.containsKey('paymentTermsDays') ? 'owed to them' : 'owes you', style: TextStyle(fontSize: 11.5, color: scheme.onSurfaceVariant)),
                ],
              ),
            ],
            const SizedBox(width: 4),
            Icon(Icons.chevron_right, color: scheme.onSurfaceVariant.withValues(alpha: 0.6)),
          ],
        ),
      ),
    );
  }
}

String _initials(String name) {
  final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
  if (parts.isEmpty) return '?';
  return (parts.length == 1 ? parts.first.substring(0, 1) : parts.first.substring(0, 1) + parts[1].substring(0, 1)).toUpperCase();
}

/// One customer or supplier: contact details, money owed, unpaid documents and (for customers) their purchases.
class _PartyScreen extends StatefulWidget {
  const _PartyScreen({required this.kind, required this.id, required this.name});

  final _Kind kind;
  final String id, name;

  @override
  State<_PartyScreen> createState() => _PartyScreenState();
}

class _PartyScreenState extends State<_PartyScreen> {
  Map<String, dynamic>? _party;
  List<Map>? _purchases;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  bool get _customer => widget.kind == _customers;

  Future<void> _load() async {
    final admin = AdminScope.read(context);
    final session = admin.session!;
    final money = _bookkeepers.contains(session.role);
    setState(() => _error = null);
    try {
      final results = await Future.wait([
        admin.fetch('${widget.kind.path}/${widget.id}${money ? '/summary' : ''}'),
        if (_customer && session.can('sales.view'))
          admin.fetch('/sales', query: {'customerId': widget.id, 'excludeQuotations': 'true', 'pageSize': '15'}),
      ]);
      if (!mounted) return;
      setState(() {
        _party = (results[0] as Map).cast();
        _purchases = results.length > 1 ? ((results[1] as Map)['items'] as List).cast<Map>() : null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _edit() async {
    final saved = await Navigator.push<Map<String, dynamic>>(context, MaterialPageRoute(builder: (_) => _PartyForm(kind: widget.kind, existing: _party)));
    if (saved != null && mounted) {
      showMessage(context, 'Saved');
      _load();
    }
  }

  void _copy(String what, String value) {
    Clipboard.setData(ClipboardData(text: value));
    showMessage(context, '$what copied');
  }

  @override
  Widget build(BuildContext context) {
    final admin = AdminScope.of(context);
    final scheme = Theme.of(context).colorScheme;
    final p = _party;
    final canEdit = admin.session!.can(widget.kind.editPermission);
    return Scaffold(
      appBar: AppBar(
        title: Text((p?['name'] as String?) ?? widget.name),
        actions: [if (p != null && canEdit) IconButton(tooltip: 'Edit', icon: const Icon(Icons.edit_outlined), onPressed: _edit)],
      ),
      body: p == null
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
                        if (p.containsKey('owed')) ...[_MoneyCard(party: p, customer: _customer), const SizedBox(height: 12)],
                        _ContactCard(party: p, onCopy: _copy, customer: _customer),
                        if (p.containsKey('owed')) ...[
                          const SizedBox(height: 12),
                          SectionCard(
                            title: _customer ? 'Unpaid invoices' : 'Unpaid bills',
                            child: _Documents(docs: ((_customer ? p['unpaidInvoices'] : p['unpaidBills']) as List).cast<Map>(), emptyTitle: 'Nothing unpaid'),
                          ),
                        ],
                        if (!_customer && p['recentBills'] != null) ...[
                          const SizedBox(height: 12),
                          SectionCard(
                            title: 'Latest bills and deliveries',
                            child: _Documents(docs: (p['recentBills'] as List).cast<Map>(), emptyTitle: 'No bills yet', showStore: true),
                          ),
                        ],
                        if (_purchases != null) ...[
                          const SizedBox(height: 12),
                          SectionCard(
                            title: 'Purchases at the till',
                            child: _purchases!.isEmpty
                                ? const EmptyState(icon: Icons.shopping_bag_outlined, title: 'No purchases yet')
                                : Column(
                                    children: [
                                      for (final s in _purchases!)
                                        InkWell(
                                          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => SaleDetailScreen(saleId: s['id'] as String))),
                                          child: Padding(
                                            padding: const EdgeInsets.symmetric(vertical: 8),
                                            child: Row(
                                              children: [
                                                Expanded(
                                                  child: Column(
                                                    crossAxisAlignment: CrossAxisAlignment.start,
                                                    children: [
                                                      Text(s['number'] as String, style: tabular.copyWith(fontWeight: FontWeight.w600)),
                                                      Text(
                                                        '${shortDateTime(s['soldAt'])} · ${s['storeName']}${s['type'] == 'return' ? ' · Refund' : ''}${s['status'] == 'void' ? ' · Voided' : ''}',
                                                        style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant),
                                                      ),
                                                    ],
                                                  ),
                                                ),
                                                Text(
                                                  '${s['type'] == 'return' ? '−' : ''}${admin.moneyIn(s['total'], s['currencyCode'] as String)}',
                                                  style: tabular.copyWith(
                                                    fontWeight: FontWeight.w600,
                                                    decoration: s['status'] == 'void' ? TextDecoration.lineThrough : null,
                                                  ),
                                                ),
                                                Icon(Icons.chevron_right, color: scheme.onSurfaceVariant.withValues(alpha: 0.6)),
                                              ],
                                            ),
                                          ),
                                        ),
                                    ],
                                  ),
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

class _MoneyCard extends StatelessWidget {
  const _MoneyCard({required this.party, required this.customer});

  final Map<String, dynamic> party;
  final bool customer;

  @override
  Widget build(BuildContext context) {
    final admin = AdminScope.of(context);
    final scheme = Theme.of(context).colorScheme;
    final owed = toCents(party['owed']);
    final overdue = toCents(party['overdue']);
    final creditLeft = party['creditLeft'];
    Widget stat(String label, String value, {String? note, Color? color}) => Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: scheme.onSurfaceVariant)),
          const SizedBox(height: 2),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(value, style: tabular.copyWith(fontSize: 20, fontWeight: FontWeight.w700, color: color)),
          ),
          if (note != null) Text(note, style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant)),
        ],
      ),
    );
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                stat(customer ? 'Owes you' : 'You owe them', formatMoney(owed, admin.symbol)),
                stat('Overdue', formatMoney(overdue, admin.symbol), color: overdue > 0 ? scheme.error : null),
              ],
            ),
            if (customer) ...[
              const Divider(height: 24),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  stat(
                    'Credit left',
                    creditLeft == null ? 'No limit' : formatMoney(toCents(creditLeft), admin.symbol),
                    note: party['creditLimit'] == null ? null : 'of ${admin.money(party['creditLimit'])}',
                    color: creditLeft != null && toCents(creditLeft) < 0 ? scheme.error : null,
                  ),
                  stat(
                    'Spent at the till',
                    admin.money(party['spent']),
                    note: '${party['salesCount']} sale${party['salesCount'] == 1 ? '' : 's'}${party['lastSaleAt'] == null ? '' : ', last ${shortDateTime(party['lastSaleAt'])}'}',
                  ),
                ],
              ),
            ] else ...[
              const Divider(height: 24),
              Row(
                children: [
                  stat('Pays within', '${party['paymentTermsDays']} days'),
                  stat('Bills', '${party['billCount']}'),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ContactCard extends StatelessWidget {
  const _ContactCard({required this.party, required this.onCopy, required this.customer});

  final Map<String, dynamic> party;
  final void Function(String what, String value) onCopy;
  final bool customer;

  @override
  Widget build(BuildContext context) {
    final rows = <(IconData, String, String)>[
      if (party['contactName'] != null) (Icons.person_outline, 'Contact', party['contactName'] as String),
      if (party['phone'] != null) (Icons.phone_outlined, 'Phone', party['phone'] as String),
      if (party['email'] != null) (Icons.email_outlined, 'Email', party['email'] as String),
      if (party['address'] != null) (Icons.place_outlined, 'Address', party['address'] as String),
      if (party['tin'] != null) (Icons.badge_outlined, 'TIN', party['tin'] as String),
      if (party['vatNumber'] != null) (Icons.receipt_outlined, 'VAT number', party['vatNumber'] as String),
    ];
    return SectionCard(
      title: 'Contact',
      child: rows.isEmpty
          ? const EmptyState(icon: Icons.contact_page_outlined, title: 'No contact details yet')
          : Column(
              children: [
                for (final (icon, label, value) in rows)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    leading: Icon(icon),
                    title: Text(value, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500)),
                    subtitle: Text(label),
                    trailing: IconButton(tooltip: 'Copy $label', icon: const Icon(Icons.copy, size: 18), onPressed: () => onCopy(label, value)),
                  ),
              ],
            ),
    );
  }
}

/// Invoices or bills: number, dates, what is left to pay and where it stands.
class _Documents extends StatelessWidget {
  const _Documents({required this.docs, required this.emptyTitle, this.showStore = false});

  final List<Map> docs;
  final String emptyTitle;
  final bool showStore;

  @override
  Widget build(BuildContext context) {
    final admin = AdminScope.of(context);
    final scheme = Theme.of(context).colorScheme;
    if (docs.isEmpty) return EmptyState(icon: Icons.check_circle_outline, title: emptyTitle);
    return Column(
      children: [
        for (final d in docs)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 7),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Wrap(
                        spacing: 8,
                        runSpacing: 2,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Text(d['number'] as String, style: tabular.copyWith(fontWeight: FontWeight.w600)),
                          _stateTag(context, d['state'] as String),
                        ],
                      ),
                      Text(
                        [
                          shortDay(d['date'] as String, weekday: false),
                          if (d['state'] != 'paid' && d['state'] != 'void') 'due ${shortDay(d['dueDate'] as String, weekday: false)}',
                          if (d['supplierReference'] != null) 'their ref ${d['supplierReference']}',
                          if (showStore && d['storeName'] != null) 'into ${d['storeName']}',
                        ].join(' · '),
                        style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      admin.moneyIn(d['state'] == 'paid' || d['state'] == 'void' ? d['total'] : d['balance'], d['currencyCode'] as String),
                      style: tabular.copyWith(fontWeight: FontWeight.w700),
                    ),
                    if (d['state'] == 'part_paid') Text('of ${admin.moneyIn(d['total'], d['currencyCode'] as String)}', style: tabular.copyWith(fontSize: 12, color: scheme.onSurfaceVariant)),
                  ],
                ),
              ],
            ),
          ),
      ],
    );
  }

  static Widget _stateTag(BuildContext context, String state) {
    final scheme = Theme.of(context).colorScheme;
    return switch (state) {
      'overdue' => Tag(icon: Icons.schedule, label: 'Overdue', color: scheme.error),
      'part_paid' => const Tag(icon: Icons.timelapse, label: 'Part paid', color: Brand.amberInk),
      'paid' => const Tag(icon: Icons.check, label: 'Paid', color: Brand.ledger),
      'void' => Tag(icon: Icons.block, label: 'Void', color: scheme.onSurfaceVariant),
      _ => Tag(icon: Icons.hourglass_empty, label: 'Unpaid', color: scheme.onSurfaceVariant),
    };
  }
}

/// Adds a customer or supplier, or edits one. Price lists, groups and other
/// settings stay on the web backoffice.
class _PartyForm extends StatefulWidget {
  const _PartyForm({required this.kind, this.existing});

  final _Kind kind;
  final Map<String, dynamic>? existing;

  @override
  State<_PartyForm> createState() => _PartyFormState();
}

class _PartyFormState extends State<_PartyForm> {
  late final Map<String, TextEditingController> _text = {
    for (final f in widget.kind.fields) f.key: TextEditingController(text: _initial(f)),
  };
  late bool _active = widget.existing?['active'] as bool? ?? true;
  bool _busy = false;
  String? _error;

  String _initial(_Field f) {
    final v = widget.existing?[f.key];
    if (v == null) return f.number && widget.existing == null && f.key == 'paymentTermsDays' ? '30' : '';
    return f.money ? fromCents(toCents(v)) : '$v';
  }

  @override
  void dispose() {
    for (final c in _text.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    final body = <String, dynamic>{};
    for (final f in widget.kind.fields) {
      final v = _text[f.key]!.text.trim();
      if (f.required && v.isEmpty) {
        setState(() => _error = 'Enter the ${f.label.toLowerCase()}');
        return;
      }
      if (f.money) {
        final cents = v.isEmpty ? null : tryParseFixed(v, 2);
        if (v.isNotEmpty && cents == null) {
          setState(() => _error = '${f.label} should be an amount');
          return;
        }
        body[f.key] = cents == null ? null : fromCents(cents);
      } else if (f.number) {
        final n = int.tryParse(v);
        if (n == null) {
          setState(() => _error = '${f.label} should be a whole number');
          return;
        }
        body[f.key] = n;
      } else if (v.isNotEmpty) {
        body[f.key] = v;
      } else if (widget.existing?[f.key] != null) {
        // Clearing a field: the API treats an empty text as "leave out", so say null explicitly where it may be cleared.
        body[f.key] = null;
      }
    }
    if (widget.existing != null) body['active'] = _active;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final admin = AdminScope.read(context);
      final existing = widget.existing;
      final res = await admin.call(
        (api) => existing == null ? api.post(widget.kind.path, body) : api.patch('${widget.kind.path}/${existing['id']}', body),
      );
      if (mounted) Navigator.pop(context, (res as Map).cast<String, dynamic>());
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
    final k = widget.kind;
    final editing = widget.existing != null;
    return Scaffold(
      appBar: AppBar(title: Text(editing ? 'Edit ${k.one}' : 'Add ${k.one}')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Narrow(
          maxWidth: 520,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final f in k.fields) ...[
                if (f.money)
                  AmountField(controller: _text[f.key]!, label: '${f.label} (optional)', prefix: admin.symbol)
                else
                  TextField(
                    controller: _text[f.key],
                    autofocus: f.key == 'name' && !editing,
                    keyboardType: f.number ? TextInputType.number : f.keyboard,
                    inputFormatters: f.number ? [FilteringTextInputFormatter.digitsOnly] : null,
                    textCapitalization: f.keyboard == TextInputType.text ? TextCapitalization.words : TextCapitalization.none,
                    minLines: f.lines,
                    maxLines: f.lines,
                    decoration: InputDecoration(labelText: f.required || f.number ? f.label : '${f.label} (optional)'),
                  ),
                const SizedBox(height: 12),
              ],
              if (editing)
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text('Active ${k.one}'),
                  subtitle: Text(_active ? 'Shows in lists and at the till' : 'Hidden from new sales and bills; history stays'),
                  value: _active,
                  onChanged: _busy ? null : (v) => setState(() => _active = v),
                ),
              if (k == _customers)
                Text('Price lists and customer groups are set on the web backoffice.', style: TextStyle(fontSize: 12.5, color: Theme.of(context).colorScheme.onSurfaceVariant)),
              if (_error != null) ...[const SizedBox(height: 12), Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))],
              const SizedBox(height: 16),
              FilledButton(
                onPressed: _busy ? null : _save,
                child: _busy ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2.4)) : Text(editing ? 'Save' : 'Add ${k.one}'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
