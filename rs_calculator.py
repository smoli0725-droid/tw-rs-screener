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

用法:
  python rs_calculator.py          # 正式執行
  python rs_calculator.py --test   # 合成資料測試
"""
import argparse
import datetime as dt
import numpy as np
import pandas as pd

FINMIND_URL = "https://api.finmindtrade.com/api/v4/data"
EXCLUDE_INDUSTRY = {"ETF", "ETN", "受益證券", "存託憑證", "上市指數投資證券(ETN)"}
TRADING_DAYS = {"3m": 63, "6m": 126, "9m": 189, "12m": 252}
MIN_HISTORY = 130        # 至少約半年資料才納入 RS 排名
MIN_AVG_VOL_ZHANG = 200  # 樣板名單的 20 日均量門檻(張),依個人資金規模調整


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
    """回傳 (close, volume):index=日期, columns=yf_ticker(還原權息)"""
    import yfinance as yf
    closes, vols = [], []
    for i in range(0, len(tickers), chunk):
        batch = tickers[i:i + chunk]
        print(f"下載 {i + 1}–{i + len(batch)} / {len(tickers)} ...", flush=True)
        data = yf.download(batch, period="400d", auto_adjust=True,
                           threads=True, progress=False)
        c, v = data["Close"], data["Volume"]
        if isinstance(c, pd.Series):
            c, v = c.to_frame(batch[0]), v.to_frame(batch[0])
        closes.append(c)
        vols.append(v)
    close = pd.concat(closes, axis=1)
    volume = pd.concat(vols, axis=1)
    close = close.loc[:, ~close.columns.duplicated()].sort_index()
    volume = volume.loc[:, ~volume.columns.duplicated()].sort_index()
    return close, volume


def fetch_index() -> pd.Series:
    """台灣加權指數(RS線基準)"""
    import yfinance as yf
    twii = yf.download("^TWII", period="400d", auto_adjust=True,
                       progress=False)["Close"]
    if isinstance(twii, pd.DataFrame):
        twii = twii.iloc[:, 0]
    return twii.sort_index()


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
    today = dt.date.today().isoformat()

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
    volume = pd.DataFrame(rng.integers(50_000, 5_000_000, (len(dates), n)),
                          index=dates, columns=tickers)
    twii = pd.Series(20000 * np.exp(np.cumsum(rng.normal(0.0003, 0.008, len(dates)))),
                     index=dates)
    uni = pd.DataFrame({
        "stock_id": [t[:4] for t in tickers],
        "stock_name": [f"測試{i}" for i in range(n)],
        "市場": "上市", "industry_category": "測試", "yf_ticker": tickers,
    })
    return close, volume, twii, uni


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", action="store_true")
    args = ap.parse_args()

    if args.test:
        close, volume, twii, uni = make_synthetic()
    else:
        uni = get_universe()
        print(f"股票池:{len(uni)} 檔(上市 {sum(uni['市場']=='上市')}、上櫃 {sum(uni['市場']=='上櫃')})")
        close, volume = fetch_prices(uni["yf_ticker"].tolist())
        twii = fetch_index()

    result = compute_rs(close)
    template = compute_template(close[result.index.tolist()], volume, twii, result["RS"])
    export(result, template, uni, data_date=close.index[-1].date())


if __name__ == "__main__":
    main()
