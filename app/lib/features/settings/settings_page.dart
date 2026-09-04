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

  Future<void> _save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('data_base_url', _url.text.trim());
    await prefs.setInt('update_hour', _hour);
    await prefs.setInt('update_minute', _minute);
    await prefs.setBool('notify_enabled', _notify);
    ref.invalidate(dataBaseUrlProvider);
    ref.invalidate(metaProvider);
    ref.invalidate(rs85Provider);
    ref.invalidate(patternsProvider);
    await scheduleDailyRefresh(hour: _hour, minute: _minute, notify: _notify);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('已儲存')));
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
    return Scaffold(
      appBar: AppBar(title: const Text('設定')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('資料來源', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          TextField(
            controller: _url,
            decoration: const InputDecoration(
              labelText: 'GitHub raw base URL',
              helperText: '指向 output/app（不含結尾斜線亦可）',
            ),
            maxLines: 2,
          ),
          const SizedBox(height: 8),
          Text(
            '請把 OWNER/REPO 換成你的 GitHub 帳號與 repo 名稱，例如：\n'
            'https://raw.githubusercontent.com/you/taiwan-rs/main/output/app',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const Divider(height: 32),
          Text('每日自動更新', style: Theme.of(context).textTheme.titleMedium),
          ListTile(
            title: Text('時間 $_hour:${_minute.toString().padLeft(2, '0')}（裝置本地時區）'),
            subtitle: const Text('建議設為 17:00；iOS 背景執行時機由系統決定'),
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
            title: const Text('推播當日損益通知'),
            value: _notify,
            onChanged: (v) => setState(() => _notify = v),
          ),
          const SizedBox(height: 16),
          FilledButton(onPressed: _save, child: const Text('儲存設定')),
        ],
      ),
    );
  }
}
