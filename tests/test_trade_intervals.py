# -*- coding: utf-8 -*-
"""同代號交易進行區間不得重疊。"""
from __future__ import annotations

import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from breakout_tracker import (
    TRADE_ACTIVE,
    TRADE_REENTERED,
    TRADE_SUCCESS,
    empty_ledger,
    overlapping_trade_pairs,
    trade_intervals_overlap,
    update_ledger,
)


def _ase(trade_id, breakout, outcome, status, origin, pivot):
    """日月光投控 3711 的最小交易列。"""
    return {
        "trade_id": trade_id,
        "id": "3711",
        "name": "日月光投控",
        "yf_ticker": "3711.TW",
        "pivot": pivot,
        "breakout_date": breakout,
        "outcome_date": outcome,
        "status": status,
        "origin": origin,
        "outcome": "failed" if status == TRADE_REENTERED else (
            "success" if status == TRADE_SUCCESS else None
        ),
    }


def test_interval_check_catches_ase_3711():
    """成功清單上的兩筆日月光:突破日 9/16 與 9/18,進行區間相交。

    9/09–9/15 的失敗單與後兩者都不相交(判定日次日可開新單),不是這次違規。
    """
    failed = _ase("3711-2026-09-09-628", "2026-09-09", "2026-09-15",
                  TRADE_REENTERED, "pattern", 628.0)
    backfill = _ase("3711-2026-09-16-601", "2026-09-16", "2026-09-21",
                    TRADE_SUCCESS, "pattern", 601.0)
    recovered = _ase("3711-2026-09-18-628", "2026-09-18", "2026-09-22",
                     TRADE_SUCCESS, "recovered", 628.0)

    pairs = overlapping_trade_pairs([failed, backfill, recovered])
    assert len(pairs) == 1
    ids = {pairs[0][0]["trade_id"], pairs[0][1]["trade_id"]}
    assert ids == {"3711-2026-09-16-601", "3711-2026-09-18-628"}
    assert trade_intervals_overlap(backfill, recovered)
    # 判定日次一交易日開新單:緊鄰,不是最短間隔違規(沒有這個參數)
    assert overlapping_trade_pairs([failed, backfill]) == []
    assert overlapping_trade_pairs([failed, recovered]) == []


def test_open_trade_overlaps_later_breakout():
    """尚無判定日的單右端開放,會蓋住同代號較晚的突破。"""
    open_trade = _ase("3711-2026-09-16-601", "2026-09-16", None,
                      TRADE_ACTIVE, "pattern", 601.0)
    later = _ase("3711-2026-09-18-628", "2026-09-18", "2026-09-22",
                 TRADE_SUCCESS, "recovered", 628.0)
    assert trade_intervals_overlap(open_trade, later)


def _hit(pivot):
    return {
        "代號": "3711", "名稱": "日月光投控", "市場": "上市",
        "yf_ticker": "3711.TW", "pattern": "作弊型態",
        "pattern_label": "作弊型態", "RS": 96, "pivot": pivot,
        "status": "已突破", "primary": True,
    }


def test_update_ledger_rejects_ase_backdated_overlap():
    """重現 2026-09-22:先把 9/18 復甦單判成功,再補進樞紐 601 的 9/16 穿越。

    候選日 9/16 落在 9/15 判定與 9/18 突破之間的空檔,舊檢查會放行;
    結算後區間是 [9/16, 9/21],蓋住 9/18 那筆,必須捨棄。
    """
    dates = pd.to_datetime([
        "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11",
        "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17",
        "2026-09-18", "2026-09-21", "2026-09-22",
    ])
    closes = [618, 640, 650, 618, 612, 592, 605, 614, 638, 663, 693]
    df = pd.DataFrame({"3711.TW": closes}, index=dates)

    failed = _ase("3711-2026-09-09-628", "2026-09-09", "2026-09-15",
                  TRADE_REENTERED, "pattern", 628.0)
    failed.update({
        "last_date": "2026-09-18", "last_close": 638.0,
        "peak_close": 650.0, "trough_close": 592.0,
        "breakout_close": 640.0,
    })
    active = _ase("3711-2026-09-18-628", "2026-09-18", None,
                  TRADE_ACTIVE, "recovered", 628.0)
    active.update({
        "outcome": None, "outcome_close": None, "outcome_pct": None,
        "last_date": "2026-09-21", "last_close": 663.0,
        "peak_close": 663.0, "trough_close": 638.0,
        "breakout_close": 638.0,
    })
    ledger = empty_ledger()
    ledger["trades"] = [failed, active]

    update_ledger(ledger, [_hit(601.0)], df, "2026-09-22")

    ids = [t["trade_id"] for t in ledger["trades"]]
    assert ids == ["3711-2026-09-09-628", "3711-2026-09-18-628"]
    recovered = ledger["trades"][1]
    assert recovered["trade_id"] == "3711-2026-09-18-628"
    assert recovered["status"] == TRADE_SUCCESS
    assert recovered["outcome_date"] == "2026-09-22"
    assert overlapping_trade_pairs(ledger["trades"]) == []


def test_backdated_trade_that_closes_before_later_one_is_allowed():
    """回補穿越若在較晚那筆開始前就已判定結束,區間不相交,仍可開。

    用來鎖住「沒有最短間隔天數」:不是看到突破日接近就拒。
    """
    dates = pd.to_datetime([
        "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17",
        "2026-09-18", "2026-09-21", "2026-09-22",
    ])
    # 9/16 站上 100,9/17 跌破失敗線,之後不再站上,最近一次穿越仍是 9/16。
    closes = [90, 90, 101, 94, 94, 94, 94]
    df = pd.DataFrame({"3711.TW": closes}, index=dates)
    later = _ase("3711-2026-09-18-628", "2026-09-18", "2026-09-22",
                 TRADE_SUCCESS, "recovered", 628.0)
    later.update({
        "last_date": "2026-09-22", "last_close": 94.0,
        "peak_close": 94.0, "trough_close": 94.0, "pivot": 628.0,
    })
    ledger = empty_ledger()
    ledger["trades"] = [later]
    update_ledger(ledger, [_hit(100.0)], df, "2026-09-22")
    assert len(ledger["trades"]) == 2
    new = [t for t in ledger["trades"] if t["pivot"] == 100.0][0]
    assert new["breakout_date"] == "2026-09-16"
    assert new["outcome_date"] == "2026-09-17"
    assert new["outcome_date"] < later["breakout_date"]
    assert overlapping_trade_pairs(ledger["trades"]) == []
