window.RS_CHART = (() => {
  const ANN_LABEL = {
    cup_left: '杯左高',
    cup_bottom: '杯底',
    pause_high: '停頓高',
    pullback_high: '回檔高',
    pullback_low: '回檔低',
    db_low1: '雙底①',
    db_mid: '雙底中',
    db_low2: '雙底②',
    thrust_high: '推力高',
    flag_high: '旗形高',
    flag_low: '旗形低',
    handle_high: '柄高',
    handle_low: '柄低',
    failed_breakout: '失敗突破',
  };
  const ANN_HIGH = new Set([
    'cup_left',
    'pause_high',
    'pullback_high',
    'db_mid',
    'thrust_high',
    'flag_high',
    'handle_high',
    'failed_breakout',
  ]);

  const UP = '#d23b3b';
  const DOWN = '#1f8a4c';

  const view = {
    host: null,
    raw: [],
    annotations: [],
    pivot: null,
    range: 'D',
    chart: null,
    series: null,
    resize: null,
    byTime: new Map(),
  };

  function labelFor(type) {
    return ANN_LABEL[type] || type;
  }

  function sma(values, period) {
    const out = new Array(values.length).fill(null);
    if (!period || period < 1) return out;
    let sum = 0;
    let filled = 0;
    for (let i = 0; i < values.length; i++) {
      const v = Number(values[i]);
      if (!Number.isFinite(v)) {
        sum = 0;
        filled = 0;
        continue;
      }
      sum += v;
      filled += 1;
      if (i >= period) {
        const prev = Number(values[i - period]);
        if (Number.isFinite(prev)) {
          sum -= prev;
          filled -= 1;
        }
      }
      if (filled === period) out[i] = sum / period;
    }
    return out;
  }

  function finiteOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function attachMa(candles) {
    const closes = candles.map((c) => Number(c.close));
    const ma50 = sma(closes, 50);
    const ma100 = sma(closes, 100);
    const ma200 = sma(closes, 200);
    return candles.map((c, i) => ({
      ...c,
      ma50: finiteOrNull(c.ma50 ?? c.ma_50) ?? ma50[i],
      ma100: finiteOrNull(c.ma100 ?? c.ma_100) ?? ma100[i],
      ma200: finiteOrNull(c.ma200 ?? c.ma_200) ?? ma200[i],
    }));
  }

  function bucketKey(dateStr, range) {
    const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
    if (range === 'M') return `${y}-${String(m).padStart(2, '0')}`;
    const dt = new Date(Date.UTC(y, m - 1, d));
    const day = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((dt - yearStart) / 86400000 + 1) / 7);
    return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }

  function aggregateCandles(candles, range) {
    if (range !== 'W' && range !== 'M') {
      return candles.map((c) => ({
        date: String(c.date).slice(0, 10),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume) || 0,
        ma50: c.ma50 ?? c.ma_50,
        ma100: c.ma100 ?? c.ma_100,
        ma150: c.ma150 ?? c.ma_150,
        ma200: c.ma200 ?? c.ma_200,
      }));
    }
    const buckets = new Map();
    for (const c of candles) {
      const date = String(c.date).slice(0, 10);
      const key = bucketKey(date, range);
      const open = Number(c.open);
      const high = Number(c.high);
      const low = Number(c.low);
      const close = Number(c.close);
      const volume = Number(c.volume) || 0;
      const bar = buckets.get(key);
      if (!bar) {
        buckets.set(key, { date, open, high, low, close, volume });
      } else {
        bar.high = Math.max(bar.high, high);
        bar.low = Math.min(bar.low, low);
        bar.close = close;
        bar.volume += volume;
        bar.date = date;
      }
    }
    return [...buckets.values()];
  }

  function lotsLabel(volume) {
    const shares = Number(volume);
    if (!Number.isFinite(shares)) return '—';
    const lots = shares / 1000;
    return `${lots.toLocaleString('zh-TW', { maximumFractionDigits: 0 })} 張`;
  }

  function destroy() {
    if (view.resize) {
      view.resize.disconnect();
      view.resize = null;
    }
    if (view.chart) {
      view.chart.remove();
      view.chart = null;
      view.series = null;
    }
  }

  function tipEl() {
    return document.getElementById('chartTip');
  }

  function fillTip(bar) {
    const tip = tipEl();
    if (!tip || !bar) return;
    const up = bar.close >= bar.open;
    const cls = up ? 'pnl-up' : 'pnl-down';
    const px = (n) =>
      Number(n).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const date = String(bar.time).replaceAll('-', '/');
    tip.innerHTML = `<div class="chart-ohlc-date">${date}</div>
      <div class="chart-ohlc-row"><span>開</span><b>${px(bar.open)}</b></div>
      <div class="chart-ohlc-row"><span>高</span><b class="${cls}">${px(bar.high)}</b></div>
      <div class="chart-ohlc-row"><span>低</span><b class="${cls}">${px(bar.low)}</b></div>
      <div class="chart-ohlc-row"><span>收</span><b class="${cls}">${px(bar.close)}</b></div>
      <div class="chart-ohlc-row"><span>量</span><b>${lotsLabel(bar.volume)}</b></div>`;
  }

  function placeTip(time) {
    const tip = tipEl();
    const bar = view.byTime.get(time);
    if (!tip || !bar) return;
    fillTip(bar);
    tip.hidden = false;
  }

  function showEmpty(message) {
    destroy();
    if (!view.host) return;
    view.host.innerHTML = '';
    const note = document.createElement('div');
    note.className = 'chart-empty';
    note.textContent = message;
    view.host.appendChild(note);
    const tip = tipEl();
    if (tip) tip.hidden = true;
  }

  function linePoints(rows, key) {
    return rows
      .filter((row) => row[key] != null && Number.isFinite(Number(row[key])))
      .map((row) => ({ time: row.time, value: Number(row[key]) }));
  }

  function paint() {
    const host = view.host;
    if (!host) return null;
    const LW = window.LightweightCharts;
    const ranged = aggregateCandles(view.raw, view.range);
    // Daily keeps pipeline MA50/MA200 and fills MA100 from closes.
    // Weekly/monthly drop those daily averages and recompute on the aggregated closes.
    const maSource =
      view.range === 'D'
        ? ranged
        : ranged.map(({ date, open, high, low, close, volume }) => ({ date, open, high, low, close, volume }));
    const rows = attachMa(maSource).filter((c) =>
      [c.open, c.high, c.low, c.close].every((n) => Number.isFinite(Number(n)))
    );

    if (!rows.length) {
      showEmpty('無 K 線資料');
      return null;
    }
    if (!LW || typeof LW.createChart !== 'function') {
      showEmpty('K 線元件尚未載入');
      return null;
    }

    destroy();
    host.innerHTML = '';
    const width = Math.max(280, host.clientWidth || host.parentElement?.clientWidth || 360);
    const height = Math.max(280, host.clientHeight || 420);
    const chart = LW.createChart(host, {
      width,
      height,
      layout: {
        background: { color: '#f6f3ec' },
        textColor: '#6d675c',
        fontFamily: '"Noto Sans TC", "DM Sans", system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: 'rgba(40, 32, 16, 0.05)' },
        horzLines: { color: 'rgba(40, 32, 16, 0.06)' },
      },
      rightPriceScale: { borderColor: 'rgba(40, 32, 16, 0.08)' },
      timeScale: { borderColor: 'rgba(40, 32, 16, 0.08)', rightOffset: 3 },
      crosshair: { mode: LW.CrosshairMode ? LW.CrosshairMode.Normal : 0 },
      handleScroll: true,
      handleScale: true,
    });
    const candleSeries = chart.addCandlestickSeries({
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
    });
    const maStyle = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
    const ma50 = chart.addLineSeries({ ...maStyle, color: '#222222', lineWidth: 2 });
    const ma100 = chart.addLineSeries({ ...maStyle, color: '#7a756c', lineWidth: 2 });
    const ma200 = chart.addLineSeries({ ...maStyle, color: '#b7b1a6', lineWidth: 2 });
    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
    candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.28 } });

    const candleData = rows.map((c) => ({
      time: String(c.date).slice(0, 10),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    }));
    candleSeries.setData(candleData);
    volumeSeries.setData(
      rows.map((c) => ({
        time: String(c.date).slice(0, 10),
        value: Number(c.volume) || 0,
        color: Number(c.close) >= Number(c.open) ? 'rgba(210,59,59,0.45)' : 'rgba(31,138,76,0.45)',
      }))
    );
    const timed = rows.map((c) => ({ ...c, time: String(c.date).slice(0, 10) }));
    ma50.setData(linePoints(timed, 'ma50'));
    ma100.setData(linePoints(timed, 'ma100'));
    ma200.setData(linePoints(timed, 'ma200'));

    const pv = view.pivot != null && Number.isFinite(Number(view.pivot)) ? Number(view.pivot) : null;
    if (pv != null) {
      candleSeries.createPriceLine({
        price: pv,
        color: UP,
        lineWidth: 1,
        lineStyle: LW.LineStyle ? LW.LineStyle.Dashed : 2,
        axisLabelVisible: true,
        title: '樞紐',
      });
    }

    if (view.range === 'D' && view.annotations.length && LW) {
      const times = new Set(candleData.map((c) => c.time));
      const markers = view.annotations
        .filter((a) => a.date && times.has(String(a.date).slice(0, 10)))
        .map((a) => ({
          time: String(a.date).slice(0, 10),
          position: ANN_HIGH.has(a.type) ? 'aboveBar' : 'belowBar',
          color: '#8a8478',
          shape: ANN_HIGH.has(a.type) ? 'arrowDown' : 'arrowUp',
          text: labelFor(a.type),
        }));
      if (markers.length && candleSeries.setMarkers) candleSeries.setMarkers(markers);
    }

    view.chart = chart;
    view.series = candleSeries;
    view.byTime = new Map(
      timed.map((c) => [
        c.time,
        {
          time: c.time,
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close),
          volume: Number(c.volume) || 0,
        },
      ])
    );

    const last = candleData[candleData.length - 1];
    const prev = candleData.length > 1 ? candleData[candleData.length - 2] : null;
    if (candleData.length > 90) {
      chart.timeScale().setVisibleLogicalRange({ from: candleData.length - 90, to: candleData.length + 1 });
    } else {
      chart.timeScale().fitContent();
    }

    const showAt = (time) => placeTip(time);
    // Ignore the chart's own crosshair until the pointer is actually over the pane,
    // so the first tooltip stays on the latest candle (the quote in the header).
    let pointer = false;
    const arm = () => {
      pointer = true;
    };
    host.addEventListener('pointerdown', arm);
    host.addEventListener('pointermove', arm);
    chart.subscribeCrosshairMove((param) => {
      if (!pointer || !param || param.time == null || !param.point) return;
      showAt(param.time);
    });
    chart.subscribeClick((param) => {
      if (!param || param.time == null) return;
      pointer = true;
      showAt(param.time);
    });

    if (typeof ResizeObserver === 'function') {
      view.resize = new ResizeObserver(() => {
        if (!view.chart || !view.host) return;
        const w = view.host.clientWidth;
        const h = view.host.clientHeight;
        if (w > 0 && h > 0) view.chart.applyOptions({ width: w, height: h });
      });
      view.resize.observe(host);
    }

    requestAnimationFrame(() => {
      showAt(last.time);
      requestAnimationFrame(() => showAt(last.time));
    });

    const change = prev ? last.close - prev.close : 0;
    const changePct = prev && prev.close ? last.close / prev.close - 1 : 0;
    return {
      lastClose: last.close,
      prevClose: prev ? prev.close : null,
      change,
      changePct,
      lastDate: last.time,
      count: candleData.length,
    };
  }

  function resolveHost(canvasOrHost) {
    if (!canvasOrHost) return document.getElementById('chartHost');
    if (canvasOrHost.tagName === 'CANVAS') {
      return document.getElementById('chartHost') || canvasOrHost.parentElement;
    }
    return canvasOrHost;
  }

  function draw(canvasOrHost, ohlcv, pivot) {
    view.host = resolveHost(canvasOrHost);
    view.raw = (ohlcv && ohlcv.candles) || [];
    view.annotations = (ohlcv && ohlcv.annotations) || [];
    view.pivot = pivot != null && pivot !== '' ? Number(pivot) : null;
    return paint();
  }

  function setRange(range) {
    view.range = range === 'W' || range === 'M' ? range : 'D';
  }

  function redraw() {
    if (!view.host) return null;
    return paint();
  }

  return {
    draw,
    labelFor,
    setRange,
    redraw,
    sma,
    attachMa,
    aggregateCandles,
    lotsLabel,
  };
})();
