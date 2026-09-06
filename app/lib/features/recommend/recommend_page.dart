import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/theme.dart';
import '../../data/github_data_source.dart';
import '../chart/stock_chart_page.dart';

class RecommendPage extends ConsumerStatefulWidget {
  const RecommendPage({super.key});

  @override
  ConsumerState<RecommendPage> createState() => _RecommendPageState();
}

class _RecommendPageState extends ConsumerState<RecommendPage>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final metaAsync = ref.watch(metaProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('股價推薦'),
        bottom: TabBar(
          controller: _tabs,
          tabs: const [
            Tab(text: 'RS≥85 總表'),
            Tab(text: '型態／即將突破'),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {
              ref.invalidate(metaProvider);
              ref.invalidate(rs85Provider);
              ref.invalidate(patternsProvider);
            },
          ),
        ],
      ),
      body: Column(
        children: [
          metaAsync.when(
            data: (m) => Material(
              color: m.isStale ? Colors.orange.shade100 : Colors.green.shade50,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                child: Text(
                  '資料日期 ${m.dataDate ?? '—'}'
                  '${m.isStale || !m.isFresh ? '  · 資料尚未更新' : ''}'
                  '  · RS85 ${m.counts['rs85'] ?? '—'}'
                  '  · 即將突破 ${m.counts['near_breakout'] ?? '—'}',
                  style: const TextStyle(fontSize: 13),
                ),
              ),
            ),
            loading: () => const SizedBox.shrink(),
            error: (e, _) => Material(
              color: Colors.red.shade50,
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: Text('讀取失敗：$e', style: const TextStyle(fontSize: 13)),
              ),
            ),
          ),
          Expanded(
            child: TabBarView(
              controller: _tabs,
              children: const [
                _Rs85Tab(),
                _PatternsTab(),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Rs85Tab extends ConsumerStatefulWidget {
  const _Rs85Tab();

  @override
  ConsumerState<_Rs85Tab> createState() => _Rs85TabState();
}

class _Rs85TabState extends ConsumerState<_Rs85Tab> {
  String _q = '';
  String? _market;
  bool _templateOnly = false;

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(rs85Provider);
    return async.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(child: Text('$e')),
      data: (rows) {
        var list = rows;
        if (_q.isNotEmpty) {
          list = list
              .where((r) => r.id.contains(_q) || r.name.contains(_q) || r.industry.contains(_q))
              .toList();
        }
        if (_market != null) {
          list = list.where((r) => r.market == _market).toList();
        }
        if (_templateOnly) {
          list = list.where((r) => r.templatePass).toList();
        }
        return Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
              child: TextField(
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search),
                  hintText: '搜尋代號 / 名稱 / 產業',
                ),
                onChanged: (v) => setState(() => _q = v.trim()),
              ),
            ),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: Row(
                children: [
                  FilterChip(
                    label: const Text('全部市場'),
                    selected: _market == null,
                    onSelected: (_) => setState(() => _market = null),
                  ),
                  const SizedBox(width: 6),
                  FilterChip(
                    label: const Text('上市'),
                    selected: _market == '上市',
                    onSelected: (_) => setState(() => _market = '上市'),
                  ),
                  const SizedBox(width: 6),
                  FilterChip(
                    label: const Text('上櫃'),
                    selected: _market == '上櫃',
                    onSelected: (_) => setState(() => _market = '上櫃'),
                  ),
                  const SizedBox(width: 6),
                  FilterChip(
                    label: const Text('只看通過樣板'),
                    selected: _templateOnly,
                    onSelected: (v) => setState(() => _templateOnly = v),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView.builder(
                itemCount: list.length,
                itemBuilder: (_, i) {
                  final r = list[i];
                  return ListTile(
                    title: Text('${r.id} ${r.name}'),
                    subtitle: Text(
                      '${r.market} · ${r.industry}'
                      '${r.templatePass ? ' · ✔樣板' : ''}'
                      '${r.patterns.isEmpty ? '' : '\n${r.patterns.join(' · ')}'}',
                    ),
                    isThreeLine: r.patterns.isNotEmpty,
                    trailing: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text('RS ${r.rs}',
                            style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.indigo)),
                        Text(fmtMoney(r.close)),
                      ],
                    ),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => StockChartPage(
                          id: r.id,
                          name: r.name,
                          market: r.market,
                          pivot: null,
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        );
      },
    );
  }
}

class _PatternsTab extends ConsumerStatefulWidget {
  const _PatternsTab();

  @override
  ConsumerState<_PatternsTab> createState() => _PatternsTabState();
}

class _PatternsTabState extends ConsumerState<_PatternsTab> {
  final _selectedPatterns = <String>{};
  final _selectedStatus = <String>{'即將突破'};

  static const allPatterns = [
    'VCP',
    '3-C',
    '低位作弊',
    '杯狀帶柄',
    '雙重底',
    '高聳旗形',
  ];
  static const allStatus = ['即將突破', '已突破', '整理中'];

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(patternsProvider);
    return async.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(child: Text('$e')),
      data: (rows) {
        var list = rows;
        if (_selectedPatterns.isNotEmpty) {
          list = list.where((r) => _selectedPatterns.contains(r.pattern)).toList();
        }
        if (_selectedStatus.isNotEmpty) {
          list = list.where((r) => _selectedStatus.contains(r.status)).toList();
        }
        return Column(
          children: [
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(8, 8, 8, 4),
              child: Row(
                children: [
                  for (final s in allStatus) ...[
                    FilterChip(
                      label: Text(s),
                      selected: _selectedStatus.contains(s),
                      onSelected: (v) => setState(() {
                        if (v) {
                          _selectedStatus.add(s);
                        } else {
                          _selectedStatus.remove(s);
                        }
                      }),
                    ),
                    const SizedBox(width: 6),
                  ],
                ],
              ),
            ),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(8, 0, 8, 4),
              child: Row(
                children: [
                  for (final p in allPatterns) ...[
                    FilterChip(
                      label: Text(p),
                      selected: _selectedPatterns.contains(p),
                      onSelected: (v) => setState(() {
                        if (v) {
                          _selectedPatterns.add(p);
                        } else {
                          _selectedPatterns.remove(p);
                        }
                      }),
                    ),
                    const SizedBox(width: 6),
                  ],
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text('${list.length} 筆', style: Theme.of(context).textTheme.bodySmall),
              ),
            ),
            Expanded(
              child: ListView.builder(
                padding: const EdgeInsets.only(bottom: 24),
                itemCount: list.length,
                itemBuilder: (_, i) {
                  final r = list[i];
                  final statusColor = switch (r.status) {
                    '即將突破' => Colors.deepOrange,
                    '已突破' => AppTheme.twUp,
                    _ => Colors.blueGrey,
                  };
                  return Card(
                    margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    child: InkWell(
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => StockChartPage(
                            id: r.id,
                            name: r.name,
                            market: r.market,
                            pivot: r.pivot,
                            annotations: r.annotations,
                            preferRepoOhlcv: true,
                          ),
                        ),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text('${r.id} ${r.name}',
                                      style: const TextStyle(fontWeight: FontWeight.w600)),
                                ),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: statusColor.withValues(alpha: 0.12),
                                    borderRadius: BorderRadius.circular(999),
                                  ),
                                  child: Text(r.status,
                                      style: TextStyle(color: statusColor, fontSize: 12)),
                                ),
                              ],
                            ),
                            const SizedBox(height: 4),
                            Text('${r.patternLabel} · RS ${r.rs} · ${fmtMoney(r.close)}'),
                            Text(
                              '樞紐 ${fmtMoney(r.pivot)}（${fmtPctPoints(r.distPivotPct)}）'
                              '${r.contraction != null ? ' · ${r.contraction}' : ''}'
                              '${r.baseWeeks != null ? ' · ${r.baseWeeks}週' : ''}'
                              '${r.volDryRatio != null ? ' · 量縮 ${r.volDryRatio}' : ''}',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        );
      },
    );
  }
}
