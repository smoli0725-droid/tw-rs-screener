# TradingVenator web UI verification map

This directory is the maintained source for verifying the user-facing behavior of the TradingVenator static site (`site/`). Read this index before driving the app, then use the matching feature file as the recipe.

Flutter under `app/` is out of scope. Pages Functions / D1 / Clerk cloud sync are preconditions for live signed-in persistence, not for local bundled-JSON proofs.

## Baseline preconditions

- Launch the site this run owns at `http://127.0.0.1:${TV_VERIFY_PORT:-4173}/` via `scripts/serve.sh` (bundles `output/app` as `site/data`).
- Run `node .cursor/skills/verify-tradingvenator/scripts/doctor.mjs` and require `ok: true`, pid alive (local), and `GET /` 200.
- Never drive an http.server this run did not start. Never kill unrelated processes.
- **Auth:** checkout `site/js/config.js` ships `__CLERK_PUBLISHABLE_KEY__`. Local static serve shows **尚未設定 Clerk** and hides `.app-shell`. Signed-in recipes use `drive.mjs --bypass-auth` (harness-only). Live `https://tradingvenator.pages.dev` requires a disposable Clerk test session (`TV_VERIFY_STORAGE`); do not edit another user's holdings.
- Viewport 390×844 unless a recipe says otherwise. Bottom nav is the user chrome.
- Start every recipe from a fresh Playwright context unless its preconditions say otherwise.

## Driving conventions

- Prefer ids, `data-view` / `data-sub` / `data-trade` / `data-status`, and visible button names in `site/index.html`.
- Treat every command as literal. Keep Chinese labels unchanged, including fullwidth `／` in `型態／突破`.
- Run browser actions through `node .cursor/skills/verify-tradingvenator/scripts/drive.mjs`.
- Restore nothing on live. Local bypass context has empty localStorage holdings; leave it empty unless a recipe is explicitly mutating.
- Cleanup stops the recorded server pid only. Do not remove proof artifacts.

## Proof and skip reporting

- Capture the user action and the resulting state (before/after screenshots when the recipe clicks nav or chips).
- UI proof includes an ARIA snapshot and a screenshot with the 閃電選股 · FlashPick brand visible.
- Record the feature id and entry point in `artifacts/<feature>/result.json`.
- Report an unreachable path with the attempted command and the unmet precondition (usually Clerk session on live).
- Do not report a skipped entry point as verified through a different path. `--bypass-auth` is not a Clerk sign-in.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with tv-verify` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Market / recommend hub](./recommend.md) covers the 推薦 view, 市況 card, and RS≥85 list (read-only first proof).
- [Trade tracking filters](./trade-tracking.md) covers 交易追蹤 chips and the status vs outcome mismatch.
- [Pattern / breakout list](./patterns.md) covers 型態／突破 status chips and the pattern list.
- [Portfolio holdings](./portfolio.md) covers the 持股 tab read-only (empty or existing rows).
- [Settings data URL](./settings.md) covers 設定, `#dataBaseUrl`, and refresh.
- [Teaching (教學)](./teaching.md) covers the 教學 feed, full-passage detail, and owner-only composer hidden for readers.
