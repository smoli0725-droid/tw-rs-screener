---
name: verify-tradingvenator
description: Drive the TradingVenator static web UI under site/ (recommend hub, trade filters, patterns, portfolio, settings) the way a user does. Use when proving site/ frontend behavior, checking auth-gate vs signed-in flows, or before claiming a UI change works.
---

# Verify TradingVenator (web UI)

Agent-facing control skill for the **TradingVenator** static web app in `site/`. Flutter under `app/` is out of scope. Cloudflare Pages Functions (`functions/`) and D1 are not required for v1 local proofs; local static serve has no API sync.

Read `features/README.md` before driving. Proof artifacts go under `.cursor/skills/verify-tradingvenator/artifacts/<feature>/` and **must survive cleanup**.

Repo root in the commands below is the `tw-rs-screener` checkout.

## Launch

Prefer **local static serve with bundled JSON**. Production `https://tradingvenator.pages.dev` is shared: use it only when intentionally testing live, and never mutate another user's holdings.

1. From repo root, start the server this skill owns:

```bash
bash .cursor/skills/verify-tradingvenator/scripts/serve.sh
```

That script:

- Links `site/data` → `output/app` when `site/data/meta.json` is missing (`site/data/` is gitignored; deploy copies JSON there).
- Binds `http://127.0.0.1:${TV_VERIFY_PORT:-4173}/` (`--directory site`).
- Writes pid/port/url to `.cursor/skills/verify-tradingvenator/artifacts/.run/`.
- Reuses that pid if it is still alive on the same port. If the port is taken by **another** process, it exits 1 and tells you to set `TV_VERIFY_PORT` (it does not kill strangers).

Ready when stdout contains `ready pid=` and `curl -sf http://127.0.0.1:4173/` returns 200 with `閃電選股` and `FlashPick`.

Equivalent manual launch if you must not use the helper:

```bash
ln -sfn "$(pwd)/output/app" site/data
python3 -m http.server 4173 --bind 127.0.0.1 --directory site
```

Record that PID yourself; cleanup may only kill the PID you started.

Env:

| Name | Default | Meaning |
|---|---|---|
| `TV_VERIFY_PORT` | `4173` | Local bind port |
| `TV_VERIFY_HOST` | `127.0.0.1` | Local bind host |
| `TV_VERIFY_URL` | recorded run url | Override target (set to `https://tradingvenator.pages.dev/` for live) |
| `TV_VERIFY_BYPASS_AUTH` | unset | `1` = harness-only signed-in bypass (local Clerk placeholder only) |
| `TV_VERIFY_STORAGE` | unset | Playwright `storageState` JSON from a disposable signed-in test account |
| `TV_VERIFY_HEADED` | unset | `1` = headed Chrome |
| `CHROME_PATH` | `/usr/local/bin/google-chrome` if present | Chrome executable |

Live URL: do not start `serve.sh`. Set `TV_VERIFY_URL=https://tradingvenator.pages.dev/` and skip local pid checks by not relying on `.run/server.pid` (doctor still fetches the URL).

## Doctor

One read-only check. Run it before the first drive, after any failed drive, and whenever the instance looks wrong.

```bash
node .cursor/skills/verify-tradingvenator/scripts/doctor.mjs
node .cursor/skills/verify-tradingvenator/scripts/doctor.mjs --ui
```

`--ui` opens Chrome long enough to classify the auth surface (needs `npm install` in this skill dir).

Pass only if:

- Local: recorded pid is alive, `GET /` is 200 with 閃電選股 and FlashPick, `GET /data/meta.json` is 200 JSON.
- Live (`TV_VERIFY_URL`): `GET /` is 200 with 閃電選股 and FlashPick. `/data/meta.json` may 404 behind Pages routing; that is not a local-bundle failure.

Stdout is JSON. Read these fields:

- `clerk=placeholder` — `site/js/config.js` still has `__CLERK_PUBLISHABLE_KEY__`. Body stays `signed-out`; `#auth-setup` shows **尚未設定 Clerk**; `.app-shell` is `display:none`. Signed-in features require `drive.mjs --bypass-auth`.
- `clerk=configured` — Clerk JS mounts `#sign-in`. Unauthenticated users cannot browse. Signed-in features need `TV_VERIFY_STORAGE` or an already signed-in browser. **Never** `--bypass-auth` on the live site.
- `data_date` / `market_label` — from bundled `meta.json` when reachable.

Install the harness once per machine:

```bash
cd .cursor/skills/verify-tradingvenator && npm install
```

Playwright uses system Chrome (`channel: 'chrome'` or `CHROME_PATH`). It does not download browsers.

## Drive

No Playwright/Cypress lives in the product repo. This skill's harness is `scripts/drive.mjs`. Prefer ids / `data-*` / button names already in `site/index.html`. Do not click by coordinates.

Stable handles:

| Control | Handle |
|---|---|
| Auth gate | `#auth-gate`, `#auth-setup`, `#sign-in`, `#auth-loading` |
| Bottom nav | `button.nav-item[data-view="portfolio\|recommend\|settings"]` (labels 持股 / 推薦 / 設定) |
| Recommend tabs | `#view-recommend button.tab[data-sub="rs85\|patterns\|breakouts"]` (RS≥85 / 型態／突破 / 交易追蹤). 市況 is **not** a tab; it is `#marketCard` on the recommend view. |
| RS list | `#rs85List`, search `#rsSearch`, chips `[data-market]`, `#tplOnlyChip` |
| Patterns | `#statusChips` (`data-status`), `#patternChips` (`data-pattern`), `#patternList`, `#patternCount` |
| Trade tracking | `#tradeChips` (`data-trade`: `active\|success\|failed\|recovered`), `#tradeList`, `#tradeCount` |
| Portfolio | `#positionList`, `#totalMv`, `#totalPnl`, `#addTradeBtn`, `#metricsBtn` |
| Settings | `#dataBaseUrl`, `#saveSettingsBtn`, `#resetSettingsBtn`, `#dataStatusBody`, `#accountCard` |
| Refresh | `#refreshBtn` |

First mapped proof for a new run: **recommend** (read-only). Recipe is `features/recommend.md`.

```bash
node .cursor/skills/verify-tradingvenator/scripts/drive.mjs --feature auth-gate
node .cursor/skills/verify-tradingvenator/scripts/drive.mjs --feature recommend --bypass-auth
node .cursor/skills/verify-tradingvenator/scripts/drive.mjs --feature patterns --bypass-auth
node .cursor/skills/verify-tradingvenator/scripts/drive.mjs --feature trade-tracking --bypass-auth
node .cursor/skills/verify-tradingvenator/scripts/drive.mjs --feature portfolio --bypass-auth
node .cursor/skills/verify-tradingvenator/scripts/drive.mjs --feature settings --bypass-auth
```

`--bypass-auth` is harness-only: it flips `body` to `signed-in`, hides `#auth-gate`, and calls `RS_APP.start()` so bundled `./data` loads. It is **not** a Clerk session. Forbidden when `TV_VERIFY_URL` is the live Pages host.

Default viewport is 390×844 (the UI is a mobile web shell with a bottom nav).

## Evidence

Exercise the real user path (nav / tabs / chips), not internal setters. Capture the action and the resulting state.

Each `drive.mjs --feature <id>` writes to `.cursor/skills/verify-tradingvenator/artifacts/<id>/`:

- `01-*.png` / `02-*.png` — viewport screenshots at 390×844 (brand 閃電選股 · FlashPick visible; not a full-page dump of hundreds of RS rows)
- `*.aria.yml` — Playwright ARIA snapshot
- `*.snapshot.json` — ids, active nav/tab, list sample rows
- `result.json` — ok flag, url, error if any

Proof standards:

- Recommend: after clicking 推薦, `#marketCard` contains 市況 and `#rs85List` has rows or the empty copy `沒有符合的股票`. `#metaLine` contains `資料`.
- Auth gate: `.app-shell` stays hidden; gate shows 尚未設定 Clerk (placeholder) or Clerk sign-in (configured).
- Trade chips: filter on `trade.status`, not `outcome` (see `features/trade-tracking.md`).
- Portfolio mutations: local Playwright context is empty and isolated. On live, **read-only** unless using an explicit disposable test account. Never click 儲存 / 確認賣出 / 確認刪除 on a personal production session.
- Side effect for settings save: `#dataBaseUrl` value plus a `#metaLine` refresh; on Functions, Network would show `PUT /api/data` — v1 static serve has no API.

Do not treat a doctor JSON dump as UI proof.

## Cleanup

Stop only the server this run started. Do **not** delete artifacts.

```bash
bash .cursor/skills/verify-tradingvenator/scripts/cleanup.sh
```

That kills the pid in `artifacts/.run/server.pid` and removes pid/port/url files. It leaves `artifacts/<feature>/` and `artifacts/.run/server.log` / `doctor.json`. After cleanup, confirm proof files still exist, e.g.:

```bash
ls .cursor/skills/verify-tradingvenator/artifacts/recommend/02-recommend.png
```

Never `pkill -f http.server` or kill by port belonging to someone else.

The `site/data` symlink may stay (gitignored). Leave it.

## Helpers

All helpers are executable and invoked as above. They live in `.cursor/skills/verify-tradingvenator/scripts/`.

| Script | Command from repo root |
|---|---|
| Install Playwright | `cd .cursor/skills/verify-tradingvenator && npm install` |
| Serve | `bash .cursor/skills/verify-tradingvenator/scripts/serve.sh` |
| Doctor | `node .cursor/skills/verify-tradingvenator/scripts/doctor.mjs` |
| Doctor + auth surface | `node .cursor/skills/verify-tradingvenator/scripts/doctor.mjs --ui` |
| Drive one feature | `node .cursor/skills/verify-tradingvenator/scripts/drive.mjs --feature recommend --bypass-auth` |
| List features | `node .cursor/skills/verify-tradingvenator/scripts/drive.mjs --list` |
| Cleanup | `bash .cursor/skills/verify-tradingvenator/scripts/cleanup.sh` |

`package.json` in this skill directory is harness-only. Do not add Playwright to the product tree.

## Auth matrix (local vs live)

| Situation | What the user sees | How to verify |
|---|---|---|
| Local static, Clerk placeholder (default checkout) | `#auth-setup` **尚未設定 Clerk**; app hidden | `drive.mjs --feature auth-gate`. Signed-in features: `--bypass-auth`. |
| Local `wrangler pages dev` with `.dev.vars` keys (out of v1 default) | Real Clerk `#sign-in` at `http://localhost:8788` | Sign in with a test user, or `TV_VERIFY_STORAGE`. |
| Live `https://tradingvenator.pages.dev` | Clerk Email + Google; unsigned users cannot browse | Auth-gate proof without a session. Signed-in proof only with a **disposable test account** storage state. Read-only recommend/market/trade list first. |

If local serve cannot satisfy Clerk, do **not** pretend signed-in flows were verified through the gate. Either `--bypass-auth` on local placeholder (document it) or a real test session on live.

## Maintenance

When `site/index.html` or `site/js/app.js` changes labels, tabs, or chips, run `/maintain-verification-skill` against this directory so the feature map does not rot.
