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
- **同代號進行區間不得重疊**:區間是突破日到判定日(含當日;尚未判定則從突破日起仍算進行中)。新單會先結算,整段區間與既有交易相交就捨棄,不能只看候選突破日當天。沒有另外的最短間隔天數——上一筆判定日的下一個交易日就可以開(含復甦後再突破)。`breakout_window_bars`(預設 10 根)只是尋找穿越的回看長度,不是兩筆交易的最小間距。
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

**備援**:OpenAPI `STOCK_DAY_ALL` 常比證交所網站晚好幾個小時換日。它還沒有目標交易日(14:00 後為今天,之前為上一交易日)時,改抓證交所網站 `rwd/zh/afterTrading/MI_INDEX?date=YYYYMMDD`(可指定日期,含加權指數)補上市;上櫃則用櫃買 OpenAPI `tpex_mainboard_daily_close_quotes` 補 `.TWO`。只補 Yahoo 還沒有的日期(或今天),不覆蓋更新的資料。

若櫃買 OpenAPI 也還沒有,上櫃不在 TWSE 快照裡,Yahoo 若還沒今日檔,TPEX 當日列會是空的(RS 會 ffill 成昨日收盤;型態偵測沿用上一根)。除權息當日,TWSE 未還原收盤與 Yahoo 還原歷史拼在同一序列,單日報酬可能有落差。

平日若 Yahoo 與 TWSE 都還沒有今日檔,程式以 exit 2 結束、**不 commit 舊資料**,等下一個時段。Yahoo 已是今天時,即使抽樣價與 TWSE 差 >3% 也不再擋下(避免還原價誤殺)。

Yahoo 盤後常先給一列「只有成交量、OHLC 全是 NaN」的當日列。收盤覆蓋率不到 50% 的尾端列會先剔除(`drop_incomplete_tail`),資料日期以剔除後為準;否則新鮮度會誤判成已更新,App K 線卻停在前一日。

排程拖過午夜時(台北 14:00 前),價格序列必須已有**上一交易日**(依休市表推算)才算新鮮;TWSE 快照若是 Yahoo 還沒有的上一交易日,也會用它補上市那一根。兩者都沒有就 exit 2 等下一個時段,不會把更舊的收盤標成新日期。

週末與證交所休市日(國定假日、補假、只辦結算交割的無交易日)在下載全市場之前就結束:日誌 `今天(YYYY-MM-DD)休市，略過`,exit 0,不重算、不 commit。休市表先打 TWSE holidaySchedule;該年沒有資料或連線失敗時用 `data/twse_market_closures.json`(2026 為證交所公布表,2027 在證交所尚未公布前依行政院辦公日曆表的平日放假)。名稱含「開始交易」或「最後交易」的列不是休市。颱風等臨時休市若寫在休市表,或出現在當日(或前一日宣布明日)的 TWSE 新聞標題,同樣略過。判斷失敗則視為交易日,資料晚到仍 exit 2。休市略過沒有新 commit,Deploy Web Site 不會因這次 Daily RS 成功而重部署。若要在休市日強制重算,可 `python rs_calculator.py --skip-freshness`(排程不會這樣做)。

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

### 教學文章怎麼新增（僅站長，全在網站上）

新增、編輯、刪除、封面圖都在網站完成。不必改 git、也不必貼圖片網址。

1. 用站長 Clerk 帳號登入
2. 底部 **教學** → **＋ 新增文章**（或內頁 **編輯**）
3. 填標題、日期、內文；封面按 **選擇圖片上傳**（jpeg / png / webp，最大 5MB）
4. **儲存**。列表與內頁把圖放在標題上方
5. **刪除**：列表或內頁按「刪除」→ 確認後寫入雲端

站長判定：email 在 `site/js/config.js` 的 `OWNER_EMAILS`（預設 `smoli0725@gmail.com`），或 Clerk user **Public metadata** `{ "role": "owner" }`。後端可用 Pages secret `OWNER_EMAIL` 覆寫允許的 email（逗號分隔）。

封面檔案會存進 Cloudflare R2。這是**一次性基礎設施**（見下），設好之後發文只走上面的網站步驟。

#### 一次性基礎設施：教學封面 R2

讓網站上的「選擇圖片上傳」能存圖。**不是**日常發文步驟；建好後不必再碰。

1. Cloudflare Dashboard → **R2 Object Storage** → **Create bucket**
   - Bucket name 填 **`flashpick-teaching`**
   - 不必開 public access
2. GitHub → Settings → Secrets and variables → Actions，新增 `R2_TEACHING_BUCKET` = `flashpick-teaching`。之後 Deploy Web Site 會把 `wrangler.toml` 的 `[[r2_buckets]]` binding **`TEACHING_COVERS`** 帶上，並嘗試 `wrangler r2 bucket create`（bucket 已存在會略過）。
   Dashboard 備援：Pages → **tradingvenator** → Settings → Bindings → R2 → Variable name `TEACHING_COVERS` → bucket `flashpick-teaching`。**仍要設 GitHub secret**，否則下次 wrangler deploy 會拿掉 toml 裡的 binding。
3. 重新跑 **Actions → Deploy Web Site**。

公開讀取路徑是 **`/covers/{uuid}.jpg|png|webp`**（不必把 bucket 設成 public）。非站長呼叫上傳 API 會 401／403。Token 若要讓 Actions 自動建 bucket，需 **Account / Workers R2 Storage / Edit**；沒有就在 Dashboard 建一次即可。

沒綁定時，網站選檔會顯示設定錯誤（API 503），發文流程仍是同一個表單。

`site/content/lessons.json` 只當尚未寫入 D1 時的種子，日常發文不要改它。不要把文章放進 `site/data/`（部署會被每日 JSON 覆寫）。

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

`wrangler.toml` 的 `[[d1_databases]]` binding 名稱是 **`DB`**。Deploy workflow 會用 GitHub secret `D1_DATABASE_ID` 取代 placeholder；沒設這個 secret 時仍會部署網站，但 `/api/*` 沒有資料庫。教學封面 R2 同理：沒設 `R2_TEACHING_BUCKET` 時仍部署，但上傳封面會 503。

#### 3) GitHub + Pages secrets

GitHub → **Settings → Secrets and variables → Actions**：

| Secret | 用途 |
|---|---|
| `CLERK_PUBLISHABLE_KEY` | 部署時寫入 `site/js/config.js`、`<meta>`、`wrangler.toml [vars]` |
| `CLERK_SECRET_KEY` | **不要**進前端。放到 Cloudflare Pages secret（見下） |
| `CLERK_JWT_KEY` | 可選，PEM 公鑰 |
| `D1_DATABASE_ID` | `wrangler d1 create` 得到的 UUID |
| `R2_TEACHING_BUCKET` | 教學封面 R2。設成 `flashpick-teaching` 後 deploy 才會綁 `TEACHING_COVERS` |

到價推播的 VAPID 私鑰與 `ALERT_PUSH_SECRET` **不要**放進 GitHub Actions。它們是 Cloudflare Pages runtime secrets，沒設時部署仍會成功，推播 API 回 503。

Cloudflare → Pages → **tradingvenator** → Settings → Environment variables（Production **and** Preview）：

```bash
npx wrangler pages secret put CLERK_SECRET_KEY --project-name=tradingvenator
# optional
npx wrangler pages secret put CLERK_JWT_KEY --project-name=tradingvenator
```

`CLERK_PUBLISHABLE_KEY` 由每次 deploy 寫進 wrangler `[vars]`，不必再在 Dashboard 設一次。

教學封面圖：設好 `R2_TEACHING_BUCKET` 後，網站上的「選擇圖片上傳」才能把檔案存進 R2（binding **`TEACHING_COVERS`**、bucket **`flashpick-teaching`**）。這是一次性基礎設施，見上方「一次性基礎設施：教學封面 R2」。

若之後接自訂網域，請加到：(1) Clerk allowed origins (2) `functions/_lib/cors.js` 的 production origin 或 Pages env `ALLOWED_ORIGINS`。

### 到價推播（Web Push v1）

登入使用者可在 **設定 → 到價推播** 開啟瀏覽器通知。白名單筆電用永豐 **行情**（ticks）看到目標價後，呼叫 `POST /api/alerts/push`。本站與這支腳本都 **不下單**（不呼叫 `activate_ca`）。一般使用者不必、也不能自己接永豐。

沒設定下列 secrets 時：設定頁顯示「伺服器尚未設定推播」，其餘頁面與部署不受影響。

#### 1) 產生 VAPID 與共享密鑰

在任何有 Node 的機器（金鑰只產生一次）：

```bash
npx web-push generate-vapid-keys
openssl rand -base64 32
```

`Public Key` / `Private Key` 都是 URL-safe Base64。`web-push` 的 32-byte 私鑰與 PKCS8 私鑰都可以。私鑰不要 commit、不要放進 GitHub Actions。

#### 2) Cloudflare Pages secrets

Production **與** Preview 都要設（或只用 `wrangler pages secret put`，會寫進該專案）：

```bash
npx wrangler pages secret put VAPID_PUBLIC_KEY --project-name=tradingvenator
npx wrangler pages secret put VAPID_PRIVATE_KEY --project-name=tradingvenator
npx wrangler pages secret put ALERT_PUSH_SECRET --project-name=tradingvenator
# 可選，預設 mailto:smoli0725@gmail.com
npx wrangler pages secret put VAPID_SUBJECT --project-name=tradingvenator
```

| Secret | 用途 |
|---|---|
| `VAPID_PUBLIC_KEY` | 瀏覽器 `pushManager.subscribe` 的 applicationServerKey |
| `VAPID_PRIVATE_KEY` | 伺服器簽 VAPID JWT。只放 Pages |
| `ALERT_PUSH_SECRET` | 筆電呼叫 `POST /api/alerts/push` 的 `X-Alert-Push-Secret` |
| `VAPID_SUBJECT` | 可選。`mailto:` 或 `https://` 聯絡方式 |

本機 `wrangler pages dev` 把同樣的名字寫進 `.dev.vars`（見 `.dev.vars.example`）。

#### 3) D1 migration

```bash
npx wrangler d1 execute tradingvenator --remote --file=migrations/0002_push_subscriptions.sql
```

表 `push_subscriptions`：`user_id`（Clerk）、`endpoint`、`p256dh`、`auth`、`created_at`，以及可選的 `user_agent`。Deploy workflow 會嘗試套用此檔；token 沒有 D1 Edit 時不擋部署，請用上面的指令手動跑一次。

#### 4) 瀏覽器訂閱 → 手動推一則

1. 用已登入帳號打開網站 → **設定** → **開啟推播** → 允許通知。iPhone 要先 Safari「加入主畫面」，從主畫面圖示開啟後才能訂閱。
2. 分頁開著時，同一則通知也會在頁面上顯示一行提示。
3. 手動打 send API（會推給 **所有** `alerts_enabled = 1` 的訂閱；這是 v1 預設，因為到價清單在筆電上，不在每位使用者的持股裡）：

```bash
curl -sS -X POST https://tradingvenator.pages.dev/api/alerts/push \
  -H "Content-Type: application/json" \
  -H "X-Alert-Push-Secret: $ALERT_PUSH_SECRET" \
  -d '{"symbol":"2330","title":"2330 到價測試","body":"這是一則手動測試","url":"/"}'
```

成功時 JSON 含 `sent`。推播服務回 **404 / 410** 的 endpoint 會從 D1 刪除。

只推給特定人時加上 `clerk_user_id` 或 `user_ids`（Clerk user id，最多 50 筆）。省略這兩個欄位就是 fan-out。`url` 只能是本站相對路徑，或 `https://tradingvenator.pages.dev`（含 preview 子網域）。

關閉推播會在這台瀏覽器 `unsubscribe`，並刪掉該 endpoint。

#### 5) 白名單筆電（交易時段）

複製範例清單（此檔已 gitignore，勿提交真實目標價）：

```bash
cp scripts/alerts/watchlist.example.json scripts/alerts/watchlist.json
pip install shioaji requests
```

`watchlist.json`：

```json
{
  "user_ids": [],
  "symbols": [
    {"symbol": "2330", "name": "台積電", "target": 950, "direction": "above"}
  ]
}
```

`user_ids` 留空 = 推給所有已開啟推播的人。`direction` 為 `above`（現價 ≥ 目標）或 `below`（現價 ≤ 目標）。同一組代號＋方向＋目標只會送出一次，紀錄在 `scripts/alerts/.alert-hits.json`。

在 **IP 已白名單** 的筆電上，於台北時間週一至週五 09:00–13:30 執行（腳本也會自己擋在這個時段外，除非加 `--ignore-hours`）：

```bash
export SHIOAJI_API_KEY="..."          # 行情用，不要配憑證密碼
export SHIOAJI_SECRET_KEY="..."
export ALERT_PUSH_SECRET="..."        # 與 Pages secret 相同
export ALERT_PUSH_URL="https://tradingvenator.pages.dev/api/alerts/push"

python scripts/alerts/confirm_watch.py
```

- 訂閱 `QuoteType.Tick`（v1）。不看委託、不下單。
- `--once`：改抓一次 snapshot 後結束，適合自己用 cron 打在盤中。
- `--dry-run`：只印出將送出的 JSON。
- `--reset-dedupe`：開跑前清掉去重檔。
- `--ignore-hours`：略過時段檢查（測連線用）。
- 不登入永豐、只測推播：`python scripts/alerts/confirm_watch.py --send-test`

模擬環境可設 `SHIOAJI_SIMULATION=1`（仍不下單）。正式看盤不要開。

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
- Backend：Cloudflare Pages Functions（`functions/api/me.js`、`functions/api/data.js`、`functions/api/lessons/index.js`、`functions/api/lessons/cover.js`、`functions/api/alerts/*`）用 `@clerk/backend` `authenticateRequest`。例外：`POST /api/alerts/push` 用 `X-Alert-Push-Secret`，不走 Clerk
- 教學封面：R2 binding `TEACHING_COVERS`；公開讀 `GET /covers/:key`（不需登入）；上傳 `POST /api/lessons/cover`（僅站長）
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
