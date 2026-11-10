import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/api.dart';
import '../theme.dart';
import 'admin_state.dart';

/// Makes the admin sign-in available to every admin screen.
class AdminScope extends InheritedNotifier<AdminState> {
  const AdminScope({super.key, required AdminState state, required super.child}) : super(notifier: state);

  /// The state, rebuilding the caller when it changes.
  static AdminState of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<AdminScope>()!.notifier!;

  /// The state, without rebuilding (for button handlers).
  static AdminState read(BuildContext context) => context.getInheritedWidgetOfExactType<AdminScope>()!.notifier!;
}

const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/// "2026-11-10" → "Tue 10 Nov".
String shortDay(String isoDay, {bool weekday = true}) {
  final d = DateTime.tryParse(isoDay);
  if (d == null) return isoDay;
  return '${weekday ? '${_weekdays[d.weekday - 1]} ' : ''}${d.day} ${_months[d.month - 1]}';
}

/// "Mon", "Tue"… for a chart's axis.
String weekdayOf(String isoDay) {
  final d = DateTime.tryParse(isoDay);
  return d == null ? '' : _weekdays[d.weekday - 1];
}

/// A grey block standing in for content that is loading.
class Skeleton extends StatefulWidget {
  const Skeleton({super.key, this.width, this.height = 16, this.radius = 8});

  final double? width;
  final double height;
  final double radius;

  @override
  State<Skeleton> createState() => _SkeletonState();
}

class _SkeletonState extends State<Skeleton> with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 900));

  @override
  void initState() {
    super.initState();
    _pulse.repeat(reverse: true);
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.onSurface;
    return FadeTransition(
      opacity: Tween(begin: 0.06, end: 0.14).animate(_pulse),
      child: Container(
        width: widget.width,
        height: widget.height,
        decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(widget.radius)),
      ),
    );
  }
}

/// A card-shaped skeleton with a few lines in it.
class SkeletonCard extends StatelessWidget {
  const SkeletonCard({super.key, this.lines = 3});

  final int lines;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Skeleton(width: 120, height: 14),
          for (var i = 0; i < lines; i++) ...[const SizedBox(height: 14), Skeleton(width: i.isEven ? double.infinity : 200)],
        ],
      ),
    ),
  );
}

/// Nothing to show, said plainly.
class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, this.message});

  final IconData icon;
  final String title;
  final String? message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 36, color: scheme.onSurfaceVariant.withValues(alpha: 0.6)),
          const SizedBox(height: 10),
          Text(title, textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w600)),
          if (message != null) ...[
            const SizedBox(height: 4),
            Text(message!, textAlign: TextAlign.center, style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13)),
          ],
        ],
      ),
    );
  }
}

/// Something failed to load: what went wrong, and a way to try again.
class ErrorState extends StatelessWidget {
  const ErrorState({super.key, required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final offline = error is ApiException && (error as ApiException).isOffline;
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(offline ? Icons.cloud_off_outlined : Icons.error_outline, size: 36, color: offline ? Brand.amber : scheme.error),
          const SizedBox(height: 10),
          Text(error.toString(), textAlign: TextAlign.center),
          const SizedBox(height: 14),
          OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('Try again')),
        ],
      ),
    );
  }
}

/// A PIN box: digits only, hidden, 4 to 6 of them.
class PinField extends StatelessWidget {
  const PinField({super.key, required this.controller, this.label = 'PIN', this.autofocus = true, this.onSubmitted, this.enabled = true});

  final TextEditingController controller;
  final String label;
  final bool autofocus;
  final bool enabled;
  final ValueChanged<String>? onSubmitted;

  @override
  Widget build(BuildContext context) => TextField(
    controller: controller,
    enabled: enabled,
    autofocus: autofocus,
    obscureText: true,
    keyboardType: TextInputType.number,
    textAlign: TextAlign.center,
    maxLength: 6,
    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
    style: const TextStyle(fontSize: 26, letterSpacing: 10, fontWeight: FontWeight.w600),
    decoration: InputDecoration(labelText: label, counterText: ''),
    onSubmitted: onSubmitted,
  );
}

/// A titled card, the building block of the admin screens.
class SectionCard extends StatelessWidget {
  const SectionCard({super.key, required this.title, this.trailing, required this.child});

  final String title;
  final Widget? trailing;
  final Widget child;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(title, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Theme.of(context).colorScheme.onSurfaceVariant)),
              ),
              ?trailing,
            ],
          ),
          const SizedBox(height: 10),
          child,
        ],
      ),
    ),
  );
}

String _two(int n) => n.toString().padLeft(2, '0');

/// A day as the API wants it: 2026-11-10.
String isoDay(DateTime d) => '${d.year}-${_two(d.month)}-${_two(d.day)}';

/// An API timestamp in the phone's time: "10 Nov, 14:05" (with the year when it isn't this one).
String shortDateTime(Object? iso) {
  final d = DateTime.tryParse('$iso')?.toLocal();
  if (d == null) return '';
  final year = d.year == DateTime.now().year ? '' : ' ${d.year}';
  return '${d.day} ${_months[d.month - 1]}$year, ${_two(d.hour)}:${_two(d.minute)}';
}

/// A filter shown as a chip that opens a menu of choices. [value] null means "any".
class FilterMenu<T> extends StatelessWidget {
  const FilterMenu({super.key, required this.label, required this.value, required this.options, required this.onChanged, this.icon});

  /// What the chip says when nothing is chosen ("Cashier").
  final String label;
  final T? value;

  /// Choices in order: value → what to call it. A null value is "any".
  final List<(T?, String)> options;
  final ValueChanged<T?> onChanged;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final chosen = options.where((o) => o.$1 == value && o.$1 != null).firstOrNull;
    final active = chosen != null;
    return PopupMenuButton<int>(
      tooltip: label,
      onSelected: (i) => onChanged(options[i].$1),
      itemBuilder: (_) => [
        for (final (i, o) in options.indexed) CheckedPopupMenuItem(value: i, checked: o.$1 == value, child: Text(o.$2)),
      ],
      child: Container(
        constraints: const BoxConstraints(minHeight: 40),
        padding: const EdgeInsets.symmetric(horizontal: 12),
        decoration: BoxDecoration(
          color: active ? scheme.primary.withValues(alpha: 0.12) : null,
          border: Border.all(color: active ? scheme.primary : scheme.outlineVariant),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[Icon(icon, size: 16, color: active ? scheme.primary : scheme.onSurfaceVariant), const SizedBox(width: 6)],
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 160),
              child: Text(
                chosen?.$2 ?? label,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: active ? scheme.primary : scheme.onSurface),
              ),
            ),
            Icon(Icons.arrow_drop_down, size: 20, color: active ? scheme.primary : scheme.onSurfaceVariant),
          ],
        ),
      ),
    );
  }
}

/// A small coloured label with an icon: Voided, Refund, Low…
class Tag extends StatelessWidget {
  const Tag({super.key, required this.icon, required this.label, required this.color});

  final IconData icon;
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
    decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 12, color: color),
        const SizedBox(width: 3),
        Text(label, style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: color)),
      ],
    ),
  );
}
