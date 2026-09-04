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
    screen_patterns,
    PatternParams,
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
    # 基底高點
    base = 40
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
    for i in range(60):
        px[i] = 70 + i * 0.3  # 上漲
    # 第一低
    for i, p in enumerate(np.linspace(88, 60, 15)):
        px[60 + i] = p
    # 反彈到 75
    for i, p in enumerate(np.linspace(60, 75, 12)):
        px[75 + i] = p
    # 第二低(略破)
    for i, p in enumerate(np.linspace(75, 58, 12)):
        px[87 + i] = p
    # 右側緊縮區在 70 附近
    for i in range(20):
        px[99 + i] = 70 + (1.5 if i % 2 == 0 else -1.0)
    px[119:] = 71
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
    assert classify_status(90, 100, 0.5, 50_000, 100_000) == "整理中"


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

    patterns = screen_patterns(ohlcv, full, min_rs=1)  # 放寬以確保有掃描
    freshness = {
        "data_date": close.index[-1].date().isoformat(),
        "is_fresh": True,
        "is_trading_day": True,
        "source_checked_at": dt.datetime.now().isoformat(),
        "message": "test",
        "twse_cross_check": None,
    }
    meta = export_app_json(full, patterns, ohlcv, freshness,
                           outdir=str(tmp_path / "output" / "app"))
    assert (tmp_path / "output" / "app" / "meta.json").exists()
    assert (tmp_path / "output" / "app" / "rs85.json").exists()
    assert (tmp_path / "output" / "app" / "patterns.json").exists()
    with open(tmp_path / "output" / "app" / "meta.json") as f:
        m = json.load(f)
    assert "counts" in m
    assert m["is_fresh"] is True
    assert meta["counts"]["universe"] == len(full)


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
