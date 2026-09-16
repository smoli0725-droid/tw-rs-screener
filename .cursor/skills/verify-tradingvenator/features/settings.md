# Settings data URL

設定 shows account / data-status cards and the 資料來源 URL box. Default URL is `./data` (bundled JSON next to the site). Saving reloads RS JSON. v1 proof is read-only unless you save the same default.

## Sub-features

- `settings-open` opens the 設定 view from the bottom nav.
- `settings-url` shows `#dataBaseUrl` with `./data` on a fresh profile (or the persisted URL).
- `settings-status` fills `#dataStatusBody` with 資料日期 and 新鮮度 after load.
- `settings-refresh` header **↻** reloads without changing the URL.

## How to get to it (user POV)

- Choose bottom-nav **設定** (`button.nav-item[data-view="settings"]`).
- Edit `#dataBaseUrl`, then **儲存並重新載入** (`#saveSettingsBtn`) or **恢復預設** (`#resetSettingsBtn`).
- Choose header `#refreshBtn` from any view to reload using the current URL.

## Driving it with tv-verify

Preconditions:

- Doctor `ok: true`. Local `--bypass-auth` or live disposable session.
- Fresh Playwright context ⇒ URL `./data`. Do not save a random URL on live (it syncs to D1 for that Clerk user).

- **Open settings.** Choose 設定. Run `node .cursor/skills/verify-tradingvenator/scripts/drive.mjs --feature settings --bypass-auth`. `#view-settings` is `.active`. `#dataBaseUrl` is visible.
- **Read URL.** `#dataBaseUrl` value is `./data` (or `/data` / `data` only if someone persisted that). `#dataStatusBody` contains `資料日期` after `RS_APP.start`.
- **Refresh only.** Prefer `#refreshBtn` over save. After refresh, `#metaLine` still contains `資料` and is not stuck on `載入資料中…`.
- **Proof.** `artifacts/settings/01-settings.png` shows 設定, `#aboutCard` 閃電選股 · FlashPick, the textarea, and data status. `01-settings.snapshot.json` records `dataBaseUrl`. `result.json` `ok: true`.

## Gotchas

- Valid URLs are `http(s)://…` or `./data` / `/data` / `data`. Anything else toasts `請輸入有效 URL 或相對路徑（如 ./data）` and does not save.
- On live, save writes through `PUT /api/data` when Clerk+D1 work. Local static serve has `API_BASE` empty; save stays in localStorage only.
- `#accountBody` email is `—` under `--bypass-auth` because there is no Clerk user. That is not a production account-card proof.
- Trailing slashes are stripped on save. Assert the textarea value after save, not the typed draft.
- Changing the URL to a missing host makes `#metaLine` `載入失敗：…` and a toast. Restore with **恢復預設** in that same isolated context, not on a shared live profile.
