# Market / recommend hub

推薦 shows market health (市況) and the RS≥85 universe on one screen. 市況 is a card, not a tab. Default tab is RS≥85; 型態／突破 and 交易追蹤 are sibling tabs on the same view.

## Sub-features

- `recommend-open` opens the 推薦 view from the bottom nav.
- `recommend-market` renders `#marketCard` with a 市況 label, win rate, and 近 N 個交易日 window.
- `recommend-rs85` lists RS≥85 rows in `#rs85List` (or the empty copy).
- `recommend-rs-filter` filters that list by 全部／上市／上櫃, 只看通過樣板, and `#rsSearch`.

## How to get to it (user POV)

- Choose the bottom-nav button **推薦** (`button.nav-item[data-view="recommend"]`).
- After 推薦 is active, choose tab **RS≥85** (`button.tab[data-sub="rs85"]`) if another recommend tab is selected.
- Pull-to-refresh is not available on web; choose header **↻** (`#refreshBtn`) to reload JSON.

## Driving it with tv-verify

Preconditions:

- Doctor reports `ok: true` for `http://127.0.0.1:4173/` (or `TV_VERIFY_URL`).
- Bundled `data/meta.json` is reachable locally, or the live app can load `./data` after sign-in.
- Local Clerk placeholder: pass `--bypass-auth`. Live: a disposable signed-in storage state. Unsigned live sessions cannot open 推薦.

- **Open recommend.** Choose 推薦. Run `node .cursor/skills/verify-tradingvenator/scripts/drive.mjs --feature recommend --bypass-auth`. `#view-recommend` is `.active`, nav `data-view="recommend"` is `.active`, and the 持股 list is not the visible view.
- **Read 市況.** Inspect `#marketCard`. The card title contains `市況` (for current data, `市況良好` / `市況中性` / `市況不佳` plus a percent). If JSON has no market block, the card still says `市況指標` and `尚無突破追蹤資料`.
- **Read RS≥85.** Default tab `data-sub="rs85"` is `.active`. `#rs85List` contains `article.item` rows (`{id} {name}` and `RS {n}`) or `沒有符合的股票`. `#metaLine` contains `資料` and a date.
- **Market chip.** Choose **上市**. Run in the same browser: click `.chip[data-market="上市"]`. Listed rows show `上市` in `.item-sub`. Choose **全部** to restore.
- **Proof.** `artifacts/recommend/01-before-nav.png` is the starting view (持股 or already-recommend). `artifacts/recommend/02-recommend.png` and `02-recommend.aria.yml` show 閃電選股 · FlashPick, `#marketCard` 市況, and `#rs85List`. `result.json` has `ok: true`.

## Gotchas

- 市況 is not a fourth tab. Agents that look for a 市況 tab will fail; use `#marketCard`.
- Unauthenticated body class `signed-out` hides `.app-shell`. A screenshot of 尚未設定 Clerk is an auth-gate proof, not a recommend proof.
- `--bypass-auth` is not Clerk. Do not report it as “signed in with Google”.
- Win rate percent changes every daily RS run. Assert structure (`市況`, a `%`, `勝`/`敗`) not a frozen `60.9%`.
- `#refreshBtn` visible label is `↻`, not the word Refresh.
- RS search filters client-side; clearing the box restores the full list. Do not treat a narrowed list as missing data.
