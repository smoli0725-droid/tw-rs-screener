import 'package:flutter_test/flutter_test.dart';
import 'package:taiwan_rs_app/core/format.dart';
import 'package:taiwan_rs_app/core/theme.dart';
import 'package:flutter/material.dart';

void main() {
  test('yfTicker maps markets', () {
    expect(yfTicker('2330', '上市'), '2330.TW');
    expect(yfTicker('3081', '上櫃'), '3081.TWO');
  });

  testWidgets('theme builds', (tester) async {
    await tester.pumpWidget(MaterialApp(theme: AppTheme.light(), home: const Scaffold(body: Text('ok'))));
    expect(find.text('ok'), findsOneWidget);
  });
}
