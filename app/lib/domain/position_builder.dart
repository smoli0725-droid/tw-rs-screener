import 'models.dart';

/// 將買賣交易彙整為目前持股（加權平均成本）。
List<Position> buildPositions(List<Trade> trades, {Map<String, double>? prices}) {
  final sorted = [...trades]..sort((a, b) => a.date.compareTo(b.date));
  final lots = <String, _Lot>{};

  for (final t in sorted) {
    final lot = lots.putIfAbsent(
      t.symbol,
      () => _Lot(symbol: t.symbol, name: t.name, market: t.market),
    );
    if (t.side == TradeSide.buy) {
      final newShares = lot.shares + t.shares;
      if (newShares > 0) {
        lot.avgCost = (lot.avgCost * lot.shares + t.price * t.shares + t.fee) / newShares;
      }
      lot.shares = newShares;
      lot.name = t.name;
      lot.market = t.market;
    } else {
      lot.shares = (lot.shares - t.shares).clamp(0, 1 << 30);
      // 賣出不改變剩餘成本（平均成本法）
      if (lot.shares == 0) lot.avgCost = 0;
    }
  }

  return lots.values
      .where((l) => l.shares > 0)
      .map((l) => Position(
            symbol: l.symbol,
            name: l.name,
            market: l.market,
            shares: l.shares,
            avgCost: l.avgCost,
            lastPrice: prices?[l.symbol],
          ))
      .toList()
    ..sort((a, b) => a.symbol.compareTo(b.symbol));
}

class _Lot {
  _Lot({required this.symbol, required this.name, required this.market});
  final String symbol;
  String name;
  String market;
  int shares = 0;
  double avgCost = 0;
}

/// FIFO 配對已平倉交易。
List<ClosedTrade> buildClosedTrades(List<Trade> trades) {
  final sorted = [...trades]..sort((a, b) => a.date.compareTo(b.date));
  final buys = <String, List<_OpenLot>>{};
  final closed = <ClosedTrade>[];

  for (final t in sorted) {
    if (t.side == TradeSide.buy) {
      buys.putIfAbsent(t.symbol, () => []).add(_OpenLot(
            shares: t.shares,
            price: t.price,
            date: t.date,
            fee: t.fee,
            name: t.name,
          ));
    } else {
      var remain = t.shares;
      final queue = buys[t.symbol] ?? [];
      while (remain > 0 && queue.isNotEmpty) {
        final lot = queue.first;
        final matched = remain < lot.shares ? remain : lot.shares;
        final actualBuyFee = lot.shares > 0 ? lot.fee * matched / lot.shares : 0.0;
        final actualSellFee = t.shares > 0 ? t.fee * matched / t.shares : 0.0;
        closed.add(ClosedTrade(
          symbol: t.symbol,
          name: t.name,
          shares: matched,
          buyPrice: lot.price,
          sellPrice: t.price,
          buyDate: lot.date,
          sellDate: t.date,
          fees: actualBuyFee + actualSellFee,
        ));
        lot.shares -= matched;
        lot.fee -= actualBuyFee;
        remain -= matched;
        if (lot.shares <= 0) queue.removeAt(0);
      }
    }
  }
  return closed;
}

class _OpenLot {
  _OpenLot({
    required this.shares,
    required this.price,
    required this.date,
    required this.fee,
    required this.name,
  });
  int shares;
  double price;
  DateTime date;
  double fee;
  String name;
}
