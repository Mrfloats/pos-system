import 'package:flutter/material.dart';

import '../theme.dart';
import '../widgets/common.dart';
import 'admin_state.dart';
import 'admin_widgets.dart';
import 'dashboard_screen.dart';
import 'sales_screens.dart';

/// One entry in the admin menu. It is shown only to people with [permission]
/// (the API checks again on every request, so hiding it is a courtesy, not the lock).
class AdminSection {
  const AdminSection({required this.id, required this.label, required this.icon, this.permission, required this.builder});

  final String id, label;
  final IconData icon;
  final String? permission;
  final WidgetBuilder builder;
}

/// The admin menu, top to bottom.
final adminSections = <AdminSection>[
  AdminSection(id: 'dashboard', label: 'Dashboard', icon: Icons.space_dashboard_outlined, permission: 'dashboard.view', builder: (_) => const DashboardScreen()),
  AdminSection(id: 'sales', label: 'Sales Activity', icon: Icons.point_of_sale_outlined, permission: 'sales.view', builder: (_) => const SalesActivityScreen()),
  AdminSection(id: 'receipts', label: 'Receipts', icon: Icons.receipt_long_outlined, permission: 'sales.view', builder: (_) => const ReceiptsScreen()),
];

/// What stays on the web backoffice, and says so.
const _webOnly = [
  ('Staff, roles and permissions', Icons.badge_outlined),
  ('Tax, currency and business settings', Icons.tune),
  ('Imports, exports and backups', Icons.import_export),
  ('Removing past transactions', Icons.history_toggle_off),
];

/// The admin area: a menu drawer and the chosen section. On a wide screen the
/// menu stays open at the side.
class AdminShell extends StatefulWidget {
  const AdminShell({super.key, this.tillAvailable = false});

  /// This device is also paired as a till, so the menu offers a way back to it.
  final bool tillAvailable;

  @override
  State<AdminShell> createState() => _AdminShellState();
}

class _AdminShellState extends State<AdminShell> {
  String? _current;

  @override
  Widget build(BuildContext context) {
    final admin = AdminScope.of(context);
    final session = admin.session!;
    final sections = adminSections.where((s) => s.permission == null || session.can(s.permission!)).toList();
    final current = sections.where((s) => s.id == _current).firstOrNull ?? sections.firstOrNull;
    final wide = isWide(context);

    final menu = _Menu(
      sections: sections,
      currentId: current?.id,
      tillAvailable: widget.tillAvailable,
      onSelect: (s) {
        setState(() => _current = s.id);
        if (!wide) Navigator.pop(context);
      },
    );

    final body = current == null
        ? const Center(
            child: EmptyState(
              icon: Icons.lock_outline,
              title: 'Nothing to show',
              message: "An owner hasn't given you permission for anything here yet.",
            ),
          )
        // A new section, or another business: start it afresh.
        : KeyedSubtree(key: ValueKey('${current.id}:${session.tenantId}'), child: current.builder(context));

    return Scaffold(
      appBar: AppBar(title: Text(current?.label ?? session.businessName), actions: const [_StorePicker(), SizedBox(width: 4)]),
      drawer: wide ? null : Drawer(backgroundColor: Brand.ledgerDeep, child: menu),
      body: wide
          ? Row(
              children: [
                SizedBox(width: 290, child: ColoredBox(color: Brand.ledgerDeep, child: menu)),
                Expanded(child: body),
              ],
            )
          : body,
    );
  }
}

/// Chooses the branch every screen looks at, or all of them together.
class _StorePicker extends StatelessWidget {
  const _StorePicker();

  @override
  Widget build(BuildContext context) {
    final admin = AdminScope.of(context);
    if (admin.stores.length < 2) return const SizedBox.shrink();
    return PopupMenuButton<String>(
      tooltip: 'Choose a store',
      onSelected: (id) => admin.setStore(id.isEmpty ? null : id),
      itemBuilder: (_) => [
        CheckedPopupMenuItem(value: '', checked: admin.storeId == null, child: const Text('All stores')),
        for (final s in admin.stores) CheckedPopupMenuItem(value: s.id, checked: admin.storeId == s.id, child: Text(s.name)),
      ],
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.storefront_outlined, size: 20, color: Colors.white),
            const SizedBox(width: 6),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 130),
              child: Text(
                admin.currentStore?.name ?? 'All stores',
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
              ),
            ),
            const Icon(Icons.arrow_drop_down, color: Colors.white),
          ],
        ),
      ),
    );
  }
}

class _Menu extends StatelessWidget {
  const _Menu({required this.sections, required this.currentId, required this.onSelect, required this.tillAvailable});

  final List<AdminSection> sections;
  final String? currentId;
  final ValueChanged<AdminSection> onSelect;
  final bool tillAvailable;

  Future<void> _switchBusiness(BuildContext context, AdminState admin) async {
    final session = admin.session!;
    final chosen = await showDialog<Business>(
      context: context,
      builder: (context) => SimpleDialog(
        title: const Text('Switch business'),
        children: [
          for (final b in session.businesses)
            ListTile(
              leading: Icon(b.tenantId == session.tenantId ? Icons.radio_button_checked : Icons.radio_button_off),
              title: Text(b.name),
              subtitle: Text(roleLabels[b.role] ?? b.role),
              onTap: () => Navigator.pop(context, b),
            ),
        ],
      ),
    );
    if (chosen == null || chosen.tenantId == session.tenantId || !context.mounted) return;
    final error = await admin.switchBusiness(chosen.tenantId);
    if (error != null && context.mounted) showMessage(context, error, error: true);
  }

  void _showWebOnly(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Available on the web backoffice', style: Theme.of(context).textTheme.titleMedium!.copyWith(fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              Text(
                'These need a bigger screen and a little more care, so they stay on the web.',
                style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
              ),
              const SizedBox(height: 8),
              for (final (label, icon) in _webOnly) ListTile(contentPadding: EdgeInsets.zero, leading: Icon(icon), title: Text(label)),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final admin = AdminScope.of(context);
    final session = admin.session!;
    final faint = Colors.white.withValues(alpha: 0.7);
    return SafeArea(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 20, 16, 12),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 24,
                  backgroundColor: Brand.mint,
                  child: Text(session.initials, style: const TextStyle(color: Brand.ledgerDeep, fontWeight: FontWeight.w700, fontSize: 17)),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        session.fullName,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: 2),
                      Text('${session.roleLabel} — ID: ${session.staffCode}', style: TextStyle(color: faint, fontSize: 13)),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Material(
              color: Colors.white.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(12),
              child: InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: session.businesses.length > 1 ? () => _switchBusiness(context, admin) : null,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  child: Row(
                    children: [
                      const Icon(Icons.business_outlined, size: 18, color: Colors.white),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(session.businessName, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
                      ),
                      if (session.businesses.length > 1) Icon(Icons.unfold_more, size: 18, color: faint),
                    ],
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 10),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              children: [
                for (final s in sections) _MenuItem(icon: s.icon, label: s.label, selected: s.id == currentId, onTap: () => onSelect(s)),
                Divider(color: Colors.white.withValues(alpha: 0.12), height: 24),
                if (tillAvailable) _MenuItem(icon: Icons.point_of_sale_outlined, label: 'Go to the till', onTap: admin.goToTill),
                _MenuItem(icon: Icons.computer_outlined, label: 'More on the web', onTap: () => _showWebOnly(context)),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
            child: _MenuItem(
              icon: Icons.logout,
              label: 'Logout',
              color: const Color(0xFFFF8A80),
              onTap: () async {
                final ok = await confirm(context, title: 'Log out?', message: "You'll need your email and password to sign in again.", yes: 'Log out', danger: true);
                if (ok) await admin.signOut();
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _MenuItem extends StatelessWidget {
  const _MenuItem({required this.icon, required this.label, required this.onTap, this.selected = false, this.color = Colors.white});

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool selected;
  final Color color;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 2),
    child: Material(
      color: selected ? Brand.ledger : Colors.transparent,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 50),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14),
            child: Row(
              children: [
                Icon(icon, color: color, size: 22),
                const SizedBox(width: 14),
                Expanded(
                  child: Text(label, style: TextStyle(color: color, fontSize: 15, fontWeight: selected ? FontWeight.w700 : FontWeight.w500)),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}
