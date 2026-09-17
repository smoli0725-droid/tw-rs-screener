import '../core/json_num.dart';

class MarketSnapshot {
  MarketSnapshot({
    this.asOf,
    this.windowDays = 10,
    this.windowStart,
    this.wins = 0,
    this.losses = 0,
    this.pending = 0,
    this.recovered = 0,
    this.winRate,
    this.label,
  });

  final String? asOf;
  final int windowDays;
  final String? windowStart;
  final int wins;
  final int losses;
  final int pending;
  final int recovered;
  final double? winRate;
  final String? label;

  int? get winRatePct => winRate == null ? null : (winRate! * 100).round();

  /// ≥60% 良好、50~60% 中性、<50% 不佳（與網站 `renderMarket` 相同）。
  String get tone {
    final pct = winRatePct;
    if (pct == null) return 'unknown';
    if (pct >= 60) return 'good';
    if (pct >= 50) return 'neutral';
    return 'bad';
  }

  factory MarketSnapshot.fromJson(Map<String, dynamic> j) => MarketSnapshot(
        asOf: j['as_of']?.toString(),
        windowDays: jsonInt(j['window_days']) ?? 10,
        windowStart: j['window_start']?.toString(),
        wins: jsonInt(j['wins']) ?? 0,
        losses: jsonInt(j['losses']) ?? 0,
        pending: jsonInt(j['pending']) ?? 0,
        recovered: jsonInt(j['recovered']) ?? 0,
        winRate: jsonDouble(j['win_rate']),
        label: j['label']?.toString(),
      );
}

class MetaInfo {
  MetaInfo({
    required this.dataDate,
    required this.generatedAt,
    required this.isFresh,
    this.message,
    this.counts = const {},
    this.market,
  });

  final String? dataDate;
  final String? generatedAt;
  final bool isFresh;
  final String? message;
  final Map<String, dynamic> counts;
  final MarketSnapshot? market;

  factory MetaInfo.fromJson(Map<String, dynamic> j) => MetaInfo(
        dataDate: j['data_date']?.toString(),
        generatedAt: j['generated_at']?.toString(),
        isFresh: j['is_fresh'] != false,
        message: j['message']?.toString(),
        counts: jsonMap(j['counts']) ?? const {},
        market: jsonMap(j['market']) == null ? null : MarketSnapshot.fromJson(jsonMap(j['market'])!),
      );

  bool get isStale {
    if (dataDate == null) return true;
    final d = DateTime.tryParse(dataDate!);
    if (d == null) return true;
    final now = DateTime.now();
    // 週末沿用週五資料不算過期
    var latest = DateTime(now.year, now.month, now.day);
    while (latest.weekday == DateTime.saturday || latest.weekday == DateTime.sunday) {
      latest = latest.subtract(const Duration(days: 1));
    }
    // 17:00 前允許前一交易日
    if (now.hour < 17) {
      latest = latest.subtract(const Duration(days: 1));
      while (latest.weekday == DateTime.saturday || latest.weekday == DateTime.sunday) {
        latest = latest.subtract(const Duration(days: 1));
      }
    }
    return d.isBefore(DateTime(latest.year, latest.month, latest.day));
  }
}

class RsStock {
  RsStock({
    required this.id,
    required this.name,
    required this.market,
    required this.industry,
    required this.rs,
    required this.close,
    required this.templatePass,
    this.distMa50Pct,
    this.avgVol20,
    this.patterns = const [],
    this.rank,
    this.ret3mPct,
    this.ret6mPct,
    this.ret12mPct,
  });

  final String id;
  final String name;
  final String market;
  final String industry;
  final int rs;
  final double close;
  final bool templatePass;
  final double? distMa50Pct;
  final double? avgVol20;
  final List<String> patterns;
  final int? rank;
  final double? ret3mPct;
  final double? ret6mPct;
  final double? ret12mPct;

  factory RsStock.fromJson(Map<String, dynamic> j) => RsStock(
        id: '${j['id']}',
        name: '${j['name']}',
        market: '${j['market'] ?? ''}',
        industry: '${j['industry'] ?? ''}',
        rs: jsonInt(j['rs']) ?? 0,
        close: jsonDouble(j['close']) ?? 0,
        templatePass: jsonBool(j['template_pass']),
        distMa50Pct: jsonDouble(j['dist_ma50_pct']),
        avgVol20: jsonDouble(j['avg_vol_20']),
        patterns: jsonList(j['patterns']).map((e) => '$e').toList(),
        rank: jsonInt(j['rank']),
        ret3mPct: jsonDouble(j['ret_3m_pct']),
        ret6mPct: jsonDouble(j['ret_6m_pct']),
        ret12mPct: jsonDouble(j['ret_12m_pct']),
      );
}

class PatternHit {
  PatternHit({
    required this.id,
    required this.name,
    required this.market,
    required this.industry,
    required this.rs,
    required this.close,
    required this.pattern,
    required this.patternLabel,
    required this.pivot,
    required this.distPivotPct,
    required this.status,
    this.score,
    this.contraction,
    this.volDryRatio,
    this.baseWeeks,
    this.depthPct,
    this.templatePass = false,
    this.annotations = const [],
    this.position,
    this.primary = true,
    this.recovered = false,
    this.structureDate,
    this.breakoutDate,
    this.daysSinceBreakout,
  });

  final String id;
  final String name;
  final String market;
  final String industry;
  final int rs;
  final double close;
  final String pattern;
  final String patternLabel;
  final double pivot;
  final double distPivotPct;
  final String status;
  final double? score;
  final String? contraction;
  final double? volDryRatio;
  final double? baseWeeks;
  final double? depthPct;
  final bool templatePass;
  final List<Map<String, dynamic>> annotations;
  /// 作弊型態的停頓區位置（低位 / 中段 3-C / 上緣（杯柄））；其他型態為 null
  final String? position;
  /// 與網站 `renderPatterns` 相同：僅 `primary === false` 視為次要列。缺欄當 true。
  final bool primary;
  final bool recovered;
  final String? structureDate;
  final String? breakoutDate;
  final int? daysSinceBreakout;

  factory PatternHit.fromJson(Map<String, dynamic> j) {
    final detail = jsonMap(j['detail']);
    return PatternHit(
      id: '${j['id']}',
      name: '${j['name']}',
      market: '${j['market'] ?? ''}',
      industry: '${j['industry'] ?? ''}',
      rs: jsonInt(j['rs']) ?? 0,
      close: jsonDouble(j['close']) ?? 0,
      pattern: '${j['pattern'] ?? ''}',
      patternLabel: '${j['pattern_label'] ?? j['pattern'] ?? ''}',
      pivot: jsonDouble(j['pivot']) ?? 0,
      distPivotPct: jsonDouble(j['dist_pivot_pct']) ?? 0,
      status: '${j['status'] ?? '整理中'}',
      score: jsonDouble(j['score']),
      contraction: j['contraction']?.toString(),
      volDryRatio: jsonDouble(j['vol_dry_ratio']),
      baseWeeks: jsonDouble(j['base_weeks']),
      depthPct: jsonDouble(j['depth_pct']),
      templatePass: jsonBool(j['template_pass']),
      annotations: jsonList(j['annotations'])
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList(),
      position: detail?['position']?.toString(),
      primary: j['primary'] != false,
      recovered: jsonBool(j['recovered']),
      structureDate: j['structure_date']?.toString(),
      breakoutDate: j['breakout_date']?.toString(),
      daysSinceBreakout: jsonInt(j['days_since_breakout']),
    );
  }
}

class Candle {
  Candle({
    required this.date,
    required this.open,
    required this.high,
    required this.low,
    required this.close,
    required this.volume,
    this.ma50,
    this.ma150,
    this.ma200,
  });

  final DateTime date;
  final double open;
  final double high;
  final double low;
  final double close;
  final double volume;
  final double? ma50;
  final double? ma150;
  final double? ma200;

  factory Candle.fromJson(Map<String, dynamic> j) => Candle(
        date: DateTime.parse('${j['date']}'),
        open: jsonDouble(j['open']) ?? 0,
        high: jsonDouble(j['high']) ?? 0,
        low: jsonDouble(j['low']) ?? 0,
        close: jsonDouble(j['close']) ?? 0,
        volume: jsonDouble(j['volume']) ?? 0,
        ma50: jsonDouble(j['ma50'] ?? j['ma_50']),
        ma150: jsonDouble(j['ma150'] ?? j['ma_150']),
        ma200: jsonDouble(j['ma200'] ?? j['ma_200']),
      );
}

class OhlcvBundle {
  OhlcvBundle({required this.candles, this.annotations = const [], this.ticker});

  final List<Candle> candles;
  final List<Map<String, dynamic>> annotations;
  final String? ticker;

  factory OhlcvBundle.fromJson(Map<String, dynamic> j) => OhlcvBundle(
        ticker: j['ticker']?.toString(),
        candles: jsonList(j['candles'])
            .whereType<Map>()
            .map((e) => Candle.fromJson(Map<String, dynamic>.from(e)))
            .toList(),
        annotations: jsonList(j['annotations'])
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList(),
      );
}

class BreakoutTrade {
  BreakoutTrade({
    required this.tradeId,
    required this.id,
    required this.name,
    required this.market,
    required this.pattern,
    required this.patternLabel,
    required this.pivot,
    required this.status,
    this.rs,
    this.breakoutDate,
    this.breakoutClose,
    this.outcome,
    this.outcomeDate,
    this.outcomeClose,
    this.outcomePct,
    this.lastDate,
    this.lastClose,
    this.origin,
  });

  final String tradeId;
  final String id;
  final String name;
  final String market;
  final String pattern;
  final String patternLabel;
  final double pivot;
  final String status;
  final int? rs;
  final String? breakoutDate;
  final double? breakoutClose;
  final String? outcome;
  final String? outcomeDate;
  final double? outcomeClose;
  final double? outcomePct;
  final String? lastDate;
  final double? lastClose;
  final String? origin;

  bool get isRecoveredOrigin => origin == 'recovered';

  double? get distPivotPct {
    if (lastClose == null || pivot == 0) return null;
    return (lastClose! / pivot - 1) * 100;
  }

  String get statusLabel => switch (status) {
        'active' => '進行中',
        'success' => '成功',
        'failed' => '失敗',
        'recovered' => '復甦',
        'reentered' => '再突破',
        _ => status,
      };

  factory BreakoutTrade.fromJson(Map<String, dynamic> j) => BreakoutTrade(
        tradeId: '${j['trade_id'] ?? j['id']}',
        id: '${j['id']}',
        name: '${j['name'] ?? ''}',
        market: '${j['market'] ?? ''}',
        pattern: '${j['pattern'] ?? ''}',
        patternLabel: '${j['pattern_label'] ?? j['pattern'] ?? ''}',
        pivot: jsonDouble(j['pivot']) ?? 0,
        status: '${j['status'] ?? ''}',
        rs: jsonInt(j['rs']),
        breakoutDate: j['breakout_date']?.toString(),
        breakoutClose: jsonDouble(j['breakout_close']),
        outcome: j['outcome']?.toString(),
        outcomeDate: j['outcome_date']?.toString(),
        outcomeClose: jsonDouble(j['outcome_close']),
        outcomePct: jsonDouble(j['outcome_pct']),
        lastDate: j['last_date']?.toString(),
        lastClose: jsonDouble(j['last_close']),
        origin: j['origin']?.toString(),
      );
}

class BreakoutBundle {
  BreakoutBundle({
    this.asOf,
    this.market,
    this.trades = const [],
  });

  final String? asOf;
  final MarketSnapshot? market;
  final List<BreakoutTrade> trades;

  factory BreakoutBundle.fromJson(Map<String, dynamic> j) => BreakoutBundle(
        asOf: j['as_of']?.toString(),
        market: jsonMap(j['market']) == null ? null : MarketSnapshot.fromJson(jsonMap(j['market'])!),
        trades: jsonList(j['trades'])
            .whereType<Map>()
            .map((e) => BreakoutTrade.fromJson(Map<String, dynamic>.from(e)))
            .toList(),
      );
}

enum TradeSide { buy, sell }

class Trade {
  Trade({
    this.id,
    required this.symbol,
    required this.name,
    required this.market,
    required this.side,
    required this.date,
    required this.price,
    required this.shares,
    this.fee = 0,
    this.note,
  });

  final int? id;
  final String symbol;
  final String name;
  final String market;
  final TradeSide side;
  final DateTime date;
  final double price;
  final int shares;
  final double fee;
  final String? note;

  Map<String, dynamic> toMap() => {
        if (id != null) 'id': id,
        'symbol': symbol,
        'name': name,
        'market': market,
        'side': side == TradeSide.buy ? 'buy' : 'sell',
        'date': date.toIso8601String().substring(0, 10),
        'price': price,
        'shares': shares,
        'fee': fee,
        'note': note,
      };

  factory Trade.fromMap(Map<String, dynamic> m) => Trade(
        id: m['id'] as int?,
        symbol: '${m['symbol']}',
        name: '${m['name']}',
        market: '${m['market'] ?? '上市'}',
        side: m['side'] == 'sell' ? TradeSide.sell : TradeSide.buy,
        date: DateTime.parse('${m['date']}'),
        price: (m['price'] as num).toDouble(),
        shares: (m['shares'] as num).toInt(),
        fee: (m['fee'] as num?)?.toDouble() ?? 0,
        note: m['note']?.toString(),
      );
}

class Position {
  Position({
    required this.symbol,
    required this.name,
    required this.market,
    required this.shares,
    required this.avgCost,
    this.lastPrice,
    this.priceDate,
  });

  final String symbol;
  final String name;
  final String market;
  final int shares;
  final double avgCost;
  final double? lastPrice;
  final DateTime? priceDate;

  double get marketValue => (lastPrice ?? avgCost) * shares;
  double get costValue => avgCost * shares;
  double get unrealizedPnl => marketValue - costValue;
  double get returnPct => avgCost == 0 ? 0 : (lastPrice ?? avgCost) / avgCost - 1;
}

class ClosedTrade {
  ClosedTrade({
    required this.symbol,
    required this.name,
    required this.shares,
    required this.buyPrice,
    required this.sellPrice,
    required this.buyDate,
    required this.sellDate,
    this.fees = 0,
  });

  final String symbol;
  final String name;
  final int shares;
  final double buyPrice;
  final double sellPrice;
  final DateTime buyDate;
  final DateTime sellDate;
  final double fees;

  double get pnl => (sellPrice - buyPrice) * shares - fees;
  double get returnPct => buyPrice == 0 ? 0 : sellPrice / buyPrice - 1;
  bool get isWin => pnl > 0;
}

class MonthlyPerf {
  MonthlyPerf({required this.yearMonth, required this.pnl, required this.returnPct});
  final String yearMonth; // yyyy-MM
  final double pnl;
  final double returnPct;
}

class PortfolioMetrics {
  PortfolioMetrics({
    required this.winRate,
    required this.avgReturnPct,
    required this.avgOpenReturnPct,
    required this.monthly,
    required this.closedCount,
    required this.openCount,
  });

  final double? winRate;
  final double? avgReturnPct;
  final double? avgOpenReturnPct;
  final List<MonthlyPerf> monthly;
  final int closedCount;
  final int openCount;
}
