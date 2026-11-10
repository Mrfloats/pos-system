import 'package:flutter/material.dart';

import '../core/api.dart';
import '../widgets/common.dart';
import 'admin_widgets.dart';

/// Asks for the person's PIN, then runs [action] with it: changing a price or
/// approving a refund from a phone needs it (the API checks). A wrong PIN asks
/// again. Returns what [action] returned, or null if they cancelled.
Future<T?> confirmWithPin<T>(BuildContext context, {required String title, required String message, required Future<T> Function(String pin) action}) async {
  final admin = AdminScope.read(context);
  if (!admin.session!.hasPin) {
    showMessage(context, 'Choose a PIN first: sign out and in again, and the app offers to set one.', error: true);
    return null;
  }
  return showDialog<T>(
    context: context,
    builder: (_) => _PinDialog<T>(title: title, message: message, action: action),
  );
}

class _PinDialog<T> extends StatefulWidget {
  const _PinDialog({required this.title, required this.message, required this.action});

  final String title, message;
  final Future<T> Function(String pin) action;

  @override
  State<_PinDialog<T>> createState() => _PinDialogState<T>();
}

class _PinDialogState<T> extends State<_PinDialog<T>> {
  final _pin = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _pin.dispose();
    super.dispose();
  }

  Future<void> _go() async {
    if (_pin.text.length < 4) {
      setState(() => _error = 'Your PIN has 4 to 6 digits');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await widget.action(_pin.text);
      if (mounted) Navigator.pop(context, result);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = e.message;
        _pin.clear();
      });
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.title),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(widget.message),
        const SizedBox(height: 16),
        PinField(controller: _pin, label: 'Your PIN', enabled: !_busy, onSubmitted: (_) => _go()),
        if (_error != null) ...[const SizedBox(height: 10), Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))],
      ],
    ),
    actions: [
      TextButton(onPressed: _busy ? null : () => Navigator.pop(context), child: const Text('Cancel')),
      FilledButton(
        onPressed: _busy ? null : _go,
        child: _busy ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2.2)) : const Text('Confirm'),
      ),
    ],
  );
}
