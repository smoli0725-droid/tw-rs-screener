# 台股全市場 RS Rating 自動計算器

Minervini / IBD 風格的 RS Rating(1–99 百分位),涵蓋全部上市+上櫃普通股,
每個交易日自動更新,輸出 RS 85–100 名單(CSV + Excel)。

## RS 計算方式
score = 2×(3個月報酬) + (6個月) + (9個月) + (12個月)
→ 全市場百分位排名 → 映射到 1–99(IBD 反推公式,3個月權重加倍)
- 使用 Yahoo Finance「還原權息」價格,避免台股高殖利率除息扭曲 RS
- 排除 ETF / ETN / DR / 受益證券;上市未滿一年者以可得期間加權

## 本機執行
```
pip install -r requirements.txt
python rs_calculator.py          # 約 5–15 分鐘(下載全市場價格)
python rs_calculator.py --test   # 合成資料快速測試
```
輸出在 `output/`:
- `RS_85-100.csv` — 直接匯入你的篩選流程
- `RS_全市場排名.xlsx` — 兩個分頁(RS 85-100 / 全市場排名)

## 每日自動更新(GitHub Actions,免費)
1. 在 GitHub 建一個新 repo(可設 private)
2. 把整個資料夾 push 上去(包含 `.github/workflows/daily_rs.yml`)
3. Repo → Settings → Actions → General → Workflow permissions
   → 勾選 **Read and write permissions** → Save
4. Actions 頁面 → Daily Taiwan RS Update → **Run workflow** 先手動跑一次驗證
5. 之後每個交易日 18:30(台北時間)自動執行,結果直接 commit 回 repo 的
   `output/` 資料夾,手機開 GitHub 就能下載最新 CSV

## 已知限制
- Yahoo Finance 偶爾漏個別上櫃股或暫時限流;workflow 失敗時隔天會自動再跑,
  也可以手動 Run workflow 重試
- RS 是「相對強度排名」,不是買進訊號——記得搭配你的趨勢樣板和量價條件用
