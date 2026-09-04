import 'package:dio/dio.dart';

import '../core/config.dart';
import '../core/format.dart';
import '../domain/models.dart';

class YahooPriceSource {
  YahooPriceSource({Dio? dio}) : _dio = dio ?? Dio(BaseOptions(
          headers: {'User-Agent': 'Mozilla/5.0 TaiwanRsApp'},
          connectTimeout: const Duration(seconds: 20),
          receiveTimeout: const Duration(seconds: 30),
        ));

  final Dio _dio;

  Future<double?> quote(String id, String market) async {
    for (final ticker in _tickers(id, market)) {
      try {
        final r = await _dio.get(
          '${AppConfig.yahooChartBase}/$ticker',
          queryParameters: {'interval': '1d', 'range': '5d'},
        );
        final result = r.data['chart']['result'];
        if (result == null || (result as List).isEmpty) continue;
        final meta = result[0]['meta'] as Map;
        final price = (meta['regularMarketPrice'] as num?)?.toDouble();
        if (price != null) return price;
      } catch (_) {
        continue;
      }
    }
    return null;
  }

  Future<Map<String, double>> quotes(List<({String id, String market})> items) async {
    final out = <String, double>{};
    for (final item in items) {
      final p = await quote(item.id, item.market);
      if (p != null) out[item.id] = p;
    }
    return out;
  }

  Future<List<Candle>> history(String id, String market, {String range = '1y'}) async {
    for (final ticker in _tickers(id, market)) {
      try {
        final r = await _dio.get(
          '${AppConfig.yahooChartBase}/$ticker',
          queryParameters: {'interval': '1d', 'range': range},
        );
        final result = r.data['chart']['result'];
        if (result == null || (result as List).isEmpty) continue;
        final timestamps = (result[0]['timestamp'] as List).cast<int>();
        final quote = result[0]['indicators']['quote'][0] as Map;
        final opens = (quote['open'] as List);
        final highs = (quote['high'] as List);
        final lows = (quote['low'] as List);
        final closes = (quote['close'] as List);
        final vols = (quote['volume'] as List);
        final candles = <Candle>[];
        final closeSeries = <double>[];
        for (var i = 0; i < timestamps.length; i++) {
          if (closes[i] == null) continue;
          final close = (closes[i] as num).toDouble();
          closeSeries.add(close);
          candles.add(Candle(
            date: DateTime.fromMillisecondsSinceEpoch(timestamps[i] * 1000),
            open: (opens[i] as num?)?.toDouble() ?? close,
            high: (highs[i] as num?)?.toDouble() ?? close,
            low: (lows[i] as num?)?.toDouble() ?? close,
            close: close,
            volume: (vols[i] as num?)?.toDouble() ?? 0,
            ma50: _ma(closeSeries, 50),
            ma150: _ma(closeSeries, 150),
            ma200: _ma(closeSeries, 200),
          ));
        }
        if (candles.isNotEmpty) return candles;
      } catch (_) {
        continue;
      }
    }
    return [];
  }

  List<String> _tickers(String id, String market) {
    final primary = yfTicker(id, market);
    final alt = primary.endsWith('.TW') ? '$id.TWO' : '$id.TW';
    return [primary, alt];
  }

  double? _ma(List<double> closes, int n) {
    if (closes.length < n) return null;
    var s = 0.0;
    for (var i = closes.length - n; i < closes.length; i++) {
      s += closes[i];
    }
    return s / n;
  }
}
