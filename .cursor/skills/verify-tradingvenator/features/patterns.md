# Pattern / breakout list

型態／突破 lists one pattern per symbol with status 即將突破 / 已突破 / 整理中. Default chips keep 整理中 off. Pattern-type chips (VCP, 作弊型態, 雙重底, 高聳旗形) start inactive, which means **no type filter** (all types shown).

## Sub-features

- `patterns-open` opens the 型態／突破 tab under 推薦.
- `patterns-default-status` shows 即將突破 and 已突破（可買 0~5%） active, 整理中 inactive.
- `patterns-include-consolidating` toggles 整理中 on and recounts `#patternCount`.
- `patterns-type-chip` when a type chip is `.active`, the list only includes that pattern (plus any other active types).

## How to get to it (user POV)

- Choose bottom-nav **推薦**, then tab **型態／突破** (`button.tab[data-sub="patterns"]`). The slash is fullwidth `／`.
- Toggle `#statusChips` (`data-status="即將突破"|"已突破"|"整理中"`).
- Toggle `#patternChips` (`data-pattern` built from the four canonical names plus any extras in the JSON).

## Driving it with tv-verify

Preconditions:

- Doctor `ok: true`. Local `--bypass-auth` or live disposable session.
- `data/patterns.json` loaded; `#metaLine` already left `載入資料中…`.

- **Open tab.** Choose 推薦 then 型態／突破. Run `node .cursor/skills/verify-tradingvenator/scripts/drive.mjs --feature patterns --bypass-auth`. `#sub-patterns` is `.active`. `#patternList` is visible. `#patternCount` reads `{n} 檔`.
- **Default statuses.** `#statusChips .chip.active` is 即將突破 and 已突破. Visible badges are those statuses (plus optional 復甦). Empty copy is `沒有符合的型態`.
- **Include 整理中.** Choose **整理中**. `#statusChips .chip[data-status="整理中"]` becomes `.active`. `#patternCount` does not drop; it stays or rises. `02-include-consolidating.png` shows the chip on.
- **Proof.** `artifacts/patterns/01-default-status.png` and `02-include-consolidating.png` plus ARIA/DOM snapshots. `result.json` `ok: true`.

## Gotchas

- Tab text is `型態／突破` (fullwidth slash). ASCII `/` will not match getByText unless you normalize.
- 已突破 chip label is `已突破（可買 0~5%）` with fullwidth parentheses. Use `data-status="已突破"`.
- Empty `state.patternTypes` means **all** types. Activating one type **narrows** the list; it does not “turn that type on” on top of an already-filtered default.
- Extended names in JSON (低位作弊, 杯狀帶柄, 高聳旗形 labels) may appear as extra chips. Filter by `data-pattern`, not the card’s `pattern_label` subtitle.
- Rows with close more than 5% above pivot are not in this list; they belong to 交易追蹤. Missing names are not necessarily a render bug.
- Clicking a row opens `#chartDialog` (K 線). Close with `#closeChartBtn` (**關閉**) before the next chip assertion.
