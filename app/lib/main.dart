import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'background/background_tasks.dart';
import 'core/theme.dart';
import 'features/portfolio/portfolio_page.dart';
import 'features/recommend/recommend_page.dart';
import 'features/settings/settings_page.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initNotifications();
  try {
    await initBackground();
  } catch (_) {
    // 桌面 / 測試環境可能不支援 workmanager
  }
  runApp(const ProviderScope(child: TaiwanRsApp()));
}

class TaiwanRsApp extends StatelessWidget {
  const TaiwanRsApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '閃電選股',
      theme: AppTheme.light(),
      home: const HomeShell(),
      debugShowCheckedModeBanner: false,
    );
  }
}

class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  static const _pages = [
    PortfolioPage(),
    RecommendPage(),
    SettingsPage(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(index: _index, children: _pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.account_balance_wallet_outlined), label: '持股'),
          NavigationDestination(icon: Icon(Icons.candlestick_chart), label: '推薦'),
          NavigationDestination(icon: Icon(Icons.settings_outlined), label: '設定'),
        ],
      ),
    );
  }
}
