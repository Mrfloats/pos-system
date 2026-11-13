import 'package:flutter/material.dart';

import '../core/api.dart';

/// "Forgot password?": asks Floatly to email a link for choosing a new password.
/// The link opens in a browser; then they sign in here with the new password.
Future<void> forgotPassword(BuildContext context, {required String server, String email = ''}) {
  return showDialog<void>(
    context: context,
    builder: (_) => _ForgotPasswordDialog(server: server, email: email.trim()),
  );
}

class _ForgotPasswordDialog extends StatefulWidget {
  const _ForgotPasswordDialog({required this.server, required this.email});

  final String server;
  final String email;

  @override
  State<_ForgotPasswordDialog> createState() => _ForgotPasswordDialogState();
}

class _ForgotPasswordDialogState extends State<_ForgotPasswordDialog> {
  late final _email = TextEditingController(text: widget.email);
  bool _busy = false;
  String? _error;
  String? _sentTo;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final email = _email.text.trim();
    if (!RegExp(r'^\S+@\S+\.\S+$').hasMatch(email)) {
      setState(() => _error = 'Enter the email you sign in with');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await Api(server: widget.server).post('/auth/forgot-password', {'email': email});
      if (mounted) setState(() => _sentTo = email);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    if (_sentTo != null) {
      return AlertDialog(
        icon: Icon(Icons.mark_email_read_outlined, color: scheme.primary),
        title: const Text('Check your email'),
        content: Text(
          'If $_sentTo has a Floatly login, we’ve sent it a link to choose a new password. '
          'Open it on this phone or a computer within 60 minutes, then sign in here with the new password.\n\n'
          'Nothing there? Look in the spam folder, or ask again in a minute.',
        ),
        actions: [FilledButton(onPressed: () => Navigator.pop(context), child: const Text('OK'))],
      );
    }
    return AlertDialog(
      title: const Text('Forgot your password?'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Enter the email you sign in with. We’ll send you a link to choose a new password.'),
          const SizedBox(height: 16),
          TextField(
            controller: _email,
            autofocus: widget.email.isEmpty,
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.email],
            decoration: const InputDecoration(labelText: 'Email'),
            onSubmitted: (_) => _busy ? null : _send(),
          ),
          if (_error != null) ...[const SizedBox(height: 12), Text(_error!, style: TextStyle(color: scheme.error))],
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        FilledButton(
          onPressed: _busy ? null : _send,
          child: _busy ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2.2)) : const Text('Send the link'),
        ),
      ],
    );
  }
}
