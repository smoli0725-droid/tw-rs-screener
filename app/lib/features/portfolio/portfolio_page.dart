import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/theme.dart';
import '../../data/github_data_source.dart';
import '../../data/trade_dao.dart';
import '../../data/yahoo_price_source.dart';
import '../../domain/models.dart';
import '../../domain/position_builder.dart';
import '../chart/stock_chart_page.dart';
import 'add_trade_sheet.dart';
import 'metrics_page.dart';

final tradeDaoProvider = Provider((ref) => TradeDao());
final yahooProvider = Provider((ref) => YahooPriceSource());

final tradesProvider = FutureProvider<List<Trade>>((ref) async {
  return ref.watch(tradeDaoProvider).all();
});

final positionsProvider = FutureProvider<List<Position>>((ref) async {
  final trades = await ref.watch(tradesProvider.future);
  final positions = buildPositions(trades);
  if (positions.isEmpty) return positions;

  final fallback = <String, double>{};
  try {
    for (final s in await ref.watch(rs85Provider.future)) {
      fallback[s.id] = s.close;
    }
  } catch (_) {}
  try {
    for (final p in await ref.watch(patternsProvider.future)) {
      fallback[p.id] ??= p.close;
    }
  } catch (_) {}
  try {
    final bundle = await ref.watch(breakoutsProvider.future);
    for (final t in bundle?.trades ?? const <BreakoutTrade>[]) {
      if (t.lastClose != null) fallback[t.id] ??= t.lastClose!;
    }
  } catch (_) {}

  final yahoo = ref.read(yahooProvider);
  final live = await yahoo.quotes([
    for (final p in positions) (id: p.symbol, market: p.market),
  ]);
  // Yahoo 有值時覆蓋 /data 收盤；Confirm／券商即時報價尚未接入。
  return buildPositions(trades, prices: {...fallback, ...live});
});

class PortfolioPage extends ConsumerWidget {
  const PortfolioPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final positionsAsync = ref.watch(positionsProvider);
    final metaAsync = ref.watch(metaProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('我的持股'),
        actions: [
          IconButton(
            tooltip: '績效',
            icon: const Icon(Icons.insights),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const MetricsPage()),
            ),
          ),
          IconButton(
            tooltip: '重新整理',
            icon: const Icon(Icons.refresh),
            onPressed: () {
              ref.invalidate(tradesProvider);
              ref.invalidate(positionsProvider);
              ref.invalidate(metaProvider);
            },
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final ok = await showModalBottomSheet<bool>(
            context: context,
            isScrollControlled: true,
            builder: (_) => const AddTradeSheet(),
          );
          if (ok == true) {
            ref.invalidate(tradesProvider);
            ref.invalidate(positionsProvider);
          }
        },
        icon: const Icon(Icons.add),
        label: const Text('新增持股'),
      ),
      body: Column(
        children: [
          metaAsync.when(
            data: (m) => _FreshnessBanner(meta: m),
            loading: () => const SizedBox.shrink(),
            error: (_, __) => const _FreshnessBanner(
              meta: null,
              fallback: '無法讀取資料日期（請到設定確認資料來源 URL）',
            ),
          ),
          Expanded(
            child: positionsAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(child: Text('載入失敗：$e')),
              data: (positions) {
                if (positions.isEmpty) {
                  return const Center(child: Text('尚未有持股，點右下角新增'));
                }
                final totalMv = positions.fold<double>(0, (s, p) => s + p.marketValue);
                final totalCost = positions.fold<double>(0, (s, p) => s + p.costValue);
                final totalPnl = totalMv - totalCost;
                final totalRet = totalCost == 0 ? 0.0 : totalPnl / totalCost;
                return RefreshIndicator(
                  onRefresh: () async {
                    ref.invalidate(positionsProvider);
                    await ref.read(positionsProvider.future);
                  },
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(12, 8, 12, 88),
                    children: [
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('總市值 ${fmtMoney(totalMv)}',
                                  style: Theme.of(context).textTheme.titleMedium),
                              const SizedBox(height: 4),
                              Text(
                                '損益 ${fmtMoney(totalPnl)}（${fmtPctRatio(totalRet)}）',
                                style: TextStyle(
                                  color: AppTheme.pnl(totalPnl),
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              Text('成本 ${fmtMoney(totalCost)} · ${positions.length} 檔',
                                  style: Theme.of(context).textTheme.bodySmall),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 8),
                      ...positions.map((p) => Card(
                            child: ListTile(
                              title: Text('${p.symbol} ${p.name}'),
                              subtitle: Text(
                                '成本 ${fmtMoney(p.avgCost)} × ${p.shares} 股\n'
                                '現價 ${p.lastPrice == null ? '—' : fmtMoney(p.lastPrice!)}',
                              ),
                              isThreeLine: true,
                              trailing: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                crossAxisAlignment: CrossAxisAlignment.end,
                                children: [
                                  Text(
                                    fmtPctRatio(p.returnPct),
                                    style: TextStyle(
                                      color: AppTheme.pnl(p.returnPct),
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                  Text(fmtMoney(p.unrealizedPnl),
                                      style: TextStyle(color: AppTheme.pnl(p.unrealizedPnl), fontSize: 12)),
                                ],
                              ),
                              onTap: () => Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (_) => StockChartPage(
                                    id: p.symbol,
                                    name: p.name,
                                    market: p.market,
                                  ),
                                ),
                              ),
                            ),
                          )),
                    ],
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _FreshnessBanner extends StatelessWidget {
  const _FreshnessBanner({required this.meta, this.fallback});
  final MetaInfo? meta;
  final String? fallback;

  @override
  Widget build(BuildContext context) {
    final stale = meta?.isStale ?? true;
    final text = meta == null
        ? (fallback ?? '資料日期未知')
        : '資料日期 ${meta!.dataDate ?? '—'}'
            '${stale || !meta!.isFresh ? '  · 資料尚未更新' : ''}';
    return Material(
      color: stale ? Colors.orange.shade100 : Colors.green.shade50,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Row(
          children: [
            Icon(stale ? Icons.warning_amber : Icons.check_circle,
                size: 18, color: stale ? Colors.orange.shade800 : Colors.green.shade800),
            const SizedBox(width: 8),
            Expanded(child: Text(text, style: const TextStyle(fontSize: 13))),
          ],
        ),
      ),
    );
  }
}
