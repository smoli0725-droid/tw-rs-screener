import 'models.dart';

/// 與 `site/js/app.js` `renderPatterns` 相同：丢掉 `primary === false`，再依代號先到先贏。
///
/// 現況 `patterns.json` 已是一檔一列；這層是舊版多列 JSON 的保險，讓同一代號
/// 不會同時出現在「即將突破／已突破／整理中」。
List<PatternHit> selectPrimaryPatterns(Iterable<PatternHit> rows) {
  final seen = <String>{};
  final out = <PatternHit>[];
  for (final r in rows) {
    if (!r.primary || seen.contains(r.id)) continue;
    seen.add(r.id);
    out.add(r);
  }
  return out;
}

/// `GitHubDataSource.fetchPatterns` 的 JSON → 清單路徑（含 primary／代號去重）。
List<PatternHit> patternHitsFromJsonList(Iterable<dynamic> raw) {
  return selectPrimaryPatterns([
    for (final e in raw) PatternHit.fromJson(Map<String, dynamic>.from(e as Map)),
  ]);
}
