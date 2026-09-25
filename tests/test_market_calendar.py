# -*- coding: utf-8 -*-
"""休市日在下載前略過；交易日資料晚到仍 exit 2。"""
from __future__ import annotations

import datetime as dt
import os
import sys

import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import market_calendar
import rs_calculator
from market_calendar import (
    closure_from_news,
    is_market_closed,
    is_scheduled_closure,
    load_fallback_closures,
    parse_holiday_schedule,
    skip_message,
)
from rs_calculator import TAIPEI_TZ


_RWD_FIXTURE = {
    "stat": "ok",
    "data": [
        ["2026-01-02", "國曆新年開始交易日", "國曆新年開始交易。"],
        ["2026-02-11", "農曆春節前最後交易日", "農曆春節前最後交易。"],
        ["2026-02-12", "市場無交易，僅辦理結算交割作業", ""],
        ["2026-02-23", "農曆春節後開始交易日", "農曆春節後開始交易。"],
        ["2026-09-25", "中秋節", "依規定放假1日。"],
    ],
}

_OPENAPI_FIXTURE = [
    {
        "Name": "中秋節",
        "Date": "1150925",
        "Description": "依規定放假1日。",
    },
    {
        "Name": "國曆新年開始交易日",
        "Date": "1150102",
        "Description": "國曆新年開始交易。",
    },
]


def _no_network(monkeypatch):
    monkeypatch.setattr("market_calendar.fetch_holiday_schedule", lambda year: None)
    monkeypatch.setattr("market_calendar.fetch_twse_news", lambda: [])


def _pin_today(monkeypatch, day: dt.date):
    monkeypatch.setattr("market_calendar.taipei_today", lambda: day)
    monkeypatch.setattr(sys, "argv", ["rs_calculator.py"])


def test_parse_drops_trading_notes_and_keeps_closures():
    closures = parse_holiday_schedule(_RWD_FIXTURE)
    assert closures[dt.date(2026, 9, 25)] == "中秋節"
    assert dt.date(2026, 2, 12) in closures
    assert dt.date(2026, 1, 2) not in closures
    assert dt.date(2026, 2, 11) not in closures
    assert dt.date(2026, 2, 23) not in closures
    assert is_scheduled_closure("市場無交易，僅辦理結算交割作業")
    assert not is_scheduled_closure("農曆春節前最後交易日", "農曆春節前最後交易。")
    assert not is_scheduled_closure("國曆新年開始交易日")

    openapi = parse_holiday_schedule(_OPENAPI_FIXTURE)
    assert openapi[dt.date(2026, 9, 25)] == "中秋節"
    assert dt.date(2026, 1, 2) not in openapi


def test_fallback_recognizes_mid_autumn_2026_and_not_trading_notes(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    closures = load_fallback_closures()
    assert closures[dt.date(2026, 9, 25)] == "中秋節"
    assert "市場無交易" in closures[dt.date(2026, 2, 12)]
    for trading_note in (dt.date(2026, 1, 2), dt.date(2026, 2, 11), dt.date(2026, 2, 23)):
        assert trading_note not in closures
    assert dt.date(2027, 2, 8) in closures
    assert dt.date(2027, 9, 15) in closures
    assert sum(1 for day in closures if day.year == 2026) == 24


def test_fallback_used_when_endpoint_has_no_year(monkeypatch):
    _no_network(monkeypatch)
    closed, reason = is_market_closed(dt.date(2026, 9, 25))
    assert closed is True
    assert reason == "中秋節"
    closed, reason = is_market_closed(dt.date(2026, 9, 24))
    assert closed is False
    assert reason == ""
    closed, reason = is_market_closed(dt.date(2026, 1, 2))
    assert closed is False
    closed, reason = is_market_closed(dt.date(2026, 2, 12))
    assert closed is True
    assert "無交易" in reason


def test_live_schedule_replaces_fallback(monkeypatch):
    monkeypatch.setattr(
        "market_calendar.fetch_holiday_schedule",
        lambda year: {dt.date(2026, 8, 3): "颱風休市"},
    )
    monkeypatch.setattr("market_calendar.fetch_twse_news", lambda: [])
    closed, reason = is_market_closed(dt.date(2026, 8, 3))
    assert closed is True
    assert reason == "颱風休市"
    # 線上該年有資料時以線上表為準，不再用內建中秋日。
    closed, _ = is_market_closed(dt.date(2026, 9, 25))
    assert closed is False


def test_weekend_skips_without_fetch(monkeypatch):
    def boom(*_args, **_kwargs):
        raise AssertionError("weekend should not fetch")

    monkeypatch.setattr("market_calendar.fetch_holiday_schedule", boom)
    monkeypatch.setattr("market_calendar.fetch_twse_news", boom)
    closed, reason = is_market_closed(dt.date(2026, 9, 26))
    assert closed is True
    assert reason == "週末"
    closed, reason = is_market_closed(dt.date(2026, 9, 27))
    assert closed is True
    assert reason == "週末"


def test_typhoon_news_closes_a_weekday(monkeypatch):
    monkeypatch.setattr("market_calendar.fetch_holiday_schedule", lambda year: None)
    news = [{
        "Title": "因颱風來襲，集中交易市場9月24日全日休市",
        "Date": "1150923",
    }]
    monkeypatch.setattr("market_calendar.fetch_twse_news", lambda: news)
    closed, reason = is_market_closed(dt.date(2026, 9, 24))
    assert closed is True
    assert "9月24日" in reason

    assert closure_from_news(
        [{"Title": "說明天然災害休市原則", "Date": "1150924"}],
        dt.date(2026, 9, 24),
    ) is None
    assert closure_from_news(
        [{"Title": "集中交易市場9月3日休市", "Date": "1150902"}],
        dt.date(2026, 9, 24),
    ) is None
    assert closure_from_news(
        [{"Title": "因颱風，集中交易市場明日休市", "Date": "1150923"}],
        dt.date(2026, 9, 24),
    ) == "因颱風，集中交易市場明日休市"
    assert closure_from_news(
        [{"Title": "本公司本日休市", "Date": "1150801"}],
        dt.date(2026, 9, 24),
    ) is None


def test_holiday_skip_exits_0_before_download(monkeypatch, capsys):
    _no_network(monkeypatch)
    _pin_today(monkeypatch, dt.date(2026, 9, 25))

    def boom():
        raise AssertionError("should not download on a holiday")

    monkeypatch.setattr("rs_calculator.get_universe", boom)
    with pytest.raises(SystemExit) as exc:
        rs_calculator.main()
    assert exc.value.code == 0
    out = capsys.readouterr().out
    assert skip_message(dt.date(2026, 9, 25)) in out
    assert "今天(2026-09-25)休市，略過" in out


def test_weekend_skip_exits_0_before_download(monkeypatch, capsys):
    def boom(*_args, **_kwargs):
        raise AssertionError("weekend should not fetch or download")

    monkeypatch.setattr("market_calendar.fetch_holiday_schedule", boom)
    monkeypatch.setattr("market_calendar.fetch_twse_news", boom)
    _pin_today(monkeypatch, dt.date(2026, 9, 26))
    monkeypatch.setattr("rs_calculator.get_universe", boom)
    with pytest.raises(SystemExit) as exc:
        rs_calculator.main()
    assert exc.value.code == 0
    assert "今天(2026-09-26)休市，略過" in capsys.readouterr().out


def test_cli_writes_closed_output(monkeypatch, capsys, tmp_path):
    _no_network(monkeypatch)
    monkeypatch.setattr("market_calendar.taipei_today", lambda: dt.date(2026, 9, 25))
    out_path = tmp_path / "github_output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out_path))
    assert market_calendar.main() == 0
    assert "今天(2026-09-25)休市，略過" in capsys.readouterr().out
    assert out_path.read_text(encoding="utf-8").strip() == "closed=true"


def test_cli_trading_day_is_not_a_skip(monkeypatch, capsys, tmp_path):
    _no_network(monkeypatch)
    monkeypatch.setattr("market_calendar.taipei_today", lambda: dt.date(2026, 9, 7))
    out_path = tmp_path / "github_output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out_path))
    assert market_calendar.main() == 0
    text = capsys.readouterr().out
    assert "休市，略過" not in text
    assert "2026-09-07 交易日" in text
    assert out_path.read_text(encoding="utf-8").strip() == "closed=false"


def test_trading_day_late_data_still_exits_2(monkeypatch, capsys, tmp_path):
    """平日 Yahoo/TWSE 都還沒有今日檔 → exit 2，且確實走到了下載之後。"""
    trading = dt.date(2026, 9, 7)
    now = dt.datetime(2026, 9, 7, 18, 0, tzinfo=TAIPEI_TZ)
    _no_network(monkeypatch)
    _pin_today(monkeypatch, trading)
    monkeypatch.setattr("rs_calculator.taipei_today", lambda: trading)
    monkeypatch.chdir(tmp_path)

    downloaded = {"n": 0}

    def get_universe():
        downloaded["n"] += 1
        return pd.DataFrame({
            "stock_id": ["2330"],
            "stock_name": ["台積電"],
            "市場": ["上市"],
            "industry_category": ["半導體"],
            "yf_ticker": ["2330.TW"],
        })

    dates = pd.bdate_range(end=dt.date(2026, 9, 4), periods=3)
    close = pd.DataFrame({"2330.TW": [2410.0, 2410.0, 2410.0]}, index=dates)
    volume = close * 0 + 1000
    ohlcv = {
        "Open": close.copy(),
        "High": close.copy(),
        "Low": close.copy(),
        "Close": close.copy(),
        "Volume": volume.copy(),
    }
    twii = pd.Series([46500.0, 46551.0, 46551.0], index=dates)
    twse = pd.DataFrame({
        "Date": ["1150904"],
        "Code": ["2330"],
        "OpeningPrice": ["2410.00"],
        "HighestPrice": ["2410.00"],
        "LowestPrice": ["2410.00"],
        "ClosingPrice": ["2410.00"],
        "TradeVolume": ["1000"],
    })
    monkeypatch.setattr("rs_calculator.get_universe", get_universe)
    monkeypatch.setattr("rs_calculator.fetch_prices", lambda tickers: (ohlcv, close, volume))
    monkeypatch.setattr("rs_calculator.fetch_index", lambda: twii)
    monkeypatch.setattr("rs_calculator.fetch_twse_day_all", lambda: twse)
    monkeypatch.setattr("rs_calculator.fetch_twse_taiex", lambda: (dt.date(2026, 9, 4), 46551.0))

    real_check = rs_calculator.check_freshness

    def pinned_check(*args, **kwargs):
        kwargs["today"] = trading
        kwargs["now"] = now
        return real_check(*args, **kwargs)

    monkeypatch.setattr("rs_calculator.check_freshness", pinned_check)

    with pytest.raises(SystemExit) as exc:
        rs_calculator.main()
    assert exc.value.code == 2
    assert downloaded["n"] == 1
    out = capsys.readouterr().out
    assert "資料尚未更新" in out
    assert "休市，略過" not in out
