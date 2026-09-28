// Closed-lot fixture for portfolio metric checks. Not shown in the app and
// never written to localStorage / D1. Missing OHLCV is not filled with candles.
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

  return { demoTrades, demoPrices };
})();
