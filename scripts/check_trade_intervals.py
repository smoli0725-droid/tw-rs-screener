#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""同代號交易的進行區間不得重疊。

區間是 [breakout_date, outcome_date]（含兩端）。沒有 outcome_date 代表仍進行中。
沒有另外的最短間隔天數：上一筆判定日的下一個交易日就可以開新單。
`breakout_window_bars` 只是找穿越的回看根數，不是兩筆交易的最小間距。

檢查：
  output/app/breakouts_ledger.json  帳本
  output/app/breakouts.json         成功／失敗清單的來源（recent_trades）
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from breakout_tracker import overlapping_trade_pairs  # noqa: E402

SOURCES = (
    ROOT / "output" / "app" / "breakouts_ledger.json",
    ROOT / "output" / "app" / "breakouts.json",
)


def _load_trades(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)
    trades = data.get("trades") if isinstance(data, dict) else None
    if not isinstance(trades, list):
        raise SystemExit(f"{path}: missing trades array")
    return trades


def _fmt(trade: dict) -> str:
    end = trade.get("outcome_date") or "進行中"
    return (
        f"{trade.get('trade_id') or trade.get('id')} "
        f"[{trade.get('breakout_date')} .. {end}] "
        f"{trade.get('status')} origin={trade.get('origin')}"
    )


def main() -> int:
    failed = False
    for path in SOURCES:
        if not path.is_file():
            print(f"FAIL {path.relative_to(ROOT)}: file not found")
            failed = True
            continue
        pairs = overlapping_trade_pairs(_load_trades(path))
        rel = path.relative_to(ROOT)
        if not pairs:
            print(f"ok {rel}")
            continue
        failed = True
        print(f"FAIL {rel}: {len(pairs)} overlapping pair(s)")
        for left, right in pairs:
            name = left.get("name") or right.get("name") or ""
            print(f"  {left.get('id')} {name}")
            print(f"    {_fmt(left)}")
            print(f"    {_fmt(right)}")
    if failed:
        print(
            "規則：同一代號的 [突破日, 判定日] 不得相交（含兩端；無判定日視為仍進行中）。"
            "沒有另外的最短間隔天數。"
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
