/// App 設定與常數。
class AppConfig {
  AppConfig._();

  /// TradingVenator 每日 JSON 根路徑（可在設定頁覆寫）。
  /// 對應網站 `https://tradingvenator.pages.dev/data`（meta / rs85 / patterns / breakouts / ohlcv）。
  static const defaultDataBaseUrl = 'https://tradingvenator.pages.dev/data';

  /// Cloudflare 可能擋預設 Dart/Dio UA；與 Yahoo 報價客戶端同一套瀏覽器式標頭。
  static const httpUserAgent = 'Mozilla/5.0 TaiwanRsApp';

  static const metaPath = '/meta.json';
  static const rs85Path = '/rs85.json';
  static const patternsPath = '/patterns.json';
  static const breakoutsPath = '/breakouts.json';

  static String ohlcvPath(String id) => '/ohlcv/$id.json';

  /// 去掉結尾斜線，讓 `/data` 與 `/data/` 指向同一組檔案。
  static String normalizeDataBaseUrl(String url) {
    var u = url.trim();
    while (u.endsWith('/')) {
      u = u.substring(0, u.length - 1);
    }
    return u;
  }

  /// 每日背景更新預設時間（台北）。
  static const defaultUpdateHour = 17;
  static const defaultUpdateMinute = 0;

  static const yahooChartBase =
      'https://query1.finance.yahoo.com/v8/finance/chart';
}
