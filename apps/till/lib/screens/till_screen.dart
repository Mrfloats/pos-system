import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/money.dart';
import '../printing/print_receipt.dart';
import '../printing/printers.dart';
import '../theme.dart';
import '../widgets/cart_panel.dart';
import '../widgets/common.dart';
import '../widgets/product_panel.dart';
import 'history_screen.dart';
import 'settings_screen.dart';
import 'shift_screens.dart';

/// Where selling happens. Side by side on tablets, countertops and desktops;
/// on phones the basket opens from the bar at the bottom.
class TillScreen extends StatefulWidget {
  const TillScreen({super.key});

  @override
  State<TillScreen> createState() => _TillScreenState();
}

class _TillScreenState extends State<TillScreen> {
  bool _askedForShift = false;

  void _lock() {
    Navigator.of(context).popUntil((r) => r.isFirst);
    TillScope.read(context).lock();
  }

  Future<void> _openDrawer() async {
    try {
      await openCashDrawer(TillScope.read(context).settings);
    } on PrinterException catch (e) {
      if (mounted) showMessage(context, e.message, error: true);
    }
  }

  Future<void> _refresh() async {
    final state = TillScope.read(context);
    try {
      await state.refreshCatalog();
      await state.sync();
      if (mounted) showMessage(context, 'Products and prices are up to date');
    } on ApiException catch (e) {
      if (mounted) showMessage(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = TillScope.of(context);
    final session = state.session!;
    final catalog = state.catalog;
    final wide = isWide(context);

    // Once Floatly has said whether this person has a shift open, offer to open one.
    if (!_askedForShift && state.shiftChecked && catalog != null) {
      _askedForShift = true;
      if (state.shift == null) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) openShift(context, offered: true);
        });
      }
    }

    if (catalog == null) {
      return Scaffold(
        appBar: AppBar(
          title: Text(state.device!.storeName),
          actions: [IconButton(tooltip: 'Lock', onPressed: _lock, icon: const Icon(Icons.lock_outline))],
        ),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (state.online) const CircularProgressIndicator() else const Icon(Icons.cloud_off_outlined, size: 48),
                const SizedBox(height: 16),
                Text(
                  state.online ? 'Downloading products…' : "Can't reach Floatly to download the products. Check the internet connection.",
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 16),
                if (!state.online) FilledButton(onPressed: _refresh, child: const Text('Try again')),
              ],
            ),
          ),
        ),
      );
    }

    final waiting = state.waitingCount;
    final refused = state.refusedCount;
    final cart = state.priced;

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 12,
        title: Row(
          children: [
            const BrandMark(size: 30),
            const SizedBox(width: 10),
            Flexible(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(catalog.store.name, overflow: TextOverflow.ellipsis),
                  Text(
                    session.fullName,
                    style: TextStyle(fontSize: 12.5, color: Colors.white.withValues(alpha: 0.75), fontWeight: FontWeight.w400),
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          if (wide) ...[
            StatusPill(
              icon: state.online ? Icons.cloud_done_outlined : Icons.cloud_off_outlined,
              label: state.online ? (session.token == null ? 'Signing in…' : 'Online') : 'Offline',
              color: state.online ? Brand.mint : Brand.amber,
            ),
            const SizedBox(width: 8),
          ] else if (!state.online)
            const Padding(
              padding: EdgeInsets.only(right: 4),
              child: Icon(Icons.cloud_off_outlined, color: Brand.amber),
            ),
          if (waiting + refused > 0) ...[
            StatusPill(
              icon: refused > 0 ? Icons.error_outline : Icons.upload_outlined,
              label: refused > 0 ? '$refused refused' : '$waiting to upload',
              color: refused > 0 ? const Color(0xFFFFB4A9) : Brand.amber,
              onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const HistoryScreen())),
            ),
            const SizedBox(width: 8),
          ],
          if (wide)
            StatusPill(
              icon: Icons.schedule,
              label: state.shift == null ? 'No shift' : 'Shift ${state.shift!.number}',
              color: state.shift == null ? Brand.amber : Colors.white,
              onTap: () => state.shift == null ? openShift(context) : closeShift(context),
            ),
          IconButton(
            tooltip: 'Sales',
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const HistoryScreen())),
            icon: const Icon(Icons.receipt_long_outlined),
          ),
          PopupMenuButton<String>(
            onSelected: (v) {
              switch (v) {
                case 'open':
                  openShift(context);
                case 'close':
                  closeShift(context);
                case 'refresh':
                  _refresh();
                case 'drawer':
                  _openDrawer();
                case 'settings':
                  Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SettingsScreen()));
                case 'lock':
                  _lock();
              }
            },
            itemBuilder: (_) => [
              if (state.shift == null)
                const PopupMenuItem(
                  value: 'open',
                  child: ListTile(leading: Icon(Icons.play_circle_outline), title: Text('Open shift')),
                )
              else
                PopupMenuItem(
                  value: 'close',
                  child: ListTile(leading: const Icon(Icons.stop_circle_outlined), title: Text('Close shift ${state.shift!.number}')),
                ),
              if (session.canManage && state.settings.direct)
                const PopupMenuItem(
                  value: 'drawer',
                  child: ListTile(leading: Icon(Icons.lock_open_outlined), title: Text('Open cash drawer')),
                ),
              const PopupMenuItem(
                value: 'refresh',
                child: ListTile(leading: Icon(Icons.sync), title: Text('Update products and prices')),
              ),
              const PopupMenuItem(
                value: 'settings',
                child: ListTile(leading: Icon(Icons.settings_outlined), title: Text('Till settings')),
              ),
              const PopupMenuItem(
                value: 'lock',
                child: ListTile(leading: Icon(Icons.lock_outline), title: Text('Lock (change cashier)')),
              ),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          if (state.notice != null) _Banner(text: state.notice!, color: Brand.amberSoft, ink: Brand.amberInk),
          if (state.online && session.token == null && waiting > 0)
            _Banner(text: "Sales can't upload until you sign in again.", color: Brand.amberSoft, ink: Brand.amberInk, action: 'Sign in', onAction: _lock),
          Expanded(
            child: wide
                ? Row(
                    children: [
                      const Expanded(child: ProductPanel()),
                      VerticalDivider(width: 1, color: Theme.of(context).colorScheme.outlineVariant),
                      const SizedBox(width: 400, child: CartPanel()),
                    ],
                  )
                : const ProductPanel(),
          ),
        ],
      ),
      bottomNavigationBar: wide || cart.isEmpty
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 6, 12, 10),
                child: FilledButton(
                  onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const _CartPage())),
                  child: Row(
                    children: [
                      const Icon(Icons.shopping_basket_outlined),
                      const SizedBox(width: 10),
                      Text('${formatQty(cart.itemCount)} ${cart.itemCount == 1000 ? 'item' : 'items'}'),
                      const Spacer(),
                      Text(formatMoney(cart.total, cart.currency.label), style: tabular),
                      const Icon(Icons.chevron_right),
                    ],
                  ),
                ),
              ),
            ),
    );
  }
}

class _CartPage extends StatelessWidget {
  const _CartPage();

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Sale')),
    body: const CartPanel(),
  );
}

class _Banner extends StatelessWidget {
  const _Banner({required this.text, required this.color, required this.ink, this.action, this.onAction});

  final String text;
  final Color color, ink;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) => Material(
    color: color,
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        children: [
          Icon(Icons.info_outline, color: ink, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(text, style: TextStyle(color: ink)),
          ),
          if (action != null) TextButton(onPressed: onAction, child: Text(action!)),
        ],
      ),
    ),
  );
}
