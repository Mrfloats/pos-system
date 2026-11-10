import 'package:flutter/material.dart';

import '../theme.dart';
import '../widgets/common.dart';
import 'admin_widgets.dart';

/// Shown when the app starts with a kept sign-in, and after it sat untouched:
/// the person's PIN opens the admin area again.
class UnlockScreen extends StatefulWidget {
  const UnlockScreen({super.key});

  @override
  State<UnlockScreen> createState() => _UnlockScreenState();
}

class _UnlockScreenState extends State<UnlockScreen> {
  final _pin = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _pin.dispose();
    super.dispose();
  }

  Future<void> _unlock() async {
    if (_pin.text.length < 4) {
      setState(() => _error = 'Your PIN has 4 to 6 digits');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final error = await AdminScope.read(context).unlock(_pin.text);
    if (!mounted || error == null) return;
    setState(() {
      _busy = false;
      _error = error;
      _pin.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    final admin = AdminScope.of(context);
    final session = admin.session!;
    return Scaffold(
      backgroundColor: Brand.ledgerDeep,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 340),
              child: Theme(
                data: buildTheme(Brightness.dark),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Center(child: BrandMark(size: 56)),
                    const SizedBox(height: 14),
                    Text(
                      session.fullName,
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${session.roleLabel} — ID: ${session.staffCode} · ${session.businessName}',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Colors.white.withValues(alpha: 0.7)),
                    ),
                    const SizedBox(height: 28),
                    PinField(controller: _pin, label: 'Enter your PIN', enabled: !_busy, onSubmitted: (_) => _unlock()),
                    SizedBox(
                      height: 44,
                      child: Center(
                        child: _error == null
                            ? null
                            : Text(
                                _error!,
                                textAlign: TextAlign.center,
                                style: const TextStyle(color: Color(0xFFFFB4A9), fontWeight: FontWeight.w500),
                              ),
                      ),
                    ),
                    FilledButton(
                      onPressed: _busy ? null : _unlock,
                      child: _busy ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2.4)) : const Text('Unlock'),
                    ),
                    const SizedBox(height: 8),
                    TextButton(
                      onPressed: _busy ? null : () => admin.signOut(),
                      child: const Text('Sign out', style: TextStyle(color: Colors.white70)),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Straight after a first sign-in: choose a PIN, so the phone remembers the
/// sign-in and can confirm price changes and refunds.
class ChoosePinScreen extends StatefulWidget {
  const ChoosePinScreen({super.key});

  @override
  State<ChoosePinScreen> createState() => _ChoosePinScreenState();
}

class _ChoosePinScreenState extends State<ChoosePinScreen> {
  final _pin = TextEditingController();
  final _again = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _pin.dispose();
    _again.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_pin.text.length < 4) {
      setState(() => _error = 'Choose 4 to 6 digits');
      return;
    }
    if (_pin.text != _again.text) {
      setState(() => _error = "The two PINs don't match");
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final error = await AdminScope.read(context).choosePin(_pin.text);
    if (!mounted || error == null) return;
    setState(() {
      _busy = false;
      _error = error;
    });
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: Narrow(
              maxWidth: 420,
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Icon(Icons.lock_outline, size: 32, color: scheme.primary),
                      const SizedBox(height: 10),
                      Text('Choose a PIN', textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleLarge!.copyWith(fontWeight: FontWeight.w700)),
                      const SizedBox(height: 6),
                      Text(
                        'Your PIN opens the app next time without your password, and confirms price changes and refunds. It also works on the till.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: scheme.onSurfaceVariant),
                      ),
                      const SizedBox(height: 18),
                      PinField(controller: _pin, label: 'New PIN', enabled: !_busy),
                      const SizedBox(height: 12),
                      PinField(controller: _again, label: 'Same PIN again', autofocus: false, enabled: !_busy, onSubmitted: (_) => _save()),
                      if (_error != null) ...[const SizedBox(height: 12), Text(_error!, textAlign: TextAlign.center, style: TextStyle(color: scheme.error))],
                      const SizedBox(height: 16),
                      FilledButton(
                        onPressed: _busy ? null : _save,
                        child: _busy ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2.4)) : const Text('Save PIN'),
                      ),
                      const SizedBox(height: 4),
                      TextButton(onPressed: _busy ? null : () => AdminScope.read(context).skipPin(), child: const Text('Not now')),
                      Text(
                        "Without a PIN you'll sign in with your password each time, and can't change prices or refund from this phone.",
                        textAlign: TextAlign.center,
                        style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12.5),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
