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
- 六種型態偵測(`pattern_screener.py`):VCP、3-C 作弊、低位作弊、杯狀帶柄、雙重底、高聳旗形
- **型態掃描池 = RS≥85 且通過趨勢樣板**(不再掃未過樣板的 RS 強勢股)
- App JSON 輸出至 `output/app/`:`meta.json`、`rs85.json`、`patterns.json`、`ohlcv/{代號}.json`

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
   - 型態篩選 / 即將突破(六種型態 + 狀態 chip)
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

### 背景更新說明
- Android:`android_alarm_manager_plus` 每日約 17:00 背景刷新持股價並推播損益;若推薦資料仍舊會約 45 分鐘後重試。另會排程本地通知提醒。
- iOS:背景執行時機由系統決定,不保證準點;會排程本地通知,開啟 App 仍會立即刷新。

## 已知限制
- Yahoo Finance 偶爾漏個別上櫃股或暫時限流;workflow 失敗時備援時段 / 隔天會再跑
- RS 是「相對強度排名」,不是買進訊號——請搭配型態與量價條件
- 型態偵測為啟發式量化,門檻集中在 `pattern_screener.py` 的 `PatternParams`
- 每日 commit `output/app/` 會讓 repo 隨時間變大;必要時可改推到獨立 data 分支
