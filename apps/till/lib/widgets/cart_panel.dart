import 'package:flutter/material.dart';

import '../core/money.dart';
import '../models/sale.dart';
import '../screens/customer_picker.dart';
import '../screens/payment_screen.dart';
import '../theme.dart';
import 'common.dart';

/// The basket: customer, items, totals and the Charge button.
class CartPanel extends StatelessWidget {
  const CartPanel({super.key});

  @override
  Widget build(BuildContext context) {
    final state = TillScope.of(context);
    final catalog = state.catalog!;
    final cart = state.priced;
    final scheme = Theme.of(context).colorScheme;
    final symbol = cart.currency.label;

    return Material(
      color: scheme.surface,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 8, 4),
            child: Row(
              children: [
                Expanded(
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: ActionChip(
                      avatar: Icon(state.customer == null ? Icons.person_outline : Icons.person, size: 18),
                      label: Text(state.customer?.name ?? state.customerName ?? 'Walk-in customer', overflow: TextOverflow.ellipsis),
                      onPressed: () => pickCustomer(context),
                    ),
                  ),
                ),
                if (state.customer != null && state.customer!.discountHundredths > 0)
                  Padding(
                    padding: const EdgeInsets.only(left: 6),
                    child: StatusPill(icon: Icons.sell_outlined, label: '${formatQty(state.customer!.discountHundredths * 10)}% off', color: scheme.primary),
                  ),
                if (catalog.currencies.length > 1)
                  PopupMenuButton<String>(
                    tooltip: 'Sale currency',
                    initialValue: cart.currency.code,
                    onSelected: (code) => state.setSaleCurrency(catalog.currency(code)),
                    itemBuilder: (_) => [for (final c in catalog.currencies) PopupMenuItem(value: c.code, child: Text('${c.code} · ${c.name}'))],
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(cart.currency.code, style: const TextStyle(fontWeight: FontWeight.w700)),
                          const Icon(Icons.arrow_drop_down),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: cart.isEmpty
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.shopping_basket_outlined, size: 48, color: scheme.outlineVariant),
                        const SizedBox(height: 8),
                        Text('Scan or tap a product to start a sale', style: TextStyle(color: scheme.onSurfaceVariant)),
                      ],
                    ),
                  )
                : ListView.separated(
                    reverse: false,
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    itemCount: cart.lines.length,
                    separatorBuilder: (_, _) => const Divider(height: 1, indent: 12, endIndent: 12),
                    itemBuilder: (context, i) => _LineRow(line: cart.lines[i], symbol: symbol),
                  ),
          ),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 6),
            child: Column(
              children: [
                if (cart.discountTotal > 0) ...[
                  TotalRow('Subtotal', formatMoney(cart.subtotal, symbol)),
                  TotalRow('Discount', '-${formatMoney(cart.discountTotal, symbol)}'),
                ],
                if (cart.taxTotal > 0) TotalRow(cart.taxIncluded ? 'VAT included' : 'VAT', formatMoney(cart.taxTotal, symbol)),
                TotalRow('Total', formatMoney(cart.total, symbol), big: true),
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
              child: Row(
                children: [
                  IconButton.outlined(
                    tooltip: 'Clear the sale',
                    style: IconButton.styleFrom(minimumSize: const Size(52, 52)),
                    onPressed: cart.isEmpty
                        ? null
                        : () async {
                            if (await confirm(context, title: 'Clear this sale?', message: 'Every item comes out of the basket.', yes: 'Clear')) {
                              state.clearCart();
                            }
                          },
                    icon: const Icon(Icons.delete_outline),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton(
                      onPressed: cart.isEmpty ? null : () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PaymentScreen())),
                      child: Text(cart.isEmpty ? 'Charge' : 'Charge ${formatMoney(cart.total, symbol)}'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _LineRow extends StatelessWidget {
  const _LineRow({required this.line, required this.symbol});

  final PricedLine line;
  final String symbol;

  @override
  Widget build(BuildContext context) {
    final state = TillScope.read(context);
    final l = line.line;
    final scheme = Theme.of(context).colorScheme;
    final details = [
      '${formatQty(l.quantity)}${l.product.unit != null && l.product.partQuantities ? ' ${l.product.unit}' : ''} × ${formatMoney(line.unitPrice, symbol)}',
      if (line.discount > 0) '−${formatMoney(line.discount, symbol)}',
      if (l.note != null) l.note!,
    ].join(' · ');
    final step = l.product.partQuantities ? null : 1000;

    return InkWell(
      onTap: () => editLine(context, l),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 6, 8, 6),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(l.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                  Text(details, style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant)),
                ],
              ),
            ),
            if (step != null) ...[
              _StepButton(icon: Icons.remove, onTap: () => state.setQuantity(l, l.quantity - step)),
              SizedBox(
                width: 30,
                child: Text(
                  formatQty(l.quantity),
                  textAlign: TextAlign.center,
                  style: tabular.copyWith(fontWeight: FontWeight.w600),
                ),
              ),
              _StepButton(icon: Icons.add, onTap: () => state.setQuantity(l, l.quantity + step)),
            ],
            SizedBox(
              width: 86,
              child: Text(
                formatMoney(line.total, symbol),
                textAlign: TextAlign.right,
                style: tabular.copyWith(fontWeight: FontWeight.w600),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StepButton extends StatelessWidget {
  const _StepButton({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => IconButton(
    onPressed: onTap,
    icon: Icon(icon, size: 18),
    visualDensity: VisualDensity.compact,
    style: IconButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.surfaceContainerHighest),
  );
}

/// Change the quantity, add a note, or (managers) change the price or give a discount.
Future<void> editLine(BuildContext context, CartLine line) async {
  final state = TillScope.read(context);
  final symbol = state.saleCurrency.label;
  final canManage = state.session?.canManage ?? false;
  final priced = state.priced.lines.firstWhere((p) => p.line.key == line.key);
  final qty = TextEditingController(text: formatQty(line.quantity));
  final price = TextEditingController(text: line.unitPrice == null ? '' : fromCents(line.unitPrice!));
  final discount = TextEditingController(text: line.discount == null ? '' : fromCents(line.discount!));
  final note = TextEditingController(text: line.note ?? '');

  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) {
      void save() {
        final q = tryParseFixed(qty.text, line.product.partQuantities ? 3 : 0);
        if (q == null || q <= 0) return;
        state.updateLine(
          line,
          quantity: line.product.partQuantities ? q : q * 1000,
          unitPrice: canManage && price.text.trim().isNotEmpty ? tryParseFixed(price.text, 2) : null,
          discount: canManage && discount.text.trim().isNotEmpty ? tryParseFixed(discount.text, 2) : null,
          note: note.text,
        );
        Navigator.pop(context);
      }

      return Padding(
        padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
        child: Narrow(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(line.name, style: Theme.of(context).textTheme.titleMedium!.copyWith(fontWeight: FontWeight.w600)),
              Text(
                'Shelf price ${formatMoney(state.saleCurrency.isBase ? line.variant.price : fromBase(line.variant.price, state.saleCurrency.rate), symbol)}',
                style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
              ),
              const SizedBox(height: 16),
              AmountField(
                controller: qty,
                label: 'Quantity${line.product.unit != null && line.product.partQuantities ? ' (${line.product.unit})' : ''}',
                decimals: line.product.partQuantities ? 3 : 0,
                autofocus: true,
              ),
              const SizedBox(height: 12),
              if (canManage) ...[
                Row(
                  children: [
                    Expanded(
                      child: AmountField(controller: price, label: 'Price each', prefix: symbol),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: AmountField(controller: discount, label: 'Discount on line', prefix: symbol),
                    ),
                  ],
                ),
                Padding(
                  padding: const EdgeInsets.only(top: 4, bottom: 8),
                  child: Text(
                    'Leave empty for the normal price${priced.discount > 0 && line.discount == null ? ' and the customer group discount' : ''}.',
                    style: TextStyle(fontSize: 12.5, color: Theme.of(context).colorScheme.onSurfaceVariant),
                  ),
                ),
              ],
              TextField(
                controller: note,
                decoration: const InputDecoration(labelText: 'Note (for the kitchen or receipt)'),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  TextButton.icon(
                    style: TextButton.styleFrom(foregroundColor: Theme.of(context).colorScheme.error),
                    onPressed: () {
                      state.removeLine(line);
                      Navigator.pop(context);
                    },
                    icon: const Icon(Icons.delete_outline),
                    label: const Text('Remove'),
                  ),
                  const Spacer(),
                  FilledButton(onPressed: save, child: const Text('Save')),
                ],
              ),
            ],
          ),
        ),
      );
    },
  );
}
