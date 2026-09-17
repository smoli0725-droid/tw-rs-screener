import 'package:taiwan_rs_app/core/config.dart';
import 'package:taiwan_rs_app/data/github_data_source.dart';
import 'package:taiwan_rs_app/domain/breakout_list.dart';

/// Live `/data` smoke (skipped if offline). Run: `dart test test/live_data_test.dart`
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('live TradingVenator /data loads with browser UA', () async {
    final ds = GitHubDataSource(AppConfig.defaultDataBaseUrl);
    final meta = await ds.fetchMeta();
    expect(meta.dataDate, isNotNull);
    expect(meta.counts['rs85'], isNotNull);

    final rs = await ds.fetchRs85();
    expect(rs, isNotEmpty);

    final patterns = await ds.fetchPatterns();
    expect(patterns, isNotEmpty);
    expect(patterns.any((p) => p.status == '已延伸'), isFalse);

    final breakouts = await ds.fetchBreakouts();
    expect(breakouts, isNotNull);
    final visible = visibleBreakoutTrades(breakouts!.trades);
    expect(visible.any((t) => t.status == 'reentered'), isFalse);

    final sampleId = patterns.first.id;
    final ohlcv = await ds.fetchOhlcvBundle(sampleId);
    expect(ohlcv.candles, isNotEmpty);
  }, timeout: const Timeout(Duration(seconds: 45)));
}
