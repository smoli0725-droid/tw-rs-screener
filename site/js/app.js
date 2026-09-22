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

  function localDateKey(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

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

  function toast(msg, duration) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), duration || 2200);
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
      renderDataStatus();
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
      (m.is_fresh === false ? ' · 資料可能過期' : '');
  }

  function renderDataStatus() {
    const el = $('#dataStatusBody');
    if (!el) return;
    const m = state.meta || {};
    if (!m.data_date && m.is_fresh == null && !m.message) {
      el.textContent = '尚無資料';
      return;
    }
    const fresh =
      m.is_fresh === false ? '可能過期' : m.is_fresh === true ? '已更新' : '—';
    el.innerHTML = `<p>資料日期：<strong>${esc(m.data_date || '—')}</strong></p>
      <p>新鮮度：<strong>${esc(fresh)}</strong></p>
      ${m.message ? `<p class="item-sub">${esc(m.message)}</p>` : ''}`;
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

  function formatPx(n) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    return Number(n).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatPct1(n) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    const v = Number(n) * 100;
    return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
  }

  function formatPct2(n) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    const v = Number(n) * 100;
    return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
  }

  function formatMonthLabel(key) {
    const match = String(key || '').match(/^(\d{4})-(\d{2})$/);
    if (!match) return '本月';
    return `${match[1]}年${Number(match[2])}月`;
  }

  function viewJournal() {
    const real = RS_STORAGE.loadTrades();
    if (real.length || !window.RS_PREVIEW) {
      return { trades: real, prices: state.priceMap, sample: false };
    }
    return {
      trades: RS_PREVIEW.demoTrades(),
      prices: RS_PREVIEW.demoPrices(),
      sample: true,
    };
  }

  function curveMarkup(points) {
    if (!points || points.length < 2) {
      return '<p class="metric-note">尚無已實現損益</p>';
    }
    const w = 280;
    const h = 78;
    const pad = 4;
    const vals = points.map((p) => p.pnl);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    const coords = vals.map((v, i) => {
      const x = pad + (i / (vals.length - 1)) * (w - pad * 2);
      const y = pad + (1 - (v - min) / span) * (h - pad * 2);
      return [x, y];
    });
    const line = coords.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    const area = `${line} L${coords[coords.length - 1][0].toFixed(1)} ${h} L${coords[0][0].toFixed(1)} ${h} Z`;
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="已實現損益成長曲線"><path d="${area}" fill="rgba(28,28,28,0.08)"></path><path d="${line}" fill="none" stroke="#1c1c1c" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path></svg>`;
  }

  function renderMetricCards(metrics, sample) {
    const win = $('#metricWinRate');
    if (!win) return;
    win.textContent = metrics.winRate == null ? '—' : `${Math.round(metrics.winRate * 100)}%`;
    $('#metricWinRateNote').textContent = metrics.closedCount
      ? `近 ${metrics.closedCount} 筆手記平倉${sample ? ' · 示例資料' : ''}`
      : '尚無手記平倉';
    const winAvg = $('#metricWinAvg');
    winAvg.textContent = formatPct1(metrics.winningAvgReturnPct);
    winAvg.className = `metric-value ${fmt.pnlClass(metrics.winningAvgReturnPct || 0)}`;
    const month = $('#metricMonth');
    month.textContent = formatPct1(metrics.monthReturnPct);
    month.className = `metric-value ${fmt.pnlClass(metrics.monthReturnPct || 0)}`;
    $('#metricMonthNote').textContent = `${formatMonthLabel(metrics.monthKey)}${sample ? ' · 示例資料' : ' · 已實現'}`;
    $('#metricCurve').innerHTML = curveMarkup(metrics.realizedCurve);
    $('#metricCurveNote').textContent = sample ? '累計已實現 · 示例資料' : '累計已實現';
  }

  function renderPortfolio() {
    const journal = viewJournal();
    const positions = RS_PORTFOLIO.buildPositions(journal.trades, journal.prices);
    const metrics = RS_PORTFOLIO.computeMetrics(journal.trades, positions);
    const mv = positions.reduce((s, p) => s + p.marketValue, 0);
    const pnl = positions.reduce((s, p) => s + p.pnl, 0);
    const cost = positions.reduce((s, p) => s + p.costValue, 0);
    $('#totalMv').textContent = mv.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
    const pnlEl = $('#totalPnl');
    if (journal.sample) {
      pnlEl.textContent = '';
      pnlEl.className = 'summary-sub';
    } else {
      pnlEl.textContent = positions.length
        ? `未實現 ${fmt.money(pnl)}（${fmt.pct(cost ? pnl / cost : 0)}）`
        : '未實現 —';
      pnlEl.className = `summary-sub ${fmt.pnlClass(pnl)}`;
    }
    const note = $('#portfolioNote');
    if (note) {
      note.textContent = journal.sample
        ? '示例資料 · 下列數字皆為靜態示意，不代表真實損益或帳戶'
        : '勝率與成功單報酬只計你手記的平倉，不含系統突破帳本。';
    }
    $$('.demo-badge').forEach((el) => {
      el.hidden = !journal.sample;
    });
    renderMetricCards(metrics, journal.sample);

    const list = $('#positionList');
    if (!positions.length) {
      list.innerHTML = '<div class="empty">尚未有持股，點上方新增</div>';
      return;
    }
    list.innerHTML = `<div class="holdings-table-wrap"><table class="holdings-table"><thead><tr>
        <th>標的</th><th>股數</th><th>成本</th><th>現價</th><th>報酬</th>${journal.sample ? '' : '<th></th>'}
      </tr></thead><tbody>${positions
        .map((p) => {
          const quote = p.lastPrice == null ? '暫用成本' : formatPx(p.lastPrice);
          const rowActions = journal.sample
            ? ''
            : `<td class="holding-actions">
                <button type="button" class="ghost-btn" data-sell="${p.symbol}">賣出</button>
                <button type="button" class="ghost-btn" data-delete-pos="${p.symbol}" data-name="${esc(p.name)}">刪除</button>
              </td>`;
          return `<tr class="holding-row" data-open-chart="${p.symbol}" data-name="${esc(p.name)}" data-market="${esc(p.market)}">
            <td class="holding-name">${p.symbol} ${esc(p.name)}${
              p.lastPrice == null ? '<span class="badge warn">無報價</span>' : ''
            }</td>
            <td>${p.shares}</td>
            <td>${formatPx(p.cost)}</td>
            <td>${quote}</td>
            <td class="${fmt.pnlClass(p.returnPct)}">${formatPct1(p.returnPct)}</td>
            ${rowActions}
          </tr>`;
        })
        .join('')}</tbody></table></div>`;
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

  const ALL_PATTERNS = ['VCP', '作弊型態', '雙重底', '高聳旗形'];

  function buildPatternChips() {
    const present = new Set(state.patterns.map((p) => p.pattern).filter(Boolean));
    const extra = [...present].filter((t) => !ALL_PATTERNS.includes(t)).sort();
    const types = [...ALL_PATTERNS, ...extra];
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

  function fmtVolDry(ratio) {
    if (ratio == null) return '';
    const n = Number(ratio);
    if (Number.isNaN(n)) return '';
    if (n < 1) return ' · <span class="vol-tag vol-shrink">量縮</span>';
    return ` · <span class="vol-tag vol-expand">量比 ${n}</span>`;
  }

  function renderPatterns() {
    // 一檔一型態:資料端已只輸出一筆;這裡再依代號去重以防舊資料
    const seen = new Set();
    let rows = state.patterns.filter((r) => {
      if (r.primary === false || seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
    if (state.statuses.size) rows = rows.filter((r) => state.statuses.has(r.status));
    if (state.patternTypes.size) rows = rows.filter((r) => state.patternTypes.has(r.pattern));
    $('#patternCount').textContent = `${rows.length} 檔`;
    const list = $('#patternList');
    if (!rows.length) {
      list.innerHTML = '<div class="empty">沒有符合的型態</div>';
      return;
    }
    list.innerHTML = rows
      .map((r) => {
        const cls = STATUS_CLASS[r.status] || 'warn';
        const bo = r.breakout_date
          ? ` · 突破 ${String(r.breakout_date).slice(5)}${
              r.days_since_breakout != null ? `（${r.days_since_breakout} 日前）` : ''
            }`
          : '';
        const pos = r.detail && r.detail.position ? `（${esc(r.detail.position)}）` : '';
        return `<article class="item" data-open-chart="${r.id}" data-name="${esc(r.name)}" data-market="${esc(
          r.market
        )}" data-pivot="${r.pivot ?? ''}">
          <div>
            <div class="item-title">${r.id} ${esc(r.name)}<span class="badge ${cls}">${esc(r.status)}</span>${
          r.recovered ? '<span class="badge hot">復甦</span>' : ''
        }</div>
            <div class="item-sub">${esc(r.pattern_label || r.pattern)}${pos} · RS ${r.rs} · ${fmt.money(r.close)}<br/>
樞紐 ${fmt.money(r.pivot)}（${fmtDist(r.dist_pivot_pct)}）${bo}<br/>
${r.contraction ? esc(r.contraction) + ' · ' : ''}${r.base_weeks != null ? r.base_weeks + '週 · ' : ''}${
          r.structure_date ? '結構 ' + String(r.structure_date).slice(5) : ''
        }${fmtVolDry(r.vol_dry_ratio)}</div>
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
    // reentered 舊列不展示;復甦後再突破看 origin=recovered 的新交易
    const trades = ((b && b.trades) || []).filter((t) => t.status !== 'reentered');
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

  function applyChartSummary(summary, sample, pivot) {
    const rangeWord = { D: '日線', W: '週線', M: '月線' }[state.chartRange] || '日線';
    const bits = [sample ? `${rangeWord} · 示例資料 · 非即時報價` : `${rangeWord} · 非即時報價`];
    if (pivot) bits.push(`樞紐 ${fmt.money(Number(pivot))}`);
    $('#chartSub').textContent = bits.join(' · ');
    const lastEl = $('#chartLast');
    const chgEl = $('#chartChg');
    if (!lastEl || !chgEl) return;
    if (!summary) {
      lastEl.textContent = '—';
      chgEl.textContent = '';
      return;
    }
    lastEl.textContent = formatPx(summary.lastClose);
    const sign = summary.change > 0 ? '+' : '';
    chgEl.textContent = `${sign}${Number(summary.change).toFixed(2)} · ${formatPct2(summary.changePct)}`;
    chgEl.className = `chart-chg ${fmt.pnlClass(summary.change)}`;
  }

  function paintChart(raw, sample) {
    const ctx = state.chartContext || {};
    const pivot = ctx.pivot !== '' && ctx.pivot != null ? Number(ctx.pivot) : null;
    const ohlcv = {
      candles: (raw.candles || []).map((c) => ({
        ...c,
        ma50: c.ma50 ?? c.ma_50,
        ma100: c.ma100 ?? c.ma_100,
        ma150: c.ma150 ?? c.ma_150,
        ma200: c.ma200 ?? c.ma_200,
      })),
      annotations: raw.annotations || [],
    };
    state.chartOhlcv = ohlcv;
    state.chartSample = sample;
    const summary = RS_CHART.draw($('#chartHost'), ohlcv, pivot);
    $('#chartLegend').textContent = RS_CHART.legendText(ohlcv);
    applyChartSummary(summary, sample, pivot);
  }

  async function openChart(id, name, market, pivot) {
    state.chartContext = { id, name, market, pivot };
    state.chartRange = 'D';
    state.chartSample = false;
    $('#chartTitle').textContent = `${id} ${name || ''}`.trim();
    $('#chartSub').textContent = '載入 K 線…';
    $$('#chartRanges .chip').forEach((c) => c.classList.toggle('active', c.dataset.range === 'D'));
    if (window.RS_CHART) RS_CHART.setRange('D');
    $('#chartDialog').showModal();
    try {
      const raw = await RS_DATA.loadOhlcv(RS_STORAGE.getDataBaseUrl(), id);
      paintChart(raw, false);
    } catch (e) {
      const candles = window.RS_PREVIEW && RS_PREVIEW.sampleCandles(id);
      if (candles) {
        paintChart({ candles, annotations: [] }, true);
        return;
      }
      RS_CHART.draw($('#chartHost'), { candles: [] }, null);
      $('#chartLegend').textContent = `K 線載入失敗：${e.message}`;
      applyChartSummary(null, false, null);
    }
  }

  // navigation
  function showView(view, opts = {}) {
    $$('.nav-item, .side-link').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
    if (view === 'settings' && window.RS_PUSH) RS_PUSH.refresh();
    if (view === 'teaching' && window.RS_TEACHING) {
      if (opts.hash) RS_TEACHING.openFromHash(opts.hash);
      else RS_TEACHING.onViewShown();
      return;
    }
    if (typeof location !== 'undefined' && String(location.hash || '').startsWith('#teaching')) {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    }
  }

  function teachingHash() {
    return String(location.hash || '').replace(/^#/, '').startsWith('teaching');
  }

  $$('.nav-item, .side-link').forEach((btn) => {
    btn.addEventListener('click', () => {
      showView(btn.dataset.view);
    });
  });
  const sidebarToggle = $('#sidebarToggle');
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      const collapsed = document.body.classList.toggle('sidebar-collapsed');
      sidebarToggle.textContent = collapsed ? '›' : '‹';
      sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
      sidebarToggle.setAttribute('aria-label', collapsed ? '展開側欄' : '收合側欄');
    });
  }
  state.chartRange = 'D';
  const chartRanges = $('#chartRanges');
  if (chartRanges) {
    chartRanges.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-range]');
      if (!btn) return;
      if (btn.dataset.range === 'I') {
        toast('尚無分線資料');
        return;
      }
      state.chartRange = btn.dataset.range;
      $$('#chartRanges .chip').forEach((c) => c.classList.toggle('active', c === btn));
      RS_CHART.setRange(btn.dataset.range);
      if (!state.chartOhlcv) return;
      const pivot = state.chartContext && state.chartContext.pivot;
      const summary = RS_CHART.redraw();
      applyChartSummary(summary, state.chartSample, pivot);
    });
  }
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
    form.date.value = localDateKey();
    $('#tradeDialog').showModal();
  });
  $('#cancelTradeBtn').addEventListener('click', () => {
    $('#tradeDialog').close();
  });
  $('#tradeForm').addEventListener('submit', (e) => {
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
    toast(
      !hit ? '已新增持股（此代號不在 RS85／型態名單，無法取得報價）' : '已新增持股'
    );
  });

  let pendingDelete = null;

  function openShares(symbol) {
    const pos = RS_PORTFOLIO.buildPositions(RS_STORAGE.loadTrades(), state.priceMap).find(
      (p) => String(p.symbol) === String(symbol)
    );
    return pos || null;
  }

  function openSellDialog(symbol) {
    const pos = openShares(symbol);
    if (!pos) {
      toast('找不到持股');
      return;
    }
    const form = $('#sellForm');
    form.reset();
    form.symbol.value = pos.symbol;
    form.name.value = pos.name || pos.symbol;
    form.market.value = pos.market || '上市';
    form.shares.value = pos.shares;
    form.shares.max = pos.shares;
    form.price.value = pos.lastPrice != null ? pos.lastPrice : pos.cost;
    form.date.value = localDateKey();
    $('#sellHint').textContent = `${pos.symbol} ${pos.name} · 目前持股 ${pos.shares} 股`;
    $('#sellDialog').showModal();
  }

  $('#cancelSellBtn').addEventListener('click', () => $('#sellDialog').close());
  $('#sellForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData($('#sellForm'));
    const symbol = String(fd.get('symbol') || '').trim();
    const price = Number(fd.get('price'));
    const shares = Number(fd.get('shares'));
    const pos = openShares(symbol);
    if (!pos) {
      toast('找不到持股');
      return;
    }
    if (!(price > 0) || !(shares > 0)) {
      toast('請確認賣出價／股數');
      return;
    }
    if (shares > pos.shares) {
      toast(`賣出股數不可超過目前持股 ${pos.shares}`);
      return;
    }
    RS_STORAGE.addSell({
      symbol,
      name: String(fd.get('name') || pos.name || symbol).trim(),
      market: String(fd.get('market') || pos.market || '上市'),
      price,
      shares,
      date: String(fd.get('date')),
    });
    $('#sellDialog').close();
    renderPortfolio();
    toast(shares >= pos.shares ? '已全部賣出' : '已賣出');
  });

  function openDeleteDialog(symbol, name) {
    pendingDelete = symbol;
    $('#deleteHint').textContent = `確定刪除 ${symbol} ${name || ''} 的全部持股紀錄？`;
    $('#deleteDialog').showModal();
  }

  $('#cancelDeleteBtn').addEventListener('click', () => {
    pendingDelete = null;
    $('#deleteDialog').close();
  });
  $('#confirmDeleteBtn').addEventListener('click', () => {
    if (!pendingDelete) return;
    RS_STORAGE.removeTradesBySymbol(pendingDelete);
    pendingDelete = null;
    $('#deleteDialog').close();
    renderPortfolio();
    toast('已刪除持股');
  });

  $('#positionList').addEventListener('click', (e) => {
    const sellBtn = e.target.closest('[data-sell]');
    if (sellBtn) {
      e.stopPropagation();
      openSellDialog(sellBtn.dataset.sell);
      return;
    }
    const delBtn = e.target.closest('[data-delete-pos]');
    if (delBtn) {
      e.stopPropagation();
      openDeleteDialog(delBtn.dataset.deletePos, delBtn.dataset.name);
    }
  });

  $('#metricsBtn').addEventListener('click', () => {
    const journal = viewJournal();
    const positions = RS_PORTFOLIO.buildPositions(journal.trades, journal.prices);
    const m = RS_PORTFOLIO.computeMetrics(journal.trades, positions);
    $('#metricsBody').innerHTML = `
      <p class="hint">${journal.sample ? '示例資料。' : ''}勝率與成功單平均報酬只計手記平倉（FIFO，賺錢的單另計），不含系統突破帳本。</p>
      <p>勝率：<strong>${m.winRate == null ? '—' : fmt.pct(m.winRate)}</strong>
        <span class="hint">（${
          m.closedCount ? `已平倉 ${m.closedCount} 筆` : '尚無手記平倉'
        }）</span></p>
      <p>成功單平均報酬：<strong class="${fmt.pnlClass(m.winningAvgReturnPct || 0)}">${
        m.winningAvgReturnPct == null ? '—' : fmt.pct(m.winningAvgReturnPct)
      }</strong>
        <span class="hint">（僅 ${m.winningCount || 0} 筆賺錢的平倉）</span></p>
      <p>平均報酬（全部已平倉）：<strong class="${fmt.pnlClass(m.avgReturnPct || 0)}">${
        m.avgReturnPct == null ? '—' : fmt.pct(m.avgReturnPct)
      }</strong></p>
      <p>平均報酬（持股）：<strong class="${fmt.pnlClass(m.avgOpenReturnPct || 0)}">${
        m.avgOpenReturnPct == null ? '—' : fmt.pct(m.avgOpenReturnPct)
      }</strong></p>
      <h3>持倉浮動</h3>
      <p>未實現損益：<strong class="${fmt.pnlClass(m.unrealizedPnl || 0)}">${
        m.openCount ? fmt.money(m.unrealizedPnl) : '—'
      }</strong></p>
      <p>持倉成本：<strong>${m.openCount ? fmt.money(m.openCost) : '—'}</strong></p>
      <p>浮動報酬：<strong class="${fmt.pnlClass(m.unrealizedReturnPct || 0)}">${
        fmt.pct(m.unrealizedReturnPct)
      }</strong></p>
      <h3>月績效（已實現）</h3>
      <p class="hint">每月報酬％＝該月已平倉損益 ÷ 該月賣出部位的買進成本，不含持倉浮動。</p>
      ${
        m.monthly.length
          ? `<div class="list">${m.monthly
              .slice()
              .reverse()
              .map(
                (row) => `<div class="item"><div>${row.yearMonth}<div class="item-sub">已實現報酬 ${
                  row.returnPct == null ? '—' : fmt.pct(row.returnPct)
                }</div></div>
                <div class="item-right ${fmt.pnlClass(row.pnl)}">${fmt.money(row.pnl)}</div></div>`
              )
              .join('')}</div>`
          : '<p class="hint">尚無已平倉資料</p>'
      }`;
    $('#metricsDialog').showModal();
  });
  $('#closeMetricsBtn').addEventListener('click', () => $('#metricsDialog').close());

  // chart / settings
  document.body.addEventListener('click', (e) => {
    if (e.target.closest('button, .item-actions')) return;
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
    form.date.value = localDateKey();
    if (state.priceMap[ctx.id] != null) form.price.value = state.priceMap[ctx.id];
    $('#tradeDialog').showModal();
  });

  function isValidDataBase(url) {
    if (!url) return false;
    if (/^https?:\/\//.test(url)) return true;
    return url === './data' || url === '/data' || url === 'data';
  }

  $('#dataBaseUrl').value = RS_STORAGE.getDataBaseUrl();
  $('#saveSettingsBtn').addEventListener('click', async () => {
    const url = $('#dataBaseUrl').value.trim().replace(/\/$/, '');
    if (!isValidDataBase(url)) {
      toast('請輸入有效 URL 或相對路徑（如 ./data）');
      return;
    }
    RS_STORAGE.setDataBaseUrl(url);
    toast('已儲存');
    await refresh();
    renderAccount();
  });
  $('#resetSettingsBtn').addEventListener('click', async () => {
    RS_STORAGE.clearDataBaseUrl();
    $('#dataBaseUrl').value = RS_CONFIG.DEFAULT_DATA_BASE;
    toast('已恢復預設');
    await refresh();
    renderAccount();
  });
  $('#refreshBtn').addEventListener('click', () => refresh());

  function renderAccount() {
    const el = $('#accountBody');
    if (!el) return;
    const user = window.RS_AUTH && window.RS_AUTH.getUser && window.RS_AUTH.getUser();
    const plan = (window.RS_STORAGE.getPlan && window.RS_STORAGE.getPlan()) || {
      plan: 'free',
      plan_expires_at: null,
    };
    const sync = (window.RS_STORAGE.getSyncState && window.RS_STORAGE.getSyncState()) || {
      state: 'idle',
      error: '',
    };
    const email =
      (user &&
        (user.primaryEmailAddress?.emailAddress ||
          user.emailAddresses?.[0]?.emailAddress)) ||
      '—';
    const syncLabel =
      sync.state === 'synced'
        ? '已同步'
        : sync.state === 'pending'
          ? '同步中…'
          : sync.state === 'error'
            ? `同步失敗${sync.error ? `：${sync.error}` : ''}`
            : '尚未同步';
    el.innerHTML = `<p>帳號：<strong>${esc(email)}</strong></p>
      <p>方案：<strong>${esc(plan.plan || 'free')}</strong>${
        plan.plan_expires_at ? `（到期 ${esc(plan.plan_expires_at)}）` : ''
      }</p>
      <p>雲端資料：<strong>${esc(syncLabel)}</strong></p>
      <p class="hint">持股與設定會同步到雲端；billing 尚未開放，方案預設為 free。</p>`;
  }

  window.addEventListener('hashchange', () => {
    if (!teachingHash()) return;
    showView('teaching', { hash: location.hash });
  });

  window.RS_APP = {
    start: async () => {
      const input = $('#dataBaseUrl');
      if (input) input.value = RS_STORAGE.getDataBaseUrl();
      renderAccount();
      if (window.RS_PUSH) {
        RS_PUSH.bind();
        await RS_PUSH.refresh();
      }
      if (window.RS_TEACHING) {
        RS_TEACHING.bind();
        await RS_TEACHING.load();
        RS_TEACHING.render();
      }
      await refresh();
      renderAccount();
      if (teachingHash()) showView('teaching', { hash: location.hash });
    },
    refresh,
    renderPortfolio,
    renderAccount,
    toast,
    showView,
  };
})();
