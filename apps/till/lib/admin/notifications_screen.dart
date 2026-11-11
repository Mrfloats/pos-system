import 'package:flutter/material.dart';

import '../core/api.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'admin_state.dart';
import 'admin_widgets.dart';
import 'inventory_screens.dart';
import 'reports_screen.dart';
import 'returns_screen.dart';
import 'sales_screens.dart';

/// The bell in the top bar, with how many notifications are new.
class NotificationBell extends StatelessWidget {
  const NotificationBell({super.key});

  @override
  Widget build(BuildContext context) {
    final admin = AdminScope.of(context);
    if (!admin.session!.can('dashboard.view')) return const SizedBox.shrink();
    final count = admin.unseenCount;
    return IconButton(
      tooltip: count == 0 ? 'Notifications' : '$count new notification${count == 1 ? '' : 's'}',
      onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const NotificationsScreen())),
      icon: Badge(
        isLabelVisible: count > 0,
        backgroundColor: Brand.amber,
        textColor: Brand.ledgerDeep,
        label: Text(count > 9 ? '9+' : '$count'),
        child: const Icon(Icons.notifications_outlined, color: Colors.white),
      ),
    );
  }
}

const _icons = {
  'low_stock': Icons.warning_amber_rounded,
  'request': Icons.assignment_return_outlined,
  'large_refund': Icons.undo,
  'void': Icons.block,
  'end_of_day': Icons.nights_stay_outlined,
};

/// Low stock, requests waiting, large refunds, voids and yesterday's takings.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  /// What was new when the screen opened, so it stays marked while it's read.
  late final Set<String> _newIds;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    final admin = AdminScope.read(context);
    _newIds = _unseen(admin.notifications, admin);
    _refresh();
  }

  /// The list is newest first, so the new ones are the first [AdminState.unseenCount].
  Set<String> _unseen(List<Map<String, dynamic>> list, AdminState admin) => {
    for (final n in list.take(admin.unseenCount)) n['id'] as String,
  };

  Future<void> _refresh() async {
    final admin = AdminScope.read(context);
    await admin.loadNotifications();
    if (!mounted) return;
    setState(() {
      _newIds.addAll(_unseen(admin.notifications, admin));
      _loading = false;
    });
    await admin.markNotificationsSeen();
  }

  Future<void> _open(Map<String, dynamic> n) async {
    final link = (n['link'] as Map).cast<String, dynamic>();
    final id = link['id'] as String?;
    switch (link['to']) {
      case 'low_stock':
        await Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => Scaffold(
              appBar: AppBar(title: const Text('Low stock')),
              body: ItemList(
                lowStockFirst: true,
                onPick: (context, item, reload) async {
                  await Navigator.push(context, MaterialPageRoute(builder: (_) => ItemScreen(variantId: item['variantId'] as String)));
                  reload();
                },
              ),
            ),
          ),
        );
      case 'request':
        try {
          final r = await AdminScope.read(context).fetch('/sale-requests/$id') as Map;
          if (!mounted) return;
          await Navigator.push(context, MaterialPageRoute(builder: (_) => RequestScreen(request: r.cast())));
          _refresh();
        } on ApiException catch (e) {
          if (mounted) showMessage(context, e.message, error: true);
        }
      case 'sale':
        await Navigator.push(context, MaterialPageRoute(builder: (_) => SaleDetailScreen(saleId: id!)));
      case 'daily_report':
        await Navigator.push(context, MaterialPageRoute(builder: (_) => Scaffold(appBar: AppBar(title: const Text('Reports')), body: const ReportsScreen())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final admin = AdminScope.of(context);
    final scheme = Theme.of(context).colorScheme;
    final list = admin.notifications;
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            Narrow(
              maxWidth: 640,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (list.isEmpty && _loading) ...[for (var i = 0; i < 4; i++) const Padding(padding: EdgeInsets.fromLTRB(16, 12, 16, 0), child: SkeletonCard(lines: 1))],
                  if (list.isEmpty && !_loading)
                    const EmptyState(icon: Icons.notifications_none, title: 'Nothing to report', message: 'Low stock, refund requests, large refunds and voids show here.'),
                  for (final n in list)
                    InkWell(
                      onTap: () => _open(n),
                      child: Container(
                        color: _newIds.contains(n['id']) ? scheme.primary.withValues(alpha: 0.06) : null,
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Padding(
                              padding: const EdgeInsets.only(top: 2, right: 12),
                              child: Icon(_icons[n['kind']] ?? Icons.notifications_outlined, color: n['attention'] == true ? Brand.amberInk : scheme.primary),
                            ),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(n['title'] as String, style: TextStyle(fontWeight: _newIds.contains(n['id']) ? FontWeight.w700 : FontWeight.w600)),
                                  Text(n['body'] as String, style: const TextStyle(fontSize: 13.5)),
                                  Text(shortDateTime(n['at']), style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant)),
                                ],
                              ),
                            ),
                            if (_newIds.contains(n['id']))
                              Padding(
                                padding: const EdgeInsets.only(left: 8, top: 6),
                                child: Semantics(
                                  label: 'New',
                                  child: Container(width: 8, height: 8, decoration: BoxDecoration(color: scheme.primary, shape: BoxShape.circle)),
                                ),
                              ),
                          ],
                        ),
                      ),
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
