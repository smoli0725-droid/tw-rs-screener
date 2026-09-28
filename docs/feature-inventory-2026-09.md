# 功能盤點（2026-09-28）

唯讀盤點。沒有改產品程式。檢查對象是 `site/`、`functions/`、`app/`，以及正式站公開端點 `https://tradingvenator.pages.dev`（2026-09-28）。

狀態定義：

- **能用**：使用者看得到的流程有真實資料或真實讀寫，從畫面接到 API／D1／每日 JSON。
- **部分能用**：主路徑有真實資料或真實邏輯，但有缺口（過期檔、示例資料、缺持久化、部分狀態不完整）。
- **空殼**：畫面或文案在，後面沒有可用的資料或邏輯。

未用站長或一般帳號登入，所以持股寫入、教學存檔、推播訂閱沒有在正式站點擊送出。這些列的依據是程式路徑，加上未帶 token／密鑰時 API 的實際 HTTP 狀態。

## 摘要

| 狀態 | 網站 | App | 合計 |
|---|---:|---:|---:|
| 能用 | 13 | 4 | 17 |
| 部分能用 | 6 | 5 | 11 |
| 空殼 | 1 | 2 | 3 |
| 合計 | 20 | 11 | 31 |

當天（2026-09-28）是證交所休市（教師節）；2026-09-25 是中秋節。最近交易日是 2026-09-24。正式站 `GET /data/meta.json` 為 `data_date=2026-09-24`、`is_fresh=true`、RS≥85 共 291 檔、型態 20 檔、市況「良好」勝率 60%（21 勝／14 敗）。與倉庫 `output/app/meta.json` 的 `generated_at`（2026-09-25T01:58:09+08）一致。

最大風險：

1. **K 線檔沒有清掉舊的。** 匯出只重寫「目前型態＋突破帳本」的 `ohlcv/{代號}.json`（本次 meta 寫 78 檔），目錄裡舊檔仍會部署。抽樣前段 RS 名單：新鮮 K 線停在 2026-09-23（比資料日晚一根），不少 RS 股最後一根停在 09-04 或 09-15。缺檔時 Pages 回傳首頁 HTML（HTTP 200）；2330、2603 會改畫 `preview-demo.js` 的示例 K 線。
2. **教學封面上傳在正式站不能用。** `GET /covers/{合法 uuid}.webp` 回 **503 `R2 not bound`**。文字教學 API 仍在（未登入 401）。
3. **App 沒有已實現損益成長曲線。** 網站持股頁有這條曲線（手記 FIFO）。App 績效頁只有月列表，而且把未實現損益併進當月。
4. **到價推播的觸發不在產品裡。** `POST /api/alerts/push` 未帶密鑰回 401（不是 503），代表 VAPID 與 `ALERT_PUSH_SECRET` 已設定；真正到價要靠白名單筆電跑 `scripts/alerts/confirm_watch.py`，網站不能自設目標價。
5. **App 沒有雲端。** 設定頁寫明尚未接 Clerk／D1。網站持股會同步 D1。
6. **正式站 Clerk 是 `pk_test_…`。** 登入閘門已接上（不是 placeholder），但是測試實例金鑰。

App 沒有教學分頁，也沒有 Web Push。下表只列畫面上存在的項目。

## 盤點

| 平台 | 功能 | 位置 | 狀態 | 依據（資料來源／檢查方式） | 缺什麼 | 補完工作量 |
|---|---|---|---|---|---|---|
| 網站 | 登入閘門（Email magic link、Google、登出） | `#auth-gate`、`#sign-in`、`#userButton`；`site/js/auth.js` → Clerk | 能用 | 正式站首頁 HTTP 200，含「閃電選股／FlashPick」，publishable key 為 `pk_test_…`（非 `__CLERK_PUBLISHABLE_KEY__`）。未登入呼叫 `/api/me` 回 401。未實際完成登入。 | — | — |
| 網站 | 主導覽與重新整理 | 側欄 `#appSidebar`、底欄 `.bottom-nav`（持股／推薦／教學／設定）、`#refreshBtn`、側欄收合 | 能用 | `site/index.html` + `site/js/app.js` `showView`。登入後才顯示 `.app-shell`。 | — | — |
| 網站 | 資料日期與新鮮度 | 頂欄 `#metaLine`、設定「資料狀態」`#dataStatusBody` | 能用 | `GET /data/meta.json`（`RS_DATA.loadAll`）。正式站 2026-09-24、`is_fresh=true`，訊息為休市前沿用該日。 | — | — |
| 網站 | RS≥85 名單（搜尋、上市／上櫃、只看通過樣板） | 推薦 → `#sub-rs85` | 能用 | `GET /data/rs85.json`。正式站 291 筆，首筆 3441 聯一光 RS 99。篩選在瀏覽器。 | — | — |
| 網站 | 型態／突破名單（即將突破、已突破、整理中；VCP／作弊型態／雙重底／高聳旗形） | 推薦 → `#sub-patterns` | 能用 | `GET /data/patterns.json`。正式站 20 筆：即將突破 6、已突破 5、整理中 9。 | — | — |
| 網站 | 交易追蹤，含成功交易清單（進行中／成功／失敗／復甦） | 推薦 → `#sub-breakouts` | 能用 | `GET /data/breakouts.json`（`breakout_tracker.py` → 每日 JSON）。正式站 59 筆：進行中 31、成功 21、失敗 2、復甦 5；`reentered` 0（舊列不顯示）。 | 市況的 14 敗含已轉成復甦或「再突破」的單，失敗 chip 只剩目前狀態仍是失敗的 2 筆。規則如此，不是空清單。 | — |
| 網站 | 市況（近 10 個交易日成功 ÷ 成功＋失敗） | 推薦頁 `#marketCard`（不是分頁） | 能用 | 同上 `breakouts.json` 的 `market`，並寫進 `meta.json`。正式站：市況良好、60%、21 勝 14 敗、進行中 31、自 2026-09-11。帳本 86 筆裡，視窗內 14 次失敗＝失敗 2＋復甦 5＋已隱藏的再突破 7。 | — | — |
| 網站 | 持股：新增、賣出、整檔刪除、總市值與未實現損益 | 持股 `#positionList`、`#tradeDialog`、`#sellDialog`、`#deleteDialog` | 能用 | 手記在 `localStorage`（`rs_web_trades_v1`），登入後 `PUT /api/data` 寫入 D1 `user_data.trades_json`（`functions/api/data.js`）。FIFO 部位在 `site/js/portfolio.js`。未在正式站代使用者寫入。 | 現價見下一列。沒有單筆編輯，輸錯要刪除再新增。 | — |
| 網站 | 已實現損益成長曲線、勝率、成功單平均報酬、月報酬 | 持股頁 `#metricCurve` 等四張卡；「績效」`#metricsDialog` 的月表 | 能用 | 只算使用者手記的賣出（FIFO）。曲線要至少兩筆已實現才畫 SVG；沒有平倉顯示「尚無已實現損益」。不讀系統突破帳本。`preview-demo.js` 的假手記沒有接到這個畫面。 | — | — |
| 網站 | 持股與設定雲端同步 | 登入後 `RS_STORAGE.hydrateFromCloud`；設定頁「雲端資料」 | 能用 | `GET /api/me`、`GET/PUT /api/data`。未帶 token 皆 401，且不是「D1 未綁定」的 503，代表 `users`／`user_data` 路由有接上。本機有、雲端空才上傳；雲端有資料則覆蓋本機。 | 多裝置沒有合併，後寫的蓋過先寫的。本次未做登入往返。 | — |
| 網站 | 資料來源 URL（儲存／恢復預設） | 設定 `#dataBaseUrl` | 能用 | 預設 `./data`。正式站該路徑就是上面的 JSON。覆寫網址會跟著設定物件同步到 D1。 | — | — |
| 網站 | 教學：列表、內文、站長新增／編輯／刪除文字 | 底欄「教學」`#view-teaching`；站長 `#addLessonBtn`、`#lessonDialog` | 能用 | 登入後 `GET/PUT/DELETE /api/lessons` → D1 `site_content`（key `lessons`）。未登入 401。D1 沒有列時改讀 `GET /content/lessons.json`，正式站是 `{ "lessons": [] }`。站長＝`OWNER_EMAILS` 或 Clerk `role=owner`。 | 種子是空的。正式站 D1 裡有沒有文章要登入才知道。封面見下。 | — |
| 網站 | iPhone「加入主畫面」說明 | 設定頁步驟清單 | 能用 | 靜態說明，給 Web Push 的 iOS 前提。 | — | — |
| 網站 | 持股現價 | 持股列「現價／報酬」 | 部分能用 | 現價只來自 `rs85.json`／`patterns.json` 的 `close`（`data.js` 的 `priceMap`）。不在這兩份名單裡顯示「無報價」並暫用成本。 | 沒有 Yahoo 或券商報價。RS 名單以外的持股沒有市價。收盤也不是盤中價。 | M：網站現價改接一個報價來源，並涵蓋使用者任意四碼。理由：名單內已有收盤，缺的是名單外與盤中。 |
| 網站 | K 線（日／週／月、MA50／100／200、成交量、樞紐、型態標註） | `#chartDialog`；RS、型態、交易追蹤、持股列點進去。元件 lightweight-charts | 部分能用 | 讀 `GET /data/ohlcv/{id}.json`。型態股 6651 有 260 根、標註 3 個，最後日期 2026-09-23。週／月由日線在瀏覽器合併。 | 只重寫目前型態與帳本代號，舊檔不刪。抽樣裡多檔 RS 的最後一根停在 09-04～09-21。缺檔（2330、2603、3026）回首頁 HTML 200；2330／2603 失敗後改畫示例 K 線（副標會寫「示例資料」）。新鮮檔仍比資料日 09-24 少一根。 | M：匯出時刪除不再更新的 ohlcv、缺檔改錯誤不要示例圖，並讓 K 線涵蓋到 RS 名單或至少與資料日同一根。理由：產線已有價格，差在清理與涵蓋範圍。 |
| 網站 | 到價推播（開啟／關閉、瀏覽器通知） | 設定 `#pushCard`；`site/sw.js`；`/api/alerts/*` | 部分能用 | 訂閱寫入 D1 `push_subscriptions`。`POST /api/alerts/push` 不帶 `X-Alert-Push-Secret` 回 **401**（密鑰未設定時才會 503），所以 VAPID 與推播密鑰已在 Pages。Service worker 有部署。 | 使用者不能在網站設目標價。觸發是筆電 `scripts/alerts/confirm_watch.py`（永豐行情、`watchlist.json` 不進 git），沒有排程。未實測訂閱與送達。iPhone 必須先加入主畫面。 | M：把到價條件放進帳號（或改由雲端排程盯盤），不要只靠手動開著的筆電。理由：訂閱與發送 API 已在，缺的是產品內的條件與穩定觸發。 |
| 網站 | 教學封面上傳與公開讀取 | 站長表單「選擇圖片上傳」；`POST /api/lessons/cover`；`GET /covers/{uuid}`（jpg、png 或 webp） | 部分能用 | 上傳程式在 `functions/api/lessons/cover.js`（jpeg／png／webp、5MB、僅站長）。正式站對合法鍵 `00000000-0000-4000-8000-000000000000.webp` 回 **503 `R2 not bound`**。 | Cloudflare R2 binding `TEACHING_COVERS`（bucket `flashpick-teaching`）沒綁上。選檔會得到設定錯誤，封面存不進去、也讀不出來。文字教學不受影響。 | S：依 README 建 bucket 並綁定後重跑 Deploy。理由：程式與路由已在，差一次基礎設施。 |
| 網站 | 帳號方案 | 設定「帳號」`plan`／`plan_expires_at` | 部分能用 | `GET /api/me` 讀 D1 `users.plan`（預設 `free`）。畫面寫明 billing 尚未開放。 | 沒有方案、付款、到期檢查。欄位只會顯示 free。 | L：要接 Clerk Billing 或別的結帳，並在 API 擋付費功能。理由：現在只有一個顯示欄位。 |
| 網站 | 公開歡迎頁「今日掃描」表 | `/welcome/` | 部分能用 | 正式站 HTTP 200。登入／開始使用連到 `/?signin=1`。表格六列（2330、2454…）寫在 `site/welcome/index.html`，頁尾寫「靜態原型、非真實報價」。 | 這張表沒有接 `/data`。RS 門檻與型態用詞也和產品不一致（表上是 RS≥80、杯柄）。 | S：若只要避免誤認，維持示例標籤即可（已有）。若要改成真實公開榜，再決定未登入能否看 `/data`。 |
| 網站 | 分 K | K 線工具列「分」`data-range="I"` | 空殼 | 點下去只 `toast('尚無分線資料')`（`app.js`）。`chart.js` 的 `setRange` 只接受日／週／月。沒有分線 JSON。 | 沒有盤中 K 線來源，也沒有圖。 | L：要新的盤中資料與圖表週期，現有日線 JSON 補不出來。 |
| App | RS≥85（搜尋、上市／上櫃、樣板） | 推薦第一頁 `_Rs85Tab` | 能用 | `GitHubDataSource` 讀 `{資料來源}/rs85.json`，預設 `https://tradingvenator.pages.dev/data`（與上面正式站同一份）。 | — | — |
| App | 型態／突破（狀態與四種型態 chip） | 推薦第二頁 `_PatternsTab` | 能用 | 同上 `patterns.json`。預設篩即將突破＋已突破，與網站相同。 | — | — |
| App | 市況、交易追蹤（含成功）、資料日期橫幅 | 推薦頂部 `_MarketCard`、第三頁 `_TradesTab`；持股頁 `_FreshnessBanner` | 能用 | `breakouts.json`＋`meta.json`。`visibleBreakoutTrades` 去掉 `reentered`。 | 與網站相同：失敗筆數是「目前狀態」，不是市況分母裡的每一次失敗。 | — |
| App | 資料來源 URL、資料狀態、恢復預設 | 設定頁 | 能用 | `SharedPreferences` 的 `data_base_url`。儲存後 `invalidate` 重新抓 JSON。預設即正式站 `/data`。 | — | — |
| App | 新增買進／賣出（本機） | 持股右下角「新增持股」、K 線「加入持股」；`AddTradeSheet` | 部分能用 | `TradeDao` 寫入裝置 SQLite `taiwan_rs.db`。表單有買進／賣出、手續費。部位用 `position_builder.dart`。 | 持股列表沒有刪除。`TradeDao.delete` 沒有任何畫面呼叫。改錯單無法清掉。不同步到網站 D1。 | S：列表加上刪除（DAO 已有）。雲端同步另列。 |
| App | 持股現價與未實現損益 | 持股列表總市值／損益 | 部分能用 | 先打 Yahoo chart，失敗再用 `/data` 的 RS、型態、突破 `last_close`。設定頁寫明沒有 Confirm／券商即時報價。 | 報價逐檔串行，Yahoo 被擋時退回每日收盤。沒有券商成交價。 | M：若要穩定盤中價，需換允許的行情來源並並行請求。理由：主路徑已有 Yahoo，缺的是可靠度與即時定義。 |
| App | K 線 | `StockChartPage`（持股、RS、型態、交易追蹤點入） | 部分能用 | 先讀 `/data/ohlcv/{id}.json`，空的再向 Yahoo 要一年日線。樞紐用水平線。型態標註是 Chip 文字，沒有畫在圖上。 | 圖是收盤折線加 MA，不是 K 棒（程式註解寫明簡化）。沒有週／月／分。成交量是長條圖。沿用網站那份 ohlcv 時會吃到過期檔。 | M：改成 K 棒並標註落在對應日期；過期檔要等網站匯出一併清。理由：資料已有 OHLC，差在畫法與標註。 |
| App | 績效：勝率、已平倉平均報酬、月績效 | 持股 AppBar「績效」`MetricsPage` | 部分能用 | `computeMetrics` 用本機交易。有平倉時勝率是平倉勝率。 | **沒有已實現損益成長曲線**（見下一列）。沒有平倉時勝率改成「持股裡賺錢的比例」。月損益把未實現併進最近月份，報酬率用目前持倉成本當分母，和網站「只計已實現」不同。 | S：月表改成只計已平倉，勝率在沒有平倉時顯示「—」。理由：計算已在 `portfolio_metrics.dart`，差的是不要混未實現。 |
| App | 已實現損益成長曲線 | 績效頁（網站有、App 沒有對應圖） | 空殼 | 網站 `#metricCurve` 用手記累計已實現損益畫 SVG。App `MetricsPage` 只有勝率、平均報酬、月列表，沒有曲線資料或圖。 | 整條曲線的 UI 與序列都不存在。 | S：沿網站 FIFO 累計已實現損益，在績效頁加一條折線。理由：平倉明細已經算得出來。 |
| App | 每日更新提醒（「推播當日損益通知」） | 設定「每日自動更新」時間與開關 | 部分能用 | `background_tasks.dart`：本機通知＋Android `AndroidAlarmManager` 抓 meta 與 Yahoo 後通知未實現損益。不是 FCM，也不是網站 Web Push。 | iOS 不排背景鬧鐘，只靠打開 App。通知文案與實際損益都依賴當下 Yahoo／JSON 是否成功。桌面／測試環境會略過 workmanager。 | M：若要 iOS 也準時更新，要改成系統允許的背景方式或明確只做「打開 App 時刷新」。理由：Android 路徑已有，iOS 是平台限制。 |
| App | 帳號／雲端持股 | 設定頁「帳號／雲端持股」 | 空殼 | 文案寫「尚未接上 Clerk／D1」。沒有登入、沒有呼叫 `/api/me` 或 `/api/data`。持股只在本機 SQLite。 | 與網站同一帳號的持股、設定都不會同步。 | L：App 接 Clerk，並重用現有 `/api/data`。理由：後端已有，缺整條行動登入與衝突處理。 |
