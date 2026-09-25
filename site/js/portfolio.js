window.RS_PORTFOLIO = (() => {
  function calendarDate(value) {
    return String(value ?? '').slice(0, 10);
  }

  function orderedTrades(trades) {
    return trades
      .map((trade, index) => ({ trade, index }))
      .sort((a, b) => {
        const byDate = calendarDate(a.trade.date).localeCompare(calendarDate(b.trade.date));
        if (byDate) return byDate;
        const bySide = ((a.trade.side || 'buy') === 'buy' ? 0 : 1) - ((b.trade.side || 'buy') === 'buy' ? 0 : 1);
        if (bySide) return bySide;
        return a.index - b.index;
      })
      .map((row) => row.trade);
  }

  function walkJournal(trades) {
    const lots = {};
    const buys = {};
    const closed = [];
    for (const t of orderedTrades(trades)) {
      const sym = String(t.symbol);
      const lot = (lots[sym] ??= {
        symbol: sym,
        name: t.name || sym,
        market: t.market || '上市',
        shares: 0,
        cost: 0,
      });
      const shares = Number(t.shares);
      const price = Number(t.price);
      if ((t.side || 'buy') === 'buy') {
        const next = lot.shares + shares;
        lot.cost = next > 0 ? (lot.cost * lot.shares + price * shares) / next : 0;
        lot.shares = next;
        lot.name = t.name || lot.name;
        lot.market = t.market || lot.market;
        (buys[sym] ??= []).push({ shares, price, date: t.date });
      } else {
        lot.shares = Math.max(0, lot.shares - shares);
        if (!lot.shares) lot.cost = 0;
        let remain = shares;
        const q = buys[sym] || [];
        while (remain > 0 && q.length) {
          const open = q[0];
          const matched = Math.min(remain, open.shares);
          closed.push({
            trade: t,
            shares: matched,
            sellDate: t.date,
            returnPct: open.price ? price / open.price - 1 : 0,
            pnl: (price - open.price) * matched,
            cost: open.price * matched,
          });
          open.shares -= matched;
          remain -= matched;
          if (open.shares <= 0) q.shift();
        }
      }
    }
    return { lots, closed };
  }

  function matchedSellShares(trades, candidate) {
    const sell = { ...candidate, side: 'sell' };
    const { closed } = walkJournal([...trades, sell]);
    let matched = 0;
    for (const row of closed) {
      if (row.trade === sell) matched += row.shares;
    }
    return matched;
  }

  function buildPositions(trades, priceMap = {}) {
    const { lots } = walkJournal(trades);
    return Object.values(lots)
      .filter((p) => p.shares > 0)
      .map((p) => {
        const lastPrice = priceMap[p.symbol];
        const px = lastPrice != null ? lastPrice : p.cost;
        const marketValue = px * p.shares;
        const costValue = p.cost * p.shares;
        return {
          ...p,
          lastPrice,
          marketValue,
          costValue,
          pnl: marketValue - costValue,
          returnPct: p.cost ? px / p.cost - 1 : 0,
        };
      })
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  function taipeiYearMonth(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(date);
    const year = parts.find((p) => p.type === 'year').value;
    const month = parts.find((p) => p.type === 'month').value;
    return `${year}-${month}`;
  }

  // Closed lots come only from the trades argument (the user journal).
  // The system breakout ledger is never read here.
  function computeMetrics(trades, positions, now = new Date()) {
    const { closed } = walkJournal(trades);

    const winners = closed.filter((c) => c.pnl > 0);
    let winRate = null;
    let avgReturnPct = null;
    let winningAvgReturnPct = null;
    if (closed.length) {
      winRate = winners.length / closed.length;
      avgReturnPct = closed.reduce((s, c) => s + c.returnPct, 0) / closed.length;
    }
    if (winners.length) {
      winningAvgReturnPct = winners.reduce((s, c) => s + c.returnPct, 0) / winners.length;
    }

    const avgOpenReturnPct = positions.length
      ? positions.reduce((s, p) => s + p.returnPct, 0) / positions.length
      : null;

    const monthlyMap = {};
    for (const c of closed) {
      const key = String(c.sellDate).slice(0, 7);
      const row = (monthlyMap[key] ??= { pnl: 0, cost: 0 });
      row.pnl += c.pnl;
      row.cost += c.cost;
    }
    const monthly = Object.keys(monthlyMap)
      .sort()
      .map((yearMonth) => {
        const { pnl, cost } = monthlyMap[yearMonth];
        return {
          yearMonth,
          pnl,
          cost,
          returnPct: cost > 0 ? pnl / cost : null,
        };
      });

    const unrealizedPnl = positions.reduce((s, p) => s + p.pnl, 0);
    const openCost = positions.reduce((s, p) => s + p.costValue, 0);
    const unrealizedReturnPct = openCost > 0 ? unrealizedPnl / openCost : null;

    const monthKey = taipeiYearMonth(now instanceof Date ? now : new Date(now));
    const monthRow = monthly.find((row) => row.yearMonth === monthKey) || null;
    let accPnl = 0;
    const realizedCurve = closed.map((c) => {
      accPnl += c.pnl;
      return { date: String(c.sellDate).slice(0, 10), pnl: accPnl };
    });

    return {
      winRate,
      avgReturnPct,
      winningAvgReturnPct,
      winningCount: winners.length,
      avgOpenReturnPct,
      closedCount: closed.length,
      openCount: positions.length,
      monthly,
      monthKey,
      monthReturnPct: monthRow ? monthRow.returnPct : null,
      monthPnl: monthRow ? monthRow.pnl : null,
      realizedCurve,
      unrealizedPnl,
      openCost,
      unrealizedReturnPct,
    };
  }

  return { buildPositions, computeMetrics, matchedSellShares };
})();
