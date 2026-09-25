import 'models.dart';

String _calendarDate(DateTime date) {
  final year = date.year.toString().padLeft(4, '0');
  final month = date.month.toString().padLeft(2, '0');
  final day = date.day.toString().padLeft(2, '0');
  return '$year-$month-$day';
}

class _RankedTrade {
  _RankedTrade(this.index, this.trade);
  final int index;
  final Trade trade;
}

class _Walk {
  _Walk({required this.lots, required this.closed, required this.matchedShares});
  final Map<String, _Lot> lots;
  final List<ClosedTrade> closed;
  final int matchedShares;
}

_Walk _walkTrades(List<Trade> trades, {Trade? countedSell}) {
  final order = [for (var i = 0; i < trades.length; i++) _RankedTrade(i, trades[i])];
  // List.sort is not stable, so the input index keeps order inside a day and side.
  order.sort((a, b) {
    final byDate = _calendarDate(a.trade.date).compareTo(_calendarDate(b.trade.date));
    if (byDate != 0) return byDate;
    final bySide =
        (a.trade.side == TradeSide.buy ? 0 : 1) - (b.trade.side == TradeSide.buy ? 0 : 1);
    if (bySide != 0) return bySide;
    return a.index.compareTo(b.index);
  });

  final lots = <String, _Lot>{};
  final buys = <String, List<_OpenLot>>{};
  final closed = <ClosedTrade>[];
  var matchedShares = 0;

  for (final row in order) {
    final t = row.trade;
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
      buys.putIfAbsent(t.symbol, () => []).add(_OpenLot(
            shares: t.shares,
            price: t.price,
            date: t.date,
            fee: t.fee,
            name: t.name,
          ));
    } else {
      lot.shares = (lot.shares - t.shares).clamp(0, 1 << 30);
      // 賣出不改變剩餘成本（平均成本法）
      if (lot.shares == 0) lot.avgCost = 0;
      var remain = t.shares;
      final queue = buys[t.symbol] ?? [];
      var matchedThis = 0;
      while (remain > 0 && queue.isNotEmpty) {
        final open = queue.first;
        final matched = remain < open.shares ? remain : open.shares;
        final actualBuyFee = open.shares > 0 ? open.fee * matched / open.shares : 0.0;
        final actualSellFee = t.shares > 0 ? t.fee * matched / t.shares : 0.0;
        closed.add(ClosedTrade(
          symbol: t.symbol,
          name: t.name,
          shares: matched,
          buyPrice: open.price,
          sellPrice: t.price,
          buyDate: open.date,
          sellDate: t.date,
          fees: actualBuyFee + actualSellFee,
        ));
        open.shares -= matched;
        open.fee -= actualBuyFee;
        remain -= matched;
        matchedThis += matched;
        if (open.shares <= 0) queue.removeAt(0);
      }
      if (identical(t, countedSell)) matchedShares += matchedThis;
    }
  }

  return _Walk(lots: lots, closed: closed, matchedShares: matchedShares);
}

int matchedSellShares(List<Trade> trades, Trade candidate) {
  final sell = Trade(
    id: candidate.id,
    symbol: candidate.symbol,
    name: candidate.name,
    market: candidate.market,
    side: TradeSide.sell,
    date: candidate.date,
    price: candidate.price,
    shares: candidate.shares,
    fee: candidate.fee,
    note: candidate.note,
  );
  return _walkTrades([...trades, sell], countedSell: sell).matchedShares;
}

/// 將買賣交易彙整為目前持股（加權平均成本）。
List<Position> buildPositions(List<Trade> trades, {Map<String, double>? prices}) {
  final lots = _walkTrades(trades).lots;

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
  return _walkTrades(trades).closed;
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
