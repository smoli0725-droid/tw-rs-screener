window.RS_STORAGE = (() => {
  const K = window.RS_CONFIG.STORAGE_KEYS;
  function getDataBaseUrl() {
    return (localStorage.getItem(K.dataBaseUrl) || window.RS_CONFIG.DEFAULT_DATA_BASE).replace(/\/$/, '');
  }
  function setDataBaseUrl(url) {
    localStorage.setItem(K.dataBaseUrl, String(url).replace(/\/$/, ''));
  }
  function loadTrades() {
    try {
      return JSON.parse(localStorage.getItem(K.trades) || '[]');
    } catch {
      return [];
    }
  }
  function saveTrades(trades) {
    localStorage.setItem(K.trades, JSON.stringify(trades));
  }
  function addTrade(trade) {
    const trades = loadTrades();
    trades.push({ id: crypto.randomUUID(), side: 'buy', ...trade });
    saveTrades(trades);
    return trades;
  }
  function addSell(trade) {
    const trades = loadTrades();
    trades.push({ id: crypto.randomUUID(), ...trade, side: 'sell' });
    saveTrades(trades);
    return trades;
  }
  function removeTrade(id) {
    const trades = loadTrades().filter((t) => t.id !== id);
    saveTrades(trades);
    return trades;
  }
  function removeTradesBySymbol(symbol) {
    const sid = String(symbol);
    const trades = loadTrades().filter((t) => String(t.symbol) !== sid);
    saveTrades(trades);
    return trades;
  }
  return {
    getDataBaseUrl,
    setDataBaseUrl,
    loadTrades,
    saveTrades,
    addTrade,
    addSell,
    removeTrade,
    removeTradesBySymbol,
  };
})();
