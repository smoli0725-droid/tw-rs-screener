import 'models.dart';

/// 與 `site/js/app.js` `renderTrades` 相同：舊的 `reentered` 列不進清單。
/// 復甦後再突破看 `origin == recovered` 的新交易。
List<BreakoutTrade> visibleBreakoutTrades(Iterable<BreakoutTrade> trades) {
  return [for (final t in trades) if (t.status != 'reentered') t];
}

BreakoutBundle? breakoutBundleFromJson(dynamic raw) {
  final map = raw is Map<String, dynamic>
      ? raw
      : raw is Map
          ? Map<String, dynamic>.from(raw)
          : null;
  if (map == null) return null;
  return BreakoutBundle.fromJson(map);
}
