import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/theme.dart';
import '../../data/github_data_source.dart';
import '../../domain/models.dart';
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
    _tabs = TabController(length: 3, vsync: this);
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  void _refresh() {
    ref.invalidate(metaProvider);
    ref.invalidate(rs85Provider);
    ref.invalidate(patternsProvider);
    ref.invalidate(breakoutsProvider);
  }

  @override
  Widget build(BuildContext context) {
    final metaAsync = ref.watch(metaProvider);
    final breakoutsAsync = ref.watch(breakoutsProvider);
    final market = breakoutsAsync.valueOrNull?.market ?? metaAsync.valueOrNull?.market;

    return Scaffold(
      appBar: AppBar(
        title: const Text('股價推薦'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _refresh,
          ),
        ],
      ),
      body: Column(
        children: [
          metaAsync.when(
            data: (m) {
              final mk = m.market;
              final rate = mk?.winRatePct;
              return Material(
                color: m.isStale ? Colors.orange.shade100 : Colors.green.shade50,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  child: Text(
                    '資料 ${m.dataDate ?? '—'}'
                    '  · RS85 ${m.counts['rs85'] ?? '—'}'
                    '  · 型態 ${m.counts['pattern_symbols'] ?? m.counts['patterns'] ?? '—'} 檔'
                    '  · 即將突破 ${m.counts['near_breakout'] ?? '—'}'
                    '  · 可買 ${m.counts['broke_out'] ?? '—'}'
                    '${rate != null ? '  · 勝率 $rate%' : ''}'
                    '${m.isStale || !m.isFresh ? '  · 資料尚未更新' : ''}',
                    style: const TextStyle(fontSize: 13),
                  ),
                ),
              );
            },
            loading: () => const SizedBox.shrink(),
            error: (e, _) => Material(
              color: Colors.red.shade50,
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: Text('讀取失敗：$e', style: const TextStyle(fontSize: 13)),
              ),
            ),
          ),
          _MarketCard(market: market),
          TabBar(
            controller: _tabs,
            tabs: const [
              Tab(text: 'RS≥85'),
              Tab(text: '型態／突破'),
              Tab(text: '交易追蹤'),
            ],
          ),
          Expanded(
            child: TabBarView(
              controller: _tabs,
              children: const [
                _Rs85Tab(),
                _PatternsTab(),
                _TradesTab(),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MarketCard extends StatelessWidget {
  const _MarketCard({this.market});
  final MarketSnapshot? market;

  Color _toneColor(String tone) => switch (tone) {
        'good' => const Color(0xFF2E7D32),
        'neutral' => const Color(0xFFF9A825),
        'bad' => const Color(0xFFC62828),
        _ => Colors.blueGrey,
      };

  @override
  Widget build(BuildContext context) {
    final mk = market;
    if (mk == null) {
      return const Card(
        margin: EdgeInsets.fromLTRB(12, 8, 12, 4),
        child: ListTile(
          title: Text('市況指標'),
          subtitle: Text('尚無突破追蹤資料，每日更新後累積。'),
        ),
      );
    }
    final pct = mk.winRatePct;
    final color = _toneColor(mk.tone);
    return Card(
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 4),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Text(
              pct == null ? '—' : '$pct%',
              style: TextStyle(
                fontSize: 28,
                fontWeight: FontWeight.w700,
                color: color,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    mk.label ?? '市況',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  Text(
                    '近 ${mk.windowDays} 個交易日 · ${mk.wins} 勝 ${mk.losses} 敗 · 進行中 ${mk.pending}'
                    '${mk.recovered > 0 ? ' · 復甦 ${mk.recovered}' : ''}'
                    '${mk.windowStart != null ? ' · 自 ${mk.windowStart}' : ''}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: 6),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      value: (pct ?? 0) / 100,
                      minHeight: 6,
                      color: color,
                      backgroundColor: color.withValues(alpha: 0.15),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
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
                    label: const Text('全部'),
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
              child: list.isEmpty
                  ? const Center(child: Text('沒有符合的股票'))
                  : ListView.builder(
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
  /// 與網站相同：預設即將突破 + 已突破。已延伸不進預設 chip（網站也不展示）。
  final _selectedStatus = <String>{'即將突破', '已突破'};

  static const allPatterns = [
    'VCP',
    '作弊型態',
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
        var list = rows.where((r) => r.status != '已延伸').toList();
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
                      label: Text(s == '已突破' ? '已突破（可買 0~5%）' : s),
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
                child: Text('${list.length} 檔', style: Theme.of(context).textTheme.bodySmall),
              ),
            ),
            Expanded(
              child: list.isEmpty
                  ? const Center(child: Text('沒有符合的型態'))
                  : ListView.builder(
                      padding: const EdgeInsets.only(bottom: 24),
                      itemCount: list.length,
                      itemBuilder: (_, i) {
                        final r = list[i];
                        final statusColor = switch (r.status) {
                          '即將突破' => Colors.deepOrange,
                          '已突破' => AppTheme.twUp,
                          '已延伸' => Colors.blueGrey,
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
                                      if (r.recovered) ...[
                                        const SizedBox(width: 4),
                                        Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                          decoration: BoxDecoration(
                                            color: Colors.deepOrange.withValues(alpha: 0.12),
                                            borderRadius: BorderRadius.circular(999),
                                          ),
                                          child: const Text('復甦',
                                              style: TextStyle(color: Colors.deepOrange, fontSize: 12)),
                                        ),
                                      ],
                                    ],
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    '${r.patternLabel}${r.position != null ? '（${r.position}）' : ''}'
                                    ' · RS ${r.rs} · ${fmtMoney(r.close)}',
                                  ),
                                  Text(
                                    '樞紐 ${fmtMoney(r.pivot)}（${fmtPctPoints(r.distPivotPct)}）'
                                    '${r.breakoutDate != null ? ' · 突破 ${fmtMd(r.breakoutDate)}' : ''}'
                                    '${r.daysSinceBreakout != null ? '（${r.daysSinceBreakout} 日前）' : ''}'
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

class _TradesTab extends ConsumerStatefulWidget {
  const _TradesTab();

  @override
  ConsumerState<_TradesTab> createState() => _TradesTabState();
}

class _TradesTabState extends ConsumerState<_TradesTab> {
  final _selected = <String>{'active', 'success', 'failed', 'recovered'};

  static const chips = [
    ('active', '進行中'),
    ('success', '成功'),
    ('failed', '失敗'),
    ('recovered', '復甦'),
  ];

  Color _statusColor(String status) => switch (status) {
        'success' => const Color(0xFF2E7D32),
        'failed' => Colors.deepOrange,
        'recovered' => Colors.deepOrange,
        'active' => Colors.orange.shade800,
        _ => Colors.blueGrey,
      };

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(visibleBreakoutTradesProvider);
    return async.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(child: Text('$e')),
      data: (trades) {
        final rows = _selected.isEmpty
            ? trades
            : trades.where((t) => _selected.contains(t.status)).toList();
        return Column(
          children: [
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(8, 8, 8, 4),
              child: Row(
                children: [
                  for (final c in chips) ...[
                    FilterChip(
                      label: Text(c.$2),
                      selected: _selected.contains(c.$1),
                      onSelected: (v) => setState(() {
                        if (v) {
                          _selected.add(c.$1);
                        } else {
                          _selected.remove(c.$1);
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
                child: Text(
                  '${rows.length} 筆（共 ${trades.length}）',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            ),
            Expanded(
              child: rows.isEmpty
                  ? Center(
                      child: Text(
                        trades.isEmpty ? '尚無突破交易紀錄；每日更新後會自動累積' : '沒有符合的交易',
                      ),
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.only(bottom: 24),
                      itemCount: rows.length,
                      itemBuilder: (_, i) {
                        final t = rows[i];
                        final color = _statusColor(t.status);
                        final dist = t.distPivotPct;
                        final outcome = t.outcomeDate != null
                            ? '${t.outcome == 'success' ? '達 +10%' : '跌破 −5%'} ${fmtMd(t.outcomeDate)}'
                                '${t.outcomePct != null ? '（${fmtPctPoints(t.outcomePct!)}）' : ''}'
                            : '現價 ${t.lastClose == null ? '—' : fmtMoney(t.lastClose!)}'
                                '${dist != null ? '（${fmtPctPoints(dist)}）' : ''}';
                        return Card(
                          margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                          child: InkWell(
                            onTap: () => Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) => StockChartPage(
                                  id: t.id,
                                  name: t.name,
                                  market: t.market,
                                  pivot: t.pivot,
                                ),
                              ),
                            ),
                            child: Padding(
                              padding: const EdgeInsets.all(12),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Wrap(
                                          spacing: 6,
                                          runSpacing: 4,
                                          crossAxisAlignment: WrapCrossAlignment.center,
                                          children: [
                                            Text('${t.id} ${t.name}',
                                                style: const TextStyle(fontWeight: FontWeight.w600)),
                                            Container(
                                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                              decoration: BoxDecoration(
                                                color: color.withValues(alpha: 0.12),
                                                borderRadius: BorderRadius.circular(999),
                                              ),
                                              child: Text(t.statusLabel,
                                                  style: TextStyle(color: color, fontSize: 12)),
                                            ),
                                            if (t.isRecoveredOrigin)
                                              Container(
                                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                                decoration: BoxDecoration(
                                                  color: Colors.blueGrey.withValues(alpha: 0.12),
                                                  borderRadius: BorderRadius.circular(999),
                                                ),
                                                child: const Text('復甦後再突破',
                                                    style: TextStyle(color: Colors.blueGrey, fontSize: 12)),
                                              ),
                                          ],
                                        ),
                                        const SizedBox(height: 4),
                                        Text(
                                          '${t.patternLabel} · 樞紐 ${fmtMoney(t.pivot)} · 突破 ${fmtMd(t.breakoutDate)}'
                                          '${t.breakoutClose != null ? ' @ ${fmtMoney(t.breakoutClose!)}' : ''}\n'
                                          '$outcome',
                                          style: Theme.of(context).textTheme.bodySmall,
                                        ),
                                      ],
                                    ),
                                  ),
                                  if (dist != null)
                                    Text(
                                      fmtPctPoints(dist),
                                      style: TextStyle(
                                        fontWeight: FontWeight.bold,
                                        color: AppTheme.pnl(dist),
                                      ),
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
