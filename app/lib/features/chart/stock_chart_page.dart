import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/theme.dart';
import '../../data/github_data_source.dart';
import '../../domain/models.dart';
import '../portfolio/add_trade_sheet.dart';
import '../portfolio/portfolio_page.dart';

class StockChartPage extends ConsumerStatefulWidget {
  const StockChartPage({
    super.key,
    required this.id,
    required this.name,
    required this.market,
    this.pivot,
    this.annotations = const [],
    this.preferRepoOhlcv = true,
  });

  final String id;
  final String name;
  final String market;
  final double? pivot;
  final List<Map<String, dynamic>> annotations;
  /// 預設先讀 `/data/ohlcv/{id}.json`，失敗再退回 Yahoo。
  final bool preferRepoOhlcv;

  @override
  ConsumerState<StockChartPage> createState() => _StockChartPageState();
}

class _StockChartPageState extends ConsumerState<StockChartPage> {
  late Future<({List<Candle> candles, List<Map<String, dynamic>> annotations})> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<({List<Candle> candles, List<Map<String, dynamic>> annotations})> _load() async {
    if (widget.preferRepoOhlcv) {
      try {
        final bundle = await ref.read(githubDataSourceProvider).fetchOhlcvBundle(widget.id);
        if (bundle.candles.isNotEmpty) {
          final notes = widget.annotations.isNotEmpty ? widget.annotations : bundle.annotations;
          return (candles: bundle.candles, annotations: notes);
        }
      } catch (_) {}
    }
    final candles = await ref.read(yahooProvider).history(widget.id, widget.market);
    return (candles: candles, annotations: widget.annotations);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('${widget.id} ${widget.name}'),
        actions: [
          IconButton(
            tooltip: '加入持股',
            icon: const Icon(Icons.add_box_outlined),
            onPressed: () async {
              await showModalBottomSheet<bool>(
                context: context,
                isScrollControlled: true,
                builder: (_) => AddTradeSheet(
                  initial: Trade(
                    symbol: widget.id,
                    name: widget.name,
                    market: widget.market,
                    side: TradeSide.buy,
                    date: DateTime.now(),
                    price: 0,
                    shares: 1000,
                  ),
                ),
              );
            },
          ),
        ],
      ),
      body: FutureBuilder<({List<Candle> candles, List<Map<String, dynamic>> annotations})>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError) {
            return Center(child: Text('載入失敗：${snap.error}'));
          }
          final candles = snap.data?.candles ?? [];
          final annotations = snap.data?.annotations ?? const <Map<String, dynamic>>[];
          if (candles.isEmpty) {
            return const Center(child: Text('無 K 線資料'));
          }
          final view = candles.length > 120 ? candles.sublist(candles.length - 120) : candles;
          return Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '收 ${fmtMoney(view.last.close)}'
                  '${widget.pivot != null ? '  · 樞紐 ${fmtMoney(widget.pivot!)}' : ''}',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 8),
                Expanded(flex: 3, child: _CandleChart(candles: view, pivot: widget.pivot)),
                const SizedBox(height: 8),
                Expanded(flex: 1, child: _VolumeChart(candles: view)),
                if (annotations.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text('標註', style: Theme.of(context).textTheme.titleSmall),
                  Wrap(
                    spacing: 6,
                    children: [
                      for (final a in annotations)
                        Chip(
                          label: Text(
                            '${a['type']}'
                            '${a['price'] != null ? ' ${fmtMoney((a['price'] as num).toDouble())}' : ''}',
                            style: const TextStyle(fontSize: 11),
                          ),
                          visualDensity: VisualDensity.compact,
                        ),
                    ],
                  ),
                ],
              ],
            ),
          );
        },
      ),
    );
  }
}

class _CandleChart extends StatelessWidget {
  const _CandleChart({required this.candles, this.pivot});
  final List<Candle> candles;
  final double? pivot;

  @override
  Widget build(BuildContext context) {
    double minY = candles.map((c) => c.low).reduce((a, b) => a < b ? a : b);
    double maxY = candles.map((c) => c.high).reduce((a, b) => a > b ? a : b);
    if (pivot != null) {
      minY = minY < pivot! ? minY : pivot!;
      maxY = maxY > pivot! ? maxY : pivot!;
    }
    final pad = (maxY - minY) * 0.05;
    minY -= pad;
    maxY += pad;

    return LineChart(
      LineChartData(
        minX: 0,
        maxX: (candles.length - 1).toDouble(),
        minY: minY,
        maxY: maxY,
        borderData: FlBorderData(show: true),
        gridData: const FlGridData(show: true, drawVerticalLine: false),
        titlesData: FlTitlesData(
          topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          leftTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: 44,
              getTitlesWidget: (v, _) => Text(v.toStringAsFixed(0), style: const TextStyle(fontSize: 10)),
            ),
          ),
          bottomTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              interval: (candles.length / 4).clamp(1, 999).toDouble(),
              getTitlesWidget: (v, _) {
                final i = v.round();
                if (i < 0 || i >= candles.length) return const SizedBox.shrink();
                final d = candles[i].date;
                return Text('${d.month}/${d.day}', style: const TextStyle(fontSize: 10));
              },
            ),
          ),
        ),
        lineBarsData: [
          LineChartBarData(
            spots: [
              for (var i = 0; i < candles.length; i++) FlSpot(i.toDouble(), candles[i].close),
            ],
            isCurved: false,
            color: Colors.indigo,
            barWidth: 1.5,
            dotData: const FlDotData(show: false),
            belowBarData: BarAreaData(show: false),
          ),
          if (candles.any((c) => c.ma50 != null))
            LineChartBarData(
              spots: [
                for (var i = 0; i < candles.length; i++)
                  if (candles[i].ma50 != null) FlSpot(i.toDouble(), candles[i].ma50!),
              ],
              color: Colors.orange,
              barWidth: 1,
              dotData: const FlDotData(show: false),
            ),
          if (candles.any((c) => c.ma150 != null))
            LineChartBarData(
              spots: [
                for (var i = 0; i < candles.length; i++)
                  if (candles[i].ma150 != null) FlSpot(i.toDouble(), candles[i].ma150!),
              ],
              color: Colors.purple,
              barWidth: 1,
              dotData: const FlDotData(show: false),
            ),
          if (candles.any((c) => c.ma200 != null))
            LineChartBarData(
              spots: [
                for (var i = 0; i < candles.length; i++)
                  if (candles[i].ma200 != null) FlSpot(i.toDouble(), candles[i].ma200!),
              ],
              color: Colors.teal,
              barWidth: 1,
              dotData: const FlDotData(show: false),
            ),
        ],
        extraLinesData: ExtraLinesData(
          horizontalLines: [
            if (pivot != null)
              HorizontalLine(
                y: pivot!,
                color: Colors.redAccent,
                strokeWidth: 1.2,
                dashArray: [6, 4],
                label: HorizontalLineLabel(
                  show: true,
                  alignment: Alignment.topRight,
                  style: const TextStyle(fontSize: 10, color: Colors.redAccent),
                  labelResolver: (_) => 'pivot',
                ),
              ),
          ],
        ),
        // 用 close 折線 + 額外畫影線感的 bar，簡化展示；細節用 CustomPaint 補 K 棒
      ),
    );
  }
}

class _VolumeChart extends StatelessWidget {
  const _VolumeChart({required this.candles});
  final List<Candle> candles;

  @override
  Widget build(BuildContext context) {
    return BarChart(
      BarChartData(
        gridData: const FlGridData(show: false),
        borderData: FlBorderData(show: false),
        titlesData: const FlTitlesData(show: false),
        barGroups: [
          for (var i = 0; i < candles.length; i++)
            BarChartGroupData(
              x: i,
              barRods: [
                BarChartRodData(
                  toY: candles[i].volume,
                  width: 2,
                  color: candles[i].close >= candles[i].open ? AppTheme.twUp : AppTheme.twDown,
                ),
              ],
            ),
        ],
      ),
    );
  }
}
