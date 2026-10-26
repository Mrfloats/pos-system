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
class _Home extends StatelessWidget {
  const _Home();

  @override
  Widget build(BuildContext context) {
    final state = TillScope.of(context);
    if (!state.ready) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    if (state.device == null) return const SetupScreen();
    if (state.session == null) return const PinScreen();
    return const TillScreen();
  }
}
