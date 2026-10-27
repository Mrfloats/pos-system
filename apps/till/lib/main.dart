import 'package:flutter/material.dart';

import 'core/local_store.dart';
import 'screens/pin_screen.dart';
import 'screens/setup_screen.dart';
import 'screens/till_screen.dart';
import 'state/till_state.dart';
import 'theme.dart';
import 'widgets/common.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final state = TillState(LocalStore.create())..init();
  runApp(TillApp(state: state));
}

class TillApp extends StatelessWidget {
  const TillApp({super.key, required this.state});

  final TillState state;

  @override
  Widget build(BuildContext context) {
    return TillScope(
      state: state,
      child: MaterialApp(
        title: 'Floatly Till',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(Brightness.light),
        darkTheme: buildTheme(Brightness.dark),
        home: const _Home(),
      ),
    );
  }
}

/// Not set up → setup. Set up → PIN. Signed in → the till.
class _Home extends StatefulWidget {
  const _Home();

  @override
  State<_Home> createState() => _HomeState();
}

class _HomeState extends State<_Home> {
  bool _signedIn = false;

  @override
  Widget build(BuildContext context) {
    final state = TillScope.of(context);
    // Signed out from anywhere (locked, or the till switched off): close whatever was open on top.
    final signedIn = state.session != null;
    if (_signedIn && !signedIn) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
      });
    }
    _signedIn = signedIn;
    if (!state.ready) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    if (state.device == null) return const SetupScreen();
    if (state.session == null) return const PinScreen();
    return const TillScreen();
  }
}
