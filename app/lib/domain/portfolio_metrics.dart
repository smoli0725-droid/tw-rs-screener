import 'models.dart';
import 'position_builder.dart';

/// 計算月績效 / 勝率 / 平均報酬率。
PortfolioMetrics computeMetrics({
  required List<Trade> trades,
  required List<Position> positions,
  Map<String, List<Candle>>? historyBySymbol,
}) {
  final closed = buildClosedTrades(trades);
  double? winRate;
  double? avgReturn;
  if (closed.isNotEmpty) {
    final wins = closed.where((c) => c.isWin).length;
    winRate = wins / closed.length;
    avgReturn = closed.map((c) => c.returnPct).reduce((a, b) => a + b) / closed.length;
  } else if (positions.isNotEmpty) {
    // 無平倉時以持股獲利比例作為參考勝率
    final wins = positions.where((p) => p.returnPct > 0).length;
    winRate = wins / positions.length;
  }

  double? avgOpen;
  if (positions.isNotEmpty) {
    avgOpen = positions.map((p) => p.returnPct).reduce((a, b) => a + b) / positions.length;
  }

  final monthly = _monthlyFromClosedAndMarks(closed, positions, historyBySymbol);

  return PortfolioMetrics(
    winRate: winRate,
    avgReturnPct: avgReturn,
    avgOpenReturnPct: avgOpen,
    monthly: monthly,
    closedCount: closed.length,
    openCount: positions.length,
  );
}

List<MonthlyPerf> _monthlyFromClosedAndMarks(
  List<ClosedTrade> closed,
  List<Position> positions,
  Map<String, List<Candle>>? history,
) {
  final map = <String, double>{}; // yyyy-MM -> pnl

  for (final c in closed) {
    final key =
        '${c.sellDate.year.toString().padLeft(4, '0')}-${c.sellDate.month.toString().padLeft(2, '0')}';
    map[key] = (map[key] ?? 0) + c.pnl;
  }

  // 未實現：以月底市值相對成本估算當月浮動（若有歷史）
  if (history != null) {
    for (final p in positions) {
      final candles = history[p.symbol];
      if (candles == null || candles.isEmpty) continue;
      // 簡化：把目前未實現損益掛在最近月份
      final last = candles.last.date;
      final key =
          '${last.year.toString().padLeft(4, '0')}-${last.month.toString().padLeft(2, '0')}';
      map[key] = (map[key] ?? 0) + p.unrealizedPnl;
    }
  } else {
    for (final p in positions) {
      final now = DateTime.now();
      final key =
          '${now.year.toString().padLeft(4, '0')}-${now.month.toString().padLeft(2, '0')}';
      map[key] = (map[key] ?? 0) + p.unrealizedPnl;
    }
  }

  final keys = map.keys.toList()..sort();
  // 報酬率：相對該月成本近似（無完整市值序列時用損益 / 持股成本合計）
  final costBase = positions.fold<double>(0, (s, p) => s + p.costValue);
  return keys.map((k) {
    final pnl = map[k]!;
    final ret = costBase > 0 ? pnl / costBase : 0.0;
    return MonthlyPerf(yearMonth: k, pnl: pnl, returnPct: ret);
  }).toList();
}
