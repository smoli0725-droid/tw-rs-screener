import 'package:flutter/material.dart';

class AppTheme {
  static ThemeData light() {
    const seed = Color(0xFF0D47A1);
    final scheme = ColorScheme.fromSeed(seedColor: seed, brightness: Brightness.light);
    return ThemeData(
      colorScheme: scheme,
      useMaterial3: true,
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.primary,
        foregroundColor: scheme.onPrimary,
        centerTitle: true,
      ),
      cardTheme: CardThemeData(
        elevation: 0.5,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      inputDecorationTheme: const InputDecorationTheme(
        border: OutlineInputBorder(),
        isDense: true,
      ),
    );
  }

  static Color pnl(double v) =>
      v > 0 ? const Color(0xFFC62828) : (v < 0 ? const Color(0xFF2E7D32) : Colors.grey);

  /// 台股習慣：紅漲綠跌。
  static Color twUp = const Color(0xFFC62828);
  static Color twDown = const Color(0xFF2E7D32);
}
