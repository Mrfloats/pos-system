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
