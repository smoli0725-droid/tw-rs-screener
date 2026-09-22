import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function load(file, sandbox) {
  const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
  vm.runInNewContext(code, sandbox, { filename: file });
}

function setup() {
  const sandbox = { window: {}, Intl, Date, Math, Number, String, Object, Array };
  sandbox.window = sandbox;
  load('site/js/portfolio.js', sandbox);
  load('site/js/preview-demo.js', sandbox);
  load('site/js/chart.js', sandbox);
  return sandbox;
}

test('winning average uses only FIFO lots with pnl > 0', () => {
  const { RS_PORTFOLIO } = setup();
  const trades = [
    { symbol: '1111', side: 'buy', price: 100, shares: 10, date: '2026-01-02' },
    { symbol: '1111', side: 'sell', price: 120, shares: 10, date: '2026-01-10' },
    { symbol: '2222', side: 'buy', price: 50, shares: 10, date: '2026-02-02' },
    { symbol: '2222', side: 'sell', price: 40, shares: 10, date: '2026-02-10' },
  ];
  const positions = RS_PORTFOLIO.buildPositions(trades, {});
  const now = new Date('2026-09-22T04:00:00Z');
  const m = RS_PORTFOLIO.computeMetrics(trades, positions, now);
  assert.equal(m.closedCount, 2);
  assert.equal(m.winningCount, 1);
  assert.equal(m.winRate, 0.5);
  assert.ok(Math.abs(m.winningAvgReturnPct - 0.2) < 1e-12);
  assert.ok(Math.abs(m.avgReturnPct - 0) < 1e-12);
  assert.equal(m.monthReturnPct, null);
  assert.equal(m.realizedCurve.at(-1).pnl, (120 - 100) * 10 + (40 - 50) * 10);
});

test('demo journal matches the holdings mock rates and ignores breakout ledger', () => {
  const src = fs.readFileSync(path.join(ROOT, 'site/js/portfolio.js'), 'utf8');
  assert.equal(src.includes('breakouts'), false);
  const { RS_PORTFOLIO, RS_PREVIEW } = setup();
  const trades = RS_PREVIEW.demoTrades();
  const positions = RS_PORTFOLIO.buildPositions(trades, RS_PREVIEW.demoPrices());
  const now = new Date('2026-09-22T04:00:00Z');
  const m = RS_PORTFOLIO.computeMetrics(trades, positions, now);
  assert.equal(positions.map((p) => p.symbol).join(','), '2330,2454,2603');
  assert.equal(m.closedCount, 13);
  assert.equal(m.winningCount, 8);
  assert.equal(Math.round(m.winRate * 100), 62);
  assert.ok(Math.abs(m.winningAvgReturnPct - 0.184) < 1e-12);
  assert.ok(Math.abs(m.monthReturnPct - 0.032) < 1e-12);
  assert.equal(m.monthKey, '2026-09');
  assert.equal(m.realizedCurve.length, 13);
  assert.ok(m.realizedCurve.at(-1).pnl > m.realizedCurve[0].pnl);
  const tsmc = positions.find((p) => p.symbol === '2330');
  assert.ok(Math.abs(tsmc.returnPct - (986 / 920 - 1)) < 1e-12);
});

test('MA100 is filled from closes without dropping pipeline MA50', () => {
  const { RS_CHART } = setup();
  const closes = Array.from({ length: 120 }, (_, i) => i + 1);
  const candles = closes.map((close, i) => ({
    date: `2026-01-${String((i % 27) + 1).padStart(2, '0')}`,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
    ma50: i === 119 ? 999 : null,
  }));
  const withMa = RS_CHART.attachMa(candles);
  assert.ok(Math.abs(withMa[49].ma50 - 25.5) < 1e-9);
  assert.equal(withMa[119].ma50, 999);
  assert.ok(Math.abs(withMa[99].ma100 - 50.5) < 1e-9);
  assert.equal(withMa[98].ma100, null);
  const weekly = RS_CHART.aggregateCandles(
    [
      { date: '2026-09-14', open: 10, high: 12, low: 9, close: 11, volume: 1000 },
      { date: '2026-09-15', open: 11, high: 14, low: 10, close: 13, volume: 2000 },
      { date: '2026-09-21', open: 13, high: 15, low: 12, close: 14, volume: 500 },
    ],
    'W'
  );
  assert.equal(weekly.length, 2);
  assert.equal(weekly[0].open, 10);
  assert.equal(weekly[0].high, 14);
  assert.equal(weekly[0].low, 9);
  assert.equal(weekly[0].close, 13);
  assert.equal(weekly[0].volume, 3000);
  assert.equal(RS_CHART.lotsLabel(32580000), '32,580 張');
});

test('sample 2330 candle matches the mobile tooltip', () => {
  const { RS_PREVIEW } = setup();
  const bars = RS_PREVIEW.sampleCandles('2330');
  const last = bars.at(-1);
  const prev = bars.at(-2);
  assert.equal(last.date, '2026-09-14');
  assert.deepEqual(
    { open: last.open, high: last.high, low: last.low, close: last.close },
    { open: 968, high: 992, low: 964, close: 986 }
  );
  assert.equal(prev.close, 972);
  assert.equal(last.volume / 1000, 32580);
  assert.ok(bars.length >= 200);
  assert.equal(RS_PREVIEW.sampleCandles('2454'), null);
});
