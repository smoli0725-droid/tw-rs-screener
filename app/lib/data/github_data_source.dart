import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/config.dart';
import '../core/json_num.dart';
import '../domain/breakout_list.dart';
import '../domain/models.dart';
import '../domain/pattern_list.dart';

final prefsProvider = FutureProvider<SharedPreferences>((ref) async {
  return SharedPreferences.getInstance();
});

final dataBaseUrlProvider = Provider<String>((ref) {
  final prefs = ref.watch(prefsProvider).valueOrNull;
  final raw = prefs?.getString('data_base_url') ?? AppConfig.defaultDataBaseUrl;
  return AppConfig.normalizeDataBaseUrl(raw);
});

Dio createAppDio() {
  return Dio(
    BaseOptions(
      headers: {
        'User-Agent': AppConfig.httpUserAgent,
        'Accept': 'application/json,text/plain,*/*',
      },
      connectTimeout: const Duration(seconds: 20),
      receiveTimeout: const Duration(seconds: 30),
    ),
  );
}

class GitHubDataSource {
  GitHubDataSource(String baseUrl, {Dio? dio})
      : baseUrl = AppConfig.normalizeDataBaseUrl(baseUrl),
        _dio = dio ?? createAppDio();

  final String baseUrl;
  final Dio _dio;

  String _url(String path) => '$baseUrl$path';

  Future<Map<String, dynamic>> _getMap(String path) async {
    final r = await _dio.get<dynamic>(_url(path));
    final map = jsonMap(r.data);
    if (map == null) {
      throw StateError('Expected JSON object at $path');
    }
    return map;
  }

  Future<List<dynamic>> _getList(String path) async {
    final r = await _dio.get<dynamic>(_url(path));
    if (r.data is List) return r.data as List<dynamic>;
    throw StateError('Expected JSON array at $path');
  }

  Future<MetaInfo> fetchMeta() async {
    return MetaInfo.fromJson(await _getMap(AppConfig.metaPath));
  }

  Future<List<RsStock>> fetchRs85() async {
    final rows = await _getList(AppConfig.rs85Path);
    return [
      for (final e in rows)
        if (e is Map) RsStock.fromJson(Map<String, dynamic>.from(e)),
    ];
  }

  Future<List<PatternHit>> fetchPatterns() async {
    return patternHitsFromJsonList(await _getList(AppConfig.patternsPath));
  }

  /// `breakouts.json` 可選；404 時回 null（與網站 `fetchOptional` 相同）。
  Future<BreakoutBundle?> fetchBreakouts() async {
    try {
      final r = await _dio.get<dynamic>(_url(AppConfig.breakoutsPath));
      return breakoutBundleFromJson(r.data);
    } on DioException catch (e) {
      if (e.response?.statusCode == 404) return null;
      rethrow;
    }
  }

  Future<OhlcvBundle> fetchOhlcvBundle(String id) async {
    return OhlcvBundle.fromJson(await _getMap(AppConfig.ohlcvPath(id)));
  }

  Future<List<Candle>> fetchOhlcv(String id) async {
    return (await fetchOhlcvBundle(id)).candles;
  }
}

final githubDataSourceProvider = Provider<GitHubDataSource>((ref) {
  return GitHubDataSource(ref.watch(dataBaseUrlProvider));
});

final metaProvider = FutureProvider<MetaInfo>((ref) async {
  return ref.watch(githubDataSourceProvider).fetchMeta();
});

final rs85Provider = FutureProvider<List<RsStock>>((ref) async {
  return ref.watch(githubDataSourceProvider).fetchRs85();
});

final patternsProvider = FutureProvider<List<PatternHit>>((ref) async {
  return ref.watch(githubDataSourceProvider).fetchPatterns();
});

final breakoutsProvider = FutureProvider<BreakoutBundle?>((ref) async {
  return ref.watch(githubDataSourceProvider).fetchBreakouts();
});

final visibleBreakoutTradesProvider = Provider<AsyncValue<List<BreakoutTrade>>>((ref) {
  return ref.watch(breakoutsProvider).whenData((bundle) {
    return visibleBreakoutTrades(bundle?.trades ?? const []);
  });
});

void invalidateScreenerData(WidgetRef ref) {
  ref.invalidate(dataBaseUrlProvider);
  ref.invalidate(metaProvider);
  ref.invalidate(rs85Provider);
  ref.invalidate(patternsProvider);
  ref.invalidate(breakoutsProvider);
}
