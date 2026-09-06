# -*- coding: utf-8 -*-
"""
Minervini 風格股價型態篩選器
============================
四種型態:VCP、作弊型態(合併 3-C / 低位作弊 / 上緣杯柄)、雙重底、強勁攻勢/高聳旗形。
所有門檻集中於下方 PatternParams,方便依實戰結果調整。

一檔一型態
----------
同一段 K 線只承認一個結構:四個偵測器都跑,但 `screen_one` 只回傳
「結構完成日最新」的那一個(同日再看狀態、分數),其餘丟棄。

Pivot 原則
----------
* pivot 必須是「已被確認的阻力」:基底 / 柄 / 收縮段的高點,且之後價格曾在其下方。
  ZigZag 結尾尚未確認的高低點只用來判斷目前走勢,不能當 pivot。
* 型態有時效:最後一個結構點必須在最近 `recent_bars` 根 K 內。
* 突破有時效:收盤首次站上 pivot 必須在最近 `breakout_window_bars` 根內,
  否則視為「已延伸」(舊突破),不再列為可買。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

STATUS_NEAR = "即將突破"      # 收盤在 pivot 下方 0~5% 且量縮
STATUS_BROKE = "已突破"       # 近期突破且收盤在 pivot 上方 0~5%(可買池)
STATUS_EXTENDED = "已延伸"    # 收盤高於 pivot 5% 以上,或突破已超過時效(不進型態清單,只供交易帳本)
STATUS_BASE = "整理中"


@dataclass
class PatternParams:
    # 通用
    min_rs: int = 85
    near_pivot_pct: float = 5.0          # 即將突破:距 pivot 下方 % 上限
    buy_zone_pct: float = 5.0            # 已突破(可買):pivot 上方 0~5%
    success_pct: float = 10.0            # 突破後收盤 ≥ pivot×1.10 → 成功交易
    fail_pct: float = 5.0                # 突破後收盤 ≤ pivot×0.95 → 失敗交易
    vol_dry_ratio: float = 1.0           # 近10日均量 / 50日均量 < 此值視為量縮
    breakout_vol_mult: float = 1.5       # 突破日量能倍數(僅供參考)
    zigzag_pct: float = 0.08             # zigzag 最小波段幅度(8%)
    zigzag_min_bars: int = 3
    recent_bars: int = 60                # 型態最後結構點需在最近 N 根內
    breakout_window_bars: int = 10       # 突破日需在最近 N 根內
    pause_max_span_bars: int = 60        # 停頓區需在起點後 N 根內結束

    # VCP
    vcp_min_legs: int = 2
    vcp_max_legs: int = 6
    vcp_shrink_lo: float = 0.35          # 每段深度 ≈ 前段 × (0.35~0.80)
    vcp_shrink_hi: float = 0.80
    vcp_last_max_pct: float = 10.0       # 最後一段 ≤ 10%

    # 作弊型態(基底 + 基底內停頓區;停頓區位置決定 低位 / 中段 3-C / 上緣杯柄)
    cheat_prior_min_months: int = 3
    cheat_prior_max_months: int = 36
    cheat_prior_gain_min: float = 0.25   # 先前漲幅 ≥ 25%
    cheat_base_min_weeks: int = 3        # 左高 → 停頓區結束
    cheat_base_max_weeks: int = 45
    cheat_min_depth: float = 0.12        # 基底修正 12~60%
    cheat_max_depth: float = 0.60
    cheat_right_max_over: float = 0.05   # 底部之後任何高點不得高於左高 5%(否則已在漲,不是基底)
    cheat_pause_min_bars: int = 5
    cheat_pause_range_pct: float = 10.0  # 停頓區高低差 ≤ 10%
    cheat_low_hi: float = 1.0 / 3.0      # 停頓區中點 < 下 1/3 → 低位
    cheat_mid_hi: float = 2.0 / 3.0      # 1/3~2/3 → 中段 3-C;> 2/3 → 上緣(杯柄)
    cheat_upper_min_weeks: int = 6       # 上緣杯柄的基底至少 6 週

    # 雙重底
    db_min_weeks: int = 3
    db_max_weeks: int = 20
    db_second_tol: float = 1.03          # 第二低 ≤ 第一低 × 1.03
    db_second_floor: float = 0.90        # 第二低 ≥ 第一低 × 0.90(不可深破)
    db_handle_range: float = 0.10

    # 高聳旗形
    flag_prior_bars: int = 40            # 8 週
    flag_prior_gain: float = 1.0         # ≥ 100%
    flag_max_retrace: float = 0.25
    flag_range_pct: float = 0.10
    flag_min_bars: int = 5
    flag_max_bars: int = 25


PARAMS = PatternParams()

STATUS_ORDER = {STATUS_NEAR: 0, STATUS_BROKE: 1, STATUS_BASE: 2, STATUS_EXTENDED: 3}


# ---------------------------------------------------------------- zigzag
def _date_ord(s: str) -> int:
    """'YYYY-MM-DD' → 可排序整數;無法解析回 0。"""
    try:
        return int(str(s)[:10].replace("-", ""))
    except ValueError:
        return 0


def _bar_date(index, i) -> str:
    ts = index[i]
    return str(ts.date()) if hasattr(ts, "date") else str(ts)[:10]


def zigzag(high: pd.Series, low: pd.Series, close: pd.Series,
           pct: float = PARAMS.zigzag_pct,
           min_bars: int = PARAMS.zigzag_min_bars,
           include_trailing: bool = False) -> list[dict]:
    """回傳波段轉折點 list[{idx, date, price, kind:'H'|'L', confirmed}]。

    confirmed=True 的轉折已被之後 ≥ pct 的反向走勢確認。
    include_trailing=True 時,會在結尾附上目前尚未確認的極值(confirmed=False),
    僅供判斷目前走勢方向,不可作為 pivot。
    """
    n = len(close)
    if n < min_bars * 3:
        return []

    seed_hi = float(high.iloc[0])
    seed_lo = float(low.iloc[0])
    seed_i_hi, seed_i_lo = 0, 0
    direction = 0
    c0 = float(close.iloc[0])
    for i in range(1, min(n, 30)):
        hi, lo = float(high.iloc[i]), float(low.iloc[i])
        if hi > seed_hi:
            seed_hi, seed_i_hi = hi, i
        if lo < seed_lo:
            seed_lo, seed_i_lo = lo, i
        up = (seed_hi / c0 - 1) if c0 else 0
        dn = (1 - seed_lo / c0) if c0 else 0
        if up >= pct and up >= dn:
            direction = 1
            candidate_i, candidate_px = seed_i_hi, seed_hi
            break
        if dn >= pct and dn > up:
            direction = -1
            candidate_i, candidate_px = seed_i_lo, seed_lo
            break
    if direction == 0:
        direction = 1
        candidate_i, candidate_px = int(high.values.argmax()), float(high.max())

    pivots: list[dict] = []
    start = candidate_i + 1

    def _pv(i, px, kind, confirmed=True):
        return {"idx": i, "date": _bar_date(close.index, i),
                "price": round(float(px), 4), "kind": kind, "confirmed": confirmed}

    for i in range(start, n):
        hi = float(high.iloc[i])
        lo = float(low.iloc[i])
        if direction == 1:
            if hi >= candidate_px:
                candidate_i, candidate_px = i, hi
            elif lo <= candidate_px * (1 - pct) and (i - candidate_i) >= min_bars:
                pivots.append(_pv(candidate_i, candidate_px, "H"))
                direction = -1
                candidate_i, candidate_px = i, lo
        else:
            if lo <= candidate_px:
                candidate_i, candidate_px = i, lo
            elif hi >= candidate_px * (1 + pct) and (i - candidate_i) >= min_bars:
                pivots.append(_pv(candidate_i, candidate_px, "L"))
                direction = 1
                candidate_i, candidate_px = i, hi

    if include_trailing and pivots:
        kind = "H" if direction == 1 else "L"
        if pivots[-1]["kind"] != kind:
            pivots.append(_pv(candidate_i, candidate_px, kind, confirmed=False))
    return pivots


def vol_dry_ratio(volume: pd.Series, short: int = 10, long: int = 50) -> float:
    if len(volume) < long:
        return float("nan")
    s = float(volume.iloc[-short:].mean())
    l = float(volume.iloc[-long:].mean())
    if l <= 0:
        return float("nan")
    return s / l


def find_breakout_idx(close: pd.Series, pivot: float, window: int) -> int | None:
    """最近 window 根內,收盤由 pivot 下方站上 pivot 的最後一次索引;沒有則 None。

    若整個 window 都在 pivot 上方(沒有交叉),代表突破早於時效 → None。
    """
    n = len(close)
    if n < 2 or pivot <= 0:
        return None
    lo = max(1, n - window)
    for i in range(n - 1, lo - 1, -1):
        if float(close.iloc[i]) >= pivot and float(close.iloc[i - 1]) < pivot:
            return i
    return None


def classify_status(close, pivot: float, vol_ratio: float,
                    today_vol: float, avg_vol_20: float,
                    p: PatternParams = PARAMS) -> str:
    """回傳狀態字串。close 可為收盤 Series(建議)或單一數值。"""
    return classify(close, pivot, vol_ratio, p)["status"]


def classify(close, pivot: float, vol_ratio: float,
             p: PatternParams = PARAMS) -> dict:
    """回傳 {status, breakout_idx, dist_pivot_pct}。"""
    if pivot is None or pivot <= 0 or (isinstance(pivot, float) and np.isnan(pivot)):
        return {"status": STATUS_BASE, "breakout_idx": None, "dist_pivot_pct": None}
    series = close if isinstance(close, pd.Series) else None
    last = float(series.iloc[-1]) if series is not None else float(close)
    dist = (last / pivot - 1) * 100
    out = {"status": STATUS_BASE, "breakout_idx": None, "dist_pivot_pct": round(dist, 2)}

    if last >= pivot:
        if series is not None:
            bi = find_breakout_idx(series, pivot, p.breakout_window_bars)
            out["breakout_idx"] = bi
            if bi is None:
                out["status"] = STATUS_EXTENDED
                return out
        out["status"] = STATUS_BROKE if dist <= p.buy_zone_pct else STATUS_EXTENDED
        return out

    dry = np.isnan(vol_ratio) or vol_ratio < p.vol_dry_ratio
    if -p.near_pivot_pct <= dist < 0 and dry:
        out["status"] = STATUS_NEAR
    return out


def _is_recent(idx: int, n: int, p: PatternParams) -> bool:
    return (n - 1 - idx) <= p.recent_bars


def _finish(c: pd.Series, v: pd.Series, pivot: float, p: PatternParams,
            tightness: float) -> dict:
    """共用:計算狀態 / 距離 / 分數 / 突破日。"""
    vr = vol_dry_ratio(v)
    cls = classify(c, pivot, vr, p)
    bi = cls["breakout_idx"]
    return {
        "pivot": round(pivot, 2),
        "dist_pivot_pct": cls["dist_pivot_pct"],
        "status": cls["status"],
        "score": _score(cls["status"], float(c.iloc[-1]), pivot, vr, tightness),
        "vol_dry_ratio": None if np.isnan(vr) else round(vr, 2),
        "breakout_date": _bar_date(c.index, bi) if bi is not None else None,
        "days_since_breakout": (len(c) - 1 - bi) if bi is not None else None,
    }


# ---------------------------------------------------------------- 各型態偵測
def detect_vcp(o: pd.Series, h: pd.Series, l: pd.Series, c: pd.Series, v: pd.Series,
               p: PatternParams = PARAMS) -> dict | None:
    pivots = zigzag(h, l, c, p.zigzag_pct, include_trailing=True)
    if len(pivots) < 3:
        return None
    n = len(c)

    # 回檔段:確認的 H → 下一個 L(L 可為尚未確認的目前低點)
    legs: list[dict] = []
    for i in range(len(pivots) - 1):
        a, b = pivots[i], pivots[i + 1]
        if a["kind"] == "H" and a["confirmed"] and b["kind"] == "L":
            hp, lp = a["price"], b["price"]
            if hp <= 0:
                continue
            legs.append({"high": a, "low": b, "depth_pct": round((hp - lp) / hp * 100, 1)})
    if len(legs) < p.vcp_min_legs:
        return None

    # 取結尾連續收縮的段落(偏好最靠近現在)
    best: list[dict] | None = None
    for start in range(len(legs)):
        seq = [legs[start]]
        for j in range(start + 1, len(legs)):
            prev, cur = seq[-1]["depth_pct"], legs[j]["depth_pct"]
            if prev <= 0:
                break
            ratio = cur / prev
            if not (p.vcp_shrink_lo <= ratio <= p.vcp_shrink_hi) and cur >= prev:
                if cur > prev * 1.05:
                    break
            seq.append(legs[j])
            if len(seq) >= p.vcp_max_legs:
                break
        if len(seq) >= p.vcp_min_legs and seq[-1]["depth_pct"] <= p.vcp_last_max_pct:
            if best is None or seq[-1]["low"]["idx"] >= best[-1]["low"]["idx"]:
                best = seq
    if best is None:
        return None

    last_low = best[-1]["low"]
    # 型態時效 + 最後一段之後不得再有已確認轉折(否則結構已改變)
    if not _is_recent(last_low["idx"], n, p):
        return None
    if any(pv["confirmed"] and pv["idx"] > last_low["idx"] for pv in pivots):
        return None

    # pivot = 最後一段收縮的高點(已確認阻力),不追蹤之後的新高
    pivot = float(best[-1]["high"]["price"])
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
        **_finish(c, v, pivot, p, depths[-1]),
        "contraction": "→".join(f"{d:.0f}%" for d in depths),
        "legs": len(best),
        "base_weeks": round((last_low["idx"] - best[0]["high"]["idx"]) / 5, 1),
        "depth_pct": round(depths[0], 1),
        "structure_date": last_low["date"],
        "annotations": annotations,
        "detail": {"depths": depths},
    }


def _find_base_structure(h: pd.Series, l: pd.Series, c: pd.Series,
                         p: PatternParams) -> dict | None:
    """找最近的基底:左高(確認 H) → 底(確認 L),修正深度在 cheat_min_depth~cheat_max_depth。"""
    pivots = zigzag(h, l, c, max(p.zigzag_pct * 0.75, 0.05))
    if len(pivots) < 2:
        return None
    best = None
    for i, pv in enumerate(pivots):
        if pv["kind"] != "L":
            continue
        left_hs = [x for x in pivots[:i] if x["kind"] == "H"]
        if not left_hs:
            continue
        left = left_hs[-1]
        depth = (left["price"] - pv["price"]) / left["price"]
        if not (p.cheat_min_depth <= depth <= p.cheat_max_depth):
            continue
        if best is None or pv["idx"] > best["bottom"]["idx"]:
            best = {"left": left, "bottom": pv, "depth": depth}
    return best


def _pause_zone(h: pd.Series, l: pd.Series, c: pd.Series, v: pd.Series,
                start_idx: int, p: PatternParams) -> dict | None:
    """在 start_idx 之後、且 pause_max_span_bars 內,找高低差 ≤ pause_range 的盤整區。

    不含最後一根 K:若今天是突破日,其高點不應成為自己的 pivot。
    """
    n = len(c) - 1  # 排除今天
    if start_idx >= n - p.cheat_pause_min_bars:
        return None
    max_end = min(n, start_idx + p.pause_max_span_bars + 1)
    best = None
    for end in range(start_idx + p.cheat_pause_min_bars, max_end):
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
                if best is None or zone["end_idx"] > best["end_idx"] or (
                    zone["end_idx"] == best["end_idx"] and zone["bars"] > best["bars"]
                ):
                    best = zone
    return best


CHEAT_POS_LOW = "低位"
CHEAT_POS_MID = "中段 3-C"
CHEAT_POS_UPPER = "上緣（杯柄）"


def detect_cheat_pattern(o, h, l, c, v, p: PatternParams = PARAMS) -> dict | None:
    """作弊型態:基底(左高 → 底)+ 基底內的停頓區,pivot = 停頓區高點。

    停頓區在基底的相對位置決定子類型:下 1/3 低位、中 1/3 3-C、上 1/3 杯柄。
    底部之後若任何高點已高於左高 5% 以上,代表股價早已脫離基底在漲,
    這不是作弊型態(交給 VCP / 高聳旗形 / 交易帳本),避免把飆漲後的
    第一次回檔誤判成「杯柄」而把 pivot 放在最高上影線。
    """
    if len(c) < 150:
        return None
    n = len(c)
    ma200 = c.rolling(200).mean().iloc[-1] if n >= 200 else c.rolling(n).mean().iloc[-1]
    if float(c.iloc[-1]) < float(ma200):
        return None

    lookback = min(n, p.cheat_prior_max_months * 21)
    window = c.iloc[-lookback:]
    prior_low = float(window.min())
    prior_high = float(window.max())
    if prior_low <= 0:
        return None
    prior_gain = prior_high / prior_low - 1
    if prior_gain < p.cheat_prior_gain_min:
        return None

    base = _find_base_structure(h, l, c, p)
    if base is None:
        return None
    left, bottom = base["left"], base["bottom"]
    base_range = left["price"] - bottom["price"]
    if base_range <= 0:
        return None

    pause = _pause_zone(h, l, c, v, bottom["idx"], p)
    if pause is None or not _is_recent(pause["end_idx"], n, p):
        return None

    # 右側上限:底部之後到停頓區結束,任何高點不得高於左高 × (1 + cheat_right_max_over)
    cap = left["price"] * (1 + p.cheat_right_max_over)
    if float(h.iloc[bottom["idx"]:pause["end_idx"] + 1].max()) > cap:
        return None

    base_weeks = (pause["end_idx"] - left["idx"]) / 5
    if not (p.cheat_base_min_weeks <= base_weeks <= p.cheat_base_max_weeks):
        return None

    pause_mid = (pause["high"] + pause["low"]) / 2
    rel = (pause_mid - bottom["price"]) / base_range  # 0=底部,1=左高
    if rel < p.cheat_low_hi:
        position = CHEAT_POS_LOW
    elif rel <= p.cheat_mid_hi:
        position = CHEAT_POS_MID
    else:
        position = CHEAT_POS_UPPER
        if base_weeks < p.cheat_upper_min_weeks:
            return None

    pivot = float(pause["high"])
    pause_end_date = _bar_date(c.index, pause["end_idx"])
    return {
        "pattern": "作弊型態",
        "pattern_label": "作弊型態",
        **_finish(c, v, pivot, p, base["depth"] * 100),
        "contraction": None,
        "legs": None,
        "base_weeks": round(base_weeks, 1),
        "depth_pct": round(base["depth"] * 100, 1),
        "structure_date": pause_end_date,
        "annotations": [
            {"type": "cup_left", "date": left["date"], "price": left["price"]},
            {"type": "cup_bottom", "date": bottom["date"], "price": bottom["price"]},
            {"type": "pause_high", "date": pause_end_date, "price": round(pivot, 2)},
        ],
        "detail": {
            "position": position,
            "prior_gain_pct": round(prior_gain * 100, 1),
            "pause_rel": round(rel, 2),
            "pause_range_pct": pause["range_pct"],
        },
    }


def detect_double_bottom(o, h, l, c, v, p: PatternParams = PARAMS) -> dict | None:
    pivots = zigzag(h, l, c, p.zigzag_pct)  # 只用已確認轉折
    lows = [x for x in pivots if x["kind"] == "L"]
    highs = [x for x in pivots if x["kind"] == "H"]
    if len(lows) < 2:
        return None
    n = len(c)

    best = None
    for i in range(len(lows) - 1):
        l1, l2 = lows[i], lows[i + 1]
        weeks = (l2["idx"] - l1["idx"]) / 5
        if not (p.db_min_weeks <= weeks <= p.db_max_weeks):
            continue
        if l2["price"] > l1["price"] * p.db_second_tol:
            continue
        if l2["price"] < l1["price"] * p.db_second_floor:
            continue
        if (n - 1 - l2["idx"]) > p.recent_bars * 2:
            continue
        # 第二底之後不得再有已確認低點(否則已是新結構)
        if any(x["idx"] > l2["idx"] for x in lows):
            continue
        mid_hs = [x for x in highs if l1["idx"] < x["idx"] < l2["idx"]]
        if not mid_hs:
            continue
        mid = max(mid_hs, key=lambda x: x["price"])

        pause = _pause_zone(h, l, c, v, l2["idx"], p)
        if pause is None:
            pivot = float(mid["price"])
            handle_info = None
            structure_idx = l2["idx"]
        else:
            if pause["range_pct"] > p.db_handle_range * 100:
                continue
            # 停頓區(柄)高點若已越過 W 中間高點,阻力仍以中間高點為準
            pivot = float(min(pause["high"], mid["price"]))
            handle_info = pause
            structure_idx = pause["end_idx"]
        if not _is_recent(structure_idx, n, p):
            continue

        candidate = {
            "pattern": "雙重底",
            "pattern_label": "雙重底",
            **_finish(c, v, pivot, p, weeks),
            "contraction": None,
            "legs": None,
            "base_weeks": round(weeks, 1),
            "depth_pct": round((1 - min(l1["price"], l2["price"]) / mid["price"]) * 100, 1),
            "structure_date": _bar_date(c.index, structure_idx),
            "annotations": [
                {"type": "db_low1", "date": l1["date"], "price": l1["price"]},
                {"type": "db_mid", "date": mid["date"], "price": mid["price"]},
                {"type": "db_low2", "date": l2["date"], "price": l2["price"]},
            ],
            "detail": {"handle": handle_info["range_pct"] if handle_info else None},
            "_l2_idx": l2["idx"],
        }
        if best is None or candidate["_l2_idx"] > best["_l2_idx"]:
            best = candidate

    if best is None:
        return None
    best.pop("_l2_idx", None)
    return best


def detect_high_tight_flag(o, h, l, c, v, p: PatternParams = PARAMS) -> dict | None:
    if len(c) < p.flag_prior_bars + p.flag_min_bars:
        return None

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
        flag_end = min(len(seg), hi_abs + p.flag_max_bars)
        flag = seg.iloc[hi_abs:flag_end]
        if len(flag) < p.flag_min_bars:
            continue
        if flag_end < len(seg) - 5:
            continue
        # 旗形統計不含今天(今天若突破,不可成為自己的 pivot)
        flag_stat = flag.iloc[:-1] if flag_end == len(seg) and len(flag) > p.flag_min_bars else flag
        flag_hi = float(flag_stat.max())
        flag_lo = float(flag_stat.min())
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
            "flag_end_idx": offset + flag_end - 1,
        }
        if best_run is None or abs_hi >= best_run["hi_idx"]:
            best_run = run

    if best_run is None:
        return None

    pivot = float(best_run["flag_hi"])
    hi_date = _bar_date(c.index, best_run["hi_idx"])
    return {
        "pattern": "高聳旗形",
        "pattern_label": "強勁攻勢／高聳旗形",
        **_finish(c, v, pivot, p, 100 - best_run["gain"] * 10),
        "contraction": None,
        "legs": None,
        "base_weeks": round(best_run["flag_bars"] / 5, 1),
        "depth_pct": round(best_run["retrace"] * 100, 1),
        "structure_date": _bar_date(c.index, min(best_run["flag_end_idx"], len(c) - 1)),
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
    """分數越高越優先:即將突破 > 已突破 > 整理 > 已延伸;距 pivot 近、量縮加分。"""
    base = {STATUS_NEAR: 100, STATUS_BROKE: 85, STATUS_BASE: 40, STATUS_EXTENDED: 20}.get(status, 30)
    if pivot > 0:
        dist = abs(close / pivot - 1) * 100
        base += max(0, 20 - dist * 2)
    if not np.isnan(vol_ratio):
        base += max(0, (1 - vol_ratio) * 15)
    base -= min(tightness, 30) * 0.2
    return round(base, 1)


DETECTORS = [
    detect_vcp,
    detect_cheat_pattern,
    detect_double_bottom,
    detect_high_tight_flag,
]


def screen_one(ticker: str, ohlcv: dict, meta: dict,
               p: PatternParams = PARAMS) -> list[dict]:
    """對單一股票跑所有偵測器,回傳命中的型態 list(已標記 primary)。"""
    try:
        o = ohlcv["Open"][ticker].dropna()
        h = ohlcv["High"][ticker].dropna()
        l = ohlcv["Low"][ticker].dropna()
        c = ohlcv["Close"][ticker].dropna()
        v = ohlcv["Volume"][ticker].reindex(c.index).fillna(0)
    except Exception:
        return []
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
            hits.append({**meta, **hit})
    primary = pick_primary(hits)
    return [primary] if primary else []


def pick_primary(hits: list[dict]) -> dict | None:
    """同一檔多型態時只留一個:以最新結構為準,再看狀態與分數。"""
    if not hits:
        return None
    ranked = sorted(hits, key=lambda x: (
        -_date_ord(x.get("structure_date") or ""),
        STATUS_ORDER.get(x.get("status"), 9),
        -(x.get("score") or 0),
    ))
    primary = ranked[0]
    primary["primary"] = True
    return primary


def mark_primary(hits: list[dict]) -> list[dict]:
    """相容舊呼叫:標記 primary 旗標(screen_one 已只回傳一個)。"""
    primary = pick_primary(hits)
    for hit in hits:
        hit["primary"] = hit is primary
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
    close_cols = list(ohlcv["Close"].columns)
    id_to_yf = {}
    for col in close_cols:
        sid = str(col).split(".")[0]
        id_to_yf[sid] = col

    top = ranking[ranking["RS"] >= min_rs].copy()
    if require_template:
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
        all_hits.extend(screen_one(yf, ohlcv, meta, p))

    all_hits.sort(key=lambda x: (
        STATUS_ORDER.get(x.get("status"), 9),
        not x.get("primary", False),
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
