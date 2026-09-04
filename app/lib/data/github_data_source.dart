import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/config.dart';
import '../domain/models.dart';

final prefsProvider = FutureProvider<SharedPreferences>((ref) async {
  return SharedPreferences.getInstance();
});

final dataBaseUrlProvider = Provider<String>((ref) {
  final prefs = ref.watch(prefsProvider).valueOrNull;
  return prefs?.getString('data_base_url') ?? AppConfig.defaultDataBaseUrl;
});

class GitHubDataSource {
  GitHubDataSource(this.baseUrl, {Dio? dio}) : _dio = dio ?? Dio();

  final String baseUrl;
  final Dio _dio;

  Future<MetaInfo> fetchMeta() async {
    final r = await _dio.get<Map<String, dynamic>>('$baseUrl${AppConfig.metaPath}');
    return MetaInfo.fromJson(r.data!);
  }

  Future<List<RsStock>> fetchRs85() async {
    final r = await _dio.get<List<dynamic>>('$baseUrl${AppConfig.rs85Path}');
    return r.data!.map((e) => RsStock.fromJson(Map<String, dynamic>.from(e as Map))).toList();
  }

  Future<List<PatternHit>> fetchPatterns() async {
    final r = await _dio.get<List<dynamic>>('$baseUrl${AppConfig.patternsPath}');
    return r.data!
        .map((e) => PatternHit.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();
  }

  Future<List<Candle>> fetchOhlcv(String id) async {
    final r = await _dio.get<Map<String, dynamic>>('$baseUrl${AppConfig.ohlcvPath(id)}');
    final candles = (r.data!['candles'] as List)
        .map((e) => Candle.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();
    return candles;
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
