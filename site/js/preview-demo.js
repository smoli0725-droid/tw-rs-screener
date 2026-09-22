// Sample journal + K-line used only when the signed-in user has no trades,
// or when a symbol has no bundled OHLCV. Never written to localStorage / D1.
window.RS_PREVIEW = (() => {
  function lot(symbol, buyDate, sellDate, buyPx, sellPx, shares = 100) {
    const name = '手記平倉';
    return [
      { symbol, name, market: '上市', side: 'buy', price: buyPx, shares, date: buyDate },
      { symbol, name, market: '上市', side: 'sell', price: sellPx, shares, date: sellDate },
    ];
  }

  // 8 winning closed lots (FIFO pnl > 0) and 5 losers.
  // Winner returns average exactly 18.4%. September 2026 realized return is exactly 3.2%.
  // Win rate = 8/13 ≈ 62%. These symbols are fully closed and do not appear as holdings.
  function demoTrades() {
    const closed = [
      ...lot('9101', '2025-09-01', '2025-09-18', 100, 125),
      ...lot('9102', '2025-10-01', '2025-10-16', 100, 124),
      ...lot('9103', '2025-11-03', '2025-11-18', 100, 122),
      ...lot('9104', '2025-12-01', '2025-12-15', 100, 96),
      ...lot('9105', '2026-01-05', '2026-01-20', 100, 120),
      ...lot('9106', '2026-02-02', '2026-02-24', 100, 118),
      ...lot('9107', '2026-03-02', '2026-03-16', 100, 95),
      ...lot('9108', '2026-04-01', '2026-04-20', 100, 116),
      ...lot('9109', '2026-05-04', '2026-05-19', 100, 119),
      ...lot('9110', '2026-06-01', '2026-06-16', 100, 93),
      ...lot('9111', '2026-07-01', '2026-07-15', 100, 92),
      ...lot('9112', '2026-08-03', '2026-08-18', 100, 88),
      ...lot('9113', '2026-08-20', '2026-09-10', 1000, 1032),
    ];
    const open = [
      { symbol: '2330', name: '台積電', market: '上市', side: 'buy', price: 920, shares: 100, date: '2026-06-02' },
      { symbol: '2454', name: '聯發科', market: '上市', side: 'buy', price: 1240, shares: 50, date: '2026-07-01' },
      { symbol: '2603', name: '長榮', market: '上市', side: 'buy', price: 186.5, shares: 200, date: '2026-08-03' },
    ];
    return [...closed, ...open];
  }

  function demoPrices() {
    return { 2330: 986, 2454: 1285, 2603: 179 };
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function businessDaysEnding(endIso, count) {
    const [y, m, d] = endIso.split('-').map(Number);
    const cursor = new Date(Date.UTC(y, m - 1, d));
    const out = [];
    while (out.length < count) {
      const day = cursor.getUTCDay();
      if (day !== 0 && day !== 6) out.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return out.reverse();
  }

  function roundPx(n) {
    return Math.round(n * 100) / 100;
  }

  function buildSeries({ seed, endDate, endBar, prevClose, startPrice }) {
    const rand = mulberry32(seed);
    const dates = businessDaysEnding(endDate, 240);
    const candles = [];
    let price = startPrice;
    for (let i = 0; i < dates.length - 2; i++) {
      const drift = 0.0016;
      const shock = (rand() - 0.46) * 0.02;
      const close = Math.max(startPrice * 0.55, price * (1 + drift + shock));
      const open = price * (1 + (rand() - 0.5) * 0.01);
      const high = Math.max(open, close) * (1 + rand() * 0.008);
      const low = Math.min(open, close) * (1 - rand() * 0.008);
      const volume = Math.round((12000 + rand() * 28000) * 1000);
      candles.push({
        date: dates[i],
        open: roundPx(open),
        high: roundPx(high),
        low: roundPx(low),
        close: roundPx(close),
        volume,
      });
      price = close;
    }
    const prev = {
      date: dates[dates.length - 2],
      open: roundPx(prevClose * 0.994),
      high: roundPx(prevClose * 1.008),
      low: roundPx(prevClose * 0.986),
      close: prevClose,
      volume: 28000000,
    };
    candles.push(prev);
    candles.push({ date: endDate, ...endBar });
    return candles;
  }

  function sampleCandles(symbol) {
    const id = String(symbol);
    if (id === '2330') {
      return buildSeries({
        seed: 2330,
        endDate: '2026-09-14',
        startPrice: 640,
        prevClose: 972,
        endBar: { open: 968, high: 992, low: 964, close: 986, volume: 32580000 },
      });
    }
    if (id === '2603') {
      return buildSeries({
        seed: 2603,
        endDate: '2026-09-14',
        startPrice: 140,
        prevClose: 181.2,
        endBar: { open: 180.5, high: 183, low: 177.5, close: 179, volume: 18500000 },
      });
    }
    return null;
  }

  return { demoTrades, demoPrices, sampleCandles };
})();
