# 台股全市場 RS Rating 自動計算器 + 選股 App

Minervini / IBD 風格的 RS Rating(1–99 百分位),涵蓋全部上市+上櫃普通股,
每個交易日自動更新,輸出 RS 85–100 名單(CSV + Excel),並產生 Flutter App
用的 JSON(型態篩選 / 即將突破)。

## RS 計算方式
score = 2×(3個月報酬) + (6個月) + (9個月) + (12個月)
→ 全市場百分位排名 → 映射到 1–99(IBD 反推公式,3個月權重加倍)
- 使用 Yahoo Finance「還原權息」價格,避免台股高殖利率除息扭曲 RS
- 排除 ETF / ETN / DR / 受益證券;上市未滿一年者以可得期間加權

## 趨勢樣板與型態篩選
- 趨勢樣板通過名單仍輸出至 `output/趨勢樣板通過.csv`
- 四種型態偵測(`pattern_screener.py`):VCP、作弊型態、雙重底、高聳旗形
- **型態掃描池 = RS≥85 且通過趨勢樣板**(不再掃未過樣板的 RS 強勢股)
- App JSON 輸出至 `output/app/`:`meta.json`、`rs85.json`、`patterns.json`、`breakouts.json`、`ohlcv/{代號}.json`

### 樞紐(pivot)與狀態規則
- 樞紐必須是**已確認的阻力**:收縮段 / 柄 / 停頓區的高點,且之後價格曾在其下方;ZigZag 結尾尚未確認的高低點(最新引線)不可當樞紐
- **型態時效**:最後一個結構點需在最近 60 根 K 內;**突破時效**:收盤首次站上樞紐需在最近 10 根 K 內
- **一檔一型態**:四個偵測器都跑,但只保留**結構完成日最新**的一個(同日再看狀態、分數),`patterns.json` 每檔只有一筆
- 狀態:

| 狀態 | 條件 |
|---|---|
| 即將突破 | 收盤在樞紐下方 0~5%,且 10 日均量 / 50 日均量 < 1 |
| 已突破(可買池) | 近 10 根內突破,收盤在樞紐上方 0~5% |
| 整理中 | 其餘 |

- 收盤高於樞紐 5% 以上(或突破早於 10 根)的「已延伸」**不進型態清單**,只由交易帳本追蹤成功/失敗

### 作弊型態(合併 3-C / 低位作弊 / 杯狀帶柄)
- 基底:左高(確認 H)→ 底(確認 L),修正 12~60%;收盤 ≥ 200MA 且先前漲幅 ≥ 25%
- 停頓區:底部之後 60 根內、高低差 ≤ 10%、≥ 5 根,不含今天;樞紐 = 停頓區高點
- **右側上限**:底部之後到停頓區結束,任何高點不得高於左高 5%。否則股價已脫離基底在漲,不是基底(交給 VCP / 高聳旗形 / 交易帳本);這條規則避免把飆漲後第一次回檔誤判成「杯柄」、樞紐落在最高上影線
- 停頓區中點在基底的相對位置決定子類型(卡片小字):下 1/3 **低位**、中 1/3 **中段 3-C**、上 1/3 **上緣(杯柄)**;杯柄要求基底 ≥ 6 週

### 突破交易帳本與市況(`breakout_tracker.py`)
- 每日把「近期突破」的主要型態記成一筆交易,樞紐在突破日凍結(`output/app/breakouts_ledger.json`,由 Actions commit)
- 之後逐日判定:收盤 ≥ 樞紐 +10% → **成功**;收盤 ≤ 樞紐 −5% → **失敗**
- 失敗後收盤回到樞紐下方 0~5% → **復甦**,重新注入「即將突破」;再收過樞紐則開一筆新交易
- **市況** = 近 10 個交易日內(以判定日計)成功 ÷(成功+失敗);≥60% 良好、50~60% 中性、<50% 不佳;進行中不計入分母
- 門檻集中在 `PatternParams`(`buy_zone_pct`、`success_pct`、`fail_pct`、`recent_bars`、`breakout_window_bars`)

## 每日自動更新(含資料新鮮度保護)
- 排程:台北 **17:00 / 18:30 / 20:00**(主跑 + 備援)。若 `資料日期.txt` 已是今天則跳過。
- Yahoo 資料若落後當日交易日,會以 TWSE OpenAPI 確認後**失敗退出、不 commit 舊資料**,等備援時段重試。
- 手動跑:Actions → Daily Taiwan RS Update → **Run workflow**

```bash
python rs_calculator.py          # 正式
python rs_calculator.py --test   # 合成資料
pytest tests/
```

## Flutter App(`app/`)

兩個介面、三種功能:

1. **持股**:輸入代號 / 成本 / 股數(交易紀錄),開啟 App 或下拉刷新抓最新價與收益率;點入看 K 線。績效頁含月績效 / 勝率 / 平均報酬率。
2. **推薦**
   - RS≥85 總表(由高到低,可搜尋 / 市場 / 樣板過濾)
   - 型態篩選 / 即將突破(四種型態 + 狀態 chip)
3. **設定**:GitHub raw URL、每日更新時間(預設 17:00)、通知開關。頁面顯示資料日期;過期會提示「資料尚未更新」。

### 建置

```bash
cd app
flutter pub get
flutter test
flutter build apk --debug    # Android 可直接安裝
# iOS(需 macOS + Xcode):
flutter build ios --no-codesign
```

預設資料來源:

```
https://raw.githubusercontent.com/smoli0725-droid/tw-rs-screener/main/output/app
```

若 fork 到其他 repo,到 App「設定」改 raw URL。

## 網站版（`site/`，給 iPhone / 任何瀏覽器）

不需安裝 App。部署到 **Cloudflare Pages（免費）** 後，用 Safari 打開即可；可「加入主畫面」。  
Private repo 也能用（不必把 GitHub 改成 Public）。

功能對應 App：
- 持股（存在瀏覽器 localStorage）
- RS≥85 總表、型態／即將突破
- K 線
- 設定資料來源（預設 `./data`）

### 第一次設定（約 5 分鐘）

1. 註冊免費帳號：https://dash.cloudflare.com/sign-up
2. **先建立空專案**（名稱必須完全一致）：  
   Cloudflare → **Workers & Pages** → **Create** → **Pages** → **Upload assets** / Direct Upload  
   → Project name 填 `tradingvenator`（只能小寫）→ Create（不必真的上傳檔案）
3. 建立 API Token：  
   https://dash.cloudflare.com/profile/api-tokens  
   → **Create Token** → 使用範本 **Edit Cloudflare Workers**  
   （權限需含 Account / Cloudflare Pages / Edit；Account Resources 選你的帳號）
4. 複製 **Account ID**：Dashboard 右側 Overview 可看到
5. 回到 GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**，新增兩個：
   - `CLOUDFLARE_API_TOKEN` = 剛才的 token
   - `CLOUDFLARE_ACCOUNT_ID` = Account ID
6. **Actions → Deploy Web Site → Run workflow**
7. 跑完後到 Cloudflare → Workers & Pages → **tradingvenator** → 會看到網址  
   （`https://tradingvenator.pages.dev`）

> 若 Actions 出現 `Project not found [code: 8000007]`，就是還沒建立名為 `tradingvenator` 的 Pages 專案。

之後每日 RS Actions 更新 `output/app/`，或你改 `site/`，都會自動重新部署。

本地預覽：

```bash
cp -r output/app site/data
cd site && python3 -m http.server 8080
```

### 背景更新說明
- Android:`android_alarm_manager_plus` 每日約 17:00 背景刷新持股價並推播損益;若推薦資料仍舊會約 45 分鐘後重試。另會排程本地通知提醒。
- iOS:背景執行時機由系統決定,不保證準點;會排程本地通知,開啟 App 仍會立即刷新。

## 已知限制
- Yahoo Finance 偶爾漏個別上櫃股或暫時限流;workflow 失敗時備援時段 / 隔天會再跑
- RS 是「相對強度排名」,不是買進訊號——請搭配型態與量價條件
- 型態偵測為啟發式量化,門檻集中在 `pattern_screener.py` 的 `PatternParams`
- 每日 commit `output/app/` 會讓 repo 隨時間變大;必要時可改推到獨立 data 分支
