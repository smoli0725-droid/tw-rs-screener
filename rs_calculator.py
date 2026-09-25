# -*- coding: utf-8 -*-
"""
台股全市場 RS Rating + Minervini 趨勢樣板篩選器
================================================
RS:score = 2*(3月報酬) + (6月) + (9月) + (12月) → 全市場百分位 1–99

趨勢樣板(《超級績效》8 條):
  1. 股價 > 150MA 且 > 200MA
  2. 150MA > 200MA
  3. 200MA 向上至少一個月(以 21 個交易日前比較)
  4. 50MA > 150MA 且 > 200MA
  5. 股價較 52 週低點高出至少 25%
  6. 股價落在 52 週高點的 25% 以內
  7. RS >= 70;且 RS線(股價/加權指數)上升至少 6 週
  (原第 8 條「股價 > 50MA」屬買進時機,已移除;改以「距50MA%」呈現離突破距離)

輸出:
  output/趨勢樣板通過.csv   ← 可直接操作的觀察名單
  output/RS_85-100.csv      ← 純 RS 粗篩(含未過樣板者)
  output/RS_全市場排名.xlsx  ← 三個分頁
  output/app/*.json         ← Flutter App 資料

當日收盤:Yahoo 歷史(含上櫃) + TWSE STOCK_DAY_ALL 補上市最後一根;
上櫃與還原價限制見 README。富邦 Neo 尚未接入(fetch_neo_day_all)。

用法:
  python rs_calculator.py          # 正式執行
  python rs_calculator.py --test   # 合成資料測試
  python rs_calculator.py --skip-patterns  # 略過型態篩選
"""
import argparse
import datetime as dt
import os
import sys

import numpy as np
import pandas as pd

from market_calendar import ensure_market_open

FINMIND_URL = "https://api.finmindtrade.com/api/v4/data"
TWSE_DAY_ALL = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"
TWSE_MI_INDEX = "https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX"
EXCLUDE_INDUSTRY = {"ETF", "ETN", "受益證券", "存託憑證", "上市指數投資證券(ETN)"}
TRADING_DAYS = {"3m": 63, "6m": 126, "9m": 189, "12m": 252}
MIN_HISTORY = 130        # 至少約半年資料才納入 RS 排名
MIN_AVG_VOL_ZHANG = 200  # 樣板名單的 20 日均量門檻(張),依個人資金規模調整
FRESHNESS_SAMPLE_IDS = ("2330", "2317", "2454")
TAIPEI_TZ = dt.timezone(dt.timedelta(hours=8))
# Same-day close sources (priority when wiring new ones):
#   1. TWSE STOCK_DAY_ALL — listed official unadjusted OHLCV (implemented)
#   2. Yahoo Finance — history + TPEX (.TWO); lags after 13:30 close
#   3. Fubon Neo — not implemented; see fetch_neo_day_all()
PRICE_SOURCE_TWSE = "twse"
PRICE_SOURCE_YAHOO = "yahoo"
PRICE_SOURCE_NEO = "neo"  # reserved; do not log in / scrape Neo in this module


# ---------------------------------------------------------------- 股票池
def get_universe() -> pd.DataFrame:
    import requests
    r = requests.get(FINMIND_URL, params={"dataset": "TaiwanStockInfo"}, timeout=60)
    r.raise_for_status()
    df = pd.DataFrame(r.json()["data"])
    df = df[df["type"].isin(["twse", "tpex"])]
    df = df[df["stock_id"].str.fullmatch(r"\d{4}")]
    df = df[~df["stock_id"].str.startswith("00")]
    df = df[~df["industry_category"].isin(EXCLUDE_INDUSTRY)]
    df = df.drop_duplicates(subset="stock_id")
    df["yf_ticker"] = df.apply(
        lambda x: f"{x.stock_id}.TW" if x.type == "twse" else f"{x.stock_id}.TWO", axis=1
    )
    df["市場"] = df["type"].map({"twse": "上市", "tpex": "上櫃"})
    return df[["stock_id", "stock_name", "市場", "industry_category", "yf_ticker"]]


# ---------------------------------------------------------------- 抓價量
def fetch_prices(tickers: list, chunk: int = 200):
    """回傳 (ohlcv_dict, close, volume)。
    ohlcv_dict: {'Open','High','Low','Close','Volume'} → DataFrame(index=日期, columns=yf_ticker)
    close/volume 維持舊介面相容。
    """
    import yfinance as yf
    opens, highs, lows, closes, vols = [], [], [], [], []
    for i in range(0, len(tickers), chunk):
        batch = tickers[i:i + chunk]
        print(f"下載 {i + 1}–{i + len(batch)} / {len(tickers)} ...", flush=True)
        data = yf.download(batch, period="400d", auto_adjust=True,
                           threads=True, progress=False)
        o, h, l, c, v = data["Open"], data["High"], data["Low"], data["Close"], data["Volume"]
        if isinstance(c, pd.Series):
            o = o.to_frame(batch[0])
            h = h.to_frame(batch[0])
            l = l.to_frame(batch[0])
            c = c.to_frame(batch[0])
            v = v.to_frame(batch[0])
        opens.append(o)
        highs.append(h)
        lows.append(l)
        closes.append(c)
        vols.append(v)

    def _merge(parts):
        df = pd.concat(parts, axis=1)
        return df.loc[:, ~df.columns.duplicated()].sort_index()

    open_ = _merge(opens)
    high = _merge(highs)
    low = _merge(lows)
    close = _merge(closes)
    volume = _merge(vols)
    ohlcv = {"Open": open_, "High": high, "Low": low, "Close": close, "Volume": volume}
    return ohlcv, close, volume


def fetch_index() -> pd.Series:
    """台灣加權指數(RS線基準)"""
    import yfinance as yf
    twii = yf.download("^TWII", period="400d", auto_adjust=True,
                       progress=False)["Close"]
    if isinstance(twii, pd.DataFrame):
        twii = twii.iloc[:, 0]
    return twii.sort_index()


# ---------------------------------------------------------------- 資料新鮮度
def taipei_today() -> dt.date:
    """Actions runner 是 UTC;新鮮度與資料日期一律用台北曆日。"""
    return dt.datetime.now(TAIPEI_TZ).date()


def fetch_twse_day_all() -> pd.DataFrame | None:
    """抓 TWSE 當日全市場收盤價;失敗回傳 None。"""
    import requests
    try:
        r = requests.get(TWSE_DAY_ALL, timeout=30)
        r.raise_for_status()
        df = pd.DataFrame(r.json())
        if df.empty or "Code" not in df.columns:
            return None
        return df
    except Exception as e:
        print(f"[freshness] TWSE OpenAPI 失敗: {e}", flush=True)
        return None


def fetch_twse_taiex() -> tuple[dt.date | None, float | None]:
    """TWSE 發行量加權股價指數收盤。失敗回傳 (None, None)。"""
    import requests
    try:
        r = requests.get(TWSE_MI_INDEX, timeout=30)
        r.raise_for_status()
        rows = r.json()
        if not isinstance(rows, list):
            return None, None
        for row in rows:
            if row.get("指數") == "發行量加權股價指數":
                return _parse_twse_date(row.get("日期")), _parse_twse_price(row.get("收盤指數"))
    except Exception as e:
        print(f"[prices] TWSE TAIEX 失敗: {e}", flush=True)
    return None, None


def fetch_neo_day_all() -> pd.DataFrame | None:
    """Fubon Neo same-day quotes — not implemented.

    Leave this as the extension point. Do not add login, cookies, or
    credentials here until a Neo account exists and secrets live in
    GitHub Actions (never in git).

    Expected DataFrame columns (same as STOCK_DAY_ALL so
    ``apply_twse_snapshot`` can be reused or generalized):
      Code, Date, OpeningPrice, HighestPrice, LowestPrice,
      ClosingPrice, TradeVolume

    Wire-up later in ``resolve_same_day_prices``: call this, and if it
    returns today's rows, overlay listed *and* TPEX (Yahoo ``.TWO``
    still lags). Prefer Neo over TWSE when both exist.
    """
    return None


def _parse_twse_price(val) -> float | None:
    try:
        return float(str(val).replace(",", ""))
    except (TypeError, ValueError):
        return None


def _parse_twse_date(val) -> dt.date | None:
    """TWSE OpenAPI Date: 民國年(1150904=2026-09-04),也接受西元 8 碼。"""
    if val is None:
        return None
    try:
        if isinstance(val, float) and np.isnan(val):
            return None
    except TypeError:
        pass
    s = str(val).strip().replace("/", "").replace("-", "")
    if not s.isdigit():
        return None
    try:
        if len(s) == 7:      # 1150904
            y, m, d = int(s[:3]) + 1911, int(s[3:5]), int(s[5:7])
        elif len(s) == 8:    # 20260907
            y, m, d = int(s[:4]), int(s[4:6]), int(s[6:8])
        elif len(s) == 6:    # 990904
            y, m, d = int(s[:2]) + 1911, int(s[2:4]), int(s[4:6])
        else:
            return None
        return dt.date(y, m, d)
    except ValueError:
        return None


def _twse_snapshot_date(twse: pd.DataFrame) -> dt.date | None:
    if twse is None or twse.empty or "Date" not in twse.columns:
        return None
    parsed = [_parse_twse_date(v) for v in twse["Date"].dropna().unique()]
    parsed = [p for p in parsed if p is not None]
    return max(parsed) if parsed else None


def is_likely_trading_day(today: dt.date | None = None) -> bool:
    """粗判今天是否為台股交易日(週一到週五;假日另用 TWSE 資料確認)。"""
    today = today or taipei_today()
    return today.weekday() < 5


def _index_timestamp(index: pd.Index, d: dt.date) -> pd.Timestamp:
    """對齊既有 DatetimeIndex 上同一曆日的標籤;沒有則新建。"""
    for existing in reversed(list(index)):
        try:
            if pd.Timestamp(existing).date() == d:
                return pd.Timestamp(existing)
        except (TypeError, ValueError):
            continue
    ts = pd.Timestamp(d)
    tz = getattr(index, "tz", None)
    if tz is not None:
        ts = ts.tz_localize(tz)
    return ts


def _ensure_date_row(df: pd.DataFrame, ts: pd.Timestamp) -> pd.DataFrame:
    if ts in df.index:
        return df
    new_index = df.index.union(pd.Index([ts]), sort=True)
    return df.reindex(new_index)


def _ensure_date_value(s: pd.Series, ts: pd.Timestamp) -> pd.Series:
    if ts in s.index:
        return s
    new_index = s.index.union(pd.Index([ts]), sort=True)
    return s.reindex(new_index)


def _sample_price_mismatches(close: pd.DataFrame, twse: pd.DataFrame,
                             rel_tol: float = 0.03) -> list[dict]:
    """Only meaningful when TWSE snapshot date == last close index date."""
    mismatches = []
    codes = twse["Code"].astype(str) if "Code" in twse.columns else pd.Series(dtype=str)
    for sid in FRESHNESS_SAMPLE_IDS:
        row = twse[codes == sid]
        if row.empty:
            continue
        twse_px = _parse_twse_price(row.iloc[0].get("ClosingPrice"))
        yf_col = f"{sid}.TW"
        if twse_px is None or yf_col not in close.columns:
            continue
        yf_px = float(close[yf_col].iloc[-1])
        if not np.isfinite(yf_px) or twse_px <= 0:
            continue
        if abs(yf_px / twse_px - 1) > rel_tol:
            mismatches.append({"id": sid, "twse": twse_px, "yahoo": yf_px})
    return mismatches


def apply_twse_snapshot(ohlcv: dict, close: pd.DataFrame, volume: pd.DataFrame,
                        twii: pd.Series, twse: pd.DataFrame | None,
                        today: dt.date | None = None,
                        taiex_close: float | None = None) -> tuple:
    """用 TWSE 當日官方 OHLCV 覆蓋/補上市股最後一根。

    只在快照日期 == 台北「今天」時套用,避免把昨日 TWSE 寫進 Yahoo 已有的今日列。
    上櫃 (.TWO) 不在 STOCK_DAY_ALL,維持 Yahoo;若補了新的一日列,上櫃該列為 NaN
    (RS 計算會 ffill,型態偵測 dropna 後沿用上一根)。

    TWSE 收盤為未還原價。Yahoo 歷史列仍是 auto_adjust;最後一根官方收盤與
    Yahoo 慣例(最新收盤=未還原)一致,除權息當日仍可能和還原序列有落差。
    """
    today = today or taipei_today()
    overlay = {
        "applied": False,
        "source": None,
        "twse_date": None,
        "yahoo_date": None,
        "listed_filled": 0,
        "appended_row": False,
        "taiex_filled": False,
        "message": "no_twse",
    }
    if close is None or close.empty:
        overlay["message"] = "empty_close"
        return ohlcv, close, volume, twii, overlay

    overlay["yahoo_date"] = pd.Timestamp(close.index[-1]).date().isoformat()
    if twse is None or twse.empty:
        return ohlcv, close, volume, twii, overlay

    twse_date = _twse_snapshot_date(twse)
    overlay["twse_date"] = twse_date.isoformat() if twse_date else None
    if twse_date is None:
        overlay["message"] = "twse_date_unparsed"
        return ohlcv, close, volume, twii, overlay
    if twse_date != today:
        overlay["message"] = "twse_not_today"
        return ohlcv, close, volume, twii, overlay

    close = close.copy()
    volume = volume.copy()
    twii = twii.copy()
    ohlcv = {k: v.copy() for k, v in ohlcv.items()}
    ohlcv["Close"] = close
    ohlcv["Volume"] = volume

    ts = _index_timestamp(close.index, twse_date)
    appended = ts not in close.index
    if appended:
        ohlcv = {k: _ensure_date_row(df, ts) for k, df in ohlcv.items()}
        close = ohlcv["Close"]
        volume = ohlcv["Volume"]
        twii = _ensure_date_value(twii, ts)
        overlay["appended_row"] = True

    filled = 0
    for _, row in twse.iterrows():
        code = str(row.get("Code", "")).strip()
        ticker = f"{code}.TW"
        if ticker not in close.columns:
            continue
        cpx = _parse_twse_price(row.get("ClosingPrice"))
        if cpx is None or cpx <= 0:
            continue
        opx = _parse_twse_price(row.get("OpeningPrice"))
        hpx = _parse_twse_price(row.get("HighestPrice"))
        lpx = _parse_twse_price(row.get("LowestPrice"))
        vol = _parse_twse_price(row.get("TradeVolume"))
        if opx is None:
            opx = cpx
        if hpx is None:
            hpx = max(opx, cpx)
        if lpx is None:
            lpx = min(opx, cpx)
        close.at[ts, ticker] = cpx
        if ticker in volume.columns and vol is not None:
            volume.at[ts, ticker] = vol
        for key, px in (("Open", opx), ("High", hpx), ("Low", lpx), ("Close", cpx)):
            frame = ohlcv.get(key)
            if frame is not None and ticker in frame.columns:
                frame.at[ts, ticker] = px
        vol_frame = ohlcv.get("Volume")
        if vol_frame is not None and ticker in vol_frame.columns and vol is not None:
            vol_frame.at[ts, ticker] = vol
        filled += 1

    if taiex_close is not None and np.isfinite(taiex_close) and taiex_close > 0:
        twii.at[ts] = float(taiex_close)
        overlay["taiex_filled"] = True

    overlay["applied"] = filled > 0
    overlay["source"] = PRICE_SOURCE_TWSE if filled else None
    overlay["listed_filled"] = filled
    overlay["message"] = "appended" if appended and filled else (
        "overlaid" if filled else "twse_today_no_overlap"
    )
    return ohlcv, close, volume, twii, overlay


def resolve_same_day_prices(ohlcv: dict, close: pd.DataFrame, volume: pd.DataFrame,
                            twii: pd.Series, today: dt.date | None = None):
    """Yahoo 歷史 + TWSE 當日上市收盤。Neo 帳號就緒後在此接入 fetch_neo_day_all()。"""
    today = today or taipei_today()
    twse = fetch_twse_day_all()
    # neo = fetch_neo_day_all()  # future: overlay listed + TPEX when neo date == today
    taiex_date, taiex_px = fetch_twse_taiex()
    taiex_close = taiex_px if taiex_date == today else None
    ohlcv, close, volume, twii, overlay = apply_twse_snapshot(
        ohlcv, close, volume, twii, twse, today=today, taiex_close=taiex_close)
    if overlay.get("applied"):
        print(
            f"[prices] TWSE overlay {overlay['message']} "
            f"listed={overlay['listed_filled']} appended={overlay['appended_row']} "
            f"taiex={overlay['taiex_filled']} twse_date={overlay['twse_date']}",
            flush=True,
        )
    elif overlay.get("twse_date"):
        print(f"[prices] TWSE snapshot {overlay['twse_date']} ({overlay['message']})",
              flush=True)
    return ohlcv, close, volume, twii, twse, overlay


def check_freshness(close: pd.DataFrame, twii: pd.Series,
                    today: dt.date | None = None,
                    skip: bool = False,
                    twse: pd.DataFrame | None = None,
                    overlay: dict | None = None,
                    now: dt.datetime | None = None) -> dict:
    """確認價格序列已是當日交易日。

    Yahoo 已是今天時不因 TWSE 抽樣價差 >3% 擋下(還原價 vs 未還原、或已 overlay)。
    只在 TWSE 快照日期 == 價格序列最後日期時比價,且比價僅供紀錄。
    Yahoo 仍為昨日時:若 TWSE 已是今日,應先走 apply_twse_snapshot;套用失敗才重試。
    平日 14:00 後且 Yahoo/TWSE 都還沒有今日檔 → is_fresh=False,等備援時段。
    GitHub cron 若拖過午夜,台北 14:00 前仍接受上一交易日(今日盤未收)。
    """
    now = now or dt.datetime.now(TAIPEI_TZ)
    if now.tzinfo is None:
        now = now.replace(tzinfo=TAIPEI_TZ)
    today = today or now.date()
    data_date = pd.Timestamp(close.index[-1]).date()
    checked_at = now.isoformat()
    overlay = overlay or {}
    result = {
        "data_date": data_date.isoformat(),
        "is_fresh": True,
        "is_trading_day": is_likely_trading_day(today),
        "source_checked_at": checked_at,
        "message": "ok",
        "twse_cross_check": None,
        "price_overlay": overlay or None,
    }
    if skip:
        result["message"] = "skipped"
        return result

    if data_date >= today:
        if twse is None:
            twse = fetch_twse_day_all()
        if twse is not None:
            twse_date = _twse_snapshot_date(twse)
            # STOCK_DAY_ALL 常晚於 Yahoo 才換成當日檔。若拿前一交易日收盤
            # 去對 Yahoo 當日價,大漲股會被誤判成「資料未更新」
            # (例:2026-09-07 2454 Yahoo 4760 vs TWSE 9/4 快照 4415)。
            if twse_date is not None and twse_date < data_date:
                result["twse_cross_check"] = {
                    "ok": True,
                    "skipped": True,
                    "reason": "twse_stale",
                    "twse_date": twse_date.isoformat(),
                    "mismatches": [],
                }
                result["message"] = (
                    f"fresh（TWSE 快照 {twse_date} 尚未更新,略過交叉比價）"
                )
                return result

            mismatches = []
            if twse_date == data_date:
                mismatches = _sample_price_mismatches(close, twse)
            result["twse_cross_check"] = {
                "ok": len(mismatches) == 0,
                "skipped": False,
                "reason": "price_mismatch_ignored" if mismatches else "matched",
                "twse_date": twse_date.isoformat() if twse_date else None,
                "mismatches": mismatches,
                "warning": bool(mismatches),
            }
            extra = ""
            if overlay.get("applied"):
                extra = f"（已套用 TWSE 上市收盤 {overlay.get('listed_filled', 0)} 檔）"
            if mismatches:
                result["message"] = (
                    f"fresh{extra}（Yahoo/序列已是當日;TWSE 抽樣價差僅記錄不阻擋）: "
                    f"{mismatches}"
                )
            else:
                result["message"] = f"fresh{extra}"
            return result
        result["message"] = "fresh" + (
            f"（已套用 TWSE 上市收盤 {overlay.get('listed_filled', 0)} 檔）"
            if overlay.get("applied") else ""
        )
        return result

    # 價格序列日期落後
    if today.weekday() >= 5:
        result["is_trading_day"] = False
        result["is_fresh"] = True
        result["message"] = f"週末,沿用 {data_date}"
        return result

    if twse is None:
        twse = fetch_twse_day_all()
    twse_date = _twse_snapshot_date(twse) if twse is not None and not twse.empty else None

    # Delayed schedule past midnight: next calendar day, but today's session
    # has not closed. Accept last session instead of failing the late slot.
    if now.date() == today and now.time() < dt.time(14, 0) and twse_date != today:
        result["is_trading_day"] = False
        result["is_fresh"] = True
        result["message"] = f"今日盤未收(台北 {now.strftime('%H:%M')}),沿用 {data_date}"
        result["twse_cross_check"] = {
            "ok": True,
            "reason": "before_session_close",
            "twse_date": twse_date.isoformat() if twse_date else None,
        }
        return result

    result["is_trading_day"] = True
    result["is_fresh"] = False
    if twse_date == today:
        result["message"] = (
            f"今天({today}) TWSE 已有收盤但價格序列最後日期為 {data_date},"
            f"請稍後重試"
        )
        result["twse_cross_check"] = {
            "ok": False,
            "reason": "yahoo_stale",
            "twse_date": twse_date.isoformat(),
        }
        return result

    result["message"] = (
        f"今天({today}) Yahoo/TWSE 皆尚未有當日收盤"
        f"（Yahoo {data_date}, TWSE {twse_date}）,請稍後重試"
    )
    result["twse_cross_check"] = {
        "ok": False,
        "reason": "sources_stale",
        "twse_date": twse_date.isoformat() if twse_date else None,
    }
    return result


# ---------------------------------------------------------------- RS 計算
def compute_rs(close: pd.DataFrame) -> pd.DataFrame:
    close = close.dropna(axis=1, thresh=MIN_HISTORY).ffill()
    last = close.iloc[-1]

    perf = {}
    for name, n in TRADING_DAYS.items():
        perf[name] = last / close.iloc[-n - 1] if len(close) > n \
            else pd.Series(np.nan, index=close.columns)
    perf = pd.DataFrame(perf)

    weights = pd.Series({"3m": 2.0, "6m": 1.0, "9m": 1.0, "12m": 1.0})
    w = perf.notna().mul(weights, axis=1)
    score = (perf.fillna(0) * w).sum(axis=1) / w.sum(axis=1)
    score[perf["3m"].isna() | perf["6m"].isna()] = np.nan
    score = score.dropna()

    rs = (score.rank(pct=True) * 98 + 1).round(0).astype(int)

    hi52 = close.iloc[-min(len(close), 252):].max()
    lo52 = close.iloc[-min(len(close), 252):].min()
    out = pd.DataFrame({
        "RS": rs,
        "收盤價": last.round(2),
        "3月漲幅%": ((perf["3m"] - 1) * 100).round(1),
        "6月漲幅%": ((perf["6m"] - 1) * 100).round(1),
        "12月漲幅%": ((perf["12m"] - 1) * 100).round(1),
        "距52週高點%": ((last / hi52 - 1) * 100).round(1),
        "距52週低點%": ((last / lo52 - 1) * 100).round(1),
    }).dropna(subset=["RS"])
    return out.sort_values("RS", ascending=False)


# ---------------------------------------------------------------- 趨勢樣板
def compute_template(close: pd.DataFrame, volume: pd.DataFrame,
                     twii: pd.Series, rs: pd.Series) -> pd.DataFrame:
    close = close.ffill()
    c = close.iloc[-1]
    ma50 = close.rolling(50).mean()
    ma150 = close.rolling(150).mean()
    ma200 = close.rolling(200).mean()
    hi52 = close.iloc[-min(len(close), 252):].max()
    lo52 = close.iloc[-min(len(close), 252):].min()

    # RS線 = 股價 / 加權指數,6 週(30 個交易日)前比較
    twii_al = twii.reindex(close.index).ffill()
    rs_line = close.div(twii_al, axis=0)

    checks = pd.DataFrame({
        "1_價>150MA":   c > ma150.iloc[-1],
        "1_價>200MA":   c > ma200.iloc[-1],
        "2_150>200MA":  ma150.iloc[-1] > ma200.iloc[-1],
        "3_200MA向上":  ma200.iloc[-1] > ma200.iloc[-22] if len(close) > 222
                        else pd.Series(False, index=close.columns),
        "4_50>150MA":   ma50.iloc[-1] > ma150.iloc[-1],
        "4_50>200MA":   ma50.iloc[-1] > ma200.iloc[-1],
        "5_高於低點25%": c >= lo52 * 1.25,
        "6_距高點25%內": c >= hi52 * 0.75,
        "7_RS>=70":     rs.reindex(close.columns) >= 70,
        "7_RS線升6週":  rs_line.iloc[-1] > rs_line.iloc[-31] if len(close) > 31
                        else pd.Series(False, index=close.columns),
    }).fillna(False)
    # 註:原樣板第 8 條「股價 > 50MA」屬買進時機條件,已移除——
    #     保留正在均線下方、結構已對位、隔日可能突破的候選股。
    #     改以「距50MA%」欄位呈現離突破多近(負值=還在 50MA 下方)。
    near_50 = ((c / ma50.iloc[-1] - 1) * 100).round(1)

    avg_vol = (volume.reindex(columns=close.columns).iloc[-20:].mean() / 1000).round(0)
    out = pd.DataFrame({
        "通過項數": checks.sum(axis=1).astype(int),
        "通過樣板": checks.all(axis=1).map({True: "✔", False: ""}),
        "距50MA%": near_50,
        "20日均量(張)": avg_vol,
    })
    return out


# ---------------------------------------------------------------- 輸出
def export(result, template, universe, data_date, outdir="output"):
    import os
    os.makedirs(outdir, exist_ok=True)
    meta = universe.set_index("yf_ticker")
    result = result.join(meta[["stock_id", "stock_name", "市場", "industry_category"]])
    result = result.join(template)
    result = result.rename(columns={"stock_id": "代號", "stock_name": "名稱",
                                    "industry_category": "產業"})
    result.insert(0, "排名", range(1, len(result) + 1))
    cols = ["排名", "代號", "名稱", "市場", "產業", "RS", "收盤價",
            "通過樣板", "通過項數", "距50MA%", "20日均量(張)",
            "距52週高點%", "距52週低點%", "3月漲幅%", "6月漲幅%", "12月漲幅%"]
    result = result[cols].reset_index(drop=True)

    top = result[result["RS"] >= 85]
    passed = result[(result["通過樣板"] == "✔") &
                    (result["20日均量(張)"] >= MIN_AVG_VOL_ZHANG)]
    today = taipei_today().isoformat()

    passed.to_csv(f"{outdir}/趨勢樣板通過.csv", index=False, encoding="utf-8-sig")

    # TradingView 觀察清單:上市=TWSE、上櫃=TPEX,逗號分隔
    tv_prefix = passed["市場"].map({"上市": "TWSE", "上櫃": "TPEX"})
    tv_symbols = (tv_prefix + ":" + passed["代號"].astype(str)).dropna().tolist()
    with open(f"{outdir}/TradingView觀察清單.txt", "w", encoding="utf-8") as f:
        f.write(",".join(tv_symbols))

    top.to_csv(f"{outdir}/RS_85-100.csv", index=False, encoding="utf-8-sig")
    with pd.ExcelWriter(f"{outdir}/RS_全市場排名.xlsx", engine="openpyxl") as w:
        passed.to_excel(w, sheet_name="趨勢樣板通過", index=False)
        top.to_excel(w, sheet_name="RS 85-100", index=False)
        result.to_excel(w, sheet_name="全市場排名", index=False)
        widths = [6, 8, 14, 6, 16, 6, 10, 9, 9, 9, 12, 12, 12, 10, 10, 10]
        for ws in w.sheets.values():
            for col, width in zip("ABCDEFGHIJKLMNOP", widths):
                ws.column_dimensions[col].width = width
    with open(f"{outdir}/資料日期.txt", "w") as f:
        f.write(f"價格資料最後交易日:{data_date}\n執行日期:{today}\n")
    print(f"[{today}] 資料日期:{data_date}|排名 {len(result)} 檔|RS≥85:{len(top)} 檔|"
          f"通過趨勢樣板(含均量≥{MIN_AVG_VOL_ZHANG}張):{len(passed)} 檔")
    return result


# ---------------------------------------------------------------- 測試模式
def make_synthetic():
    rng = np.random.default_rng(42)
    dates = pd.bdate_range(end=dt.date.today(), periods=300)
    n = 60
    tickers = [f"{1000 + i}.TW" for i in range(n)]
    drift = rng.normal(0.0005, 0.002, n)
    rets = rng.normal(0, 0.02, (len(dates), n)) + drift
    close = pd.DataFrame(100 * np.exp(np.cumsum(rets, axis=0)), index=dates, columns=tickers)
    # 合成 OHLC:以 close 為基準加噪
    noise = rng.uniform(0.005, 0.02, close.shape)
    open_ = close * (1 + rng.uniform(-0.01, 0.01, close.shape))
    high = close * (1 + noise)
    low = close * (1 - noise)
    volume = pd.DataFrame(rng.integers(50_000, 5_000_000, (len(dates), n)),
                          index=dates, columns=tickers)
    twii = pd.Series(20000 * np.exp(np.cumsum(rng.normal(0.0003, 0.008, len(dates)))),
                     index=dates)
    uni = pd.DataFrame({
        "stock_id": [t[:4] for t in tickers],
        "stock_name": [f"測試{i}" for i in range(n)],
        "市場": "上市", "industry_category": "測試", "yf_ticker": tickers,
    })
    ohlcv = {"Open": open_, "High": high, "Low": low, "Close": close, "Volume": volume}
    return ohlcv, close, volume, twii, uni


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", action="store_true")
    ap.add_argument("--skip-patterns", action="store_true",
                    help="略過型態篩選與 App JSON 匯出")
    ap.add_argument("--skip-freshness", action="store_true",
                    help="略過資料新鮮度檢查，也略過休市提前結束(測試用)")
    args = ap.parse_args()

    if args.test:
        ohlcv, close, volume, twii, uni = make_synthetic()
        freshness = {
            "data_date": pd.Timestamp(close.index[-1]).date().isoformat(),
            "is_fresh": True,
            "is_trading_day": True,
            "source_checked_at": dt.datetime.now().isoformat(),
            "message": "test",
            "twse_cross_check": None,
        }
    else:
        if not args.skip_freshness:
            # 休市／週末沒有當日收盤。下載前 exit 0，避免整晚把休市當成資料延遲。
            ensure_market_open()
        uni = get_universe()
        print(f"股票池:{len(uni)} 檔(上市 {sum(uni['市場']=='上市')}、上櫃 {sum(uni['市場']=='上櫃')})")
        ohlcv, close, volume = fetch_prices(uni["yf_ticker"].tolist())
        twii = fetch_index()
        if args.skip_freshness:
            freshness = check_freshness(close, twii, skip=True)
        else:
            ohlcv, close, volume, twii, twse, overlay = resolve_same_day_prices(
                ohlcv, close, volume, twii)
            freshness = check_freshness(
                close, twii, skip=False, twse=twse, overlay=overlay)
        print(f"[freshness] {freshness['message']} | data_date={freshness['data_date']}",
              flush=True)
        if not freshness["is_fresh"]:
            print("ERROR: 資料尚未更新,退出等待備援排程重試。", flush=True)
            sys.exit(2)

    result = compute_rs(close)
    template = compute_template(close[result.index.tolist()], volume, twii, result["RS"])
    full = export(result, template, uni, data_date=close.index[-1].date())

    if not args.skip_patterns:
        from pattern_screener import screen_patterns
        from export_app_json import export_app_json
        from breakout_tracker import load_ledger, save_ledger, update_ledger
        patterns = screen_patterns(ohlcv, full, min_rs=85)

        # 突破交易帳本:pivot 在突破日凍結,逐日判定成功/失敗,彙整近兩週勝率
        ledger_path = os.path.join("output", "app", "breakouts_ledger.json")
        ledger = load_ledger(ledger_path)
        update_ledger(ledger, patterns, close, freshness["data_date"])
        save_ledger(ledger, ledger_path)
        m = ledger.get("market") or {}
        print(f"[breakouts] {m.get('label')} 勝率={m.get('win_rate')} "
              f"({m.get('wins')}勝{m.get('losses')}敗, 進行中 {m.get('pending')})", flush=True)

        export_app_json(full, patterns, ohlcv, freshness, outdir="output/app", ledger=ledger)


if __name__ == "__main__":
    main()
