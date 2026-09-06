window.RS_CHART = (() => {
  function draw(canvas, ohlcv, pivot) {
    const parentW = canvas.parentElement?.clientWidth || 800;
    const cssW = Math.max(300, parentW);
    const cssH = 360;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const candles = (ohlcv.candles || []).slice(-120);
    ctx.fillStyle = '#0e2a32';
    ctx.fillRect(0, 0, cssW, cssH);
    if (!candles.length) {
      ctx.fillStyle = '#9fb4b0';
      ctx.font = '14px sans-serif';
      ctx.fillText('無 K 線資料', 16, 28);
      return;
    }

    const padL = 10;
    const padR = 54;
    const padT = 18;
    const padB = 28;
    const plotW = cssW - padL - padR;
    const plotH = cssH - padT - padB;
    let minY = Math.min(...candles.map((c) => Number(c.low)));
    let maxY = Math.max(...candles.map((c) => Number(c.high)));
    const pv = pivot != null && !Number.isNaN(Number(pivot)) ? Number(pivot) : null;
    // 樞紐離價格區間太遠(舊結構)時不拉伸 Y 軸,改在邊緣標註
    const pivotInRange = pv != null && pv >= minY * 0.85 && pv <= maxY * 1.15;
    if (pivotInRange) {
      minY = Math.min(minY, pv);
      maxY = Math.max(maxY, pv);
    }
    const span = maxY - minY || 1;
    minY -= span * 0.05;
    maxY += span * 0.05;
    const xAt = (i) => padL + ((i + 0.5) / candles.length) * plotW;
    const yAt = (v) => padT + ((maxY - v) / (maxY - minY)) * plotH;
    const candleW = Math.max(2, (plotW / candles.length) * 0.65);

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    for (let g = 0; g <= 4; g++) {
      const y = padT + (plotH * g) / 4;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(cssW - padR, y);
      ctx.stroke();
      const val = maxY - ((maxY - minY) * g) / 4;
      ctx.fillStyle = '#8aa3a0';
      ctx.font = '11px sans-serif';
      ctx.fillText(val.toFixed(1), cssW - padR + 6, y + 4);
    }

    const drawMa = (key, color) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.3;
      let started = false;
      candles.forEach((c, i) => {
        if (c[key] == null) return;
        const x = xAt(i);
        const y = yAt(Number(c[key]));
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      });
      if (started) ctx.stroke();
    };
    drawMa('ma50', '#f0a202');
    drawMa('ma150', '#c084fc');
    drawMa('ma200', '#2dd4bf');

    candles.forEach((c, i) => {
      const x = xAt(i);
      const o = Number(c.open);
      const h = Number(c.high);
      const l = Number(c.low);
      const cl = Number(c.close);
      const up = cl >= o;
      ctx.strokeStyle = up ? '#ef5350' : '#66bb6a';
      ctx.fillStyle = up ? '#ef5350' : '#66bb6a';
      ctx.beginPath();
      ctx.moveTo(x, yAt(h));
      ctx.lineTo(x, yAt(l));
      ctx.stroke();
      const y1 = yAt(Math.max(o, cl));
      const y2 = yAt(Math.min(o, cl));
      ctx.fillRect(x - candleW / 2, y1, candleW, Math.max(1, y2 - y1));
    });

    if (pv != null) {
      ctx.save();
      ctx.fillStyle = '#ff8a80';
      ctx.font = '11px sans-serif';
      if (pivotInRange) {
        const y = yAt(pv);
        ctx.strokeStyle = '#ff8a80';
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(cssW - padR, y);
        ctx.stroke();
        ctx.fillText(`pivot ${pv}`, padL + 4, y - 6);
      } else {
        const above = pv > maxY;
        const y = above ? padT + 12 : padT + plotH - 6;
        ctx.fillText(`pivot ${pv}（${above ? '高於' : '低於'}圖表範圍）`, padL + 4, y);
      }
      ctx.restore();
    }

    ctx.fillStyle = '#8aa3a0';
    ctx.font = '11px sans-serif';
    [0, Math.floor(candles.length / 2), candles.length - 1].forEach((i) => {
      ctx.fillText(String(candles[i].date).slice(5), xAt(i) - 14, cssH - 8);
    });
  }

  return { draw };
})();
