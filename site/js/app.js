(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const state = {
    meta: null,
    rs85: [],
    patterns: [],
    priceMap: {},
    breakouts: null,
    market: '',
    templateOnly: false,
    rsQuery: '',
    statuses: new Set(['即將突破', '已突破']),
    patternTypes: new Set(),
    tradeStatuses: new Set(['active', 'success', 'failed', 'recovered']),
    chartContext: null,
  };

  const STATUS_CLASS = { 即將突破: 'hot', 已突破: 'ok', 整理中: 'warn', 已延伸: 'ext' };
  const TRADE_LABEL = {
    active: '進行中',
    success: '成功',
    failed: '失敗',
    recovered: '復甦',
    reentered: '再突破',
  };
  const TRADE_CLASS = { active: 'warn', success: 'ok', failed: 'hot', recovered: 'hot', reentered: 'muted' };

  const fmt = {
    money: (n) =>
      n == null || Number.isNaN(Number(n))
        ? '—'
        : Number(n).toLocaleString('zh-TW', { maximumFractionDigits: 2 }),
    pct: (n) => {
      if (n == null || Number.isNaN(Number(n))) return '—';
      const v = Number(n);
      return `${v > 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;
    },
    pnlClass: (n) => (n > 0 ? 'pnl-up' : n < 0 ? 'pnl-down' : ''),
  };

  function esc(s) {
    return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  async function refresh() {
    $('#metaLine').textContent = '載入資料中…';
    try {
      const data = await RS_DATA.loadAll(RS_STORAGE.getDataBaseUrl());
      state.meta = data.meta;
      state.rs85 = data.rs85;
      state.patterns = data.patterns;
      state.priceMap = data.priceMap;
      state.breakouts = data.breakouts;
      renderMeta();
      renderMarket();
      renderPortfolio();
      buildPatternChips();
      renderRs85();
      renderPatterns();
      renderTrades();
    } catch (e) {
      console.error(e);
      $('#metaLine').textContent = `載入失敗：${e.message}`;
      toast('資料載入失敗，請檢查設定中的 raw URL');
    }
  }

  function renderMeta() {
    const m = state.meta || {};
    const c = m.counts || {};
    const mk = m.market;
    const rate = mk && mk.win_rate != null ? ` · 勝率 ${Math.round(mk.win_rate * 100)}%` : '';
    $('#metaLine').textContent =
      `資料 ${m.data_date || '—'} · RS85 ${c.rs85 ?? '—'} · 型態 ${c.pattern_symbols ?? c.patterns ?? '—'} 檔 · 即將突破 ${
        c.near_breakout ?? '—'
      } · 可買 ${c.broke_out ?? '—'}${rate}` +
      (m.message ? ` · ${m.message}` : m.is_fresh === false ? ' · 資料可能未更新' : '');
  }

  function renderMarket() {
    const card = $('#marketCard');
    const mk = (state.breakouts && state.breakouts.market) || (state.meta && state.meta.market);
    if (!mk) {
      card.innerHTML =
        '<div class="market-body"><div class="market-title">市況指標</div><div class="item-sub">尚無突破追蹤資料，每日更新後累積。</div></div>';
      return;
    }
    const pct = mk.win_rate == null ? null : Math.round(mk.win_rate * 100);
    const cls = pct == null ? '' : pct >= 60 ? 'good' : pct >= 50 ? 'neutral' : 'bad';
    card.innerHTML = `
      <div class="market-rate ${cls}">${pct == null ? '—' : pct + '%'}</div>
      <div class="market-body">
        <div class="market-title">${esc(mk.label || '市況')}<span class="badge muted">近 ${mk.window_days || 10} 個交易日</span></div>
        <div class="item-sub">${mk.wins ?? 0} 勝 ${mk.losses ?? 0} 敗 · 進行中 ${mk.pending ?? 0}${
          mk.recovered ? ` · 復甦 ${mk.recovered}` : ''
        }${mk.window_start ? ` · 自 ${mk.window_start}` : ''}</div>
        <div class="market-bar"><span style="width:${pct == null ? 0 : pct}%"></span></div>
      </div>`;
  }

  function renderPortfolio() {
    const positions = RS_PORTFOLIO.buildPositions(RS_STORAGE.loadTrades(), state.priceMap);
    const mv = positions.reduce((s, p) => s + p.marketValue, 0);
    const pnl = positions.reduce((s, p) => s + p.pnl, 0);
    const cost = positions.reduce((s, p) => s + p.costValue, 0);
    $('#totalMv').textContent = fmt.money(mv);
    const pnlEl = $('#totalPnl');
    pnlEl.textContent = `損益 ${fmt.money(pnl)}（${fmt.pct(cost ? pnl / cost : 0)}）`;
    pnlEl.className = `summary-sub ${fmt.pnlClass(pnl)}`;

    const list = $('#positionList');
    if (!positions.length) {
      list.innerHTML = '<div class="empty">尚未有持股，點上方新增</div>';
      return;
    }
    list.innerHTML = positions
      .map(
        (p) => `<article class="item" data-open-chart="${p.symbol}" data-name="${esc(p.name)}" data-market="${esc(p.market)}">
        <div>
          <div class="item-title">${p.symbol} ${esc(p.name)}</div>
          <div class="item-sub">成本 ${fmt.money(p.cost)} × ${p.shares}<br/>現價 ${
            p.lastPrice == null ? '（名單無報價，暫用成本）' : fmt.money(p.lastPrice)
          }</div>
        </div>
        <div class="item-right">
          <div class="${fmt.pnlClass(p.returnPct)}">${fmt.pct(p.returnPct)}</div>
          <div class="item-sub ${fmt.pnlClass(p.pnl)}">${fmt.money(p.pnl)}</div>
        </div>
      </article>`
      )
      .join('');
  }

  function renderRs85() {
    let rows = state.rs85;
    if (state.market) rows = rows.filter((r) => r.market === state.market);
    if (state.templateOnly) rows = rows.filter((r) => r.template_pass);
    const q = state.rsQuery.trim();
    if (q) {
      rows = rows.filter(
        (r) =>
          String(r.id).includes(q) ||
          String(r.name).includes(q) ||
          String(r.industry || '').includes(q)
      );
    }
    const list = $('#rs85List');
    if (!rows.length) {
      list.innerHTML = '<div class="empty">沒有符合的股票</div>';
      return;
    }
    list.innerHTML = rows
      .map((r) => {
        const tags = (r.patterns || []).join(' · ');
        return `<article class="item" data-open-chart="${r.id}" data-name="${esc(r.name)}" data-market="${esc(r.market)}">
          <div>
            <div class="item-title">${r.id} ${esc(r.name)}${
              r.template_pass ? '<span class="badge ok">樣板</span>' : ''
            }</div>
            <div class="item-sub">${esc(r.market)} · ${esc(r.industry || '')}${
              tags ? `<br/>${esc(tags)}` : ''
            }</div>
          </div>
          <div class="item-right"><div><strong>RS ${r.rs}</strong></div><div class="item-sub">${fmt.money(
            r.close
          )}</div></div>
        </article>`;
      })
      .join('');
  }

  function buildPatternChips() {
    const types = [...new Set(state.patterns.map((p) => p.pattern).filter(Boolean))].sort();
    $('#patternChips').innerHTML = types
      .map(
        (t) =>
          `<button class="chip ${state.patternTypes.has(t) ? 'active' : ''}" data-pattern="${esc(
            t
          )}" type="button">${esc(t)}</button>`
      )
      .join('');
  }

  function fmtDist(v) {
    return v == null ? '—' : `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}%`;
  }

  function renderPatterns() {
    // 一檔只認一個樞紐:清單只列主要型態;次要型態只在卡片下方「另符合」顯示,
    // 不受狀態濾鏡影響,也不會自己成為一張卡
    const othersById = new Map();
    for (const r of state.patterns) {
      if (r.primary === false) {
        if (!othersById.has(r.id)) othersById.set(r.id, []);
        othersById.get(r.id).push(r);
      } else if (Array.isArray(r.others) && r.others.length) {
        othersById.set(r.id, [...(othersById.get(r.id) || []), ...r.others]);
      }
    }
    // 資料端已保證一檔一筆;這裡再去重一次以防舊資料
    const seen = new Set();
    let rows = state.patterns.filter((r) => {
      if (r.primary === false || seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
    if (state.statuses.size) rows = rows.filter((r) => state.statuses.has(r.status));
    if (state.patternTypes.size) {
      rows = rows.filter(
        (r) =>
          state.patternTypes.has(r.pattern) ||
          (othersById.get(r.id) || []).some((o) => state.patternTypes.has(o.pattern))
      );
    }
    const cards = rows.map((r) => ({ main: r, others: othersById.get(r.id) || [] }));
    $('#patternCount').textContent = `${cards.length} 檔`;
    const list = $('#patternList');
    if (!cards.length) {
      list.innerHTML = '<div class="empty">沒有符合的型態</div>';
      return;
    }
    list.innerHTML = cards
      .map(({ main: r, others }) => {
        const cls = STATUS_CLASS[r.status] || 'warn';
        const bo = r.breakout_date
          ? ` · 突破 ${String(r.breakout_date).slice(5)}${
              r.days_since_breakout != null ? `（${r.days_since_breakout} 日前）` : ''
            }`
          : '';
        const extra = others.length
          ? `<div class="item-extra">另符合：${others
              .map((o) => `${esc(o.pattern)} 樞紐 ${fmt.money(o.pivot)}（${esc(o.status)}）`)
              .join(' · ')}</div>`
          : '';
        return `<article class="item" data-open-chart="${r.id}" data-name="${esc(r.name)}" data-market="${esc(
          r.market
        )}" data-pivot="${r.pivot ?? ''}">
          <div>
            <div class="item-title">${r.id} ${esc(r.name)}<span class="badge ${cls}">${esc(r.status)}</span>${
          r.recovered ? '<span class="badge hot">復甦</span>' : ''
        }</div>
            <div class="item-sub">${esc(r.pattern_label || r.pattern)} · RS ${r.rs} · ${fmt.money(r.close)}<br/>
樞紐 ${fmt.money(r.pivot)}（${fmtDist(r.dist_pivot_pct)}）${bo}<br/>
${r.contraction ? esc(r.contraction) + ' · ' : ''}${r.base_weeks != null ? r.base_weeks + '週 · ' : ''}${
          r.structure_date ? '結構 ' + String(r.structure_date).slice(5) : ''
        }${r.vol_dry_ratio != null ? ' · 量縮 ' + r.vol_dry_ratio : ''}</div>
            ${extra}
          </div>
          <div class="item-right"><div><strong>${
            r.score != null ? Number(r.score).toFixed(0) : ''
          }</strong></div><div class="item-sub">分數</div></div>
        </article>`;
      })
      .join('');
  }

  function renderTrades() {
    const list = $('#tradeList');
    const b = state.breakouts;
    const trades = (b && b.trades) || [];
    let rows = trades;
    if (state.tradeStatuses.size) rows = rows.filter((t) => state.tradeStatuses.has(t.status));
    $('#tradeCount').textContent = `${rows.length} 筆（共 ${trades.length}）`;
    if (!rows.length) {
      list.innerHTML = `<div class="empty">${
        trades.length ? '沒有符合的交易' : '尚無突破交易紀錄；每日更新後會自動累積'
      }</div>`;
      return;
    }
    list.innerHTML = rows
      .map((t) => {
        const label = TRADE_LABEL[t.status] || t.status;
        const cls = TRADE_CLASS[t.status] || 'muted';
        const last = t.last_close != null && t.pivot ? (t.last_close / t.pivot - 1) * 100 : null;
        const outcome =
          t.outcome_date
            ? `${t.outcome === 'success' ? '達 +10%' : '跌破 −5%'} ${String(t.outcome_date).slice(5)}（${fmtDist(
                t.outcome_pct
              )}）`
            : `現價 ${fmt.money(t.last_close)}（${fmtDist(last)}）`;
        return `<article class="item" data-open-chart="${t.id}" data-name="${esc(t.name)}" data-market="${esc(
          t.market || ''
        )}" data-pivot="${t.pivot ?? ''}">
          <div>
            <div class="item-title">${t.id} ${esc(t.name || '')}<span class="badge ${cls}">${esc(label)}</span>${
          t.origin === 'recovered' ? '<span class="badge muted">復甦後再突破</span>' : ''
        }</div>
            <div class="item-sub">${esc(t.pattern_label || t.pattern || '')} · 樞紐 ${fmt.money(t.pivot)} · 突破 ${String(
          t.breakout_date || ''
        ).slice(5)} @ ${fmt.money(t.breakout_close)}<br/>${outcome}</div>
          </div>
          <div class="item-right"><div class="${fmt.pnlClass(last || 0)}"><strong>${fmtDist(last)}</strong></div><div class="item-sub">距樞紐</div></div>
        </article>`;
      })
      .join('');
  }

  async function openChart(id, name, market, pivot) {
    state.chartContext = { id, name, market, pivot };
    $('#chartTitle').textContent = `${id} ${name || ''}`;
    $('#chartSub').textContent = pivot ? `樞紐 ${fmt.money(Number(pivot))}` : market || '';
    $('#chartDialog').showModal();
    try {
      const raw = await RS_DATA.loadOhlcv(RS_STORAGE.getDataBaseUrl(), id);
      const candles = (raw.candles || []).map((c) => ({
        ...c,
        ma50: c.ma50 ?? c.ma_50,
        ma150: c.ma150 ?? c.ma_150,
        ma200: c.ma200 ?? c.ma_200,
      }));
      RS_CHART.draw($('#chartCanvas'), { candles }, pivot !== '' && pivot != null ? Number(pivot) : null);
      $('#chartLegend').textContent = '橘 MA50 · 紫 MA150 · 青 MA200 · 紅虛線樞紐';
    } catch (e) {
      RS_CHART.draw($('#chartCanvas'), { candles: [] }, null);
      $('#chartLegend').textContent = `K 線載入失敗：${e.message}`;
    }
  }

  // navigation
  $$('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.nav-item').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      $$('.view').forEach((v) => v.classList.remove('active'));
      $(`#view-${btn.dataset.view}`).classList.add('active');
    });
  });
  $$('#view-recommend .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('#view-recommend .tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      $$('#view-recommend .subview').forEach((s) => s.classList.remove('active'));
      $(`#sub-${tab.dataset.sub}`).classList.add('active');
    });
  });

  // filters
  $('#rsSearch').addEventListener('input', (e) => {
    state.rsQuery = e.target.value;
    renderRs85();
  });
  $$('#sub-rs85 .chip[data-market]').forEach((chip) => {
    chip.addEventListener('click', () => {
      $$('#sub-rs85 .chip[data-market]').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      state.market = chip.dataset.market || '';
      renderRs85();
    });
  });
  $('#tplOnlyChip').addEventListener('click', () => {
    state.templateOnly = !state.templateOnly;
    $('#tplOnlyChip').classList.toggle('active', state.templateOnly);
    renderRs85();
  });
  $('#statusChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const s = chip.dataset.status;
    if (state.statuses.has(s)) state.statuses.delete(s);
    else state.statuses.add(s);
    chip.classList.toggle('active');
    renderPatterns();
  });
  $('#patternChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const p = chip.dataset.pattern;
    if (state.patternTypes.has(p)) state.patternTypes.delete(p);
    else state.patternTypes.add(p);
    chip.classList.toggle('active');
    renderPatterns();
  });
  $('#tradeChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const s = chip.dataset.trade;
    if (state.tradeStatuses.has(s)) state.tradeStatuses.delete(s);
    else state.tradeStatuses.add(s);
    chip.classList.toggle('active');
    renderTrades();
  });

  // portfolio
  $('#addTradeBtn').addEventListener('click', () => {
    const form = $('#tradeForm');
    form.reset();
    form.date.value = new Date().toISOString().slice(0, 10);
    $('#tradeDialog').showModal();
  });
  $('#tradeForm').addEventListener('submit', (e) => {
    if (e.submitter?.value !== 'save') return;
    e.preventDefault();
    const fd = new FormData($('#tradeForm'));
    const id = String(fd.get('id') || '').trim();
    const price = Number(fd.get('price'));
    const shares = Number(fd.get('shares'));
    if (!/^\d{4}$/.test(id) || !(price > 0) || !(shares > 0)) {
      toast('請確認代號／價格／股數');
      return;
    }
    const hit =
      state.rs85.find((r) => String(r.id) === id) ||
      state.patterns.find((r) => String(r.id) === id);
    RS_STORAGE.addTrade({
      symbol: id,
      name: String(fd.get('name') || hit?.name || id).trim(),
      market: String(fd.get('market') || hit?.market || '上市'),
      price,
      shares,
      date: String(fd.get('date')),
    });
    $('#tradeDialog').close();
    renderPortfolio();
    toast('已新增持股');
  });

  $('#metricsBtn').addEventListener('click', () => {
    const trades = RS_STORAGE.loadTrades();
    const positions = RS_PORTFOLIO.buildPositions(trades, state.priceMap);
    const m = RS_PORTFOLIO.computeMetrics(trades, positions);
    $('#metricsBody').innerHTML = `
      <p>勝率：<strong>${m.winRate == null ? '—' : fmt.pct(m.winRate)}</strong>
        <span class="hint">（${
          m.closedCount ? `已平倉 ${m.closedCount} 筆` : `尚無平倉，改以持股 ${m.openCount} 檔`
        }）</span></p>
      <p>平均報酬（已平倉）：<strong class="${fmt.pnlClass(m.avgReturnPct || 0)}">${
        m.avgReturnPct == null ? '—' : fmt.pct(m.avgReturnPct)
      }</strong></p>
      <p>平均報酬（持股）：<strong class="${fmt.pnlClass(m.avgOpenReturnPct || 0)}">${
        m.avgOpenReturnPct == null ? '—' : fmt.pct(m.avgOpenReturnPct)
      }</strong></p>
      <h3>月績效</h3>
      ${
        m.monthly.length
          ? `<div class="list">${m.monthly
              .slice()
              .reverse()
              .map(
                (row) => `<div class="item"><div>${row.yearMonth}<div class="item-sub">報酬 ${fmt.pct(
                  row.returnPct
                )}</div></div>
                <div class="item-right ${fmt.pnlClass(row.pnl)}">${fmt.money(row.pnl)}</div></div>`
              )
              .join('')}</div>`
          : '<p class="hint">尚無資料</p>'
      }`;
    $('#metricsDialog').showModal();
  });
  $('#closeMetricsBtn').addEventListener('click', () => $('#metricsDialog').close());

  // chart / settings
  document.body.addEventListener('click', (e) => {
    const item = e.target.closest('[data-open-chart]');
    if (!item) return;
    openChart(item.dataset.openChart, item.dataset.name, item.dataset.market, item.dataset.pivot);
  });
  $('#closeChartBtn').addEventListener('click', () => $('#chartDialog').close());
  $('#addFromChartBtn').addEventListener('click', () => {
    const ctx = state.chartContext;
    if (!ctx) return;
    $('#chartDialog').close();
    const form = $('#tradeForm');
    form.reset();
    form.id.value = ctx.id;
    form.name.value = ctx.name || '';
    form.market.value = ctx.market === '上櫃' ? '上櫃' : '上市';
    form.date.value = new Date().toISOString().slice(0, 10);
    if (state.priceMap[ctx.id] != null) form.price.value = state.priceMap[ctx.id];
    $('#tradeDialog').showModal();
  });

  $('#dataBaseUrl').value = RS_STORAGE.getDataBaseUrl();
  $('#saveSettingsBtn').addEventListener('click', async () => {
    const url = $('#dataBaseUrl').value.trim().replace(/\/$/, '');
    if (!/^https?:\/\//.test(url)) {
      toast('請輸入有效 URL');
      return;
    }
    RS_STORAGE.setDataBaseUrl(url);
    toast('已儲存');
    await refresh();
  });
  $('#refreshBtn').addEventListener('click', () => refresh());

  refresh();
})();
