# -*- coding: utf-8 -*-
"""Freshness date matching and TWSE same-day overlay (no network)."""
from __future__ import annotations

import datetime as dt
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rs_calculator import (
    TAIPEI_TZ,
    apply_twse_snapshot,
    check_freshness,
    drop_incomplete_tail,
    fetch_neo_day_all,
    _parse_twse_date,
    _twse_snapshot_date,
)


def _dates(n: int, end: dt.date):
    return pd.bdate_range(end=end, periods=n)


def _twse_day_all(date_roc: str, prices: dict[str, str],
                  ohlcv: dict[str, dict] | None = None) -> pd.DataFrame:
    rows = []
    for code, close in prices.items():
        extra = (ohlcv or {}).get(code, {})
        rows.append({
            "Date": date_roc,
            "Code": code,
            "OpeningPrice": extra.get("open", close),
            "HighestPrice": extra.get("high", close),
            "LowestPrice": extra.get("low", close),
            "ClosingPrice": close,
            "TradeVolume": extra.get("volume", "1000"),
        })
    return pd.DataFrame(rows)


def _market(end: dt.date, n: int = 3):
    dates = _dates(n, end)
    close = pd.DataFrame({
        "2330.TW": np.linspace(2400, 2460, n),
        "2317.TW": np.linspace(250, 260, n),
        "2454.TW": np.linspace(4400, 4500, n),
        "6488.TWO": np.linspace(100, 110, n),
    }, index=dates)
    volume = close * 0 + 50_000
    ohlcv = {
        "Open": close.copy(),
        "High": close * 1.01,
        "Low": close * 0.99,
        "Close": close.copy(),
        "Volume": volume.copy(),
    }
    twii = pd.Series(np.linspace(46000, 47000, n), index=dates)
    return ohlcv, close, volume, twii


def test_parse_and_snapshot_date_matching():
    assert _parse_twse_date("1150907") == dt.date(2026, 9, 7)
    twse = _twse_day_all("1150907", {"2330": "2460.00"})
    assert _twse_snapshot_date(twse) == dt.date(2026, 9, 7)
    yahoo = dt.date(2026, 9, 7)
    assert _twse_snapshot_date(twse) == yahoo
    stale = _twse_day_all("1150904", {"2330": "2410.00"})
    assert _twse_snapshot_date(stale) != yahoo


def test_apply_twse_does_not_touch_stale_snapshot():
    today = dt.date(2026, 9, 7)
    ohlcv, close, volume, twii = _market(today)
    twse = _twse_day_all("1150904", {"2330": "9999.00"})
    o2, c2, v2, t2, meta = apply_twse_snapshot(
        ohlcv, close, volume, twii, twse, today=today, taiex_close=48000.0)
    assert meta["applied"] is False
    assert meta["message"] == "twse_not_today"
    assert c2.loc[c2.index[-1], "2330.TW"] != 9999.00
    assert t2.iloc[-1] != 48000.0


def test_apply_twse_overrides_same_day_listed_not_tpex():
    today = dt.date(2026, 9, 7)
    ohlcv, close, volume, twii = _market(today)
    tpex_before = float(close["6488.TWO"].iloc[-1])
    twse = _twse_day_all("1150907", {
        "2330": "2410.00",
        "2317": "255.00",
        "2454": "4480.00",
    }, ohlcv={"2330": {"open": "2400", "high": "2420", "low": "2390", "volume": "12345"}})
    o2, c2, v2, t2, meta = apply_twse_snapshot(
        ohlcv, close, volume, twii, twse, today=today, taiex_close=47300.0)
    assert meta["applied"] is True
    assert meta["appended_row"] is False
    assert meta["listed_filled"] == 3
    assert meta["taiex_filled"] is True
    assert float(c2["2330.TW"].iloc[-1]) == 2410.0
    assert float(o2["Open"]["2330.TW"].iloc[-1]) == 2400.0
    assert float(v2["2330.TW"].iloc[-1]) == 12345.0
    assert float(c2["6488.TWO"].iloc[-1]) == tpex_before
    assert float(t2.iloc[-1]) == 47300.0


def test_apply_twse_appends_today_when_yahoo_lags():
    today = dt.date(2026, 9, 7)
    prev = dt.date(2026, 9, 4)  # Friday before
    ohlcv, close, volume, twii = _market(prev, n=3)
    last_yahoo = pd.Timestamp(close.index[-1]).date()
    assert last_yahoo < today
    tpex_prev = float(close["6488.TWO"].iloc[-1])
    twse = _twse_day_all("1150907", {"2330": "2500.00", "2317": "270.00"})
    o2, c2, v2, t2, meta = apply_twse_snapshot(
        ohlcv, close, volume, twii, twse, today=today, taiex_close=48000.0)
    assert meta["applied"] is True
    assert meta["appended_row"] is True
    assert pd.Timestamp(c2.index[-1]).date() == today
    assert float(c2["2330.TW"].iloc[-1]) == 2500.0
    assert pd.isna(c2["6488.TWO"].iloc[-1])
    # previous TPEX bar untouched
    assert float(c2["6488.TWO"].iloc[-2]) == tpex_prev
    assert float(t2.iloc[-1]) == 48000.0


def test_check_freshness_after_overlay_yahoo_lag(monkeypatch):
    today = dt.date(2026, 9, 7)
    ohlcv, close, volume, twii = _market(dt.date(2026, 9, 4), n=3)
    twse = _twse_day_all("1150907", {
        "2330": "2500.00",
        "2317": "270.00",
        "2454": "4600.00",
    })
    monkeypatch.setattr("rs_calculator.fetch_twse_day_all", lambda: twse)
    o2, c2, v2, t2, overlay = apply_twse_snapshot(
        ohlcv, close, volume, twii, twse, today=today)
    r = check_freshness(c2, t2, today=today, skip=False, twse=twse, overlay=overlay)
    assert r["is_fresh"] is True
    assert r["data_date"] == "2026-09-07"
    assert overlay["applied"] is True
    assert "TWSE" in r["message"]


def test_check_freshness_yahoo_stale_twse_today_without_overlay(monkeypatch):
    today = dt.date(2026, 9, 7)
    dates = _dates(2, end=dt.date(2026, 9, 4))
    close = pd.DataFrame({"2330.TW": [2410.0, 2410.0]}, index=dates)
    twii = pd.Series([46500.0, 46551.0], index=dates)
    twse = _twse_day_all("1150907", {"2330": "2460.00", "2317": "260.00", "2454": "4760.00"})
    monkeypatch.setattr("rs_calculator.fetch_twse_day_all", lambda: twse)
    r = check_freshness(close, twii, today=today, now=dt.datetime(2026, 9, 7, 18, 0, tzinfo=TAIPEI_TZ),
                        skip=False, twse=twse)
    assert r["is_fresh"] is False
    assert r["twse_cross_check"]["reason"] == "yahoo_stale"
    assert r["twse_cross_check"]["twse_date"] == "2026-09-07"


def test_check_freshness_both_sources_stale_weekday(monkeypatch):
    today = dt.date(2026, 9, 7)
    now = dt.datetime(2026, 9, 7, 17, 30, tzinfo=TAIPEI_TZ)
    dates = _dates(2, end=dt.date(2026, 9, 4))
    close = pd.DataFrame({"2330.TW": [2410.0, 2410.0]}, index=dates)
    twii = pd.Series([46500.0, 46551.0], index=dates)
    twse = _twse_day_all("1150904", {"2330": "2410.00", "2317": "256.00", "2454": "4415.00"})
    monkeypatch.setattr("rs_calculator.fetch_twse_day_all", lambda: twse)
    r = check_freshness(close, twii, today=today, now=now, skip=False, twse=twse)
    assert r["is_fresh"] is False
    assert r["twse_cross_check"]["reason"] == "sources_stale"
    assert r["twse_cross_check"]["twse_date"] == "2026-09-04"


def test_check_freshness_delayed_cron_after_midnight(monkeypatch):
    """GitHub cron 拖到台北次日 01:30 仍應接受上一交易日,不要整晚失敗。"""
    today = dt.date(2026, 9, 8)  # Tuesday
    now = dt.datetime(2026, 9, 8, 1, 30, tzinfo=TAIPEI_TZ)
    dates = _dates(2, end=dt.date(2026, 9, 7))
    close = pd.DataFrame({"2330.TW": [2410.0, 2460.0]}, index=dates)
    twii = pd.Series([46500.0, 47300.0], index=dates)
    twse = _twse_day_all("1150907", {"2330": "2460.00"})
    monkeypatch.setattr("rs_calculator.fetch_twse_day_all", lambda: twse)
    r = check_freshness(close, twii, today=today, now=now, skip=False, twse=twse,
                        prev_session=dt.date(2026, 9, 7))
    assert r["is_fresh"] is True
    assert r["twse_cross_check"]["reason"] == "before_session_close"


def test_check_freshness_after_midnight_requires_previous_session(monkeypatch):
    """2026-10-06 00:35:Yahoo 只到 10/2,不可把 10/2 當成 10/5 收盤寫出去。"""
    today = dt.date(2026, 10, 6)
    now = dt.datetime(2026, 10, 6, 0, 35, tzinfo=TAIPEI_TZ)
    dates = _dates(2, end=dt.date(2026, 10, 2))
    close = pd.DataFrame({"2330.TW": [2510.0, 2500.0]}, index=dates)
    twii = pd.Series([48353.0, 48475.0], index=dates)
    twse = _twse_day_all("1151002", {"2330": "2500.00"})
    monkeypatch.setattr("rs_calculator.fetch_twse_day_all", lambda: twse)
    r = check_freshness(close, twii, today=today, now=now, skip=False, twse=twse,
                        prev_session=dt.date(2026, 10, 5))
    assert r["is_fresh"] is False
    assert r["twse_cross_check"]["reason"] == "prev_session_missing"


def test_drop_incomplete_tail_removes_volume_only_yahoo_row():
    """Yahoo 給了 10/5 列但只有成交量:剔除後資料日期回到 10/2。"""
    ohlcv, close, volume, twii = _market(dt.date(2026, 10, 5), n=4)
    for key in ("Open", "High", "Low", "Close"):
        ohlcv[key].iloc[-1] = np.nan
    twii.iloc[-1] = np.nan
    o2, c2, v2, t2, dropped = drop_incomplete_tail(
        ohlcv, ohlcv["Close"], ohlcv["Volume"], twii)
    assert dropped == [dt.date(2026, 10, 5)]
    assert pd.Timestamp(c2.index[-1]).date() == dt.date(2026, 10, 2)
    assert pd.Timestamp(o2["Volume"].index[-1]).date() == dt.date(2026, 10, 2)
    assert pd.Timestamp(t2.index[-1]).date() == dt.date(2026, 10, 2)
    # 完整的資料不動
    o3, c3, v3, t3, dropped = drop_incomplete_tail(o2, c2, v2, t2)
    assert dropped == []
    assert len(c3) == len(c2)


def test_apply_twse_catches_up_missed_session_after_midnight():
    """午夜後:Yahoo 只到 10/2、TWSE 快照 10/5 → 補上 10/5 上市收盤。"""
    today = dt.date(2026, 10, 6)
    ohlcv, close, volume, twii = _market(dt.date(2026, 10, 2), n=3)
    twse = _twse_day_all("1151005", {"2330": "2550.00", "2317": "265.00"})
    o2, c2, v2, t2, meta = apply_twse_snapshot(
        ohlcv, close, volume, twii, twse, today=today, taiex_close=48600.0)
    assert meta["applied"] is True
    assert meta["appended_row"] is True
    assert pd.Timestamp(c2.index[-1]).date() == dt.date(2026, 10, 5)
    assert float(c2["2330.TW"].iloc[-1]) == 2550.0
    assert float(t2.iloc[-1]) == 48600.0
    r = check_freshness(c2, t2, today=today, now=dt.datetime(2026, 10, 6, 0, 35, tzinfo=TAIPEI_TZ),
                        skip=False, twse=twse, overlay=meta,
                        prev_session=dt.date(2026, 10, 5))
    assert r["is_fresh"] is True
    assert r["data_date"] == "2026-10-05"


def test_check_freshness_does_not_compare_mismatched_dates(monkeypatch):
    """Yahoo already today + TWSE previous session → skip price compare."""
    today = dt.date(2026, 9, 7)
    dates = _dates(3, end=today)
    close = pd.DataFrame({
        "2330.TW": [2410.0, 2410.0, 2460.0],
        "2454.TW": [4415.0, 4415.0, 4760.0],
    }, index=dates)
    twii = pd.Series([1.0, 1.0, 1.0], index=dates)
    twse = _twse_day_all("1150904", {"2330": "1.00", "2454": "1.00"})
    monkeypatch.setattr("rs_calculator.fetch_twse_day_all", lambda: twse)
    r = check_freshness(close, twii, today=today, skip=False)
    assert r["is_fresh"] is True
    assert r["twse_cross_check"]["skipped"] is True
    assert r["twse_cross_check"]["mismatches"] == []


def test_neo_extension_point_is_noop():
    assert fetch_neo_day_all() is None
