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
- 基底:左高 → 底(確認 L),修正 12~60%;收盤 ≥ 200MA 且先前漲幅 ≥ 25%
  - **左高 = 從底部往回掃到「上一次股價低於底部」為止,這段期間的最高確認高點**(整段修正的起點),而不是底部前最後一個小反彈;階梯式下跌的大基底才能被完整認出
- 停頓區:底部之後 60 根內、高低差 ≤ 10%、≥ 5 根,不含今天;樞紐 = 停頓區高點
- **右側上限**:底部之後到停頓區結束,任何高點不得高於左高 5%。否則股價已脫離基底在漲,不是基底(交給 VCP / 高聳旗形 / 交易帳本);這條規則避免把飆漲後第一次回檔誤判成「杯柄」、樞紐落在最高上影線
- 停頓區中點在基底的相對位置決定子類型(卡片小字):下 1/3 **低位**、中 1/3 **中段 3-C**、上 1/3 **上緣(杯柄)**;杯柄要求基底 ≥ 6 週

### 突破交易帳本與市況(`breakout_tracker.py`)
- 每日把「近期突破」的主要型態記成一筆交易,樞紐在突破日凍結(`output/app/breakouts_ledger.json`,由 Actions commit)
- 之後逐日判定:收盤 ≥ 樞紐 +10% → **成功**;收盤 ≤ 樞紐 −5% → **失敗**
- 失敗後收盤回到樞紐下方 0~5% → **復甦**,重新注入「即將突破」;再收過樞紐則開一筆新交易
- **同代號仍有進行中時禁止再開**:候選突破日若落在既有交易的進行區間(突破日到判定日,含當日;尚未判定則仍視為進行中),不得再開新單。先前交易結束後的新突破(含復甦後再突破)仍可開。
- **市況** = 近 10 個交易日內(以判定日計)成功 ÷(成功+失敗);≥60% 良好、50~60% 中性、<50% 不佳;進行中不計入分母
- 前端「成功／失敗」清單與市況同一視窗;進行中／復甦不裁。舊的 `reentered` 列不進清單(新交易以「復甦後再突破」標示)。帳本仍保留歷史(復甦最多再追 60 根)
- 門檻集中在 `PatternParams`(`buy_zone_pct`、`success_pct`、`fail_pct`、`recent_bars`、`breakout_window_bars`)

## 每日自動更新(含資料新鮮度保護)

排程(週一到週五,台北時間):**17:30 / 18:00 / 18:30 / 19:00 / 19:30 / 20:00 / 20:30 / 21:00 / 21:30**。
若 `output/資料日期.txt` 已是今天則跳過,所以多時段只會成功 commit 一次。

**不要指望 17:00 準點。** GitHub Actions 的 `schedule` cron 不保證準時(常見延遲數十分鐘,有時約數小時);而且 17:00 時 Yahoo 與 TWSE `STOCK_DAY_ALL` 經常還停在前一交易日,新鮮度檢查會失敗等下一檔。本 workflow 從 17:30 開始、拉長到 21:30,並在 Yahoo 落後時用 **TWSE 上市收盤快照補當日 K 線**。若 cron 拖到台北次日凌晨,14:00 前會沿用上一交易日,避免整晚白跑。

手動跑:GitHub → **Actions** → **Daily Taiwan RS Update** → **Run workflow**。

需要更準點時,用外部 cron 打 `workflow_dispatch`(仍不要把 token 寫進 repo):

```bash
gh workflow run daily_rs.yml --repo smoli0725-droid/tw-rs-screener
```

價格來源(當日收盤):

1. **Yahoo Finance**:歷史 OHLCV(還原權息)與上櫃 `.TWO`;收盤後常落後
2. **TWSE OpenAPI `STOCK_DAY_ALL`**:上市官方未還原 OHLCV;快照日期已是今天時,覆蓋/補上上市最後一根,並嘗試用 `MI_INDEX` 的發行量加權補 `^TWII`
3. **富邦 Neo**(尚未實作):帳號就緒後在 `rs_calculator.fetch_neo_day_all()` 接入,可同時補上市+上櫃;憑證只放 Actions secrets

上櫃不在 TWSE 快照裡,Yahoo 若還沒今日檔,TPEX 當日列會是空的(RS 會 ffill 成昨日收盤;型態偵測沿用上一根)。除權息當日,TWSE 未還原收盤與 Yahoo 還原歷史拼在同一序列,單日報酬可能有落差。

平日若 Yahoo 與 TWSE 都還沒有今日檔,程式以 exit 2 結束、**不 commit 舊資料**,等下一個時段。Yahoo 已是今天時,即使抽樣價與 TWSE 差 >3% 也不再擋下(避免還原價誤殺)。

`output/` 的 commit 若與 `main` 上既有 RS 產物衝突,會改以「剛算完的 `output/`」為準 rebase/重放,不會 `--force` push `main`。

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
flutter build apk --debug    # Android 可直接安裝（debug 簽名）
# iOS(需 macOS + Xcode):
flutter build ios --no-codesign
```

預設資料來源（與網站相同的每日 JSON）:

```
https://tradingvenator.pages.dev/data
```

可在 App「設定」覆寫（GitHub raw `.../output/app` 仍可用）。HTTP 客戶端使用瀏覽器式 User-Agent，避免 Cloudflare 擋預設 Dart/Dio UA。突破清單會過濾 `status=reentered`。

## 網站版（`site/`，給 iPhone / 任何瀏覽器）

不需安裝 App。部署到 **Cloudflare Pages（免費）** 後，用 Safari 打開即可；可「加入主畫面」。  
Private repo 也能用（不必把 GitHub 改成 Public）。

功能對應 App：
- **整站需登入**（Clerk：Email magic link + Google）。未登入只看得到登入畫面，看不到 RS／型態／持股
- 持股與設定同步到雲端（D1）；本機 localStorage 只當快取。第一次登入會把既有 localStorage 上傳
- RS≥85 總表、型態／即將突破、K 線
- **教學**（底部導航「教學」，網址 `#teaching`）：X 風格短文列表（封面圖在標題上方），點進去看全文。純文字＋選填一張圖，沒有影片。一般登入使用者只能讀；只有站長能新增／編輯／刪除
- 設定資料來源（預設 `./data`）
- 帳號方案欄位 `plan`（預設 `free`）、`plan_expires_at`（目前無收費）

### 教學文章怎麼新增（僅站長）

內容種子在 git 裡的 `site/content/lessons.json`（**不要**放 `site/data/`，那個目錄會在部署時被每日 JSON 覆寫）。

兩種寫入方式（擇一）：

1. **改檔部署（最穩）**  
   在 `site/content/lessons.json` 的 `lessons` 陣列加一則：

   ```json
   {
     "id": "my-slug",
     "title": "標題",
     "published_at": "2026-09-18",
     "cover_url": "https://example.com/cover.jpg",
     "body": "純文字內文，可用換行。"
   }
   ```

   `cover_url` 選填，一張圖：`https://` 網址，或網站內路徑（如 `./icons/og-1200x630.png`）。提交後 Deploy Web Site 會把文章帶上線。`id` 只能是英數、點、底線、連字號。

2. **網站上編輯／刪除**  
   用站長 Clerk 帳號登入 → 教學 →「新增文章」。表單可貼封面圖網址（沒有上傳空間；把圖放到可公開 https 或 `site/icons` 後貼路徑）。列表與內頁會把圖放在標題上方。  
   刪除：列表或內頁按「刪除」→ 確認後寫入 D1。優先 `DELETE /api/lessons?id=`，失敗則 `PUT /api/lessons` 送剩下的文章。  
   站長判定：email 在 `site/js/config.js` 的 `OWNER_EMAILS`（預設 `smoli0725@gmail.com`），或 Clerk user **Public metadata** `{ "role": "owner" }`。後端可用 Pages secret `OWNER_EMAIL` 覆寫允許的 email（逗號分隔）。沒有 Functions／D1 時請改用方式 1。

### 第一次設定（Cloudflare Pages）

1. 註冊免費帳號：https://dash.cloudflare.com/sign-up
2. **先建立空專案**（名稱必須完全一致）：  
   Cloudflare → **Workers & Pages** → **Create** → **Pages** → **Upload assets** / Direct Upload  
   → Project name 填 `tradingvenator`（只能小寫）→ Create（不必真的上傳檔案）
3. 建立 API Token：  
   https://dash.cloudflare.com/profile/api-tokens  
   → **Create Token** → 使用範本 **Edit Cloudflare Workers**  
   （權限需含 Account / Cloudflare Pages / Edit；若要讓 Actions 建 D1／跑 migration，再加 **Account / D1 / Edit**；Account Resources 選你的帳號）
4. 複製 **Account ID**：Dashboard 右側 Overview 可看到
5. 回到 GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**，新增：
   - `CLOUDFLARE_API_TOKEN` = 剛才的 token
   - `CLOUDFLARE_ACCOUNT_ID` = Account ID
6. **Actions → Deploy Web Site → Run workflow**
7. 跑完後到 Cloudflare → Workers & Pages → **tradingvenator** → 會看到網址  
   （`https://tradingvenator.pages.dev`）

> 若 Actions 出現 `Project not found [code: 8000007]`，就是還沒建立名為 `tradingvenator` 的 Pages 專案。

之後每日 RS Actions 更新 `output/app/`，或你改 `site/` / `functions/`，都會自動重新部署。

### Authentication + cloud sync（Clerk + D1）

未完成下列步驟時：網站會顯示「尚未設定 Clerk」；API 在缺少 D1／secret 時回 503。不會把金鑰寫進 git。

#### 1) Clerk Dashboard

English / 中文步驟相同：

1. Open [dashboard.clerk.com](https://dashboard.clerk.com) → **Create application**（名稱例如 `FlashPick`）
2. **Sign-in options**
   - Enable **Email**（magic link / email code；可關 password）
   - Enable **Google**
3. **Configure → Domains / Paths**
   - Allowed origins / home URL 加上：
     - `https://tradingvenator.pages.dev`
     - `http://localhost:8788`（`wrangler pages dev`）
     - `http://localhost:8080`（靜態預覽）
   - Redirect URLs 同樣允許上述 origin（hash routing，sign-in 在 `/`）
4. **API keys** 複製：
   - Publishable key（`pk_test_…` / `pk_live_…`）
   - Secret key（`sk_test_…` / `sk_live_…`）— 只放 Cloudflare / GitHub secrets
   - 可選：**Show JWT public key** → PEM，存成 `CLERK_JWT_KEY`（Functions 可離線驗 token）

Production instance 請改用 `pk_live_` / `sk_live_`。

#### 2) Cloudflare D1

在有 `CLOUDFLARE_API_TOKEN` 的環境（本機或 CI）：

```bash
npx wrangler d1 create tradingvenator
# 複製輸出的 database_id
npx wrangler d1 execute tradingvenator --remote --file=migrations/0001_init.sql
```

`wrangler.toml` 的 `[[d1_databases]]` binding 名稱是 **`DB`**。Deploy workflow 會用 GitHub secret `D1_DATABASE_ID` 取代 placeholder；沒設這個 secret 時仍會部署網站，但 `/api/*` 沒有資料庫。

#### 3) GitHub + Pages secrets

GitHub → **Settings → Secrets and variables → Actions**：

| Secret | 用途 |
|---|---|
| `CLERK_PUBLISHABLE_KEY` | 部署時寫入 `site/js/config.js`、`<meta>`、`wrangler.toml [vars]` |
| `CLERK_SECRET_KEY` | **不要**進前端。放到 Cloudflare Pages secret（見下） |
| `CLERK_JWT_KEY` | 可選，PEM 公鑰 |
| `D1_DATABASE_ID` | `wrangler d1 create` 得到的 UUID |

Cloudflare → Pages → **tradingvenator** → Settings → Environment variables（Production **and** Preview）：

```bash
npx wrangler pages secret put CLERK_SECRET_KEY --project-name=tradingvenator
# optional
npx wrangler pages secret put CLERK_JWT_KEY --project-name=tradingvenator
```

`CLERK_PUBLISHABLE_KEY` 由每次 deploy 寫進 wrangler `[vars]`，不必再在 Dashboard 設一次。

若之後接自訂網域，請加到：(1) Clerk allowed origins (2) `functions/_lib/cors.js` 的 production origin 或 Pages env `ALLOWED_ORIGINS`。

### 怎麼驗證 / How to verify

**本機（建議，含 API）**

```bash
cp -r output/app site/data
cp .dev.vars.example .dev.vars   # 填入 pk_ / sk_
cd functions && npm ci && cd ..
npx wrangler d1 execute tradingvenator --local --file=migrations/0001_init.sql
npx wrangler pages dev
```

1. 打開 wrangler 印出的 URL（通常 `http://localhost:8788`）
2. 未登入：只能看到登入畫面，看不到持股／RS
3. Email magic link 或 Google 登入後出現主畫面與右上角 UserButton
4. 新增一筆持股 → 重新整理後還在；DevTools → Network 應有 `GET /api/me`、`PUT /api/data`（`Authorization: Bearer …`）
5. 未帶 token 呼叫 API 應為 401：
   `curl -i http://localhost:8788/api/me`

僅靜態預覽（**沒有** Functions / 同步）：

```bash
cp -r output/app site/data
# 可把 site/js/config.js 的 __CLERK_PUBLISHABLE_KEY__ 換成 pk_test_…
cd site && python3 -m http.server 8080
```

**Pages（secrets 設好並重新 Run workflow 之後）**

1. `https://tradingvenator.pages.dev` 未登入被擋
2. 登入後設定頁顯示帳號 email 與 `plan: free`
3. 持股在另一個瀏覽器登入同一帳號後會出現（雲端同步）

### 架構摘要

- Frontend：`site/js/auth.js` 載入 `@clerk/clerk-js` CDN；`storage.js` 登入後拉雲端、變更時 PUT
- Backend：Cloudflare Pages Functions（`functions/api/me.js`、`functions/api/data.js`）用 `@clerk/backend` `authenticateRequest`
- CORS 只允許 `https://tradingvenator.pages.dev` 與 localhost
- 每日 RS Python pipeline（`rs_calculator.py` / `daily_rs.yml`）與 Flutter App **沒有**改動

本地預覽（舊的純靜態方式仍可用，但沒有 API）：

```bash
cp -r output/app site/data
cd site && python3 -m http.server 8080
```

### 背景更新說明
- Android:`android_alarm_manager_plus` 每日約 17:00 背景刷新持股價並推播損益;若推薦資料仍舊會約 45 分鐘後重試。另會排程本地通知提醒。
- iOS:背景執行時機由系統決定,不保證準點;會排程本地通知,開啟 App 仍會立即刷新。

## 已知限制
- Yahoo Finance 偶爾漏個別上櫃股或暫時限流;上市當日收盤改以 TWSE 快照補,上櫃仍靠 Yahoo,失敗時由後續時段重試
- GitHub cron 不準點;要準時請用外部排程觸發 `workflow_dispatch`(見上方)
- RS 是「相對強度排名」,不是買進訊號——請搭配型態與量價條件
- 型態偵測為啟發式量化,門檻集中在 `pattern_screener.py` 的 `PatternParams`
- 網站版整站需 Clerk 登入；未設定 Publishable Key 時只會看到設定提示，不會顯示 RS 名單
