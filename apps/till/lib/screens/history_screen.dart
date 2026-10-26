import 'package:flutter/material.dart';

import '../core/money.dart';
import '../models/receipt.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'receipt_screen.dart';

/// Sales made on this till, newest first, with whether each has reached Floatly.
class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key});

  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  bool _syncing = false;

  Future<void> _sync() async {
    final state = TillScope.read(context);
    setState(() => _syncing = true);
    await state.sync();
    if (!mounted) return;
    setState(() => _syncing = false);
    final left = state.waitingCount;
    showMessage(
      context,
      left == 0 ? 'Everything is uploaded' : (state.online ? '$left still waiting' : "Can't reach Floatly. Sales stay saved on this till."),
      error: left > 0,
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = TillScope.of(context);
    final scheme = Theme.of(context).colorScheme;
    final receipts = state.receipts;
    final waiting = state.waitingCount;
    final refused = state.refusedCount;
    String two(int n) => n.toString().padLeft(2, '0');

    return Scaffold(
      appBar: AppBar(title: const Text('Sales on this till')),
      body: Narrow(
        maxWidth: 720,
        child: ListView(
          padding: const EdgeInsets.symmetric(vertical: 8),
          children: [
            if (waiting + refused > 0)
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
                child: Card(
                  color: refused > 0 ? scheme.errorContainer : Brand.amberSoft,
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Row(
                      children: [
                        Icon(refused > 0 ? Icons.error_outline : Icons.cloud_upload_outlined, color: refused > 0 ? scheme.onErrorContainer : Brand.amberInk),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            [
                              if (waiting > 0) '$waiting waiting to upload',
                              if (refused > 0)
                                '$refused refused by Floatly. A manager can open ${refused == 1 ? 'it' : 'each one'} to try again or discard it.',
                            ].join('. '),
                            style: TextStyle(color: refused > 0 ? scheme.onErrorContainer : Brand.amberInk),
                          ),
                        ),
                        if (waiting > 0)
                          _syncing
                              ? const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2.4))
                              : TextButton(onPressed: _sync, child: const Text('Upload now')),
                      ],
                    ),
                  ),
                ),
              ),
            if (receipts.isEmpty)
              Padding(
                padding: const EdgeInsets.all(48),
                child: Text(
                  'No sales on this till yet',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: scheme.onSurfaceVariant),
                ),
              ),
            for (final r in receipts)
              ListTile(
                leading: _StatusIcon(receipt: r),
                title: Text(r.number ?? r.reference, style: const TextStyle(fontWeight: FontWeight.w600)),
                subtitle: Text(
                  [
                    '${two(r.soldAt.day)}/${two(r.soldAt.month)} ${two(r.soldAt.hour)}:${two(r.soldAt.minute)}',
                    r.cashier,
                    if (r.customerName != null) r.customerName!,
                    if (state.pendingFor(r)?.error != null) 'Refused',
                    if (r.discarded) 'Discarded',
                  ].join(' · '),
                ),
                trailing: Text(formatMoney(r.total, r.symbol), style: tabular.copyWith(fontWeight: FontWeight.w600)),
                onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ReceiptScreen(receipt: r))),
              ),
            if (receipts.isNotEmpty)
              Padding(
                padding: const EdgeInsets.all(16),
                child: Text(
                  'The backoffice has every sale from every till under Sales.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12.5),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _StatusIcon extends StatelessWidget {
  const _StatusIcon({required this.receipt});

  final Receipt receipt;

  @override
  Widget build(BuildContext context) {
    final state = TillScope.of(context);
    final scheme = Theme.of(context).colorScheme;
    final (IconData icon, Color color, String tip) = receipt.discarded
        ? (Icons.block, scheme.outline, 'Discarded')
        : receipt.uploaded
        ? (Icons.cloud_done_outlined, scheme.primary, 'Uploaded')
        : state.pendingFor(receipt)?.error != null
        ? (Icons.error_outline, scheme.error, 'Refused')
        : (Icons.cloud_upload_outlined, Brand.amber, 'Waiting to upload');
    return Tooltip(
      message: tip,
      child: Icon(icon, color: color),
    );
  }
}
