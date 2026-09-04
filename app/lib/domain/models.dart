class MetaInfo {
  MetaInfo({
    required this.dataDate,
    required this.generatedAt,
    required this.isFresh,
    this.message,
    this.counts = const {},
  });

  final String? dataDate;
  final String? generatedAt;
  final bool isFresh;
  final String? message;
  final Map<String, dynamic> counts;

  factory MetaInfo.fromJson(Map<String, dynamic> j) => MetaInfo(
        dataDate: j['data_date']?.toString(),
        generatedAt: j['generated_at']?.toString(),
        isFresh: j['is_fresh'] != false,
        message: j['message']?.toString(),
        counts: Map<String, dynamic>.from(j['counts'] as Map? ?? {}),
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
        rs: (j['rs'] as num).toInt(),
        close: (j['close'] as num).toDouble(),
        templatePass: j['template_pass'] == true,
        distMa50Pct: (j['dist_ma50_pct'] as num?)?.toDouble(),
        avgVol20: (j['avg_vol_20'] as num?)?.toDouble(),
        patterns: (j['patterns'] as List?)?.map((e) => '$e').toList() ?? const [],
        rank: (j['rank'] as num?)?.toInt(),
        ret3mPct: (j['ret_3m_pct'] as num?)?.toDouble(),
        ret6mPct: (j['ret_6m_pct'] as num?)?.toDouble(),
        ret12mPct: (j['ret_12m_pct'] as num?)?.toDouble(),
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

  factory PatternHit.fromJson(Map<String, dynamic> j) => PatternHit(
        id: '${j['id']}',
        name: '${j['name']}',
        market: '${j['market'] ?? ''}',
        industry: '${j['industry'] ?? ''}',
        rs: (j['rs'] as num).toInt(),
        close: (j['close'] as num).toDouble(),
        pattern: '${j['pattern'] ?? ''}',
        patternLabel: '${j['pattern_label'] ?? j['pattern'] ?? ''}',
        pivot: (j['pivot'] as num?)?.toDouble() ?? 0,
        distPivotPct: (j['dist_pivot_pct'] as num?)?.toDouble() ?? 0,
        status: '${j['status'] ?? '整理中'}',
        score: (j['score'] as num?)?.toDouble(),
        contraction: j['contraction']?.toString(),
        volDryRatio: (j['vol_dry_ratio'] as num?)?.toDouble(),
        baseWeeks: (j['base_weeks'] as num?)?.toDouble(),
        depthPct: (j['depth_pct'] as num?)?.toDouble(),
        templatePass: j['template_pass'] == true,
        annotations: (j['annotations'] as List?)
                ?.map((e) => Map<String, dynamic>.from(e as Map))
                .toList() ??
            const [],
      );
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
        open: (j['open'] as num).toDouble(),
        high: (j['high'] as num).toDouble(),
        low: (j['low'] as num).toDouble(),
        close: (j['close'] as num).toDouble(),
        volume: (j['volume'] as num?)?.toDouble() ?? 0,
        ma50: (j['ma50'] as num?)?.toDouble(),
        ma150: (j['ma150'] as num?)?.toDouble(),
        ma200: (j['ma200'] as num?)?.toDouble(),
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
