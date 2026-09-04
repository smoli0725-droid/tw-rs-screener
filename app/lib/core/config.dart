/// App 設定與常數。
class AppConfig {
  AppConfig._();

  /// GitHub raw 根路徑（可在設定頁覆寫）。
  /// 預設指向本 repo 的 main 分支 output/app/
  static const defaultDataBaseUrl =
      'https://raw.githubusercontent.com/smoli0725-droid/tw-rs-screener/main/output/app';

  static const metaPath = '/meta.json';
  static const rs85Path = '/rs85.json';
  static const patternsPath = '/patterns.json';

  static String ohlcvPath(String id) => '/ohlcv/$id.json';

  /// 每日背景更新預設時間（台北）。
  static const defaultUpdateHour = 17;
  static const defaultUpdateMinute = 0;

  static const yahooChartBase =
      'https://query1.finance.yahoo.com/v8/finance/chart';
}
