# -*- coding: utf-8 -*-
"""
Minervini 風格股價型態篩選器
============================
六種型態:VCP、3-C 作弊、低位作弊、杯狀帶柄、雙重底、強勁攻勢/高聳旗形。
所有門檻集中於下方 PatternParams,方便依實戰結果調整。
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np
import pandas as pd

STATUS_NEAR = "即將突破"   # 收盤在 pivot 下方 0~5% 且量縮
STATUS_BROKE = "已突破"    # 今日收盤過 pivot 且量 > 1.5× 均量
STATUS_BASE = "整理中"


@dataclass
class PatternParams:
    # 通用
    min_rs: int = 85
    near_pivot_pct: float = 5.0          # 即將突破:距 pivot 下方 % 上限
    vol_dry_ratio: float = 1.0           # 近10日均量 / 50日均量 < 此值視為量縮
    breakout_vol_mult: float = 1.5       # 突破日量能倍數
    zigzag_pct: float = 0.08             # zigzag 最小波段幅度(8%)
    zigzag_min_bars: int = 3

    # VCP
    vcp_min_legs: int = 2
    vcp_max_legs: int = 6
    vcp_shrink_lo: float = 0.35          # 每段深度 ≈ 前段 × (0.35~0.80)
    vcp_shrink_hi: float = 0.80
    vcp_last_max_pct: float = 10.0       # 最後一段 ≤ 10%

    # 3-C / 低位作弊
    cheat_prior_min_months: int = 3
    cheat_prior_max_months: int = 36
    cheat_prior_gain_min: float = 0.25   # 先前漲幅 ≥ 25%
    cheat_base_min_weeks: int = 3
    cheat_base_max_weeks: int = 45
    cheat_max_depth: float = 0.60        # 修正 ≤ 60%
    cheat_pause_min_bars: int = 5
    cheat_pause_range_pct: float = 10.0  # 停頓區高低差 ≤ 10%
    cheat_mid_lo: float = 1.0 / 3.0      # 中間 1/3 深度區間
    cheat_mid_hi: float = 2.0 / 3.0
    cheat_low_hi: float = 1.0 / 3.0      # 低位:下方 1/3

    # 杯狀帶柄
    cup_min_depth: float = 0.12
    cup_max_depth: float = 0.50
    cup_right_near_pct: float = 0.10     # 右側回到左高 10% 內
    handle_min_bars: int = 5
    handle_max_bars: int = 20
    handle_max_drop: float = 0.12
    handle_upper_half: bool = True

    # 雙重底
    db_min_weeks: int = 3
    db_max_weeks: int = 20
    db_second_tol: float = 1.03          # 第二低 ≤ 第一低 × 1.03
    db_handle_range: float = 0.10

    # 高聳旗形
    flag_prior_bars: int = 40            # 8 週
    flag_prior_gain: float = 1.0         # ≥ 100%
    flag_max_retrace: float = 0.25
    flag_range_pct: float = 0.10
    flag_min_bars: int = 5
    flag_max_bars: int = 25


PARAMS = PatternParams()

STATUS_ORDER = {STATUS_NEAR: 0, STATUS_BROKE: 1, STATUS_BASE: 2}


# ---------------------------------------------------------------- zigzag
def _bar_date(index, i) -> str:
    ts = index[i]
    return str(ts.date()) if hasattr(ts, "date") else str(ts)[:10]


def zigzag(high: pd.Series, low: pd.Series, close: pd.Series,
           pct: float = PARAMS.zigzag_pct,
           min_bars: int = PARAMS.zigzag_min_bars) -> list[dict]:
    """回傳波段轉折點 list[{idx, date, price, kind:'H'|'L'}]。"""
    n = len(close)
    if n < min_bars * 3:
        return []

    # 以第一段實際走勢決定初始方向,避免 direction=0 時高低互相覆蓋
    seed_hi = float(high.iloc[0])
    seed_lo = float(low.iloc[0])
    seed_i_hi, seed_i_lo = 0, 0
    direction = 0
    for i in range(1, min(n, 30)):
        hi, lo = float(high.iloc[i]), float(low.iloc[i])
        if hi > seed_hi:
            seed_hi, seed_i_hi = hi, i
        if lo < seed_lo:
            seed_lo, seed_i_lo = lo, i
        up = (seed_hi / float(close.iloc[0]) - 1) if float(close.iloc[0]) else 0
        dn = (1 - seed_lo / float(close.iloc[0])) if float(close.iloc[0]) else 0
        if up >= pct and up >= dn:
            direction = 1
            candidate_i, candidate_px = seed_i_hi, seed_hi
            break
        if dn >= pct and dn > up:
            direction = -1
            candidate_i, candidate_px = seed_i_lo, seed_lo
            break
    if direction == 0:
        # 預設視為上升找高點
        direction = 1
        candidate_i, candidate_px = int(high.values.argmax()), float(high.max())
        if candidate_i == 0:
            candidate_i, candidate_px = 0, float(high.iloc[0])

    pivots: list[dict] = []
    start = candidate_i + 1

    for i in range(start, n):
        hi = float(high.iloc[i])
        lo = float(low.iloc[i])
        if direction == 1:
            if hi >= candidate_px:
                candidate_i, candidate_px = i, hi
            elif lo <= candidate_px * (1 - pct) and (i - candidate_i) >= min_bars:
                pivots.append({
                    "idx": candidate_i,
                    "date": _bar_date(close.index, candidate_i),
                    "price": round(candidate_px, 4),
                    "kind": "H",
                })
                direction = -1
                candidate_i, candidate_px = i, lo
        else:
            if lo <= candidate_px:
                candidate_i, candidate_px = i, lo
            elif hi >= candidate_px * (1 + pct) and (i - candidate_i) >= min_bars:
                pivots.append({
                    "idx": candidate_i,
                    "date": _bar_date(close.index, candidate_i),
                    "price": round(candidate_px, 4),
                    "kind": "L",
                })
                direction = 1
                candidate_i, candidate_px = i, hi

    if pivots:
        kind = "H" if direction == 1 else "L"
        if pivots[-1]["kind"] != kind:
            pivots.append({
                "idx": candidate_i,
                "date": _bar_date(close.index, candidate_i),
                "price": round(float(candidate_px), 4),
                "kind": kind,
            })
    return pivots


def vol_dry_ratio(volume: pd.Series, short: int = 10, long: int = 50) -> float:
    if len(volume) < long:
        return float("nan")
    s = float(volume.iloc[-short:].mean())
    l = float(volume.iloc[-long:].mean())
    if l <= 0:
        return float("nan")
    return s / l


def classify_status(close: float, pivot: float, vol_ratio: float,
                    today_vol: float, avg_vol_20: float,
                    p: PatternParams = PARAMS) -> str:
    if pivot <= 0 or np.isnan(pivot):
        return STATUS_BASE
    dist = (close / pivot - 1) * 100
    broke_vol = (not np.isnan(avg_vol_20) and avg_vol_20 > 0
                 and today_vol >= avg_vol_20 * p.breakout_vol_mult)
    if close >= pivot and broke_vol:
        return STATUS_BROKE
    if close >= pivot:
        return STATUS_BROKE  # 價過 pivot 也算已突破(量能次要)
    if -p.near_pivot_pct <= dist < 0 and (np.isnan(vol_ratio) or vol_ratio < p.vol_dry_ratio):
        return STATUS_NEAR
    return STATUS_BASE


def _ma(series: pd.Series, n: int) -> float:
    if len(series) < n:
        return float("nan")
    return float(series.iloc[-n:].mean()) if False else float(series.rolling(n).mean().iloc[-1])


# ---------------------------------------------------------------- 各型態偵測
def detect_vcp(o: pd.Series, h: pd.Series, l: pd.Series, c: pd.Series, v: pd.Series,
               p: PatternParams = PARAMS) -> dict | None:
    pivots = zigzag(h, l, c, p.zigzag_pct)
    if len(pivots) < 4:
        return None
    # 找最近的高點起點,往後取 H-L 回檔段
    highs = [x for x in pivots if x["kind"] == "H"]
    if len(highs) < 2:
        return None
    # 從最近一段往前找連續收縮的回檔
    # 回檔定義:H → 下一個 L,深度 = (H-L)/H
    legs: list[dict] = []
    for i in range(len(pivots) - 1):
        if pivots[i]["kind"] == "H" and pivots[i + 1]["kind"] == "L":
            hp, lp = pivots[i]["price"], pivots[i + 1]["price"]
            if hp <= 0:
                continue
            depth = (hp - lp) / hp * 100
            legs.append({
                "high": pivots[i], "low": pivots[i + 1],
                "depth_pct": round(depth, 1),
            })
    if len(legs) < p.vcp_min_legs:
        return None

    # 取結尾連續滿足收縮條件的段落
    best: list[dict] | None = None
    for start in range(len(legs)):
        seq = [legs[start]]
        ok = True
        for j in range(start + 1, len(legs)):
            prev, cur = seq[-1]["depth_pct"], legs[j]["depth_pct"]
            if prev <= 0:
                ok = False
                break
            ratio = cur / prev
            if not (p.vcp_shrink_lo <= ratio <= p.vcp_shrink_hi) and cur >= prev:
                # 允許最後幾段略鬆,但不可擴大
                if cur > prev * 1.05:
                    break
            seq.append(legs[j])
            if len(seq) >= p.vcp_max_legs:
                break
        if len(seq) >= p.vcp_min_legs and seq[-1]["depth_pct"] <= p.vcp_last_max_pct:
            # 偏好靠近現在的序列
            if best is None or seq[-1]["low"]["idx"] >= best[-1]["low"]["idx"]:
                best = seq

    if best is None:
        return None

    last_high = best[-1]["high"]
    pivot = float(last_high["price"])
    # 若最後一段之後又有更高的 H,用那個
    for pv in pivots:
        if pv["idx"] > last_high["idx"] and pv["kind"] == "H":
            pivot = float(pv["price"])

    close = float(c.iloc[-1])
    vr = vol_dry_ratio(v)
    avg20 = float(v.iloc[-20:].mean()) if len(v) >= 20 else float("nan")
    status = classify_status(close, pivot, vr, float(v.iloc[-1]), avg20, p)
    depths = [x["depth_pct"] for x in best]
    annotations = []
    for leg in best:
        annotations.append({"type": "pullback_high", "date": leg["high"]["date"],
                            "price": leg["high"]["price"]})
        annotations.append({"type": "pullback_low", "date": leg["low"]["date"],
                            "price": leg["low"]["price"]})

    return {
        "pattern": "VCP",
        "pattern_label": "VCP 波動收縮",
        "pivot": round(pivot, 2),
        "dist_pivot_pct": round((close / pivot - 1) * 100, 2),
        "status": status,
        "score": _score(status, close, pivot, vr, depths[-1] if depths else 99),
        "contraction": "→".join(f"{d:.0f}%" for d in depths),
        "legs": len(best),
        "vol_dry_ratio": None if np.isnan(vr) else round(vr, 2),
        "base_weeks": round((best[-1]["low"]["idx"] - best[0]["high"]["idx"]) / 5, 1),
        "depth_pct": round(depths[0], 1) if depths else None,
        "annotations": annotations,
        "detail": {"depths": depths},
    }


def _find_cup_structure(h: pd.Series, l: pd.Series, c: pd.Series,
                        p: PatternParams) -> dict | None:
    """找最近的杯狀結構:左高 → 杯底 → 右高(接近左高)。"""
    pivots = zigzag(h, l, c, max(p.zigzag_pct * 0.75, 0.05))
    if len(pivots) < 3:
        return None
    # 找 L 作為杯底,左右各有 H
    best = None
    for i, pv in enumerate(pivots):
        if pv["kind"] != "L":
            continue
        left_hs = [x for x in pivots[:i] if x["kind"] == "H"]
        right_hs = [x for x in pivots[i + 1:] if x["kind"] == "H"]
        if not left_hs:
            continue
        left = left_hs[-1]
        cup_low = pv
        depth = (left["price"] - cup_low["price"]) / left["price"]
        if not (p.cup_min_depth <= depth <= max(p.cup_max_depth, p.cheat_max_depth)):
            continue
        weeks = (cup_low["idx"] - left["idx"]) / 5
        # 右側:若有右高且接近左高;否則用最近收盤當右緣
        if right_hs:
            right = right_hs[0]
            if right["price"] < left["price"] * (1 - p.cup_right_near_pct):
                # 尚未回到左高附近,仍可作作弊結構
                right_edge = right
            else:
                right_edge = right
        else:
            right_edge = {
                "idx": len(c) - 1,
                "date": str(c.index[-1].date()) if hasattr(c.index[-1], "date") else str(c.index[-1]),
                "price": float(c.iloc[-1]),
                "kind": "H",
            }
        base_weeks = (right_edge["idx"] - left["idx"]) / 5
        candidate = {
            "left": left, "bottom": cup_low, "right": right_edge,
            "depth": depth, "base_weeks": base_weeks,
        }
        if best is None or cup_low["idx"] > best["bottom"]["idx"]:
            best = candidate
    return best


def _pause_zone(h: pd.Series, l: pd.Series, c: pd.Series, v: pd.Series,
                start_idx: int, p: PatternParams) -> dict | None:
    """在 start_idx 之後找一段高低差 ≤ pause_range 的盤整區。"""
    n = len(c)
    if start_idx >= n - p.cheat_pause_min_bars:
        return None
    best = None
    for end in range(start_idx + p.cheat_pause_min_bars, n):
        for s in range(start_idx, end - p.cheat_pause_min_bars + 1):
            window_h = float(h.iloc[s:end + 1].max())
            window_l = float(l.iloc[s:end + 1].min())
            mid = (window_h + window_l) / 2
            if mid <= 0:
                continue
            rng = (window_h - window_l) / mid * 100
            if rng <= p.cheat_pause_range_pct:
                zone = {
                    "start_idx": s, "end_idx": end,
                    "high": window_h, "low": window_l,
                    "range_pct": round(rng, 1),
                    "bars": end - s + 1,
                }
                # 偏好靠近現在、且時間夠長
                if best is None or zone["end_idx"] > best["end_idx"] or (
                    zone["end_idx"] == best["end_idx"] and zone["bars"] > best["bars"]
                ):
                    best = zone
    return best


def detect_cheat(o, h, l, c, v, low_position: bool = False,
                 p: PatternParams = PARAMS) -> dict | None:
    """3-C 作弊 / 低位作弊。"""
    if len(c) < 150:
        return None
    ma200 = c.rolling(200).mean().iloc[-1] if len(c) >= 200 else c.rolling(len(c)).mean().iloc[-1]
    if float(c.iloc[-1]) < float(ma200):
        return None

    # 先前漲幅:過去 3~36 月內低點到高點
    lookback = min(len(c), p.cheat_prior_max_months * 21)
    window = c.iloc[-lookback:]
    prior_low = float(window.min())
    prior_high = float(window.max())
    if prior_low <= 0:
        return None
    prior_gain = prior_high / prior_low - 1
    if prior_gain < p.cheat_prior_gain_min:
        return None

    cup = _find_cup_structure(h, l, c, p)
    if cup is None:
        return None
    if not (p.cheat_base_min_weeks <= cup["base_weeks"] <= p.cheat_base_max_weeks):
        return None
    if cup["depth"] > p.cheat_max_depth:
        return None

    left, bottom, right = cup["left"], cup["bottom"], cup["right"]
    cup_range = left["price"] - bottom["price"]
    if cup_range <= 0:
        return None

    # 在底部之後找停頓區
    pause = _pause_zone(h, l, c, v, bottom["idx"], p)
    if pause is None:
        return None

    pause_mid = (pause["high"] + pause["low"]) / 2
    # 停頓區在杯狀深度的相對位置:0=底部,1=左高
    rel = (pause_mid - bottom["price"]) / cup_range

    if low_position:
        if rel > p.cheat_low_hi:
            return None
        label, code = "低位作弊", "低位作弊"
    else:
        if not (p.cheat_mid_lo <= rel <= p.cheat_mid_hi):
            return None
        label, code = "3-C 作弊", "3-C"

    pivot = float(pause["high"])
    close = float(c.iloc[-1])
    vr = vol_dry_ratio(v)
    avg20 = float(v.iloc[-20:].mean()) if len(v) >= 20 else float("nan")
    status = classify_status(close, pivot, vr, float(v.iloc[-1]), avg20, p)

    return {
        "pattern": code,
        "pattern_label": label,
        "pivot": round(pivot, 2),
        "dist_pivot_pct": round((close / pivot - 1) * 100, 2),
        "status": status,
        "score": _score(status, close, pivot, vr, cup["depth"] * 100),
        "contraction": None,
        "legs": None,
        "vol_dry_ratio": None if np.isnan(vr) else round(vr, 2),
        "base_weeks": round(cup["base_weeks"], 1),
        "depth_pct": round(cup["depth"] * 100, 1),
        "annotations": [
            {"type": "cup_left", "date": left["date"], "price": left["price"]},
            {"type": "cup_bottom", "date": bottom["date"], "price": bottom["price"]},
            {"type": "pause_high", "date": str(c.index[pause["end_idx"]].date())
             if hasattr(c.index[pause["end_idx"]], "date") else str(c.index[pause["end_idx"]]),
             "price": pivot},
        ],
        "detail": {
            "prior_gain_pct": round(prior_gain * 100, 1),
            "pause_rel": round(rel, 2),
            "pause_range_pct": pause["range_pct"],
        },
    }


def detect_cup_with_handle(o, h, l, c, v, p: PatternParams = PARAMS) -> dict | None:
    cup = _find_cup_structure(h, l, c, p)
    if cup is None:
        return None
    if not (p.cup_min_depth <= cup["depth"] <= p.cup_max_depth):
        return None
    left, bottom, right = cup["left"], cup["bottom"], cup["right"]
    # 右側需接近左高
    if right["price"] < left["price"] * (1 - p.cup_right_near_pct):
        return None

    # 柄部:右高之後的回檔
    handle_start = right["idx"]
    if handle_start >= len(c) - p.handle_min_bars:
        # 右高就是最近,可能柄還在形成——用右高後的局部低
        pass
    handle_slice_h = h.iloc[handle_start:]
    handle_slice_l = l.iloc[handle_start:]
    if len(handle_slice_h) < p.handle_min_bars:
        return None
    if len(handle_slice_h) > p.handle_max_bars:
        handle_slice_h = handle_slice_h.iloc[:p.handle_max_bars]
        handle_slice_l = handle_slice_l.iloc[:p.handle_max_bars]

    handle_high = float(handle_slice_h.max())
    handle_low = float(handle_slice_l.min())
    if handle_high <= 0:
        return None
    drop = (handle_high - handle_low) / handle_high
    if drop > p.handle_max_drop:
        return None

    # 柄部位於杯狀上半部
    cup_mid = (left["price"] + bottom["price"]) / 2
    if p.handle_upper_half and handle_low < cup_mid:
        return None

    pivot = handle_high
    close = float(c.iloc[-1])
    vr = vol_dry_ratio(v)
    avg20 = float(v.iloc[-20:].mean()) if len(v) >= 20 else float("nan")
    status = classify_status(close, pivot, vr, float(v.iloc[-1]), avg20, p)

    return {
        "pattern": "杯狀帶柄",
        "pattern_label": "夢幻型態／杯狀帶柄",
        "pivot": round(pivot, 2),
        "dist_pivot_pct": round((close / pivot - 1) * 100, 2),
        "status": status,
        "score": _score(status, close, pivot, vr, drop * 100),
        "contraction": None,
        "legs": None,
        "vol_dry_ratio": None if np.isnan(vr) else round(vr, 2),
        "base_weeks": round(cup["base_weeks"], 1),
        "depth_pct": round(cup["depth"] * 100, 1),
        "annotations": [
            {"type": "cup_left", "date": left["date"], "price": left["price"]},
            {"type": "cup_bottom", "date": bottom["date"], "price": bottom["price"]},
            {"type": "handle_high", "date": right["date"], "price": pivot},
            {"type": "handle_low", "price": round(handle_low, 2)},
        ],
        "detail": {"handle_drop_pct": round(drop * 100, 1)},
    }


def detect_double_bottom(o, h, l, c, v, p: PatternParams = PARAMS) -> dict | None:
    pivots = zigzag(h, l, c, p.zigzag_pct)
    lows = [x for x in pivots if x["kind"] == "L"]
    highs = [x for x in pivots if x["kind"] == "H"]
    if len(lows) < 2:
        return None

    best = None
    for i in range(len(lows) - 1):
        l1, l2 = lows[i], lows[i + 1]
        weeks = (l2["idx"] - l1["idx"]) / 5
        if not (p.db_min_weeks <= weeks <= p.db_max_weeks):
            continue
        if l2["price"] > l1["price"] * p.db_second_tol:
            continue
        # 中間高點
        mid_hs = [x for x in highs if l1["idx"] < x["idx"] < l2["idx"]]
        if not mid_hs:
            continue
        mid = max(mid_hs, key=lambda x: x["price"])
        # 右側緊縮區
        pause = _pause_zone(h, l, c, v, l2["idx"], p)
        if pause is None:
            # 若無停頓區,用中間高點當 pivot(尚未形成柄)
            pivot = float(mid["price"])
            handle_info = None
        else:
            if pause["range_pct"] > p.db_handle_range * 100:
                continue
            pivot = float(pause["high"])
            handle_info = pause

        close = float(c.iloc[-1])
        vr = vol_dry_ratio(v)
        avg20 = float(v.iloc[-20:].mean()) if len(v) >= 20 else float("nan")
        status = classify_status(close, pivot, vr, float(v.iloc[-1]), avg20, p)
        candidate = {
            "pattern": "雙重底",
            "pattern_label": "雙重底",
            "pivot": round(pivot, 2),
            "dist_pivot_pct": round((close / pivot - 1) * 100, 2),
            "status": status,
            "score": _score(status, close, pivot, vr, weeks),
            "contraction": None,
            "legs": None,
            "vol_dry_ratio": None if np.isnan(vr) else round(vr, 2),
            "base_weeks": round(weeks, 1),
            "depth_pct": round((1 - min(l1["price"], l2["price"]) / mid["price"]) * 100, 1),
            "annotations": [
                {"type": "db_low1", "date": l1["date"], "price": l1["price"]},
                {"type": "db_mid", "date": mid["date"], "price": mid["price"]},
                {"type": "db_low2", "date": l2["date"], "price": l2["price"]},
            ],
            "detail": {"handle": handle_info["range_pct"] if handle_info else None},
        }
        if best is None or l2["idx"] > (best["_l2_idx"]):
            candidate["_l2_idx"] = l2["idx"]
            best = candidate

    if best is None:
        return None
    best.pop("_l2_idx", None)
    return best


def detect_high_tight_flag(o, h, l, c, v, p: PatternParams = PARAMS) -> dict | None:
    if len(c) < p.flag_prior_bars + p.flag_min_bars:
        return None

    # 找急漲高點:在足夠長的 lookback 內,任意 ≤8 週窗口漲幅 ≥ 100%,
    # 且高點之後仍有狹幅旗形整理、旗形末端靠近現在。
    lookback = min(len(c), p.flag_prior_bars + p.flag_max_bars + 60)
    offset = len(c) - lookback
    seg = c.iloc[-lookback:]
    best_run = None

    for end in range(p.flag_prior_bars, len(seg)):
        start = max(0, end - p.flag_prior_bars)
        window = seg.iloc[start:end + 1]
        lo = float(window.min())
        hi = float(window.max())
        if lo <= 0:
            continue
        gain = hi / lo - 1
        if gain < p.flag_prior_gain:
            continue
        hi_idx_local = int(window.values.argmax())
        hi_abs = start + hi_idx_local
        # 旗形必須在高點之後,且高點不能太舊(旗形結束後最多再拖 flag_max_bars)
        flag_end = min(len(seg), hi_abs + p.flag_max_bars)
        flag = seg.iloc[hi_abs:flag_end]
        if len(flag) < p.flag_min_bars:
            continue
        # 旗形末端需接近序列末端(仍在整理或剛整理完)
        if flag_end < len(seg) - 5:
            continue
        flag_hi = float(flag.max())
        flag_lo = float(flag.min())
        retrace = (hi - flag_lo) / hi if hi > 0 else 1
        if retrace > p.flag_max_retrace:
            continue
        mid = (flag_hi + flag_lo) / 2
        rng = (flag_hi - flag_lo) / mid if mid > 0 else 1
        if rng > p.flag_range_pct:
            continue
        abs_hi = offset + hi_abs
        run = {
            "gain": gain, "hi": hi, "hi_idx": abs_hi,
            "flag_hi": flag_hi, "flag_lo": flag_lo,
            "retrace": retrace, "range": rng,
            "flag_bars": len(flag),
        }
        if best_run is None or abs_hi >= best_run["hi_idx"]:
            best_run = run

    if best_run is None:
        return None

    pivot = float(best_run["flag_hi"])
    close = float(c.iloc[-1])
    vr = vol_dry_ratio(v)
    avg20 = float(v.iloc[-20:].mean()) if len(v) >= 20 else float("nan")
    status = classify_status(close, pivot, vr, float(v.iloc[-1]), avg20, p)
    hi_date = _bar_date(c.index, best_run["hi_idx"])

    return {
        "pattern": "高聳旗形",
        "pattern_label": "強勁攻勢／高聳旗形",
        "pivot": round(pivot, 2),
        "dist_pivot_pct": round((close / pivot - 1) * 100, 2),
        "status": status,
        "score": _score(status, close, pivot, vr, 100 - best_run["gain"] * 10),
        "contraction": None,
        "legs": None,
        "vol_dry_ratio": None if np.isnan(vr) else round(vr, 2),
        "base_weeks": round(best_run["flag_bars"] / 5, 1),
        "depth_pct": round(best_run["retrace"] * 100, 1),
        "annotations": [
            {"type": "thrust_high", "date": hi_date, "price": round(best_run["hi"], 2)},
            {"type": "flag_high", "price": round(pivot, 2)},
            {"type": "flag_low", "price": round(best_run["flag_lo"], 2)},
        ],
        "detail": {
            "prior_gain_pct": round(best_run["gain"] * 100, 1),
            "flag_range_pct": round(best_run["range"] * 100, 1),
        },
    }


def _score(status: str, close: float, pivot: float, vol_ratio: float,
           tightness: float) -> float:
    """分數越高越優先:即將突破 > 已突破 > 整理;距 pivot 近、量縮加分。"""
    base = {STATUS_NEAR: 100, STATUS_BROKE: 70, STATUS_BASE: 40}.get(status, 30)
    if pivot > 0:
        dist = abs(close / pivot - 1) * 100
        base += max(0, 20 - dist * 2)
    if not np.isnan(vol_ratio):
        base += max(0, (1 - vol_ratio) * 15)
    base -= min(tightness, 30) * 0.2
    return round(base, 1)


DETECTORS = [
    detect_vcp,
    lambda o, h, l, c, v, p=PARAMS: detect_cheat(o, h, l, c, v, False, p),
    lambda o, h, l, c, v, p=PARAMS: detect_cheat(o, h, l, c, v, True, p),
    detect_cup_with_handle,
    detect_double_bottom,
    detect_high_tight_flag,
]


def screen_one(ticker: str, ohlcv: dict, meta: dict,
               p: PatternParams = PARAMS) -> list[dict]:
    """對單一股票跑所有偵測器,回傳命中的型態 list。"""
    try:
        o = ohlcv["Open"][ticker].dropna()
        h = ohlcv["High"][ticker].dropna()
        l = ohlcv["Low"][ticker].dropna()
        c = ohlcv["Close"][ticker].dropna()
        v = ohlcv["Volume"][ticker].reindex(c.index).fillna(0)
    except Exception:
        return []
    # 對齊
    idx = c.index.intersection(h.index).intersection(l.index)
    if len(idx) < 60:
        return []
    o, h, l, c, v = o.reindex(idx).ffill(), h.reindex(idx), l.reindex(idx), c.reindex(idx), v.reindex(idx).fillna(0)

    hits = []
    for det in DETECTORS:
        try:
            hit = det(o, h, l, c, v, p)
        except Exception:
            hit = None
        if hit:
            hit = {**meta, **hit}
            hits.append(hit)
    return hits


def screen_patterns(ohlcv: dict, ranking: pd.DataFrame,
                    min_rs: int = 85,
                    require_template: bool = True,
                    p: PatternParams = PARAMS) -> list[dict]:
    """對 RS≥min_rs 的股票跑型態篩選。

    預設再限制「通過趨勢樣板」(通過樣板 == ✔),避免名單過寬。
    ranking: export() 回傳的完整排名表(含 代號/名稱/RS/...)。
    ohlcv columns 為 yf_ticker。
    """
    # 建立 代號 → yf_ticker
    close_cols = list(ohlcv["Close"].columns)
    id_to_yf = {}
    for col in close_cols:
        sid = str(col).split(".")[0]
        id_to_yf[sid] = col

    top = ranking[ranking["RS"] >= min_rs].copy()
    if require_template:
        # rs_calculator 以 U+2714 ✔ 標記通過
        passed = top["通過樣板"].fillna("").astype(str).str.strip()
        top = top[passed == "✔"].copy()
    all_hits: list[dict] = []
    for _, row in top.iterrows():
        sid = str(row["代號"])
        yf = id_to_yf.get(sid)
        if yf is None:
            continue
        meta = {
            "代號": sid,
            "名稱": row["名稱"],
            "市場": row["市場"],
            "產業": row["產業"],
            "RS": int(row["RS"]),
            "收盤價": float(row["收盤價"]),
            "通過樣板": row.get("通過樣板", ""),
            "距50MA%": float(row["距50MA%"]) if pd.notna(row.get("距50MA%")) else None,
            "yf_ticker": yf,
        }
        hits = screen_one(yf, ohlcv, meta, p)
        all_hits.extend(hits)

    all_hits.sort(key=lambda x: (
        STATUS_ORDER.get(x.get("status"), 9),
        -x.get("RS", 0),
        abs(x.get("dist_pivot_pct") or 99),
        -x.get("score", 0),
    ))
    scope = f"RS≥{min_rs}" + (" 且通過趨勢樣板" if require_template else "")
    print(f"[patterns] {scope} 掃描 {len(top)} 檔,命中 {len(all_hits)} 筆型態")
    return all_hits


def patterns_by_symbol(patterns: list[dict]) -> dict[str, list[str]]:
    """代號 → 命中型態名稱 list。"""
    out: dict[str, list[str]] = {}
    for p in patterns:
        out.setdefault(p["代號"], [])
        label = p.get("pattern") or p.get("pattern_label")
        if label and label not in out[p["代號"]]:
            out[p["代號"]].append(label)
    return out
