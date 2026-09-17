import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:taiwan_rs_app/core/config.dart';
import 'package:taiwan_rs_app/data/github_data_source.dart';
import 'package:taiwan_rs_app/domain/breakout_list.dart';
import 'package:taiwan_rs_app/domain/models.dart';
import 'package:taiwan_rs_app/domain/pattern_list.dart';

Directory _repoRoot() {
  var dir = Directory.current;
  for (var i = 0; i < 4; i++) {
    if (File('${dir.path}/output/app/meta.json').existsSync()) return dir;
    dir = dir.parent;
  }
  return Directory.current;
}

void main() {
  test('default data base is TradingVenator /data', () {
    expect(AppConfig.defaultDataBaseUrl, 'https://tradingvenator.pages.dev/data');
    expect(AppConfig.normalizeDataBaseUrl('${AppConfig.defaultDataBaseUrl}/'), AppConfig.defaultDataBaseUrl);
    expect(AppConfig.httpUserAgent, contains('Mozilla/5.0'));
  });

  test('visibleBreakoutTrades drops reentered', () {
    final bundle = BreakoutBundle.fromJson({
      'trades': [
        {'id': '2330', 'name': '台積電', 'status': 'active', 'pivot': 100, 'origin': 'pattern'},
        {'id': '2454', 'name': '聯發科', 'status': 'reentered', 'pivot': 200, 'origin': 'pattern'},
        {
          'id': '3441',
          'name': '聯一光',
          'status': 'success',
          'pivot': 139.5,
          'origin': 'recovered',
          'last_close': 166,
        },
      ],
    });
    final visible = visibleBreakoutTrades(bundle.trades);
    expect(visible.map((t) => t.id).toList(), ['2330', '3441']);
    expect(visible.any((t) => t.status == 'reentered'), isFalse);
    expect(visible.last.isRecoveredOrigin, isTrue);
    expect(visible.last.statusLabel, '成功');
  });

  test('GitHubDataSource treats breakouts 404 as optional', () async {
    final dio = Dio();
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          handler.reject(
            DioException(
              requestOptions: options,
              response: Response(requestOptions: options, statusCode: 404),
              type: DioExceptionType.badResponse,
            ),
          );
        },
      ),
    );
    final ds = GitHubDataSource(AppConfig.defaultDataBaseUrl, dio: dio);
    expect(await ds.fetchBreakouts(), isNull);
  });

  test('createAppDio sends browser-like User-Agent', () {
    expect(createAppDio().options.headers['User-Agent'], AppConfig.httpUserAgent);
  });

  test('parses output/app fixtures', () {
    final root = _repoRoot();
    final metaFile = File('${root.path}/output/app/meta.json');
    final breakoutsFile = File('${root.path}/output/app/breakouts.json');
    final patternsFile = File('${root.path}/output/app/patterns.json');
    final rsFile = File('${root.path}/output/app/rs85.json');
    expect(metaFile.existsSync(), isTrue, reason: 'need output/app fixtures');

    final meta = MetaInfo.fromJson(jsonDecode(metaFile.readAsStringSync()) as Map<String, dynamic>);
    expect(meta.dataDate, isNotNull);
    expect(meta.counts['rs85'], isNotNull);
    expect(meta.market?.label, isNotNull);

    final rs = (jsonDecode(rsFile.readAsStringSync()) as List)
        .map((e) => RsStock.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();
    expect(rs, isNotEmpty);
    expect(rs.first.id, isNotEmpty);

    final patterns = patternHitsFromJsonList(jsonDecode(patternsFile.readAsStringSync()) as List);
    expect(patterns, isNotEmpty);
    expect(patterns.map((p) => p.id).toSet().length, patterns.length);
    expect(patterns.any((p) => p.status == '已延伸'), isFalse);

    final bundle = BreakoutBundle.fromJson(
      jsonDecode(breakoutsFile.readAsStringSync()) as Map<String, dynamic>,
    );
    final visible = visibleBreakoutTrades(bundle.trades);
    expect(visible.length, bundle.trades.length); // current snapshot has no reentered
    expect(visible.every((t) => t.status != 'reentered'), isTrue);
    expect({'active', 'success', 'failed', 'recovered'}.containsAll(visible.map((t) => t.status)), isTrue);

    final ohlcvDir = Directory('${root.path}/output/app/ohlcv');
    final sample = ohlcvDir.listSync().whereType<File>().first;
    final ohlcv = OhlcvBundle.fromJson(jsonDecode(sample.readAsStringSync()) as Map<String, dynamic>);
    expect(ohlcv.candles, isNotEmpty);
    expect(ohlcv.candles.first.close, greaterThan(0));
  });
}
