import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../state/till_state.dart';
import '../theme.dart';
import 'brand_painter.dart';

/// Makes the till's state available to every screen.
class TillScope extends InheritedNotifier<TillState> {
  const TillScope({super.key, required TillState state, required super.child}) : super(notifier: state);

  /// The state, rebuilding the caller when it changes.
  static TillState of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<TillScope>()!.notifier!;

  /// The state, without rebuilding (for button handlers).
  static TillState read(BuildContext context) => context.getInheritedWidgetOfExactType<TillScope>()!.notifier!;
}

/// Wide enough to show products and the basket side by side.
bool isWide(BuildContext context) => MediaQuery.sizeOf(context).width >= 840;

/// Phones and tablets have a camera to scan barcodes with.
bool get hasCameraScanner => !kIsWeb && (defaultTargetPlatform == TargetPlatform.android || defaultTargetPlatform == TargetPlatform.iOS);

void showMessage(BuildContext context, String message, {bool error = false}) {
  final messenger = ScaffoldMessenger.of(context);
  messenger.hideCurrentSnackBar();
  messenger.showSnackBar(SnackBar(content: Text(message), backgroundColor: error ? Theme.of(context).colorScheme.error : null));
}

Future<bool> confirm(BuildContext context, {required String title, required String message, String yes = 'Yes', bool danger = false}) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
        FilledButton(
          style: danger ? FilledButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error) : null,
          onPressed: () => Navigator.pop(context, true),
          child: Text(yes),
        ),
      ],
    ),
  );
  return ok ?? false;
}

/// The Floatly mark: a receipt roll on a ledger-green tile.
class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.size = 44});

  final double size;

  @override
  Widget build(BuildContext context) => Semantics(
    label: 'Floatly',
    child: CustomPaint(size: Size.square(size), painter: const BrandPainter()),
  );
}

/// A coloured pill: online/offline, waiting sales, the shift.
class StatusPill extends StatelessWidget {
  const StatusPill({super.key, required this.icon, required this.label, required this.color, this.onTap});

  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: color.withValues(alpha: 0.16),
      shape: const StadiumBorder(),
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 15, color: color),
              const SizedBox(width: 5),
              Text(
                label,
                style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: color),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A text field for money: digits and one decimal point, two places.
class AmountField extends StatelessWidget {
  const AmountField({
    super.key,
    required this.controller,
    this.label,
    this.prefix,
    this.autofocus = false,
    this.onChanged,
    this.onSubmitted,
    this.decimals = 2,
  });

  final TextEditingController controller;
  final String? label;
  final String? prefix;
  final bool autofocus;
  final int decimals;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      autofocus: autofocus,
      keyboardType: TextInputType.numberWithOptions(decimal: decimals > 0),
      inputFormatters: [FilteringTextInputFormatter.allow(RegExp(decimals > 0 ? '^\\d*\\.?\\d{0,$decimals}' : r'^\d*'))],
      style: tabular.copyWith(fontSize: 18, fontWeight: FontWeight.w600),
      decoration: InputDecoration(labelText: label, prefixText: prefix == null ? null : '$prefix '),
      onChanged: onChanged,
      onSubmitted: onSubmitted,
    );
  }
}

/// A row in a totals block: label on the left, amount on the right.
class TotalRow extends StatelessWidget {
  const TotalRow(this.label, this.value, {super.key, this.big = false, this.color});

  final String label;
  final String value;
  final bool big;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final style = big
        ? Theme.of(context).textTheme.titleLarge!.copyWith(fontWeight: FontWeight.w700, color: color)
        : Theme.of(context).textTheme.bodyMedium!.copyWith(color: color ?? Theme.of(context).colorScheme.onSurfaceVariant);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Expanded(child: Text(label, style: style)),
          Text(value, style: style.merge(tabular)),
        ],
      ),
    );
  }
}

/// Keeps forms and lists a comfortable width on big screens.
class Narrow extends StatelessWidget {
  const Narrow({super.key, required this.child, this.maxWidth = 560});

  final Widget child;
  final double maxWidth;

  @override
  Widget build(BuildContext context) => Align(
    alignment: Alignment.topCenter,
    child: ConstrainedBox(
      constraints: BoxConstraints(maxWidth: maxWidth),
      child: child,
    ),
  );
}
