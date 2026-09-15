# Portfolio holdings

持股 is the default signed-in view. It shows total market value, a position list, and actions to add / sell / delete / open 績效. v1 verification is **read-only**.

## Sub-features

- `portfolio-open` shows `#view-portfolio` from the 持股 nav item (also the default view after sign-in).
- `portfolio-empty` shows `尚未有持股，點上方新增` when localStorage/cloud trades are empty.
- `portfolio-rows` lists `article.item` rows with symbol, 成本, 現價, and 損益 when trades exist.
- `portfolio-metrics-open` opens `#metricsDialog` from **績效** (still read-only if you only **關閉**).

## How to get to it (user POV)

- After sign-in, the shell lands on 持股 (`button.nav-item[data-view="portfolio"]` is `.active`).
- Choose **持股** from the bottom nav if another view is active.
- Optional: **績效** (`#metricsBtn`) then **關閉** (`#closeMetricsBtn`). Do not use **＋ 新增持股**, **賣出**, or **刪除** on live personal data.

## Driving it with tv-verify

Preconditions:

- Doctor `ok: true`. Local `--bypass-auth` (fresh context ⇒ empty holdings) or live disposable test account.
- Do not set `TV_VERIFY_URL` to production while using a personal Clerk session.

- **Open holdings.** Choose 持股. Run `node .cursor/skills/verify-tradingvenator/scripts/drive.mjs --feature portfolio --bypass-auth`. `#view-portfolio` is `.active`. `#totalMv` is visible.
- **Read list.** `#positionList` is either the empty copy `尚未有持股，點上方新增` (local bypass) or symbol rows. Screenshot must show FlashPick and the 持股 nav active.
- **Skip mutations.** Do not click `#addTradeBtn` / `[data-sell]` / `[data-delete-pos]` / submit `#tradeForm` unless a later recipe isolates a throwaway context. Live D1 would persist those writes.
- **Proof.** `artifacts/portfolio/01-holdings.png` and `01-holdings.snapshot.json` (`activeNav: portfolio`). `result.json` `ok: true`.

## Gotchas

- Default view after bypass/sign-in is 持股, not 推薦. A recommend proof that never clicks 推薦 may accidentally snapshot portfolio.
- Empty list is valid local proof. It is not proof that production cloud holdings render.
- `#addFromChartBtn` (**加入持股**) on a K 線 dialog is another mutation path.
- Cloud sync toasts (`雲端同步失敗，先使用本機快取`) appear when Functions are absent; that does not fail a local read-only list proof.
- Playwright storage from a real user will show their positions. Treat that as unsafe for sell/delete.
