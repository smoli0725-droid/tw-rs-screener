# Trade tracking filters

交易追蹤 lists breakout ledger rows and filters them with chips 進行中／成功／失敗／復甦／再突破. The chips filter `status`. A row can have `outcome` failed (or success) while `status` is `recovered` or `reentered`.

## Sub-features

- `trades-open` opens the 交易追蹤 tab under 推薦.
- `trades-default` shows all five chips active and `#tradeCount` as `{n} 筆（共 {total}）`.
- `trades-failed-chip` isolates 失敗 (`data-trade="failed"`) so only `status=failed` rows remain.
- `trades-outcome-mismatch` keeps `recovered` / `reentered` rows (which often have `outcome=failed`) out of the 失敗-only list.

## How to get to it (user POV)

- Choose bottom-nav **推薦**, then tab **交易追蹤** (`button.tab[data-sub="breakouts"]`).
- Toggle chips in `#tradeChips` (進行中 `active`, 成功 `success`, 失敗 `failed`, 復甦 `recovered`, 再突破 `reentered`). All five start `.active`.

## Driving it with tv-verify

Preconditions:

- Doctor `ok: true`. Local `--bypass-auth` or live disposable session.
- Bundled `breakouts.json` exists (optional fetch in the app; empty copy is `尚無突破交易紀錄；每日更新後會自動累積`).

- **Open tab.** Choose 推薦 then 交易追蹤. Run `node .cursor/skills/verify-tradingvenator/scripts/drive.mjs --feature trade-tracking --bypass-auth`. `#sub-breakouts` is `.active`. `#tradeList` is visible.
- **Default chips.** `#tradeChips .chip.active` includes `active`, `success`, `failed`, `recovered`, `reentered`. `#tradeCount` matches the unfiltered total.
- **Isolate 失敗.** Click 進行中, 成功, 復甦, 再突破 so they lose `.active`, leave 失敗 on. `#tradeChips` active set is only `failed`. Every visible `article.item .badge` is `失敗`. `#tradeCount` shrinks.
- **Outcome vs status.** A 失敗-only list must not show badges `復甦` or `再突破` even when those rows’ JSON `outcome` is `failed`. The harness checks sample badges in `02-failed-only.snapshot.json`.
- **Proof.** `artifacts/trade-tracking/01-all-chips.png` (all chips on) and `02-failed-only.png` (失敗 only). `result.json` `ok: true`.

## Gotchas

- Filter predicate is `t.status`, not `t.outcome`. README language “成功／失敗” describes the 市況 window, not the chip key.
- `reentered` rows can carry `outcome: failed` from the previous attempt. Clicking 失敗 does not include them.
- Success/fail rows in the UI are already limited to the same ~10-session window as 市況; 進行中 and 復甦 are not. Do not expect 失敗 count to equal `market.losses` without reading that rule.
- Chips toggle independently (unlike RS market chips, which are radio). Clicking 失敗 while it is the only active chip **hides all rows**.
- Tab label is **交易追蹤**; `data-sub` is `breakouts`. There is no `#breakoutList` id — the list is `#tradeList`.
