import 'package:flutter/material.dart';

import '../screens/setup_screen.dart' show defaultServer;
import '../widgets/common.dart';
import 'admin_widgets.dart';

/// An owner, admin or manager signs in with their email and password to manage
/// the business from this phone. (Staff who sell use a till PIN instead.)
class AdminLoginScreen extends StatefulWidget {
  const AdminLoginScreen({super.key, this.server});

  /// The server this device's till is paired with, if it is.
  final String? server;

  @override
  State<AdminLoginScreen> createState() => _AdminLoginScreenState();
}

class _AdminLoginScreenState extends State<AdminLoginScreen> {
  late final _server = TextEditingController(text: widget.server ?? defaultServer);
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _showServer = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [_server, _email, _password]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _signIn() async {
    if (_email.text.trim().isEmpty || _password.text.isEmpty) {
      setState(() => _error = 'Enter your email and password');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final admin = AdminScope.read(context);
    final error = await admin.signIn(server: _server.text, email: _email.text, password: _password.text);
    if (!mounted) return;
    if (error != null) {
      setState(() {
        _busy = false;
        _error = error;
      });
      return;
    }
    // The home screen now shows the admin area; close this one.
    Navigator.of(context).popUntil((r) => r.isFirst);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final notice = AdminScope.of(context).notice;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: Narrow(
              maxWidth: 460,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      const BrandMark(),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Floatly', style: Theme.of(context).textTheme.titleLarge!.copyWith(fontWeight: FontWeight.w700)),
                            Text('Manage your business', style: TextStyle(color: scheme.onSurfaceVariant)),
                          ],
                        ),
                      ),
                      if (Navigator.canPop(context)) IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close), tooltip: 'Close'),
                    ],
                  ),
                  const SizedBox(height: 24),
                  if (notice != null) ...[
                    Material(
                      color: scheme.secondaryContainer,
                      borderRadius: BorderRadius.circular(12),
                      child: Padding(padding: const EdgeInsets.all(12), child: Text(notice, style: TextStyle(color: scheme.onSecondaryContainer))),
                    ),
                    const SizedBox(height: 12),
                  ],
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: AutofillGroup(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text('Sign in', style: Theme.of(context).textTheme.titleMedium!.copyWith(fontWeight: FontWeight.w600)),
                            const SizedBox(height: 16),
                            TextField(
                              controller: _email,
                              keyboardType: TextInputType.emailAddress,
                              autofillHints: const [AutofillHints.email],
                              textInputAction: TextInputAction.next,
                              decoration: const InputDecoration(labelText: 'Email'),
                            ),
                            const SizedBox(height: 12),
                            TextField(
                              controller: _password,
                              obscureText: true,
                              autofillHints: const [AutofillHints.password],
                              decoration: const InputDecoration(labelText: 'Password'),
                              onSubmitted: (_) => _busy ? null : _signIn(),
                            ),
                            const SizedBox(height: 8),
                            Align(
                              alignment: Alignment.centerLeft,
                              child: TextButton.icon(
                                onPressed: () => setState(() => _showServer = !_showServer),
                                icon: Icon(_showServer ? Icons.expand_less : Icons.dns_outlined, size: 18),
                                label: const Text('Server'),
                              ),
                            ),
                            if (_showServer) ...[
                              TextField(
                                controller: _server,
                                keyboardType: TextInputType.url,
                                decoration: const InputDecoration(
                                  labelText: 'Floatly server address',
                                  helperText: 'Only change this if your business runs its own Floatly server.',
                                ),
                              ),
                              const SizedBox(height: 12),
                            ],
                            if (_error != null) ...[Text(_error!, style: TextStyle(color: scheme.error)), const SizedBox(height: 12)],
                            FilledButton(
                              onPressed: _busy ? null : _signIn,
                              child: _busy ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2.4)) : const Text('Sign in'),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'For owners, admins and managers: sales, stock, customers and reports, wherever you are. Cashiers and waiters sign in on a till with their PIN.',
                    style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
