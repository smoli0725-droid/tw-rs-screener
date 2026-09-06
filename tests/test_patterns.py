# -*- coding: utf-8 -*-
"""型態偵測與 App JSON 匯出測試。"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pattern_screener import (
    STATUS_NEAR,
    zigzag,
    detect_vcp,
    detect_double_bottom,
    detect_high_tight_flag,
    detect_cheat,
    detect_cup_with_handle,
    classify_status,
    find_breakout_idx,
    mark_primary,
    screen_patterns,
    PatternParams,
)
from breakout_tracker import (
    empty_ledger,
    update_ledger,
    market_stats,
    recovered_candidates,
    TRADE_ACTIVE,
    TRADE_SUCCESS,
    TRADE_FAILED,
    TRADE_RECOVERED,
)
from export_app_json import export_app_json
from rs_calculator import (
    check_freshness,
    compute_rs,
    compute_template,
    export,
    make_synthetic,
    is_likely_trading_day,
)


def _dates(n: int, end=None):
    end = end or dt.date.today()
    return pd.bdate_range(end=end, periods=n)


def _ohlc_from_close(close: pd.Series, vol_base: int = 100_000):
    noise = 0.01
    o = close * (1 + np.random.default_rng(0).uniform(-0.005, 0.005, len(close)))
    h = close * (1 + noise)
    l = close * (1 - noise)
    # 確保 high >= close >= low
    h = pd.concat([h, close], axis=1).max(axis=1)
    l = pd.concat([l, close], axis=1).min(axis=1)
    v = pd.Series(vol_base, index=close.index, dtype=float)
    return o, h, l, close, v


def make_vcp_series(n: int = 200):
    """合成明顯 VCP:高點後三段回檔 24%→12%→6%,量能遞減。"""
    dates = _dates(n)
    px = np.full(n, 100.0)
    # 先上漲到 100
    for i in range(40):
        px[i] = 60 + i
    # 基底高點(結構放在尾端前 ~110 根,確保在型態時效內)
    base = max(40, n - 100)
    px[base] = 100
    # leg1: 回檔 24% → 76, 再反彈到 98
    for i, p in enumerate(np.linspace(100, 76, 10)):
        px[base + 1 + i] = p
    for i, p in enumerate(np.linspace(76, 98, 10)):
        px[base + 11 + i] = p
    # leg2: 回檔 12% → 86.2, 反彈到 97
    for i, p in enumerate(np.linspace(98, 86.24, 8)):
        px[base + 21 + i] = p
    for i, p in enumerate(np.linspace(86.24, 97, 8)):
        px[base + 29 + i] = p
    # leg3: 回檔 6% → 91.2, 反彈到 96(接近 pivot)
    for i, p in enumerate(np.linspace(97, 91.18, 6)):
        px[base + 37 + i] = p
    for i, p in enumerate(np.linspace(91.18, 96.0, 8)):
        px[base + 43 + i] = p
    # 其餘填平
    last = base + 51
    px[last:] = 96.0
    close = pd.Series(px, index=dates)
    o, h, l, c, v = _ohlc_from_close(close)
    # 量能萎縮
    v.iloc[:] = 200_000
    v.iloc[-30:] = 80_000
    # 高低點對齊回檔極端值
    for i in range(n):
        h.iloc[i] = max(h.iloc[i], c.iloc[i])
        l.iloc[i] = min(l.iloc[i], c.iloc[i])
    return o, h, l, c, v


def make_flag_series(n: int = 200):
    """急漲 100%+ 後狹幅整理(旗形貼近序列末端)。"""
    dates = _dates(n)
    px = np.full(n, 50.0)
    # 前段橫盤在 50
    thrust_start = n - 50
    px[:thrust_start] = 50.0
    # 急漲:50 → 120 (約 7 週)
    for i, p in enumerate(np.linspace(50, 120, 32)):
        px[thrust_start + i] = p
    # 旗形:120 附近 ±3% 整理至結尾
    flag_start = thrust_start + 32
    for i in range(n - flag_start):
        px[flag_start + i] = 118 + (2.5 if i % 2 == 0 else -1.5)
    close = pd.Series(px, index=dates)
    return _ohlc_from_close(close, vol_base=150_000)


def make_double_bottom_series(n: int = 200):
    """W 底:兩個相近低點,中間反彈,右側緊縮。"""
    dates = _dates(n)
    px = np.full(n, 80.0)
    s0 = n - 110  # 結構起點,確保在型態時效內
    for i in range(s0):
        px[i] = 70 + i * (18 / max(s0, 1))  # 上漲到 88
    # 第一低
    for i, p in enumerate(np.linspace(88, 60, 15)):
        px[s0 + i] = p
    # 反彈到 75
    for i, p in enumerate(np.linspace(60, 75, 12)):
        px[s0 + 15 + i] = p
    # 第二低(略破)
    for i, p in enumerate(np.linspace(75, 58, 12)):
        px[s0 + 27 + i] = p
    # 右側緊縮區在 70 附近
    for i in range(20):
        px[s0 + 39 + i] = 70 + (1.5 if i % 2 == 0 else -1.0)
    px[s0 + 59:] = 71
    close = pd.Series(px, index=dates)
    o, h, l, c, v = _ohlc_from_close(close)
    v.iloc[-25:] = 50_000
    return o, h, l, c, v


# ---------------------------------------------------------------- tests
def test_zigzag_finds_swings():
    o, h, l, c, v = make_vcp_series()
    pivots = zigzag(h, l, c, pct=0.05)
    assert len(pivots) >= 4
    kinds = [p["kind"] for p in pivots]
    assert "H" in kinds and "L" in kinds


def test_classify_status_near_breakout():
    assert classify_status(97, 100, 0.5, 50_000, 100_000) == STATUS_NEAR
    assert classify_status(101, 100, 0.5, 200_000, 100_000) == "已突破"
    assert classify_status(107, 100, 0.5, 200_000, 100_000) == "已延伸"
    assert classify_status(90, 100, 0.5, 50_000, 100_000) == "整理中"


def test_classify_status_breakout_window():
    """收盤站上 pivot 的日子若早於時效,即使距離在 5% 內也視為已延伸。"""
    dates = _dates(40)
    # 前 20 天在 95,之後 20 天在 103(突破發生在 20 天前)
    px = np.array([95.0] * 20 + [103.0] * 20)
    s = pd.Series(px, index=dates)
    assert classify_status(s, 100, 0.5, 1, 1) == "已延伸"
    # 3 天前才突破 → 已突破
    px2 = np.array([95.0] * 37 + [103.0] * 3)
    s2 = pd.Series(px2, index=dates)
    assert classify_status(s2, 100, 0.5, 1, 1) == "已突破"
    assert find_breakout_idx(s2, 100, 10) == 37


def test_zigzag_trailing_not_confirmed():
    o, h, l, c, v = make_vcp_series()
    confirmed = zigzag(h, l, c, pct=0.05)
    with_trail = zigzag(h, l, c, pct=0.05, include_trailing=True)
    assert all(p["confirmed"] for p in confirmed)
    assert len(with_trail) >= len(confirmed)
    if len(with_trail) > len(confirmed):
        assert with_trail[-1]["confirmed"] is False


def test_vcp_pivot_is_last_contraction_high_not_running_high():
    """突破後續漲時,pivot 不可跟著最新高點(引線)跑。"""
    o, h, l, c, v = make_vcp_series()
    p = PatternParams(zigzag_pct=0.04, vcp_shrink_lo=0.30, vcp_shrink_hi=0.85,
                      vcp_last_max_pct=12.0)
    hit = detect_vcp(o, h, l, c, v, p)
    assert hit is not None
    base_pivot = hit["pivot"]
    # 最後 3 天突破並拉出更高引線
    c2, h2, l2, o2 = c.copy(), h.copy(), l.copy(), o.copy()
    for k, px in zip(range(-3, 0), (101.0, 104.0, 103.0)):
        c2.iloc[k] = px
        o2.iloc[k] = px - 1
        h2.iloc[k] = px + 4   # 引線
        l2.iloc[k] = px - 2
    hit2 = detect_vcp(o2, h2, l2, c2, v, p)
    assert hit2 is not None
    assert hit2["pivot"] == base_pivot
    assert hit2["status"] in ("已突破", "已延伸")
    assert hit2["breakout_date"] is not None


def test_stale_pattern_is_dropped():
    """結構點太舊(超過 recent_bars)的型態不應輸出。"""
    o, h, l, c, v = make_vcp_series(200)
    p = PatternParams(zigzag_pct=0.04, vcp_shrink_lo=0.30, vcp_shrink_hi=0.85,
                      vcp_last_max_pct=12.0, recent_bars=60)
    assert detect_vcp(o, h, l, c, v, p) is not None
    # 在尾端再接 80 根橫盤 → 最後結構點已超過 60 根
    extra = 80
    idx = pd.bdate_range(start=c.index[-1] + pd.Timedelta(days=1), periods=extra)
    def _ext(s, val=None):
        tail = pd.Series([val if val is not None else float(s.iloc[-1])] * extra, index=idx)
        return pd.concat([s, tail])
    hit = detect_vcp(_ext(o), _ext(h), _ext(l), _ext(c), _ext(v, 80_000), p)
    assert hit is None


def test_detect_vcp():
    o, h, l, c, v = make_vcp_series()
    # 放寬參數以配合合成資料
    p = PatternParams(
        zigzag_pct=0.04,
        vcp_shrink_lo=0.30,
        vcp_shrink_hi=0.85,
        vcp_last_max_pct=12.0,
    )
    hit = detect_vcp(o, h, l, c, v, p)
    assert hit is not None, "應偵測到 VCP"
    assert hit["pattern"] == "VCP"
    assert hit["legs"] >= 2
    assert hit["pivot"] > 0
    assert "contraction" in hit


def test_detect_high_tight_flag():
    o, h, l, c, v = make_flag_series()
    p = PatternParams(flag_prior_gain=0.9, flag_range_pct=0.12, flag_max_retrace=0.30)
    hit = detect_high_tight_flag(o, h, l, c, v, p)
    assert hit is not None, "應偵測到高聳旗形"
    assert hit["pattern"] == "高聳旗形"
    assert hit["pivot"] > 0
    assert hit["detail"]["prior_gain_pct"] >= 90


def test_detect_double_bottom():
    o, h, l, c, v = make_double_bottom_series()
    p = PatternParams(zigzag_pct=0.05, db_min_weeks=2, cheat_pause_range_pct=12.0)
    hit = detect_double_bottom(o, h, l, c, v, p)
    assert hit is not None, "應偵測到雙重底"
    assert hit["pattern"] == "雙重底"
    assert hit["pivot"] > 0


def test_mark_primary_prefers_newest_structure():
    hits = [
        {"pattern": "雙重底", "status": "已延伸", "score": 90, "structure_date": "2026-05-01"},
        {"pattern": "VCP", "status": "即將突破", "score": 70, "structure_date": "2026-09-03"},
        {"pattern": "杯狀帶柄", "status": "已突破", "score": 80, "structure_date": "2026-09-03"},
    ]
    mark_primary(hits)
    prim = [h["pattern"] for h in hits if h["primary"]]
    # 最新結構同日 → 狀態優先(即將突破 > 已突破)
    assert prim == ["VCP"]
    hits2 = [
        {"pattern": "雙重底", "status": "已突破", "score": 60, "structure_date": "2026-09-04"},
        {"pattern": "高聳旗形", "status": "即將突破", "score": 99, "structure_date": "2026-08-01"},
    ]
    mark_primary(hits2)
    assert [h["pattern"] for h in hits2 if h["primary"]] == ["雙重底"]


def test_export_drops_extended_rows(tmp_path):
    ohlcv, close, volume, twii, uni = make_synthetic()
    result = compute_rs(close)
    template = compute_template(close[result.index.tolist()], volume, twii, result["RS"])
    ranking = export(result, template, uni, data_date=close.index[-1].date(),
                     outdir=str(tmp_path / "o"))
    row = ranking.iloc[0]
    yf = [c for c in ohlcv["Close"].columns if str(c).startswith(str(row["代號"]))][0]
    base = {"代號": str(row["代號"]), "名稱": row["名稱"], "市場": "上市", "產業": "測試",
            "RS": int(row["RS"]), "收盤價": 100.0, "通過樣板": "✔", "距50MA%": 1.0,
            "yf_ticker": yf, "score": 50, "annotations": [], "detail": {}}
    patterns = [
        {**base, "pattern": "VCP", "pattern_label": "VCP", "pivot": 100.0, "dist_pivot_pct": -2.0,
         "status": "即將突破", "primary": True},
        {**base, "pattern": "雙重底", "pattern_label": "雙重底", "pivot": 80.0, "dist_pivot_pct": 25.0,
         "status": "已延伸", "primary": False},
    ]
    fresh = {"data_date": "2026-09-04", "is_fresh": True, "is_trading_day": True,
             "source_checked_at": "x", "message": "ok", "twse_cross_check": None}
    export_app_json(ranking, patterns, ohlcv, fresh, outdir=str(tmp_path / "app"))
    with open(tmp_path / "app" / "patterns.json") as f:
        rows = json.load(f)
    assert [r["status"] for r in rows] == ["即將突破"]


# ---------------------------------------------------------------- breakout tracker
def _close_df(prices: list[float], ticker: str = "1111.TW") -> pd.DataFrame:
    # 固定起點:加一天資料 = 往後延一天(模擬每日累積)
    idx = pd.bdate_range(start="2026-01-05", periods=len(prices))
    return pd.DataFrame({ticker: prices}, index=idx)


def _hit(ticker="1111.TW", pivot=100.0, status="已突破"):
    return {"代號": "1111", "名稱": "測試", "市場": "上市", "yf_ticker": ticker,
            "pattern": "VCP", "pattern_label": "VCP 波動收縮", "RS": 95,
            "pivot": pivot, "status": status, "primary": True}


def test_tracker_opens_trade_and_marks_success():
    # 前 15 天 95,昨天突破 101,今天 111(≥ +10%) → 成功
    prices = [95.0] * 15 + [101.0, 111.0]
    df = _close_df(prices)
    d = df.index[-1].date().isoformat()
    ledger = empty_ledger()
    update_ledger(ledger, [_hit()], df, d)
    assert len(ledger["trades"]) == 1
    t = ledger["trades"][0]
    assert t["breakout_date"] == df.index[-2].date().isoformat()
    assert t["status"] == TRADE_SUCCESS
    assert t["outcome_date"] == d
    m = ledger["market"]
    assert m["wins"] == 1 and m["losses"] == 0 and m["win_rate"] == 1.0


def test_tracker_failure_then_recovery_then_reentry():
    ledger = empty_ledger()
    # Day A:突破
    prices = [95.0] * 15 + [101.0]
    df = _close_df(prices)
    update_ledger(ledger, [_hit()], df, df.index[-1].date().isoformat())
    assert ledger["trades"][0]["status"] == TRADE_ACTIVE

    # Day B:跌到 94(≤ pivot×0.95)→ 失敗;今日型態不再命中
    prices2 = prices + [94.0]
    df2 = _close_df(prices2)
    update_ledger(ledger, [], df2, df2.index[-1].date().isoformat())
    t = ledger["trades"][0]
    assert t["status"] == TRADE_FAILED and t["outcome"] == TRADE_FAILED
    assert ledger["market"]["losses"] == 1 and ledger["market"]["win_rate"] == 0.0
    assert ledger["market"]["label"] == "市況不佳"

    # Day C:回到 97(pivot 下方 3%)→ 復甦
    prices3 = prices2 + [97.0]
    df3 = _close_df(prices3)
    update_ledger(ledger, [], df3, df3.index[-1].date().isoformat())
    assert ledger["trades"][0]["status"] == TRADE_RECOVERED
    assert len(recovered_candidates(ledger)) == 1

    # Day D:再收過 pivot → 開新交易,舊的標記 reentered
    prices4 = prices3 + [102.0]
    df4 = _close_df(prices4)
    update_ledger(ledger, [], df4, df4.index[-1].date().isoformat())
    statuses = sorted(t["status"] for t in ledger["trades"])
    assert statuses == ["active", "reentered"]
    new = [t for t in ledger["trades"] if t["status"] == TRADE_ACTIVE][0]
    assert new["origin"] == "recovered"
    assert new["pivot"] == 100.0


def test_tracker_ignores_non_primary_and_no_duplicate():
    prices = [95.0] * 15 + [101.0]
    df = _close_df(prices)
    d = df.index[-1].date().isoformat()
    ledger = empty_ledger()
    hits = [_hit(), {**_hit(pivot=90.0), "primary": False}]
    update_ledger(ledger, hits, df, d)
    assert len(ledger["trades"]) == 1
    # 同一天再跑一次不重複開單
    update_ledger(ledger, hits, df, d)
    assert len(ledger["trades"]) == 1


def test_market_stats_window_by_outcome_date():
    ledger = empty_ledger()
    df = _close_df([100.0] * 30)
    dates = [x.date().isoformat() for x in df.index]
    ledger["trades"] = [
        {"id": "a", "outcome": TRADE_SUCCESS, "outcome_date": dates[-1], "status": TRADE_SUCCESS},
        {"id": "b", "outcome": TRADE_FAILED, "outcome_date": dates[-3], "status": TRADE_FAILED},
        {"id": "c", "outcome": TRADE_FAILED, "outcome_date": dates[-20], "status": TRADE_FAILED},  # 超出視窗
        {"id": "d", "outcome": None, "outcome_date": None, "status": TRADE_ACTIVE},
    ]
    m = market_stats(ledger, df, dates[-1])
    assert m["wins"] == 1 and m["losses"] == 1 and m["pending"] == 1
    assert m["win_rate"] == 0.5 and m["label"] == "市況中性"


def test_is_likely_trading_day():
    assert is_likely_trading_day(dt.date(2026, 9, 4)) is True   # Friday
    assert is_likely_trading_day(dt.date(2026, 9, 5)) is False  # Saturday


def test_check_freshness_weekend():
    dates = _dates(50, end=dt.date(2026, 9, 4))  # Friday
    close = pd.DataFrame({"2330.TW": np.linspace(100, 110, 50)}, index=dates)
    twii = pd.Series(np.linspace(20000, 21000, 50), index=dates)
    # 週六檢查 → 應允許沿用
    r = check_freshness(close, twii, today=dt.date(2026, 9, 5), skip=False)
    assert r["is_fresh"] is True
    assert r["is_trading_day"] is False


def test_check_freshness_skip():
    dates = _dates(10)
    close = pd.DataFrame({"2330.TW": range(10)}, index=dates)
    twii = pd.Series(range(10), index=dates)
    r = check_freshness(close, twii, skip=True)
    assert r["message"] == "skipped"


def test_full_pipeline_test_mode(tmp_path, monkeypatch):
    """合成資料走完整 RS → 樣板 → 型態 → JSON。"""
    monkeypatch.chdir(tmp_path)
    # 把模組路徑可用
    ohlcv, close, volume, twii, uni = make_synthetic()
    # 把第一檔改成明顯 VCP 以便至少有命中
    o, h, l, c, v = make_vcp_series(300)
    ticker = uni["yf_ticker"].iloc[0]
    for key, s in [("Open", o), ("High", h), ("Low", l), ("Close", c), ("Volume", v)]:
        # 對齊 index
        s.index = close.index[-len(s):]
        ohlcv[key][ticker] = s.reindex(close.index).ffill().bfill()
    close[ticker] = ohlcv["Close"][ticker]

    result = compute_rs(close)
    template = compute_template(close[result.index.tolist()], volume, twii, result["RS"])
    full = export(result, template, uni, data_date=close.index[-1].date(),
                  outdir=str(tmp_path / "output"))
    assert (tmp_path / "output" / "RS_85-100.csv").exists()

    patterns = screen_patterns(ohlcv, full, min_rs=1, require_template=False)  # 測試放寬
    freshness = {
        "data_date": close.index[-1].date().isoformat(),
        "is_fresh": True,
        "is_trading_day": True,
        "source_checked_at": dt.datetime.now().isoformat(),
        "message": "test",
        "twse_cross_check": None,
    }
    ledger = empty_ledger()
    update_ledger(ledger, patterns, close, freshness["data_date"])
    meta = export_app_json(full, patterns, ohlcv, freshness,
                           outdir=str(tmp_path / "output" / "app"), ledger=ledger)
    assert (tmp_path / "output" / "app" / "meta.json").exists()
    assert (tmp_path / "output" / "app" / "rs85.json").exists()
    assert (tmp_path / "output" / "app" / "patterns.json").exists()
    assert (tmp_path / "output" / "app" / "breakouts.json").exists()
    with open(tmp_path / "output" / "app" / "meta.json") as f:
        m = json.load(f)
    assert "counts" in m
    assert m["is_fresh"] is True
    assert m["market"]["label"] in ("樣本不足", "市況良好", "市況中性", "市況不佳")
    assert meta["counts"]["universe"] == len(full)
    with open(tmp_path / "output" / "app" / "patterns.json") as f:
        rows = json.load(f)
    for r in rows:
        assert "primary" in r and "breakout_date" in r


def test_export_json_structure(tmp_path):
    ohlcv, close, volume, twii, uni = make_synthetic()
    result = compute_rs(close)
    template = compute_template(close[result.index.tolist()], volume, twii, result["RS"])
    # 手動組 ranking
    meta = uni.set_index("yf_ticker")
    result = result.join(meta[["stock_id", "stock_name", "市場", "industry_category"]])
    result = result.join(template)
    result = result.rename(columns={"stock_id": "代號", "stock_name": "名稱",
                                    "industry_category": "產業"})
    result.insert(0, "排名", range(1, len(result) + 1))
    patterns = [{
        "代號": str(result.iloc[0]["代號"]),
        "名稱": result.iloc[0]["名稱"],
        "市場": "上市",
        "產業": "測試",
        "RS": int(result.iloc[0]["RS"]),
        "收盤價": float(result.iloc[0]["收盤價"]),
        "通過樣板": "",
        "距50MA%": 1.0,
        "yf_ticker": result.index[0] if result.index.dtype == object else uni["yf_ticker"].iloc[0],
        "pattern": "VCP",
        "pattern_label": "VCP 波動收縮",
        "pivot": 100.0,
        "dist_pivot_pct": -2.0,
        "status": "即將突破",
        "score": 90,
        "contraction": "20%→10%",
        "legs": 2,
        "vol_dry_ratio": 0.5,
        "base_weeks": 4,
        "depth_pct": 20,
        "annotations": [{"type": "test", "price": 100}],
        "detail": {},
    }]
    # yf_ticker 欄
    yf = uni["yf_ticker"].iloc[0]
    patterns[0]["yf_ticker"] = yf
    patterns[0]["代號"] = uni["stock_id"].iloc[0]
    freshness = {"data_date": "2026-09-04", "is_fresh": True, "is_trading_day": True,
                 "source_checked_at": "x", "message": "ok", "twse_cross_check": None}
    # reset index for export expecting 代號 column rows
    ranking = result.reset_index(drop=True)
    ranking["代號"] = uni["stock_id"].values[:len(ranking)] if len(uni) >= len(ranking) else \
        [uni["stock_id"].iloc[i % len(uni)] for i in range(len(ranking))]
    export_app_json(ranking, patterns, ohlcv, freshness, outdir=str(tmp_path / "app"))
    with open(tmp_path / "app" / "patterns.json") as f:
        rows = json.load(f)
    assert rows[0]["status"] == "即將突破"
    assert rows[0]["pattern"] == "VCP"
