import 'dart:io';

import 'package:android_alarm_manager_plus/android_alarm_manager_plus.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/data/latest.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;
import 'package:flutter_timezone/flutter_timezone.dart';

import '../core/config.dart';
import '../core/format.dart';
import '../data/github_data_source.dart';
import '../data/trade_dao.dart';
import '../data/yahoo_price_source.dart';
import '../domain/position_builder.dart';

const _alarmId = 1700;
const _retryAlarmId = 1701;

@pragma('vm:entry-point')
Future<void> alarmCallback() async {
  await _runRefresh(notify: true, allowRetry: true);
}

@pragma('vm:entry-point')
Future<void> retryAlarmCallback() async {
  await _runRefresh(notify: true, allowRetry: false);
}

Future<void> initBackground() async {
  tzdata.initializeTimeZones();
  try {
    final name = await FlutterTimezone.getLocalTimezone();
    tz.setLocalLocation(tz.getLocation(name));
  } catch (_) {
    tz.setLocalLocation(tz.getLocation('Asia/Taipei'));
  }

  if (Platform.isAndroid) {
    await AndroidAlarmManager.initialize();
  }

  final prefs = await SharedPreferences.getInstance();
  final hour = prefs.getInt('update_hour') ?? AppConfig.defaultUpdateHour;
  final minute = prefs.getInt('update_minute') ?? AppConfig.defaultUpdateMinute;
  final notify = prefs.getBool('notify_enabled') ?? true;
  await scheduleDailyRefresh(hour: hour, minute: minute, notify: notify);
}

Future<void> scheduleDailyRefresh({
  required int hour,
  required int minute,
  required bool notify,
}) async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.setBool('notify_enabled', notify);
  await prefs.setInt('update_hour', hour);
  await prefs.setInt('update_minute', minute);

  // 排程本地通知提醒（Android / iOS）
  await _scheduleDailyNotification(hour, minute, enabled: notify);

  if (!Platform.isAndroid) {
    // iOS 無法保證背景執行；開啟 App 時會刷新
    return;
  }

  await AndroidAlarmManager.cancel(_alarmId);
  await AndroidAlarmManager.cancel(_retryAlarmId);
  final ok = await AndroidAlarmManager.periodic(
    const Duration(days: 1),
    _alarmId,
    alarmCallback,
    startAt: _nextInstance(hour, minute),
    exact: true,
    wakeup: true,
    rescheduleOnReboot: true,
  );
  // ignore: avoid_print
  print('[bg] scheduled daily alarm=$ok at $hour:$minute');
}

DateTime _nextInstance(int hour, int minute) {
  final now = DateTime.now();
  var next = DateTime(now.year, now.month, now.day, hour, minute);
  if (!next.isAfter(now)) next = next.add(const Duration(days: 1));
  return next;
}

Future<void> _scheduleDailyNotification(int hour, int minute, {required bool enabled}) async {
  await _notifications.cancel(2001);
  if (!enabled) return;
  final when = tz.TZDateTime.from(_nextInstance(hour, minute), tz.local);
  await _notifications.zonedSchedule(
    2001,
    '台股 RS 每日更新',
    '開啟 App 可刷新持股損益與推薦名單',
    when,
    const NotificationDetails(
      android: AndroidNotificationDetails(
        'taiwan_rs_daily',
        '每日更新',
        channelDescription: '持股損益與資料新鮮度',
      ),
      iOS: DarwinNotificationDetails(),
    ),
    androidScheduleMode: AndroidScheduleMode.exactAllowWhileIdle,
    uiLocalNotificationDateInterpretation: UILocalNotificationDateInterpretation.absoluteTime,
    matchDateTimeComponents: DateTimeComponents.time,
  );
}

Future<void> _runRefresh({required bool notify, required bool allowRetry}) async {
  final prefs = await SharedPreferences.getInstance();
  final base = prefs.getString('data_base_url') ?? AppConfig.defaultDataBaseUrl;
  final ds = GitHubDataSource(base);
  String? dataDate;
  var stale = true;
  var fresh = false;
  try {
    final m = await ds.fetchMeta();
    dataDate = m.dataDate;
    stale = m.isStale;
    fresh = m.isFresh;
  } catch (_) {}

  if ((stale || !fresh) && allowRetry && Platform.isAndroid) {
    await AndroidAlarmManager.oneShot(
      const Duration(minutes: 45),
      _retryAlarmId,
      retryAlarmCallback,
      exact: true,
      wakeup: true,
    );
  }

  final dao = TradeDao();
  final trades = await dao.all();
  final positions = buildPositions(trades);
  final yahoo = YahooPriceSource();
  final prices = await yahoo.quotes([
    for (final p in positions) (id: p.symbol, market: p.market),
  ]);
  final priced = buildPositions(trades, prices: prices);
  final totalPnl = priced.fold<double>(0, (s, p) => s + p.unrealizedPnl);

  if (notify && (prefs.getBool('notify_enabled') ?? true)) {
    await _notify(
      title: '閃電選股 持股更新',
      body: '資料 ${dataDate ?? '—'} · 損益 ${fmtMoney(totalPnl)}'
          '${stale || !fresh ? ' · 資料尚未更新' : ''}',
    );
  }
}

final _notifications = FlutterLocalNotificationsPlugin();

Future<void> initNotifications() async {
  const android = AndroidInitializationSettings('@mipmap/ic_launcher');
  const ios = DarwinInitializationSettings();
  await _notifications.initialize(
    const InitializationSettings(android: android, iOS: ios),
  );
  await _notifications
      .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
      ?.requestNotificationsPermission();
}

Future<void> _notify({required String title, required String body}) async {
  const android = AndroidNotificationDetails(
    'taiwan_rs_daily',
    '每日更新',
    channelDescription: '持股損益與資料新鮮度',
    importance: Importance.defaultImportance,
    priority: Priority.defaultPriority,
  );
  await _notifications.show(
    1001,
    title,
    body,
    const NotificationDetails(android: android, iOS: DarwinNotificationDetails()),
  );
}
