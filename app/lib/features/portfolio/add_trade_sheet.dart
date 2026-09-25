import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models.dart';
import '../../domain/position_builder.dart';
import 'portfolio_page.dart';

class AddTradeSheet extends ConsumerStatefulWidget {
  const AddTradeSheet({super.key, this.initial});

  final Trade? initial;

  @override
  ConsumerState<AddTradeSheet> createState() => _AddTradeSheetState();
}

class _AddTradeSheetState extends ConsumerState<AddTradeSheet> {
  final _form = GlobalKey<FormState>();
  late final TextEditingController _id;
  late final TextEditingController _name;
  late final TextEditingController _price;
  late final TextEditingController _shares;
  late final TextEditingController _fee;
  String _market = '上市';
  TradeSide _side = TradeSide.buy;
  DateTime _date = DateTime.now();
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final t = widget.initial;
    _id = TextEditingController(text: t?.symbol ?? '');
    _name = TextEditingController(text: t?.name ?? '');
    _price = TextEditingController(text: t?.price.toString() ?? '');
    _shares = TextEditingController(text: t?.shares.toString() ?? '');
    _fee = TextEditingController(text: t?.fee.toString() ?? '0');
    if (t != null) {
      _market = t.market;
      _side = t.side;
      _date = t.date;
    }
  }

  @override
  void dispose() {
    _id.dispose();
    _name.dispose();
    _price.dispose();
    _shares.dispose();
    _fee.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    final trade = Trade(
      id: widget.initial?.id,
      symbol: _id.text.trim(),
      name: _name.text.trim().isEmpty ? _id.text.trim() : _name.text.trim(),
      market: _market,
      side: _side,
      date: _date,
      price: double.parse(_price.text),
      shares: int.parse(_shares.text),
      fee: double.tryParse(_fee.text) ?? 0,
    );
    final dao = ref.read(tradeDaoProvider);
    if (trade.side == TradeSide.sell) {
      final existing = await dao.all();
      final baseline = trade.id == null
          ? existing
          : [for (final row in existing) if (row.id != trade.id) row];
      final matched = matchedSellShares(baseline, trade);
      if (matched < trade.shares) {
        if (!mounted) return;
        final message = matched == 0
            ? '這個日期只能賣出 0 股，買進還在這天之後'
            : '這個日期只能賣出 $matched 股，其餘是這天之後才買的';
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
        return;
      }
    }
    setState(() => _saving = true);
    if (trade.id == null) {
      await dao.insert(trade);
    } else {
      await dao.update(trade);
    }
    if (mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.only(left: 16, right: 16, top: 16, bottom: bottom + 16),
      child: Form(
        key: _form,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('新增持股 / 交易', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: SegmentedButton<TradeSide>(
                      segments: const [
                        ButtonSegment(value: TradeSide.buy, label: Text('買進')),
                        ButtonSegment(value: TradeSide.sell, label: Text('賣出')),
                      ],
                      selected: {_side},
                      onSelectionChanged: (s) => setState(() => _side = s.first),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _id,
                decoration: const InputDecoration(labelText: '代號'),
                keyboardType: TextInputType.number,
                validator: (v) => (v == null || v.trim().length != 4) ? '請輸入 4 碼代號' : null,
              ),
              const SizedBox(height: 8),
              TextFormField(
                controller: _name,
                decoration: const InputDecoration(labelText: '名稱（可留空）'),
              ),
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                initialValue: _market,
                items: const [
                  DropdownMenuItem(value: '上市', child: Text('上市')),
                  DropdownMenuItem(value: '上櫃', child: Text('上櫃')),
                ],
                onChanged: (v) => setState(() => _market = v ?? '上市'),
                decoration: const InputDecoration(labelText: '市場'),
              ),
              const SizedBox(height: 8),
              TextFormField(
                controller: _price,
                decoration: InputDecoration(
                  labelText: _side == TradeSide.buy ? '成本 / 買進價' : '賣出價',
                ),
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                validator: (v) => double.tryParse(v ?? '') == null ? '請輸入價格' : null,
              ),
              const SizedBox(height: 8),
              TextFormField(
                controller: _shares,
                decoration: const InputDecoration(labelText: '股數'),
                keyboardType: TextInputType.number,
                validator: (v) => int.tryParse(v ?? '') == null ? '請輸入股數' : null,
              ),
              const SizedBox(height: 8),
              TextFormField(
                controller: _fee,
                decoration: const InputDecoration(labelText: '手續費（選填）'),
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
              ),
              const SizedBox(height: 8),
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text('日期 ${_date.toIso8601String().substring(0, 10)}'),
                trailing: const Icon(Icons.calendar_today),
                onTap: () async {
                  final d = await showDatePicker(
                    context: context,
                    initialDate: _date,
                    firstDate: DateTime(2000),
                    lastDate: DateTime.now().add(const Duration(days: 1)),
                  );
                  if (d != null) setState(() => _date = d);
                },
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: _saving ? null : () => Navigator.of(context).pop(false),
                      child: const Text('取消'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: FilledButton(
                      onPressed: _saving ? null : _save,
                      child: _saving
                          ? const SizedBox(
                              height: 18,
                              width: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text('儲存'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
