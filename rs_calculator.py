# -*- coding: utf-8 -*-
"""
台股全市場 RS Rating 計算器(Minervini / IBD 風格)
================================================
- 股票池:上市(TWSE)+ 上櫃(TPEX)普通股,排除 ETF/ETN/DR/受益證券
- 資料:Yahoo Finance 還原權息收盤價(auto_adjust=True,避免除息扭曲 RS)
- RS 公式(IBD 反推加權):score = 2*(3個月報酬) + (6個月) + (9個月) + (12個月)
  → 全市場百分位排名,映射到 1–99
- 輸出:output/RS_85-100.csv、output/RS_全市場排名.xlsx

用法:
  python rs_calculator.py          # 正式執行(需要網路)
  python rs_calculator.py --test   # 用合成資料測試計算與輸出邏輯
"""
import argparse
import datetime as dt
import sys
import numpy as np
import pandas as pd

FINMIND_URL = "https://api.finmindtrade.com/api/v4/data"
EXCLUDE_INDUSTRY = {"ETF", "ETN", "受益證券", "存託憑證", "上市指數投資證券(ETN)"}
TRADING_DAYS = {"3m": 63, "6m": 126, "9m": 189, "12m": 252}
MIN_HISTORY = 130  # 至少約半年資料才納入排名


# ---------------------------------------------------------------- 股票池
def get_universe() -> pd.DataFrame:
    import requests
    r = requests.get(FINMIND_URL, params={"dataset": "TaiwanStockInfo"}, timeout=60)
    r.raise_for_status()
    df = pd.DataFrame(r.json()["data"])
    df = df[df["type"].isin(["twse", "tpex"])]
    df = df[df["stock_id"].str.fullmatch(r"\d{4}")]          # 4 碼普通股
    df = df[~df["stock_id"].str.startswith("00")]             # 排除 ETF 代號
    df = df[~df["industry_category"].isin(EXCLUDE_INDUSTRY)]
    df = df.drop_duplicates(subset="stock_id")
    df["yf_ticker"] = df.apply(
        lambda x: f"{x.stock_id}.TW" if x.type == "twse" else f"{x.stock_id}.TWO", axis=1
    )
    df["市場"] = df["type"].map({"twse": "上市", "tpex": "上櫃"})
    return df[["stock_id", "stock_name", "市場", "industry_category", "yf_ticker"]]


# ---------------------------------------------------------------- 抓價格
def fetch_prices(tickers: list, chunk: int = 200) -> pd.DataFrame:
    """回傳 DataFrame:index=日期, columns=yf_ticker, 值=還原收盤價"""
    import yfinance as yf
    frames = []
    for i in range(0, len(tickers), chunk):
        batch = tickers[i:i + chunk]
        print(f"下載 {i + 1}–{i + len(batch)} / {len(tickers)} ...", flush=True)
        data = yf.download(batch, period="400d", auto_adjust=True,
                           threads=True, progress=False)["Close"]
        if isinstance(data, pd.Series):
            data = data.to_frame(batch[0])
        frames.append(data)
    close = pd.concat(frames, axis=1)
    close = close.loc[:, ~close.columns.duplicated()]
    return close.sort_index()


# ---------------------------------------------------------------- RS 計算
def compute_rs(close: pd.DataFrame) -> pd.DataFrame:
    close = close.dropna(axis=1, thresh=MIN_HISTORY).ffill()
    last = close.iloc[-1]

    perf = {}
    for name, n in TRADING_DAYS.items():
        if len(close) > n:
            perf[name] = last / close.iloc[-n - 1]
        else:
            perf[name] = pd.Series(np.nan, index=close.columns)
    perf = pd.DataFrame(perf)

    # 加權:3m 權重 2,其餘各 1;上市未滿一年者用可得期間重新正規化權重
    weights = pd.Series({"3m": 2.0, "6m": 1.0, "9m": 1.0, "12m": 1.0})
    valid = perf.notna()
    valid &= pd.DataFrame({c: [True] * len(perf) for c in perf.columns}, index=perf.index)
    w = valid.mul(weights, axis=1)
    score = (perf.fillna(0) * w).sum(axis=1) / w.sum(axis=1)
    score[perf["3m"].isna() | perf["6m"].isna()] = np.nan   # 至少要有 3m+6m
    score = score.dropna()

    rs = (score.rank(pct=True) * 98 + 1).round(0).astype(int)

    hi52 = close.iloc[-min(len(close), 252):].max()
    out = pd.DataFrame({
        "RS": rs,
        "收盤價": last.round(2),
        "3月漲幅%": ((perf["3m"] - 1) * 100).round(1),
        "6月漲幅%": ((perf["6m"] - 1) * 100).round(1),
        "12月漲幅%": ((perf["12m"] - 1) * 100).round(1),
        "距52週高點%": ((last / hi52 - 1) * 100).round(1),
    }).dropna(subset=["RS"])
    return out.sort_values("RS", ascending=False)


# ---------------------------------------------------------------- 輸出
def export(result: pd.DataFrame, universe: pd.DataFrame, outdir: str = "output"):
    import os
    os.makedirs(outdir, exist_ok=True)
    meta = universe.set_index("yf_ticker")
    result = result.join(meta[["stock_id", "stock_name", "市場", "industry_category"]])
    result = result.rename(columns={"stock_id": "代號", "stock_name": "名稱",
                                    "industry_category": "產業"})
    result.insert(0, "排名", range(1, len(result) + 1))
    cols = ["排名", "代號", "名稱", "市場", "產業", "RS", "收盤價",
            "3月漲幅%", "6月漲幅%", "12月漲幅%", "距52週高點%"]
    result = result[cols].reset_index(drop=True)

    top = result[result["RS"] >= 85]
    today = dt.date.today().isoformat()

    top.to_csv(f"{outdir}/RS_85-100.csv", index=False, encoding="utf-8-sig")
    with pd.ExcelWriter(f"{outdir}/RS_全市場排名.xlsx", engine="openpyxl") as w:
        top.to_excel(w, sheet_name="RS 85-100", index=False)
        result.to_excel(w, sheet_name="全市場排名", index=False)
        for ws in w.sheets.values():
            for col, width in zip("ABCDEFGHIJK", [6, 8, 14, 6, 16, 6, 10, 10, 10, 10, 12]):
                ws.column_dimensions[col].width = width
    print(f"[{today}] 完成:共 {len(result)} 檔納入排名,RS≥85 有 {len(top)} 檔")
    print(f"輸出:{outdir}/RS_85-100.csv、{outdir}/RS_全市場排名.xlsx")
    return result, top


# ---------------------------------------------------------------- 測試模式
def make_synthetic():
    rng = np.random.default_rng(42)
    dates = pd.bdate_range(end=dt.date.today(), periods=300)
    n = 60
    tickers = [f"{1000 + i}.TW" for i in range(n)]
    drift = rng.normal(0.0005, 0.002, n)          # 各股不同趨勢 → 製造 RS 差異
    rets = rng.normal(0, 0.02, (len(dates), n)) + drift
    close = pd.DataFrame(100 * np.exp(np.cumsum(rets, axis=0)), index=dates, columns=tickers)
    uni = pd.DataFrame({
        "stock_id": [t[:4] for t in tickers],
        "stock_name": [f"測試{i}" for i in range(n)],
        "市場": "上市", "industry_category": "測試", "yf_ticker": tickers,
    })
    return close, uni


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", action="store_true")
    args = ap.parse_args()

    if args.test:
        close, uni = make_synthetic()
    else:
        uni = get_universe()
        print(f"股票池:{len(uni)} 檔(上市 {sum(uni['市場']=='上市')}、上櫃 {sum(uni['市場']=='上櫃')})")
        close = fetch_prices(uni["yf_ticker"].tolist())

    result = compute_rs(close)
    export(result, uni)


if __name__ == "__main__":
    main()
