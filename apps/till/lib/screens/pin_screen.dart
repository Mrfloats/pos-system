import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme.dart';
import '../widgets/common.dart';
import 'setup_screen.dart';

/// Staff sign in with their 4–6 digit till PIN. Works offline for anyone who
/// has signed in on this till before.
class PinScreen extends StatefulWidget {
  const PinScreen({super.key});

  @override
  State<PinScreen> createState() => _PinScreenState();
}

class _PinScreenState extends State<PinScreen> {
  String _pin = '';
  String? _error;
  bool _busy = false;
  final _focus = FocusNode();

  @override
  void dispose() {
    _focus.dispose();
    super.dispose();
  }

  void _press(String digit) {
    if (_busy || _pin.length >= 6) return;
    setState(() {
      _pin += digit;
      _error = null;
    });
  }

  void _back() {
    if (_busy || _pin.isEmpty) return;
    setState(() => _pin = _pin.substring(0, _pin.length - 1));
  }

  Future<void> _submit() async {
    if (_busy) return;
    if (_pin.length < 4) {
      setState(() => _error = 'PINs are 4 to 6 digits');
      return;
    }
    setState(() => _busy = true);
    final error = await TillScope.read(context).signIn(_pin);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _pin = '';
      _error = error;
    });
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) return KeyEventResult.ignored;
    final key = event.logicalKey;
    final char = event.character;
    if (char != null && RegExp(r'^\d$').hasMatch(char)) {
      _press(char);
    } else if (key == LogicalKeyboardKey.backspace) {
      _back();
    } else if (key == LogicalKeyboardKey.enter || key == LogicalKeyboardKey.numpadEnter) {
      _submit();
    } else {
      return KeyEventResult.ignored;
    }
    return KeyEventResult.handled;
  }

  Future<void> _setUpAgain() async {
    final state = TillScope.read(context);
    final waiting = state.outbox.length;
    if (waiting > 0 &&
        !await confirm(
          context,
          title: 'Sales still waiting',
          message:
              '$waiting ${waiting == 1 ? 'sale has' : 'sales have'} not reached Floatly yet. Setting this till up for a different store will lose them. Connect to the internet and sign in first to upload them.',
          yes: 'Continue anyway',
          danger: true,
        )) {
      return;
    }
    if (!mounted) return;
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SetupScreen(canCancel: true)));
  }

  @override
  Widget build(BuildContext context) {
    final state = TillScope.of(context);
    final device = state.device!;
    final scheme = Theme.of(context).colorScheme;
    final waiting = state.outbox.length;

    return Scaffold(
      backgroundColor: Brand.ledgerDeep,
      body: Focus(
        focusNode: _focus,
        autofocus: true,
        onKeyEvent: _onKey,
        child: SafeArea(
          child: Stack(
            children: [
              Center(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(24),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 340),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const BrandMark(size: 56),
                        const SizedBox(height: 14),
                        Text(
                          device.businessName,
                          textAlign: TextAlign.center,
                          style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 4),
                        Text('${device.storeName} · ${device.deviceName}', style: TextStyle(color: Colors.white.withValues(alpha: 0.7))),
                        const SizedBox(height: 28),
                        Text('Enter your PIN', style: TextStyle(color: Colors.white.withValues(alpha: 0.9), fontSize: 16)),
                        const SizedBox(height: 14),
                        _Dots(count: _pin.length, busy: _busy),
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
                        _Keypad(onDigit: _press, onBack: _back, onEnter: _submit, onClear: () => setState(() => _pin = '')),
                      ],
                    ),
                  ),
                ),
              ),
              Positioned(
                left: 16,
                bottom: 12,
                child: Row(
                  children: [
                    StatusPill(
                      icon: state.online ? Icons.cloud_done_outlined : Icons.cloud_off_outlined,
                      label: state.online ? 'Online' : 'Offline',
                      color: state.online ? Brand.mint : Brand.amber,
                    ),
                    if (waiting > 0) ...[const SizedBox(width: 8), StatusPill(icon: Icons.upload_outlined, label: '$waiting to upload', color: Brand.amber)],
                  ],
                ),
              ),
              Positioned(
                right: 4,
                top: 4,
                child: PopupMenuButton<String>(
                  iconColor: Colors.white70,
                  onSelected: (v) => v == 'setup' ? _setUpAgain() : null,
                  itemBuilder: (_) => [
                    const PopupMenuItem(
                      value: 'setup',
                      child: ListTile(leading: Icon(Icons.settings_outlined), title: Text('Set up this device again')),
                    ),
                  ],
                ),
              ),
              if (state.notice != null)
                Positioned(
                  left: 16,
                  right: 16,
                  top: 12,
                  child: Material(
                    color: Brand.amberSoft,
                    borderRadius: BorderRadius.circular(12),
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Text(state.notice!, style: TextStyle(color: scheme.onSurface)),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Dots extends StatelessWidget {
  const _Dots({required this.count, required this.busy});

  final int count;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    if (busy) return const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white));
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 0; i < 6; i++)
          AnimatedContainer(
            duration: const Duration(milliseconds: 120),
            margin: const EdgeInsets.symmetric(horizontal: 7),
            width: 16,
            height: 16,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: i < count ? Colors.white : Colors.transparent,
              border: Border.all(color: Colors.white.withValues(alpha: i < 4 || i < count ? 0.85 : 0.3), width: 2),
            ),
          ),
      ],
    );
  }
}

class _Keypad extends StatelessWidget {
  const _Keypad({required this.onDigit, required this.onBack, required this.onEnter, required this.onClear});

  final ValueChanged<String> onDigit;
  final VoidCallback onBack, onEnter, onClear;

  @override
  Widget build(BuildContext context) {
    Widget key(Widget child, VoidCallback onTap, {Color? color, VoidCallback? onLongPress, String? label}) => Padding(
      padding: const EdgeInsets.all(6),
      child: Semantics(
        button: true,
        label: label,
        child: Material(
          color: color ?? Colors.white.withValues(alpha: 0.1),
          shape: const CircleBorder(),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: onTap,
            onLongPress: onLongPress,
            child: SizedBox.square(dimension: 76, child: Center(child: child)),
          ),
        ),
      ),
    );
    const digitStyle = TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w500);
    return Column(
      children: [
        for (final row in const [
          ['1', '2', '3'],
          ['4', '5', '6'],
          ['7', '8', '9'],
        ])
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [for (final d in row) key(Text(d, style: digitStyle), () => onDigit(d))],
          ),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            key(
              const Icon(Icons.backspace_outlined, color: Colors.white),
              onBack,
              onLongPress: onClear,
              label: 'Delete',
            ),
            key(const Text('0', style: digitStyle), () => onDigit('0')),
            key(
              const Icon(Icons.arrow_forward_rounded, color: Colors.white, size: 30),
              onEnter,
              color: Brand.ledger,
              label: 'Sign in',
            ),
          ],
        ),
      ],
    );
  }
}
