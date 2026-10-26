import 'package:flutter/material.dart';

import '../core/money.dart';
import '../models/receipt.dart';
import '../printing/receipt_pdf.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'refund_screen.dart';

/// A sale's receipt: shown after a sale and from the sales list, to print, share or refund.
class ReceiptScreen extends StatefulWidget {
  const ReceiptScreen({super.key, required this.receipt, this.justSold = false});

  final Receipt receipt;
  final bool justSold;

  @override
  State<ReceiptScreen> createState() => _ReceiptScreenState();
}

class _ReceiptScreenState extends State<ReceiptScreen> {
  @override
  void initState() {
    super.initState();
    final settings = TillScope.read(context).settings;
    if (widget.justSold && settings.autoPrint) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _print());
    }
  }

  Future<void> _print() async {
    try {
      await printReceipt(widget.receipt, paperWidth: TillScope.read(context).settings.paperWidth);
    } catch (e) {
      if (mounted) showMessage(context, "Couldn't print: $e", error: true);
    }
  }

  Future<void> _share() async {
    try {
      await shareReceipt(widget.receipt, paperWidth: TillScope.read(context).settings.paperWidth);
    } catch (e) {
      if (mounted) showMessage(context, "Couldn't share: $e", error: true);
    }
  }

  void _done() => Navigator.of(context).popUntil((r) => r.isFirst);

  @override
  Widget build(BuildContext context) {
    final state = TillScope.of(context);
    final r = widget.receipt;
    final pending = state.pendingFor(r);
    final scheme = Theme.of(context).colorScheme;
    final canManage = state.session?.canManage ?? false;

    final (IconData icon, String status, Color color) = r.discarded
        ? (Icons.block, 'Discarded: not recorded in Floatly', scheme.error)
        : r.uploaded
        ? (Icons.cloud_done_outlined, 'Recorded in Floatly as ${r.number}', scheme.primary)
        : pending?.error != null
        ? (Icons.error_outline, 'Floatly refused this sale: ${pending!.error}', scheme.error)
        : (Icons.cloud_upload_outlined, 'Saved on this till. It uploads when the internet is available.', Brand.amberInk);

    // After a sale, Back starts the next sale instead of returning to the (now empty) basket.
    return PopScope(
      canPop: !widget.justSold,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _done();
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(widget.justSold ? 'Sale complete' : (r.number ?? r.reference)),
          automaticallyImplyLeading: !widget.justSold,
          actions: [IconButton(tooltip: 'Share as PDF', onPressed: _share, icon: const Icon(Icons.ios_share))],
        ),
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Narrow(
            maxWidth: 440,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (widget.justSold && r.change > 0)
                  Container(
                    margin: const EdgeInsets.only(bottom: 12),
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(color: Brand.ledgerSoft, borderRadius: BorderRadius.circular(16)),
                    child: Column(
                      children: [
                        const Text(
                          'Give change',
                          style: TextStyle(color: Brand.ledgerDeep, fontWeight: FontWeight.w600),
                        ),
                        Text(
                          formatMoney(r.change, r.changeSymbol ?? r.symbol),
                          style: tabular.copyWith(fontSize: 38, fontWeight: FontWeight.w800, color: Brand.ledgerDeep),
                        ),
                      ],
                    ),
                  ),
                Row(
                  children: [
                    Icon(icon, color: color, size: 20),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(status, style: TextStyle(color: color)),
                    ),
                  ],
                ),
                if (pending?.error != null && canManage)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Row(
                      children: [
                        TextButton.icon(onPressed: () => state.retry(pending!), icon: const Icon(Icons.refresh), label: const Text('Try again')),
                        TextButton.icon(
                          style: TextButton.styleFrom(foregroundColor: scheme.error),
                          onPressed: () async {
                            if (await confirm(
                              context,
                              title: 'Discard this sale?',
                              message: "It won't be recorded in Floatly: no stock comes off and the money isn't in the books. Do this only if the sale didn't really happen or was entered again.",
                              yes: 'Discard',
                              danger: true,
                            )) {
                              await state.discard(pending!);
                            }
                          },
                          icon: const Icon(Icons.delete_outline),
                          label: const Text('Discard'),
                        ),
                      ],
                    ),
                  ),
                const SizedBox(height: 12),
                ReceiptView(receipt: r),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(onPressed: _print, icon: const Icon(Icons.print_outlined), label: const Text('Print')),
                    ),
                    if (canManage && r.uploaded && !widget.justSold) ...[
                      const SizedBox(width: 10),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: state.online
                              ? () => Navigator.of(context).push(
                                  MaterialPageRoute(
                                    builder: (_) => RefundScreen(saleId: r.saleId!, number: r.number!),
                                  ),
                                )
                              : () => showMessage(context, 'Refunds need the internet', error: true),
                          icon: const Icon(Icons.undo),
                          label: const Text('Refund'),
                        ),
                      ),
                    ],
                  ],
                ),
                if (widget.justSold) ...[
                  const SizedBox(height: 10),
                  FilledButton.icon(onPressed: _done, icon: const Icon(Icons.add_shopping_cart), label: const Text('New sale')),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The receipt drawn like a till roll.
class ReceiptView extends StatelessWidget {
  const ReceiptView({super.key, required this.receipt});

  final Receipt receipt;

  @override
  Widget build(BuildContext context) {
    final r = receipt;
    final muted = TextStyle(color: Colors.black.withValues(alpha: 0.6), fontSize: 12.5);
    const ink = TextStyle(color: Colors.black87);
    String m(int c) => formatMoney(c, r.symbol);
    Widget row(String left, String right, {TextStyle? style}) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 1.5),
      child: Row(
        children: [
          Expanded(child: Text(left, style: style ?? ink)),
          Text(right, style: (style ?? ink).merge(tabular)),
        ],
      ),
    );
    final d = r.soldAt;
    String two(int n) => n.toString().padLeft(2, '0');

    return Container(
      padding: const EdgeInsets.fromLTRB(20, 22, 20, 22),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(6),
        boxShadow: const [BoxShadow(color: Color(0x1418222B), blurRadius: 16, offset: Offset(0, 4))],
      ),
      child: DefaultTextStyle.merge(
        style: ink,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              r.businessName,
              textAlign: TextAlign.center,
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17, color: Colors.black),
            ),
            Text(r.storeName, textAlign: TextAlign.center, style: muted),
            for (final line in [
              r.address,
              if (r.phone != null) 'Tel ${r.phone}',
              if (r.tin != null) 'TIN ${r.tin}',
              if (r.vatNumber != null) 'VAT No ${r.vatNumber}',
            ])
              if (line != null) Text(line, textAlign: TextAlign.center, style: muted),
            const _Dashes(),
            row(
              r.number != null ? 'Sale ${r.number}' : 'Receipt ${r.reference}',
              '${d.year}-${two(d.month)}-${two(d.day)} ${two(d.hour)}:${two(d.minute)}',
              style: const TextStyle(fontWeight: FontWeight.w600, color: Colors.black87),
            ),
            if (r.number != null) row('Till ref', r.reference, style: muted),
            row('Cashier', r.cashier, style: muted),
            if (r.customerName != null) row('Customer', r.customerName!, style: muted),
            if (r.customerTin != null) row('Customer TIN', r.customerTin!, style: muted),
            const _Dashes(),
            for (final l in r.lines)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    row(l.name, m(l.total)),
                    Text('${formatQty(l.quantity)} × ${m(l.unitPrice)}${l.discount > 0 ? ' · less ${m(l.discount)}' : ''}', style: muted),
                    if (l.note != null) Text(l.note!, style: muted.copyWith(fontStyle: FontStyle.italic)),
                  ],
                ),
              ),
            const _Dashes(),
            if (r.discountTotal > 0) ...[row('Subtotal', m(r.subtotal), style: muted), row('Discount', '-${m(r.discountTotal)}', style: muted)],
            row(
              'Total',
              m(r.total),
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18, color: Colors.black),
            ),
            if (r.taxTotal > 0) row(r.taxIncluded ? 'VAT included' : 'VAT', m(r.taxTotal), style: muted),
            const _Dashes(),
            for (final p in r.payments) ...[
              row(p.method.label, formatMoney(p.amount, p.symbol)),
              if (p.change > 0)
                row(
                  'Change',
                  formatMoney(p.change, p.symbol),
                  style: const TextStyle(fontWeight: FontWeight.w600, color: Colors.black87),
                ),
            ],
            const SizedBox(height: 12),
            Text(
              'Thank you!',
              textAlign: TextAlign.center,
              style: muted.copyWith(fontWeight: FontWeight.w600),
            ),
          ],
        ),
      ),
    );
  }
}

class _Dashes extends StatelessWidget {
  const _Dashes();

  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.symmetric(vertical: 10),
    child: CustomPaint(size: Size(double.infinity, 1), painter: _DashPainter()),
  );
}

class _DashPainter extends CustomPainter {
  const _DashPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = const Color(0x40000000)
      ..strokeWidth = 1;
    for (var x = 0.0; x < size.width; x += 7) {
      canvas.drawLine(Offset(x, 0), Offset((x + 3.5).clamp(0, size.width), 0), paint);
    }
  }

  @override
  bool shouldRepaint(_DashPainter old) => false;
}
