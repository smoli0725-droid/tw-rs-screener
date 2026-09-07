# -*- coding: utf-8 -*-
"""
突破交易帳本與市況判定
======================
每日把「近期突破 pivot」的型態記成一筆交易,之後逐日追蹤:

* 成功:突破後收盤 ≥ pivot × (1 + success_pct)
* 失敗:突破後收盤 ≤ pivot × (1 - fail_pct)
* 復甦:失敗後收盤回到 pivot 下方 0~near_pivot_pct → 重新列入「即將突破」;
  若再收過 pivot 則開一筆新交易。

市況 = 近 `window_days` 個交易日內,以「判定日」計的成功 ÷ (成功 + 失敗)。
勝率 < 50% 視為市況不佳。仍在追蹤中的不計入分母,另列「進行中」。

帳本存成 JSON(預設 output/app/breakouts_ledger.json),由每日 Actions commit。
pivot 在突破當天凍結,不受之後型態重算影響。
"""
from __future__ import annotations

import datetime as dt
import json
import os
from typing import Any

import pandas as pd

from pattern_screener import PARAMS, PatternParams, STATUS_BROKE, STATUS_EXTENDED

LEDGER_VERSION = 1
WINDOW_DAYS = 10             # 近兩週 = 10 個交易日
RECOVER_MAX_BARS = 60        # 失敗超過 N 根不再考慮復甦
KEEP_TRADES = 600
KEEP_HISTORY = 250

TRADE_ACTIVE = "active"
TRADE_SUCCESS = "success"
TRADE_FAILED = "failed"
TRADE_RECOVERED = "recovered"
TRADE_REENTERED = "reentered"

MARKET_GOOD = "市況良好"
MARKET_NEUTRAL = "市況中性"
MARKET_BAD = "市況不佳"
MARKET_NA = "樣本不足"


def empty_ledger() -> dict:
    return {"version": LEDGER_VERSION, "trades": [], "history": []}


def load_ledger(path: str) -> dict:
    if not os.path.exists(path):
        return empty_ledger()
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict) or "trades" not in data:
            return empty_ledger()
        data.setdefault("history", [])
        data.setdefault("version", LEDGER_VERSION)
        return data
    except Exception:
        return empty_ledger()


def save_ledger(ledger: dict, path: str) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(ledger, f, ensure_ascii=False, indent=1)


# ---------------------------------------------------------------- helpers
def _date_str(ts) -> str:
    return ts.date().isoformat() if hasattr(ts, "date") else str(ts)[:10]


def _series_for(close_df: pd.DataFrame, yf_ticker: str) -> pd.Series | None:
    if yf_ticker not in close_df.columns:
        return None
    s = close_df[yf_ticker].dropna()
    return s if len(s) else None


def _bars_after(s: pd.Series, date_str: str) -> pd.Series:
    """回傳日期 > date_str 的收盤。"""
    dates = [_date_str(x) for x in s.index]
    keep = [i for i, d in enumerate(dates) if d > date_str]
    return s.iloc[keep] if keep else s.iloc[0:0]


def _trade_id(sid: str, breakout_date: str, pivot: float) -> str:
    return f"{sid}-{breakout_date}-{pivot:g}"


def _evaluate(trade: dict, s: pd.Series, p: PatternParams) -> None:
    """逐日檢查 active 交易是否成功/失敗;順帶更新最高/最低收盤與 last_date。"""
    pivot = float(trade["pivot"])
    up = pivot * (1 + p.success_pct / 100)
    dn = pivot * (1 - p.fail_pct / 100)
    for ts, px in _bars_after(s, trade["last_date"]).items():
        px = float(px)
        d = _date_str(ts)
        trade["peak_close"] = max(trade.get("peak_close") or px, px)
        trade["trough_close"] = min(trade.get("trough_close") or px, px)
        trade["last_date"] = d
        trade["last_close"] = px
        if px >= up:
            trade["status"] = TRADE_SUCCESS
            trade["outcome"] = TRADE_SUCCESS
            trade["outcome_date"] = d
            trade["outcome_close"] = px
            trade["outcome_pct"] = round((px / pivot - 1) * 100, 2)
            return
        if px <= dn:
            trade["status"] = TRADE_FAILED
            trade["outcome"] = TRADE_FAILED
            trade["outcome_date"] = d
            trade["outcome_close"] = px
            trade["outcome_pct"] = round((px / pivot - 1) * 100, 2)
            return


def _bars_since(s: pd.Series, date_str: str) -> int:
    return len(_bars_after(s, date_str))


# ---------------------------------------------------------------- core
def update_ledger(ledger: dict, hits: list[dict], close_df: pd.DataFrame,
                  data_date: str, p: PatternParams = PARAMS,
                  first_run_lookback: int = 30) -> dict:
    """以今日型態命中 + 收盤資料更新帳本(就地修改並回傳)。

    hits: screen_patterns 的輸出(含 代號/名稱/市場/yf_ticker/pivot/status/breakout_date/primary)。
    close_df: 收盤 DataFrame(columns=yf_ticker)。
    """
    trades: list[dict] = ledger.setdefault("trades", [])
    first_run = not trades

    # 1) 更新進行中的交易
    for t in trades:
        if t.get("status") != TRADE_ACTIVE:
            continue
        s = _series_for(close_df, t.get("yf_ticker", ""))
        if s is None:
            continue
        _evaluate(t, s, p)

    # 2) 失敗 → 復甦 / 再突破
    new_trades: list[dict] = []
    for t in trades:
        if t.get("status") not in (TRADE_FAILED, TRADE_RECOVERED):
            continue
        s = _series_for(close_df, t.get("yf_ticker", ""))
        if s is None or not t.get("outcome_date"):
            continue
        if _bars_since(s, t["outcome_date"]) > RECOVER_MAX_BARS:
            continue
        pivot = float(t["pivot"])
        last = float(s.iloc[-1])
        t["last_date"] = _date_str(s.index[-1])
        t["last_close"] = last
        if last >= pivot:
            # 再突破 → 開新交易,舊交易標記 reentered
            already = any(x["id"] == t["id"] and x["status"] == TRADE_ACTIVE for x in trades + new_trades)
            if not already:
                nt = _open_trade(t, s, pivot, data_date, p, origin="recovered")
                if nt:
                    new_trades.append(nt)
            t["status"] = TRADE_REENTERED
        elif last >= pivot * (1 - p.near_pivot_pct / 100):
            t["status"] = TRADE_RECOVERED
        else:
            t["status"] = TRADE_FAILED
    trades.extend(new_trades)

    # 3) 今日新突破(只用每檔的主要型態)
    window = first_run_lookback if first_run else p.breakout_window_bars
    for hit in hits:
        if not hit.get("primary", True):
            continue
        if hit.get("status") not in (STATUS_BROKE, STATUS_EXTENDED):
            continue
        sid = str(hit.get("代號") or hit.get("id"))
        yf = hit.get("yf_ticker") or ""
        s = _series_for(close_df, yf)
        if s is None:
            continue
        pivot = float(hit["pivot"])
        bi = _find_cross(s, pivot, window)
        if bi is None:
            continue
        bdate = _date_str(s.index[bi])
        if any(x["id"] == sid and x["status"] == TRADE_ACTIVE for x in trades):
            continue
        if any(x["id"] == sid and x.get("breakout_date") == bdate for x in trades):
            continue
        meta = {
            "id": sid,
            "name": hit.get("名稱") or hit.get("name"),
            "market": hit.get("市場") or hit.get("market"),
            "pattern": hit.get("pattern"),
            "pattern_label": hit.get("pattern_label"),
            "yf_ticker": yf,
            "rs": hit.get("RS") or hit.get("rs"),
        }
        nt = _open_trade(meta, s, pivot, bdate, p, origin="pattern", breakout_idx=bi)
        if nt:
            trades.append(nt)

    # 4) 修剪
    trades.sort(key=lambda x: (x.get("breakout_date") or "", x["id"]))
    if len(trades) > KEEP_TRADES:
        del trades[: len(trades) - KEEP_TRADES]

    # 5) 市況統計與歷史
    stats = market_stats(ledger, close_df, data_date, p)
    hist = ledger.setdefault("history", [])
    hist[:] = [x for x in hist if x.get("date") != data_date]
    hist.append({"date": data_date, **{k: stats[k] for k in
                                       ("wins", "losses", "pending", "win_rate", "label")}})
    hist.sort(key=lambda x: x["date"])
    if len(hist) > KEEP_HISTORY:
        del hist[: len(hist) - KEEP_HISTORY]
    ledger["updated"] = data_date
    ledger["market"] = stats
    return ledger


def _find_cross(s: pd.Series, pivot: float, window: int) -> int | None:
    n = len(s)
    lo = max(1, n - window)
    for i in range(n - 1, lo - 1, -1):
        if float(s.iloc[i]) >= pivot and float(s.iloc[i - 1]) < pivot:
            return i
    return None


def _open_trade(meta: dict, s: pd.Series, pivot: float, breakout_date: str,
                p: PatternParams, origin: str, breakout_idx: int | None = None) -> dict | None:
    if breakout_idx is None:
        dates = [_date_str(x) for x in s.index]
        if breakout_date not in dates:
            return None
        breakout_idx = dates.index(breakout_date)
    px = float(s.iloc[breakout_idx])
    t = {
        "trade_id": _trade_id(meta["id"], breakout_date, pivot),
        "id": meta["id"],
        "name": meta.get("name"),
        "market": meta.get("market"),
        "pattern": meta.get("pattern"),
        "pattern_label": meta.get("pattern_label"),
        "yf_ticker": meta.get("yf_ticker"),
        "rs": meta.get("rs"),
        "pivot": round(pivot, 2),
        "breakout_date": breakout_date,
        "breakout_close": px,
        "origin": origin,
        "status": TRADE_ACTIVE,
        "outcome": None,
        "outcome_date": None,
        "outcome_close": None,
        "outcome_pct": None,
        "peak_close": px,
        "trough_close": px,
        "last_date": breakout_date,
        "last_close": px,
    }
    _evaluate(t, s, p)
    return t


def _window_dates(close_df: pd.DataFrame, data_date: str, days: int) -> set[str]:
    dates = sorted({_date_str(x) for x in close_df.index if _date_str(x) <= data_date})
    return set(dates[-days:])


def market_stats(ledger: dict, close_df: pd.DataFrame, data_date: str,
                 p: PatternParams = PARAMS, days: int = WINDOW_DAYS) -> dict:
    win_dates = _window_dates(close_df, data_date, days)
    trades = ledger.get("trades", [])
    wins = sum(1 for t in trades if t.get("outcome") == TRADE_SUCCESS and t.get("outcome_date") in win_dates)
    losses = sum(1 for t in trades if t.get("outcome") == TRADE_FAILED and t.get("outcome_date") in win_dates)
    pending = sum(1 for t in trades if t.get("status") == TRADE_ACTIVE)
    recovered = sum(1 for t in trades if t.get("status") == TRADE_RECOVERED)
    total = wins + losses
    win_rate = round(wins / total, 3) if total else None
    if win_rate is None:
        label = MARKET_NA
    elif win_rate >= 0.6:
        label = MARKET_GOOD
    elif win_rate >= 0.5:
        label = MARKET_NEUTRAL
    else:
        label = MARKET_BAD
    return {
        "as_of": data_date,
        "window_days": days,
        "window_start": min(win_dates) if win_dates else None,
        "wins": wins,
        "losses": losses,
        "pending": pending,
        "recovered": recovered,
        "win_rate": win_rate,
        "label": label,
        "rules": {
            "buy_zone_pct": p.buy_zone_pct,
            "success_pct": p.success_pct,
            "fail_pct": p.fail_pct,
            "near_pivot_pct": p.near_pivot_pct,
        },
    }


def recovered_candidates(ledger: dict) -> list[dict]:
    """目前處於「復甦」狀態的交易 → 可注入即將突破清單。"""
    return [t for t in ledger.get("trades", []) if t.get("status") == TRADE_RECOVERED]


def recent_trades(ledger: dict, close_df: pd.DataFrame | None = None,
                  data_date: str | None = None, days: int = WINDOW_DAYS,
                  limit: int = 80) -> list[dict]:
    """給前端的近期交易(新到舊)。

    成功／失敗只列判定日落在市況視窗(近 `days` 個交易日)內的;
    進行中／復甦／再突破不裁。帳本本身不刪歷史。
    """
    trades = list(ledger.get("trades", []))
    if close_df is not None and data_date:
        win_dates = _window_dates(close_df, data_date, days)
        keep = []
        for t in trades:
            st = t.get("status")
            if st in (TRADE_SUCCESS, TRADE_FAILED):
                if t.get("outcome_date") in win_dates:
                    keep.append(t)
            else:
                keep.append(t)
        trades = keep
    trades = sorted(trades,
                    key=lambda t: (t.get("outcome_date") or t.get("last_date") or "", t.get("breakout_date") or ""),
                    reverse=True)
    keys = ("trade_id", "id", "name", "market", "pattern", "pattern_label", "rs", "pivot",
            "breakout_date", "breakout_close", "status", "outcome", "outcome_date", "outcome_close",
            "outcome_pct", "peak_close", "trough_close", "last_date", "last_close", "origin")
    return [{k: t.get(k) for k in keys} for t in trades[:limit]]
