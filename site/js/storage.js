window.RS_STORAGE = (() => {
  const K = window.RS_CONFIG.STORAGE_KEYS;
  let cloudReady = false;
  let plan = { plan: 'free', plan_expires_at: null };
  let saveTimer = null;
  let saveChain = Promise.resolve();
  let syncState = 'idle';
  let syncError = '';

  function getDataBaseUrl() {
    return (localStorage.getItem(K.dataBaseUrl) || window.RS_CONFIG.DEFAULT_DATA_BASE).replace(
      /\/$/,
      ''
    );
  }

  function loadSettingsObject() {
    try {
      const raw = localStorage.getItem(K.settings);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return Object.assign({ dataBaseUrl: getDataBaseUrl() }, parsed);
        }
      }
    } catch {
      /* keep URL fallback */
    }
    return { dataBaseUrl: getDataBaseUrl() };
  }

  function persistSettingsLocal(settings) {
    const next = Object.assign({ dataBaseUrl: window.RS_CONFIG.DEFAULT_DATA_BASE }, settings || {});
    if (next.dataBaseUrl) {
      next.dataBaseUrl = String(next.dataBaseUrl).replace(/\/$/, '');
      localStorage.setItem(K.dataBaseUrl, next.dataBaseUrl);
    }
    localStorage.setItem(K.settings, JSON.stringify(next));
    return next;
  }

  function setDataBaseUrl(url) {
    persistSettingsLocal(Object.assign(loadSettingsObject(), { dataBaseUrl: url }));
    scheduleCloudSave();
  }

  function clearDataBaseUrl() {
    persistSettingsLocal(
      Object.assign(loadSettingsObject(), { dataBaseUrl: window.RS_CONFIG.DEFAULT_DATA_BASE })
    );
    scheduleCloudSave();
  }

  function loadTrades() {
    try {
      const parsed = JSON.parse(localStorage.getItem(K.trades) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveTradesLocal(trades) {
    localStorage.setItem(K.trades, JSON.stringify(trades));
  }

  function saveTrades(trades) {
    saveTradesLocal(trades);
    scheduleCloudSave();
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

  function hasLocalData() {
    return loadTrades().length > 0 || localStorage.getItem(K.dataBaseUrl);
  }

  function cloudHasData(me) {
    const trades = Array.isArray(me && me.trades) ? me.trades : [];
    const settings = me && me.settings && typeof me.settings === 'object' ? me.settings : {};
    return trades.length > 0 || Object.keys(settings).length > 0;
  }

  function applyCloud(me) {
    plan = {
      plan: (me && me.plan) || 'free',
      plan_expires_at: me && me.plan_expires_at != null ? me.plan_expires_at : null,
    };
    if (Array.isArray(me.trades)) saveTradesLocal(me.trades);
    if (me.settings && typeof me.settings === 'object') persistSettingsLocal(me.settings);
  }

  async function pushToCloud() {
    if (!cloudReady || !window.RS_API) return;
    syncState = 'pending';
    try {
      await window.RS_API.putData({
        trades: loadTrades(),
        settings: loadSettingsObject(),
      });
      syncState = 'synced';
      syncError = '';
    } catch (err) {
      syncState = 'error';
      syncError = err && err.message ? err.message : String(err);
      console.error('cloud save failed', err);
      throw err;
    }
  }

  function scheduleCloudSave() {
    if (!cloudReady) return;
    syncState = 'pending';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveChain = saveChain.then(() => pushToCloud()).catch(() => {});
    }, 450);
  }

  async function hydrateFromCloud() {
    if (!window.RS_API) {
      cloudReady = false;
      syncState = 'local';
      return { migrated: false };
    }
    const me = await window.RS_API.getMe();
    plan = {
      plan: (me && me.plan) || 'free',
      plan_expires_at: me && me.plan_expires_at != null ? me.plan_expires_at : null,
    };
    const migrated = !cloudHasData(me) && hasLocalData();
    if (cloudHasData(me)) {
      applyCloud(me);
    } else if (migrated) {
      persistSettingsLocal(loadSettingsObject());
    }
    cloudReady = true;
    if (migrated || cloudHasData(me) === false) {
      try {
        await pushToCloud();
      } catch {
        /* keep local cache */
      }
    } else {
      syncState = 'synced';
    }
    return { migrated, plan };
  }

  function resetCloudFlag() {
    cloudReady = false;
    syncState = 'idle';
    plan = { plan: 'free', plan_expires_at: null };
  }

  function flushCloudSave() {
    if (!cloudReady) return saveChain;
    clearTimeout(saveTimer);
    saveChain = saveChain.then(() => pushToCloud()).catch(() => {});
    return saveChain;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushCloudSave();
  });
  window.addEventListener('pagehide', () => {
    flushCloudSave();
  });

  return {
    getDataBaseUrl,
    setDataBaseUrl,
    clearDataBaseUrl,
    loadTrades,
    saveTrades,
    addTrade,
    addSell,
    removeTrade,
    removeTradesBySymbol,
    loadSettings: loadSettingsObject,
    hydrateFromCloud,
    resetCloudFlag,
    flushCloudSave,
    getPlan: () => plan,
    getSyncState: () => ({ state: syncState, error: syncError }),
  };
})();
