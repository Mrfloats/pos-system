import 'package:flutter/material.dart';

import 'admin/admin_lock_screens.dart';
import 'admin/admin_shell.dart';
import 'admin/admin_state.dart';
import 'admin/admin_widgets.dart';
import 'core/local_store.dart';
import 'screens/pin_screen.dart';
import 'screens/setup_screen.dart';
import 'screens/till_screen.dart';
import 'state/till_state.dart';
import 'theme.dart';
import 'widgets/common.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final store = LocalStore.create();
  final state = TillState(store)..init();
  final admin = AdminState(store)..init();
  runApp(TillApp(state: state, admin: admin));
}

class TillApp extends StatefulWidget {
  const TillApp({super.key, required this.state, this.admin});

  final TillState state;

  /// The owner or admin's sign-in for managing the business. Left out, nobody is signed in.
  final AdminState? admin;

  @override
  State<TillApp> createState() => _TillAppState();
}

class _TillAppState extends State<TillApp> {
  AdminState? _ownAdmin;
  late AdminState _admin = widget.admin ?? (_ownAdmin = AdminState(widget.state.store)..ready = true);

  @override
  void didUpdateWidget(TillApp old) {
    super.didUpdateWidget(old);
    if (widget.admin != null) _admin = widget.admin!;
  }

  @override
  void dispose() {
    _ownAdmin?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TillScope(
      state: widget.state,
      child: AdminScope(
        state: _admin,
        child: MaterialApp(
          title: 'Floatly Till',
          debugShowCheckedModeBanner: false,
          theme: buildTheme(Brightness.light),
          darkTheme: buildTheme(Brightness.dark),
          // Any touch anywhere keeps the admin area from locking for being idle.
          builder: (context, child) => Listener(behavior: HitTestBehavior.translucent, onPointerDown: (_) => _admin.touch(), child: child),
          home: const _Home(),
        ),
      ),
    );
  }
}

/// Managing the business (an owner or admin signed in) → the admin area, behind its PIN.
/// Otherwise the till: not set up → setup. Set up → PIN. Signed in → the till.
class _Home extends StatefulWidget {
  const _Home();

  @override
  State<_Home> createState() => _HomeState();
}

class _HomeState extends State<_Home> with WidgetsBindingObserver {
  bool _signedIn = false;
  bool _adminOpen = false;
  DateTime? _leftAt;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// Timers don't run while the app is in the background, so check on coming back.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused || state == AppLifecycleState.hidden) {
      _leftAt ??= DateTime.now();
    } else if (state == AppLifecycleState.resumed) {
      final left = _leftAt;
      _leftAt = null;
      if (left != null && DateTime.now().difference(left) >= idleLimit) AdminScope.read(context).lock();
    }
  }

  void _closeEverythingOnTop() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
    });
  }

  @override
  Widget build(BuildContext context) {
    final state = TillScope.of(context);
    final admin = AdminScope.of(context);
    // Signed out from anywhere (locked, or the till switched off): close whatever was open on top.
    final signedIn = state.session != null;
    if (_signedIn && !signedIn) _closeEverythingOnTop();
    _signedIn = signedIn;
    // The same when the admin area locks or signs out: nothing of it stays on screen.
    final adminOpen = admin.signedIn && !admin.locked && !admin.showTill;
    if (_adminOpen && !adminOpen) _closeEverythingOnTop();
    _adminOpen = adminOpen;

    if (!state.ready || !admin.ready) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    if (admin.signedIn && !admin.showTill) {
      if (admin.locked) return const UnlockScreen();
      if (admin.shouldOfferPin) return const ChoosePinScreen();
      return AdminShell(tillAvailable: state.device != null);
    }
    if (state.device == null) return const SetupScreen();
    if (state.session == null) return const PinScreen();
    return const TillScreen();
  }
}
