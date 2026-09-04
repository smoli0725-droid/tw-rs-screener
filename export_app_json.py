# -*- coding: utf-8 -*-
"""匯出 Flutter App 用的 JSON 到 output/app/。"""
from __future__ import annotations

import json
import os
import datetime as dt
from typing import Any

import numpy as np
import pandas as pd

from pattern_screener import patterns_by_symbol


def _json_safe(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_json_safe(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        v = float(obj)
        return None if np.isnan(v) else v
    if isinstance(obj, float) and np.isnan(obj):
        return None
    if isinstance(obj, (pd.Timestamp, dt.datetime, dt.date)):
        return obj.isoformat()
    if isinstance(obj, np.bool_):
        return bool(obj)
    return obj


def _row_to_rs85(row: pd.Series, pattern_tags: list[str]) -> dict:
    return {
        "rank": int(row["排名"]),
        "id": str(row["代號"]),
        "name": str(row["名稱"]),
        "market": str(row["市場"]),
        "industry": str(row["產業"]),
        "rs": int(row["RS"]),
        "close": float(row["收盤價"]),
        "template_pass": row.get("通過樣板", "") == "✔",
        "template_count": int(row["通過項數"]) if pd.notna(row.get("通過項數")) else 0,
        "dist_ma50_pct": float(row["距50MA%"]) if pd.notna(row.get("距50MA%")) else None,
        "avg_vol_20": float(row["20日均量(張)"]) if pd.notna(row.get("20日均量(張)")) else None,
        "dist_52w_high_pct": float(row["距52週高點%"]) if pd.notna(row.get("距52週高點%")) else None,
        "dist_52w_low_pct": float(row["距52週低點%"]) if pd.notna(row.get("距52週低點%")) else None,
        "ret_3m_pct": float(row["3月漲幅%"]) if pd.notna(row.get("3月漲幅%")) else None,
        "ret_6m_pct": float(row["6月漲幅%"]) if pd.notna(row.get("6月漲幅%")) else None,
        "ret_12m_pct": float(row["12月漲幅%"]) if pd.notna(row.get("12月漲幅%")) else None,
        "patterns": pattern_tags,
    }


def _pattern_to_json(p: dict) -> dict:
    return {
        "id": p["代號"],
        "name": p["名稱"],
        "market": p["市場"],
        "industry": p["產業"],
        "rs": int(p["RS"]),
        "close": float(p["收盤價"]),
        "template_pass": p.get("通過樣板", "") == "✔",
        "dist_ma50_pct": p.get("距50MA%"),
        "pattern": p.get("pattern"),
        "pattern_label": p.get("pattern_label"),
        "pivot": p.get("pivot"),
        "dist_pivot_pct": p.get("dist_pivot_pct"),
        "status": p.get("status"),
        "score": p.get("score"),
        "contraction": p.get("contraction"),
        "legs": p.get("legs"),
        "vol_dry_ratio": p.get("vol_dry_ratio"),
        "base_weeks": p.get("base_weeks"),
        "depth_pct": p.get("depth_pct"),
        "annotations": p.get("annotations") or [],
        "detail": p.get("detail") or {},
    }


def _ohlcv_for_symbol(ohlcv: dict, yf_ticker: str, annotations: list,
                      bars: int = 260) -> dict | None:
    try:
        c = ohlcv["Close"][yf_ticker].dropna()
        if len(c) < 30:
            return None
        idx = c.index[-bars:]
        o = ohlcv["Open"][yf_ticker].reindex(idx).ffill()
        h = ohlcv["High"][yf_ticker].reindex(idx)
        l = ohlcv["Low"][yf_ticker].reindex(idx)
        cl = ohlcv["Close"][yf_ticker].reindex(idx)
        v = ohlcv["Volume"][yf_ticker].reindex(idx).fillna(0)
        full_close = ohlcv["Close"][yf_ticker].dropna()
        ma50 = full_close.rolling(50).mean().reindex(idx)
        ma150 = full_close.rolling(150).mean().reindex(idx)
        ma200 = full_close.rolling(200).mean().reindex(idx)

        candles = []
        for i, ts in enumerate(idx):
            date = ts.date().isoformat() if hasattr(ts, "date") else str(ts)[:10]
            candles.append({
                "date": date,
                "open": _json_safe(float(o.iloc[i])) if pd.notna(o.iloc[i]) else None,
                "high": _json_safe(float(h.iloc[i])) if pd.notna(h.iloc[i]) else None,
                "low": _json_safe(float(l.iloc[i])) if pd.notna(l.iloc[i]) else None,
                "close": _json_safe(float(cl.iloc[i])) if pd.notna(cl.iloc[i]) else None,
                "volume": _json_safe(float(v.iloc[i])) if pd.notna(v.iloc[i]) else 0,
                "ma50": _json_safe(float(ma50.iloc[i])) if pd.notna(ma50.iloc[i]) else None,
                "ma150": _json_safe(float(ma150.iloc[i])) if pd.notna(ma150.iloc[i]) else None,
                "ma200": _json_safe(float(ma200.iloc[i])) if pd.notna(ma200.iloc[i]) else None,
            })
        return {
            "ticker": yf_ticker,
            "candles": candles,
            "annotations": annotations,
        }
    except Exception as e:
        print(f"[export] ohlcv {yf_ticker} 失敗: {e}")
        return None


def export_app_json(ranking: pd.DataFrame, patterns: list[dict],
                    ohlcv: dict, freshness: dict,
                    outdir: str = "output/app") -> dict:
    os.makedirs(outdir, exist_ok=True)
    ohlcv_dir = os.path.join(outdir, "ohlcv")
    os.makedirs(ohlcv_dir, exist_ok=True)

    tags = patterns_by_symbol(patterns)
    top = ranking[ranking["RS"] >= 85].copy()
    rs85 = [_row_to_rs85(row, tags.get(str(row["代號"]), []))
            for _, row in top.iterrows()]

    pattern_rows = [_pattern_to_json(p) for p in patterns]

    # 僅為型態候選股輸出 OHLCV
    ann_by_id: dict[str, list] = {}
    yf_by_id: dict[str, str] = {}
    for p in patterns:
        sid = p["代號"]
        yf_by_id[sid] = p.get("yf_ticker") or f"{sid}.TW"
        ann_by_id.setdefault(sid, [])
        for a in (p.get("annotations") or []):
            a2 = {**a, "pattern": p.get("pattern")}
            ann_by_id[sid].append(a2)

    ohlcv_count = 0
    for sid, yf in yf_by_id.items():
        data = _ohlcv_for_symbol(ohlcv, yf, ann_by_id.get(sid, []))
        if data is None:
            # 嘗試 .TWO
            alt = f"{sid}.TWO"
            if alt != yf:
                data = _ohlcv_for_symbol(ohlcv, alt, ann_by_id.get(sid, []))
        if data is not None:
            path = os.path.join(ohlcv_dir, f"{sid}.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump(_json_safe(data), f, ensure_ascii=False)
            ohlcv_count += 1

    near_count = sum(1 for p in pattern_rows if p["status"] == "即將突破")
    broke_count = sum(1 for p in pattern_rows if p["status"] == "已突破")

    meta = {
        "data_date": freshness.get("data_date"),
        "generated_at": dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(),
        "is_fresh": freshness.get("is_fresh", True),
        "is_trading_day": freshness.get("is_trading_day"),
        "source_checked_at": freshness.get("source_checked_at"),
        "message": freshness.get("message"),
        "twse_cross_check": freshness.get("twse_cross_check"),
        "counts": {
            "rs85": len(rs85),
            "patterns": len(pattern_rows),
            "near_breakout": near_count,
            "broke_out": broke_count,
            "ohlcv_symbols": ohlcv_count,
            "universe": len(ranking),
        },
    }

    with open(os.path.join(outdir, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(_json_safe(meta), f, ensure_ascii=False, indent=2)
    with open(os.path.join(outdir, "rs85.json"), "w", encoding="utf-8") as f:
        json.dump(_json_safe(rs85), f, ensure_ascii=False)
    with open(os.path.join(outdir, "patterns.json"), "w", encoding="utf-8") as f:
        json.dump(_json_safe(pattern_rows), f, ensure_ascii=False)

    print(f"[export] app JSON → {outdir} | RS85={len(rs85)} "
          f"patterns={len(pattern_rows)}(即將突破={near_count}) ohlcv={ohlcv_count}")
    return meta
