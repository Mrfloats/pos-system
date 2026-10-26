import 'package:flutter/material.dart';

/// The backoffice's palette (apps/backoffice/src/app/globals.css): ledger green
/// for structure, cool paper behind everything, amber only for warnings.
class Brand {
  static const ledger = Color(0xFF1C6652);
  static const ledgerDeep = Color(0xFF0E3B2E);
  static const ledgerSoft = Color(0xFFDCEFE7);
  static const mint = Color(0xFF34C38F);
  static const paper = Color(0xFFF5F7F4);
  static const amber = Color(0xFFE8A317);
  static const amberSoft = Color(0xFFFDF3DC);
  static const amberInk = Color(0xFF7A4F00);
  static const danger = Color(0xFFB42318);
}

/// Money and quantities line up like a till roll.
const tabular = TextStyle(fontFeatures: [FontFeature.tabularFigures()]);

ThemeData buildTheme(Brightness brightness) {
  final light = brightness == Brightness.light;
  final scheme = ColorScheme.fromSeed(
    seedColor: Brand.ledger,
    brightness: brightness,
    primary: light ? Brand.ledger : null,
    error: light ? Brand.danger : null,
    surface: light ? Colors.white : null,
  );
  final radius = BorderRadius.circular(12);
  return ThemeData(
    colorScheme: scheme,
    scaffoldBackgroundColor: light ? Brand.paper : scheme.surfaceContainerLowest,
    appBarTheme: AppBarTheme(
      backgroundColor: light ? Brand.ledgerDeep : scheme.surfaceContainer,
      foregroundColor: Colors.white,
      elevation: 0,
      titleTextStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: Colors.white),
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      color: scheme.surface,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.5)),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(64, 52),
        shape: RoundedRectangleBorder(borderRadius: radius),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(64, 52),
        shape: RoundedRectangleBorder(borderRadius: radius),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: light ? Colors.white : scheme.surfaceContainerHigh,
      border: OutlineInputBorder(borderRadius: radius),
    ),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
  );
}
