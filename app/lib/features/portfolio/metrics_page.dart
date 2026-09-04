import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/theme.dart';
import '../../domain/portfolio_metrics.dart';
import 'portfolio_page.dart';

class MetricsPage extends ConsumerWidget {
  const MetricsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tradesAsync = ref.watch(tradesProvider);
    final positionsAsync = ref.watch(positionsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('績效統計')),
      body: tradesAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('$e')),
        data: (trades) {
          return positionsAsync.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => Center(child: Text('$e')),
            data: (positions) {
              final m = computeMetrics(trades: trades, positions: positions);
              return ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  _MetricCard(
                    title: '勝率',
                    value: m.winRate == null ? '—' : fmtPctRatio(m.winRate!),
                    subtitle: m.closedCount > 0
                        ? '已平倉 ${m.closedCount} 筆'
                        : '尚無平倉，改以持股獲利比例（${m.openCount} 檔）',
                  ),
                  _MetricCard(
                    title: '平均報酬率（已平倉）',
                    value: m.avgReturnPct == null ? '—' : fmtPctRatio(m.avgReturnPct!),
                    color: m.avgReturnPct == null ? null : AppTheme.pnl(m.avgReturnPct!),
                  ),
                  _MetricCard(
                    title: '平均報酬率（持股）',
                    value: m.avgOpenReturnPct == null ? '—' : fmtPctRatio(m.avgOpenReturnPct!),
                    color: m.avgOpenReturnPct == null ? null : AppTheme.pnl(m.avgOpenReturnPct!),
                  ),
                  const SizedBox(height: 12),
                  Text('月績效', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  if (m.monthly.isEmpty)
                    const Text('尚無資料')
                  else
                    ...m.monthly.reversed.map(
                      (row) => Card(
                        child: ListTile(
                          title: Text(row.yearMonth),
                          subtitle: Text('報酬 ${fmtPctRatio(row.returnPct)}'),
                          trailing: Text(
                            fmtMoney(row.pnl),
                            style: TextStyle(
                              color: AppTheme.pnl(row.pnl),
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              );
            },
          );
        },
      ),
    );
  }
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({required this.title, required this.value, this.subtitle, this.color});
  final String title;
  final String value;
  final String? subtitle;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: Theme.of(context).textTheme.bodyMedium),
            const SizedBox(height: 4),
            Text(value,
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      color: color,
                      fontWeight: FontWeight.bold,
                    )),
            if (subtitle != null) ...[
              const SizedBox(height: 4),
              Text(subtitle!, style: Theme.of(context).textTheme.bodySmall),
            ],
          ],
        ),
      ),
    );
  }
}
