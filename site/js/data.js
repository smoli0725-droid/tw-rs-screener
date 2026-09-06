window.RS_DATA = (() => {
  let cache = { meta: null, rs85: [], patterns: [], priceMap: {}, breakouts: null };

  async function fetchJson(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }

  async function fetchOptional(url) {
    try {
      return await fetchJson(url);
    } catch {
      return null;
    }
  }

  async function loadAll(baseUrl) {
    const base = baseUrl.replace(/\/$/, '');
    const [meta, rs85, patterns, breakouts] = await Promise.all([
      fetchJson(`${base}/meta.json`),
      fetchJson(`${base}/rs85.json`),
      fetchJson(`${base}/patterns.json`),
      fetchOptional(`${base}/breakouts.json`),
    ]);
    const priceMap = {};
    for (const s of rs85) priceMap[String(s.id)] = Number(s.close);
    for (const p of patterns) {
      const id = String(p.id);
      if (priceMap[id] == null) priceMap[id] = Number(p.close);
    }
    cache = { meta, rs85, patterns, priceMap, breakouts };
    return cache;
  }

  async function loadOhlcv(baseUrl, id) {
    return fetchJson(`${baseUrl.replace(/\/$/, '')}/ohlcv/${id}.json`);
  }

  return { loadAll, loadOhlcv, getCache: () => cache };
})();
