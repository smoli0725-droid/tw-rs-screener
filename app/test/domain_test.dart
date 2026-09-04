import 'package:flutter_test/flutter_test.dart';
import 'package:taiwan_rs_app/domain/models.dart';
import 'package:taiwan_rs_app/domain/position_builder.dart';
import 'package:taiwan_rs_app/domain/portfolio_metrics.dart';

void main() {
  group('position_builder', () {
    test('averages cost across buys and reduces on sell', () {
      final trades = [
        Trade(
          symbol: '2330',
          name: '台積電',
          market: '上市',
          side: TradeSide.buy,
          date: DateTime(2026, 1, 1),
          price: 100,
          shares: 1000,
        ),
        Trade(
          symbol: '2330',
          name: '台積電',
          market: '上市',
          side: TradeSide.buy,
          date: DateTime(2026, 2, 1),
          price: 120,
          shares: 1000,
        ),
        Trade(
          symbol: '2330',
          name: '台積電',
          market: '上市',
          side: TradeSide.sell,
          date: DateTime(2026, 3, 1),
          price: 150,
          shares: 500,
        ),
      ];
      final positions = buildPositions(trades, prices: {'2330': 160});
      expect(positions.length, 1);
      expect(positions.first.shares, 1500);
      expect(positions.first.avgCost, closeTo(110, 0.01));
      expect(positions.first.returnPct, closeTo(160 / 110 - 1, 1e-6));
    });

    test('FIFO closed trades', () {
      final trades = [
        Trade(
          symbol: '2454',
          name: '聯發科',
          market: '上市',
          side: TradeSide.buy,
          date: DateTime(2026, 1, 1),
          price: 100,
          shares: 1000,
        ),
        Trade(
          symbol: '2454',
          name: '聯發科',
          market: '上市',
          side: TradeSide.sell,
          date: DateTime(2026, 2, 1),
          price: 130,
          shares: 1000,
        ),
      ];
      final closed = buildClosedTrades(trades);
      expect(closed.length, 1);
      expect(closed.first.isWin, isTrue);
      expect(closed.first.returnPct, closeTo(0.3, 1e-9));
    });
  });

  group('portfolio_metrics', () {
    test('win rate and averages', () {
      final trades = [
        Trade(
          symbol: 'A',
          name: 'A',
          market: '上市',
          side: TradeSide.buy,
          date: DateTime(2026, 1, 1),
          price: 100,
          shares: 100,
        ),
        Trade(
          symbol: 'A',
          name: 'A',
          market: '上市',
          side: TradeSide.sell,
          date: DateTime(2026, 1, 15),
          price: 110,
          shares: 100,
        ),
        Trade(
          symbol: 'B',
          name: 'B',
          market: '上市',
          side: TradeSide.buy,
          date: DateTime(2026, 1, 1),
          price: 100,
          shares: 100,
        ),
        Trade(
          symbol: 'B',
          name: 'B',
          market: '上市',
          side: TradeSide.sell,
          date: DateTime(2026, 1, 20),
          price: 90,
          shares: 100,
        ),
        Trade(
          symbol: 'C',
          name: 'C',
          market: '上市',
          side: TradeSide.buy,
          date: DateTime(2026, 2, 1),
          price: 50,
          shares: 200,
        ),
      ];
      final positions = buildPositions(trades, prices: {'C': 60});
      final m = computeMetrics(trades: trades, positions: positions);
      expect(m.closedCount, 2);
      expect(m.winRate, closeTo(0.5, 1e-9));
      expect(m.avgReturnPct, closeTo(0.0, 1e-9)); // +10% and -10%
      expect(m.openCount, 1);
      expect(m.avgOpenReturnPct, closeTo(0.2, 1e-9));
      expect(m.monthly.isNotEmpty, isTrue);
    });
  });

  group('json models', () {
    test('RsStock and PatternHit parse', () {
      final rs = RsStock.fromJson({
        'id': '2330',
        'name': '台積電',
        'market': '上市',
        'industry': '半導體',
        'rs': 95,
        'close': 1000,
        'template_pass': true,
        'patterns': ['VCP'],
      });
      expect(rs.id, '2330');
      expect(rs.templatePass, isTrue);
      expect(rs.patterns, ['VCP']);

      final p = PatternHit.fromJson({
        'id': '2330',
        'name': '台積電',
        'market': '上市',
        'industry': '半導體',
        'rs': 95,
        'close': 1000,
        'pattern': 'VCP',
        'pattern_label': 'VCP 波動收縮',
        'pivot': 1010,
        'dist_pivot_pct': -1.0,
        'status': '即將突破',
        'annotations': [
          {'type': 'pullback_high', 'price': 1010}
        ],
      });
      expect(p.status, '即將突破');
      expect(p.annotations.length, 1);
    });
  });
}
