import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/config.dart';
import '../../data/github_data_source.dart';
import '../../background/background_tasks.dart';

class SettingsPage extends ConsumerStatefulWidget {
  const SettingsPage({super.key});

  @override
  ConsumerState<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends ConsumerState<SettingsPage> {
  late TextEditingController _url;
  int _hour = AppConfig.defaultUpdateHour;
  int _minute = AppConfig.defaultUpdateMinute;
  bool _notify = true;
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    _url = TextEditingController();
    _load();
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _url.text = prefs.getString('data_base_url') ?? AppConfig.defaultDataBaseUrl;
      _hour = prefs.getInt('update_hour') ?? AppConfig.defaultUpdateHour;
      _minute = prefs.getInt('update_minute') ?? AppConfig.defaultUpdateMinute;
      _notify = prefs.getBool('notify_enabled') ?? true;
      _loaded = true;
    });
  }

  Future<void> _save({required bool reset}) async {
    final prefs = await SharedPreferences.getInstance();
    if (reset) {
      await prefs.remove('data_base_url');
      _url.text = AppConfig.defaultDataBaseUrl;
    } else {
      await prefs.setString(
        'data_base_url',
        AppConfig.normalizeDataBaseUrl(_url.text),
      );
      _url.text = AppConfig.normalizeDataBaseUrl(_url.text);
    }
    await prefs.setInt('update_hour', _hour);
    await prefs.setInt('update_minute', _minute);
    await prefs.setBool('notify_enabled', _notify);
    invalidateScreenerData(ref);
    await scheduleDailyRefresh(hour: _hour, minute: _minute, notify: _notify);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(reset ? '已恢復預設資料來源' : '已儲存')),
      );
    }
  }

  @override
  void dispose() {
    _url.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_loaded) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final metaAsync = ref.watch(metaProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('設定')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: Image.asset(
                  'assets/brand/cheetah.png',
                  width: 48,
                  height: 48,
                ),
              ),
              const SizedBox(width: 12),
              const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '閃電選股',
                    style: TextStyle(fontWeight: FontWeight.w700, fontSize: 18),
                  ),
                  Text('FlashPick'),
                ],
              ),
            ],
          ),
          const Divider(height: 32),
          Text('帳號 / 雲端持股', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Text(
            '尚未接上 Clerk／D1 雲端同步。持股目前只存在本機，沒有券商或 Confirm 下單 API。',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const Divider(height: 32),
          Text('資料狀態', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          metaAsync.when(
            data: (m) {
              final fresh = !m.isFresh || m.isStale ? '可能過期' : '已更新';
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('資料日期：${m.dataDate ?? '—'}'),
                  Text('新鮮度：$fresh'),
                  if (m.message != null && m.message!.isNotEmpty)
                    Text(m.message!, style: Theme.of(context).textTheme.bodySmall),
                ],
              );
            },
            loading: () => const Text('載入中…'),
            error: (e, _) => Text('無法讀取：$e', style: Theme.of(context).textTheme.bodySmall),
          ),
          const Divider(height: 32),
          Text('資料來源', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          TextField(
            controller: _url,
            decoration: const InputDecoration(
              labelText: '資料來源 URL',
              helperText: '預設 TradingVenator /data（不含結尾斜線亦可）',
            ),
            maxLines: 2,
          ),
          const SizedBox(height: 8),
          Text(
            '預設 ${AppConfig.defaultDataBaseUrl}\n'
            '也可改成 GitHub raw，例如：\n'
            'https://raw.githubusercontent.com/smoli0725-droid/tw-rs-screener/main/output/app',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: FilledButton(
                  onPressed: () => _save(reset: false),
                  child: const Text('儲存並重新載入'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton(
                  onPressed: () => _save(reset: true),
                  child: const Text('恢復預設'),
                ),
              ),
            ],
          ),
          const Divider(height: 32),
          Text('每日自動更新', style: Theme.of(context).textTheme.titleMedium),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text('時間 $_hour:${_minute.toString().padLeft(2, '0')}（裝置本地時區）'),
            subtitle: const Text('本機通知提醒，不是 FCM。建議 17:00；背景執行時機由系統決定'),
            trailing: const Icon(Icons.schedule),
            onTap: () async {
              final t = await showTimePicker(
                context: context,
                initialTime: TimeOfDay(hour: _hour, minute: _minute),
              );
              if (t != null) {
                setState(() {
                  _hour = t.hour;
                  _minute = t.minute;
                });
              }
            },
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('推播當日損益通知'),
            subtitle: const Text('本機排程；未接 Firebase Cloud Messaging'),
            value: _notify,
            onChanged: (v) => setState(() => _notify = v),
          ),
          const Divider(height: 32),
          Text('即時報價', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Text(
            '尚未接上 Confirm 或券商即時報價。持股現價先用 Yahoo，失敗時改用 /data 的 RS／突破收盤價。',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}
