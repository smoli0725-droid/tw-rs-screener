import 'package:intl/intl.dart';

final _pct = NumberFormat('+0.00%;-0.00%');
final _pctPoints = NumberFormat('+0.00;-0.00');
final _money = NumberFormat('#,##0.##');
final _date = DateFormat('yyyy-MM-dd');

String fmtPctRatio(double r) => _pct.format(r);
String fmtPctPoints(double p) => '${_pctPoints.format(p)}%';
String fmtMoney(double v) => _money.format(v);
String fmtDate(DateTime d) => _date.format(d);

/// `2026-09-16` → `09-16`；對齊網站 `slice(5)`。
String fmtMd(String? iso) {
  if (iso == null || iso.isEmpty) return '—';
  return iso.length >= 10 ? iso.substring(5, 10) : iso;
}

String yfTicker(String id, String market) {
  if (market.contains('櫃') || market.toUpperCase() == 'TPEX') {
    return '$id.TWO';
  }
  return '$id.TW';
}
