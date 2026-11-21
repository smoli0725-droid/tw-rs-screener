import 'package:flutter_test/flutter_test.dart';
import 'package:taiwan_rs_app/domain/models.dart';
import 'package:taiwan_rs_app/domain/pattern_list.dart';
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

    test('sell dated before the buy matches no shares and leaves the position open', () {
      final buy = Trade(
        symbol: '2330',
        name: '台積電',
        market: '上市',
        side: TradeSide.buy,
        date: DateTime(2026, 9, 10),
        price: 100,
        shares: 100,
      );
      final candidate = Trade(
        symbol: '2330',
        name: '台積電',
        market: '上市',
        side: TradeSide.sell,
        date: DateTime(2026, 9, 1),
        price: 110,
        shares: 100,
      );
      expect(matchedSellShares([buy], candidate), 0);
      final trades = [buy, candidate];
      final positions = buildPositions(trades);
      expect(positions, hasLength(1));
      expect(positions.first.symbol, '2330');
      expect(positions.first.shares, 100);
      expect(buildClosedTrades(trades), hasLength(0));
    });

    test('same-day sell closes the shares bought that day', () {
      final buy = Trade(
        symbol: '2330',
        name: '台積電',
        market: '上市',
        side: TradeSide.buy,
        date: DateTime(2026, 9, 10, 18),
        price: 100,
        shares: 100,
      );
      final candidate = Trade(
        symbol: '2330',
        name: '台積電',
        market: '上市',
        side: TradeSide.sell,
        date: DateTime(2026, 9, 10, 9),
        price: 110,
        shares: 100,
      );
      expect(matchedSellShares([buy], candidate), 100);
      final trades = [candidate, buy];
      final positions = buildPositions(trades);
      expect(positions, isEmpty);
      expect(buildClosedTrades(trades), hasLength(1));
    });

    test('sell between two buys matches only the shares already owned', () {
      final trades = [
        Trade(
          symbol: '2330',
          name: '台積電',
          market: '上市',
          side: TradeSide.buy,
          date: DateTime(2026, 9, 1),
          price: 100,
          shares: 50,
        ),
        Trade(
          symbol: '2330',
          name: '台積電',
          market: '上市',
          side: TradeSide.buy,
          date: DateTime(2026, 9, 10),
          price: 100,
          shares: 50,
        ),
      ];
      final candidate = Trade(
        symbol: '2330',
        name: '台積電',
        market: '上市',
        side: TradeSide.sell,
        date: DateTime(2026, 9, 5),
        price: 110,
        shares: 100,
      );
      expect(matchedSellShares(trades, candidate), 50);
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
      expect(p.primary, isTrue);
      expect(p.recovered, isFalse);
    });

    test('MetaInfo parses nested market', () {
      final m = MetaInfo.fromJson({
        'data_date': '2026-09-16',
        'generated_at': '2026-09-17T01:00:00+08:00',
        'is_fresh': true,
        'counts': {'rs85': 291, 'near_breakout': 6},
        'market': {
          'win_rate': 0.444,
          'label': '市況不佳',
          'wins': 12,
          'losses': 15,
          'pending': 23,
          'window_days': 10,
        },
      });
      expect(m.market?.label, '市況不佳');
      expect(m.market?.winRatePct, 44);
      expect(m.market?.tone, 'bad');
    });
  });

  group('pattern_list (site renderPatterns parity)', () {
    const statuses = ['即將突破', '已突破', '整理中'];

    Map<String, dynamic> row({
      required String id,
      required String status,
      String pattern = 'VCP',
      bool? primary,
    }) {
      final j = <String, dynamic>{
        'id': id,
        'name': id,
        'market': '上市',
        'industry': '半導體',
        'rs': 90,
        'close': 100,
        'pattern': pattern,
        'pattern_label': pattern,
        'pivot': 110,
        'dist_pivot_pct': -5.0,
        'status': status,
      };
      if (primary != null) j['primary'] = primary;
      return j;
    }

    test('legacy multi-row same id keeps first status only', () {
      final hits = patternHitsFromJsonList([
        row(id: '2059', status: '即將突破', pattern: '高聳旗形', primary: true),
        row(id: '2059', status: '整理中', pattern: '作弊型態', primary: true),
        row(id: '2330', status: '已突破', pattern: 'VCP', primary: true),
      ]);
      expect(hits.map((h) => h.id).toList(), ['2059', '2330']);
      expect(hits.first.status, '即將突破');
      expect(hits.map((h) => h.id).toSet().length, hits.length);

      final idsByStatus = {
        for (final s in statuses) s: hits.where((h) => h.status == s).map((h) => h.id).toSet(),
      };
      expect(idsByStatus['即將突破']!.intersection(idsByStatus['整理中']!), isEmpty);
      expect(idsByStatus['即將突破']!.intersection(idsByStatus['已突破']!), isEmpty);
      expect(idsByStatus['已突破']!.intersection(idsByStatus['整理中']!), isEmpty);
    });

    test('drops primary:false then first-wins remaining id', () {
      final hits = patternHitsFromJsonList([
        row(id: '2330', status: '整理中', pattern: '作弊型態', primary: false),
        row(id: '2330', status: '即將突破', pattern: 'VCP', primary: true),
        row(id: '2454', status: '已突破', primary: false),
      ]);
      expect(hits, hasLength(1));
      expect(hits.single.id, '2330');
      expect(hits.single.status, '即將突破');
      expect(hits.single.pattern, 'VCP');
    });

    test('missing primary is kept (same as site !== false)', () {
      final hits = patternHitsFromJsonList([
        row(id: '2303', status: '已突破'),
      ]);
      expect(hits, hasLength(1));
      expect(hits.single.primary, isTrue);
    });
  });
}

