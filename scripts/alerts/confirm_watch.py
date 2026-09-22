#!/usr/bin/env python3
"""Watch Shioaji ticks and POST the first price hit to TradingVenator web push.

Market data only. This script logs in with API key / secret and subscribes to
stock ticks. It never calls activate_ca and never places a broker order.

Run on the laptop whose IP is whitelisted for the Shioaji account, during
Taiwan cash-session hours. See the README section「到價推播」.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).resolve().parent
DEFAULT_WATCHLIST = ROOT / "watchlist.json"
DEFAULT_SEEN = ROOT / ".alert-hits.json"
DEFAULT_PUSH_URL = "https://tradingvenator.pages.dev/api/alerts/push"
TAIPEI = ZoneInfo("Asia/Taipei")
RETRY_SECONDS = 60


def format_price(price: Decimal) -> str:
    text = format(price, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text


def parse_watchlist(data: dict) -> tuple[list[dict], list[str]]:
    if not isinstance(data, dict):
        raise ValueError("watchlist 必須是 JSON 物件")
    symbols = data.get("symbols")
    if not isinstance(symbols, list) or not symbols:
        raise ValueError("watchlist.symbols 至少要有一檔")
    user_ids = data.get("user_ids") or []
    if user_ids is None:
        user_ids = []
    if not isinstance(user_ids, list) or not all(isinstance(item, str) and item.strip() for item in user_ids):
        raise ValueError("user_ids 必須是字串陣列")
    rules = []
    for item in symbols:
        if not isinstance(item, dict):
            raise ValueError("symbols 每一筆都要是物件")
        symbol = str(item.get("symbol", "")).strip()
        if not symbol or not symbol.isalnum() or len(symbol) > 12:
            raise ValueError(f"代號不正確: {symbol!r}")
        direction = str(item.get("direction", "above")).strip().lower()
        if direction not in {"above", "below"}:
            raise ValueError(f"{symbol} direction 只能是 above 或 below")
        try:
            target = Decimal(str(item.get("target")))
        except (InvalidOperation, TypeError) as exc:
            raise ValueError(f"{symbol} target 不是數字") from exc
        if target <= 0:
            raise ValueError(f"{symbol} target 必須大於 0")
        name = str(item.get("name") or symbol).strip() or symbol
        rules.append(
            {
                "symbol": symbol,
                "name": name,
                "target": target,
                "direction": direction,
                "user_ids": [item.strip() for item in user_ids],
            }
        )
    return rules, [item.strip() for item in user_ids]


def load_watchlist(path: Path) -> tuple[list[dict], list[str]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise SystemExit(
            f"找不到 {path}。請複製 scripts/alerts/watchlist.example.json 為 watchlist.json"
        ) from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(f"watchlist JSON 無法解析: {exc}") from exc
    try:
        return parse_watchlist(data)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc


def dedupe_key(symbol: str, direction: str, target: Decimal) -> str:
    return f"{symbol}|{direction}|{format_price(target)}"


def is_hit(price: Decimal, target: Decimal, direction: str) -> bool:
    if direction == "above":
        return price >= target
    if direction == "below":
        return price <= target
    raise ValueError(direction)


def within_market_hours(now: datetime | None = None) -> bool:
    current = now or datetime.now(TAIPEI)
    if current.tzinfo is None:
        current = current.replace(tzinfo=TAIPEI)
    else:
        current = current.astimezone(TAIPEI)
    if current.weekday() >= 5:
        return False
    minutes = current.hour * 60 + current.minute
    return 9 * 60 <= minutes <= 13 * 60 + 30


def build_alert(rule: dict, price: Decimal) -> dict:
    direction = "向上觸及" if rule["direction"] == "above" else "向下觸及"
    title = f"{rule['symbol']} {rule['name']} 到價"
    body = (
        f"{rule['name']} 現價 {format_price(price)}，目標 {format_price(rule['target'])}"
        f"（{direction}）。本通知只提示行情，不會下單。"
    )
    payload = {
        "symbol": rule["symbol"],
        "title": title[:80],
        "body": body[:240],
        "url": "/#portfolio",
    }
    if rule.get("user_ids"):
        payload["user_ids"] = list(rule["user_ids"])
    return payload


def load_seen(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def save_seen(path: Path, seen: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(seen, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def post_alert(url: str, secret: str, payload: dict, timeout: float = 15) -> dict:
    response = requests.post(
        url,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-Alert-Push-Secret": secret,
        },
        json=payload,
        timeout=timeout,
    )
    if response.status_code >= 300:
        detail = response.text[:300].replace(secret, "***")
        raise RuntimeError(f"push API {response.status_code}: {detail}")
    try:
        body = response.json()
    except ValueError:
        body = {}
    return body if isinstance(body, dict) else {}


def consider(
    rule: dict,
    price: Decimal,
    seen: dict,
    *,
    poster,
    dry_run: bool = False,
    now: datetime | None = None,
    ignore_hours: bool = False,
    cooldown: dict | None = None,
    clock: float | None = None,
) -> str:
    """Return closed, skip, deduped, cooldown, dry-run, sent, or error."""
    if not ignore_hours and not within_market_hours(now):
        return "closed"
    if price <= 0 or not is_hit(price, rule["target"], rule["direction"]):
        return "skip"
    key = dedupe_key(rule["symbol"], rule["direction"], rule["target"])
    if key in seen:
        return "deduped"
    moment = time.time() if clock is None else clock
    if cooldown is not None and cooldown.get(key, 0) > moment:
        return "cooldown"
    payload = build_alert(rule, price)
    if dry_run:
        print(f"[dry-run] {json.dumps(payload, ensure_ascii=False)}")
        return "dry-run"
    try:
        result = poster(payload)
    except Exception as exc:
        if cooldown is not None:
            cooldown[key] = moment + RETRY_SECONDS
        print(f"推播失敗 {rule['symbol']}: {exc}", file=sys.stderr)
        return "error"
    seen[key] = datetime.now(TAIPEI).isoformat(timespec="seconds")
    sent = result.get("sent") if isinstance(result, dict) else None
    print(f"已送出 {rule['symbol']} @ {format_price(price)} sent={sent}")
    return "sent"


def _rules_for(rules: list[dict], symbol: str) -> list[dict]:
    return [rule for rule in rules if rule["symbol"] == symbol]


def handle_price(
    symbol: str,
    price: Decimal,
    rules: list[dict],
    seen: dict,
    seen_path: Path,
    *,
    poster,
    dry_run: bool,
    ignore_hours: bool,
    cooldown: dict,
    lock: threading.Lock,
) -> None:
    with lock:
        changed = False
        for rule in _rules_for(rules, symbol):
            action = consider(
                rule,
                price,
                seen,
                poster=poster,
                dry_run=dry_run,
                ignore_hours=ignore_hours,
                cooldown=cooldown,
            )
            if action == "sent":
                changed = True
        if changed:
            save_seen(seen_path, seen)


def login_market_data():
    try:
        import shioaji as sj
    except ImportError as exc:
        raise SystemExit("請先在這台電腦安裝行情套件: pip install shioaji") from exc
    api_key = os.environ.get("SHIOAJI_API_KEY", "").strip()
    secret_key = os.environ.get("SHIOAJI_SECRET_KEY", "").strip()
    if not api_key or not secret_key:
        raise SystemExit("請設定 SHIOAJI_API_KEY 與 SHIOAJI_SECRET_KEY（只用於行情，不下單）")
    simulation = os.environ.get("SHIOAJI_SIMULATION", "").strip().lower() in {"1", "true", "yes"}
    api = sj.Shioaji(simulation=simulation)
    api.login(api_key=api_key, secret_key=secret_key, fetch_contract=True)
    return api, sj


def lookup_contract(api, symbol: str):
    stocks = api.Contracts.Stocks
    for getter in (
        lambda: stocks[symbol],
        lambda: stocks.TSE[symbol],
        lambda: stocks.OTC[symbol],
    ):
        try:
            contract = getter()
        except Exception:
            contract = None
        if contract is not None:
            return contract
    return None


def _tick_price(tick) -> Decimal | None:
    raw = getattr(tick, "close", None)
    if raw is None:
        return None
    try:
        return Decimal(str(raw))
    except InvalidOperation:
        return None


def run_once(api, sj, rules, seen, seen_path, poster, dry_run: bool, ignore_hours: bool) -> int:
    contracts = []
    for symbol in dict.fromkeys(rule["symbol"] for rule in rules):
        contract = lookup_contract(api, symbol)
        if contract is None:
            print(f"找不到合約 {symbol}", file=sys.stderr)
            continue
        contracts.append(contract)
    if not contracts:
        return 2
    snapshots = api.snapshots(contracts)
    cooldown: dict = {}
    lock = threading.Lock()
    for snap in snapshots:
        price = _tick_price(snap)
        code = str(getattr(snap, "code", "") or "")
        if not code or price is None:
            continue
        handle_price(
            code,
            price,
            rules,
            seen,
            seen_path,
            poster=poster,
            dry_run=dry_run,
            ignore_hours=ignore_hours,
            cooldown=cooldown,
            lock=lock,
        )
    return 0


def run_ticks(api, sj, rules, seen, seen_path, poster, dry_run: bool, ignore_hours: bool) -> int:
    if not hasattr(api, "on_tick_stk_v1"):
        raise SystemExit("需要 shioaji 1.2+（on_tick_stk_v1 ticks）。請 pip install -U shioaji")
    quote_type = sj.constant.QuoteType.Tick
    version = sj.constant.QuoteVersion.v1
    contracts = []
    for symbol in dict.fromkeys(rule["symbol"] for rule in rules):
        contract = lookup_contract(api, symbol)
        if contract is None:
            print(f"找不到合約 {symbol}", file=sys.stderr)
            continue
        api.quote.subscribe(contract, quote_type=quote_type, version=version)
        contracts.append(contract)
    if not contracts:
        return 2
    cooldown: dict = {}
    lock = threading.Lock()

    @api.on_tick_stk_v1()
    def on_tick(_exchange, tick):
        price = _tick_price(tick)
        code = str(getattr(tick, "code", "") or "")
        if not code or price is None:
            return
        handle_price(
            code,
            price,
            rules,
            seen,
            seen_path,
            poster=poster,
            dry_run=dry_run,
            ignore_hours=ignore_hours,
            cooldown=cooldown,
            lock=lock,
        )

    names = ", ".join(dict.fromkeys(rule["symbol"] for rule in rules))
    print(f"行情監控中（不下單）: {names}")
    try:
        last_beat = time.time()
        while True:
            time.sleep(5)
            if time.time() - last_beat >= 300:
                print(f"仍在監控 {len(contracts)} 檔")
                last_beat = time.time()
    except KeyboardInterrupt:
        print("停止監控")
    finally:
        for contract in contracts:
            try:
                api.quote.unsubscribe(contract, quote_type=quote_type, version=version)
            except Exception:
                pass
    return 0


def resolve_watchlist(args) -> Path:
    if args.watchlist:
        return args.watchlist
    env = os.environ.get("ALERT_WATCHLIST", "").strip()
    if env:
        return Path(env).expanduser()
    return DEFAULT_WATCHLIST


def push_url() -> str:
    return os.environ.get("ALERT_PUSH_URL", DEFAULT_PUSH_URL).strip() or DEFAULT_PUSH_URL


def require_secret() -> str:
    secret = os.environ.get("ALERT_PUSH_SECRET", "").strip()
    if not secret:
        raise SystemExit("請設定 ALERT_PUSH_SECRET（與 Pages secret 相同，不要寫進 git）")
    return secret


def send_test(args) -> int:
    secret = "" if args.dry_run else require_secret()
    payload = {
        "symbol": args.symbol,
        "title": args.title,
        "body": args.body,
        "url": "/#portfolio",
    }
    if args.dry_run:
        print(json.dumps(payload, ensure_ascii=False))
        return 0
    result = post_alert(push_url(), secret, payload)
    print(json.dumps(result, ensure_ascii=False))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="永豐行情到價後，呼叫 TradingVenator Web Push（不下單）")
    parser.add_argument("--watchlist", type=Path, default=None, help="預設 scripts/alerts/watchlist.json")
    parser.add_argument("--seen", type=Path, default=DEFAULT_SEEN, help="去重紀錄")
    parser.add_argument("--once", action="store_true", help="用 snapshot 查一次就結束")
    parser.add_argument("--dry-run", action="store_true", help="印出將送出的內容，不呼叫 API、不寫去重")
    parser.add_argument("--ignore-hours", action="store_true", help="略過 09:00–13:30 台北交易時段檢查")
    parser.add_argument("--reset-dedupe", action="store_true", help="先清掉去重紀錄")
    parser.add_argument("--send-test", action="store_true", help="不登入永豐，直接送一則測試推播")
    parser.add_argument("--symbol", default="2330")
    parser.add_argument("--title", default="到價推播測試")
    parser.add_argument("--body", default="這是一則手動測試，不代表真實成交價。")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.reset_dedupe and args.seen.exists():
        args.seen.unlink()
        print(f"已清除 {args.seen}")
    if args.send_test:
        return send_test(args)

    rules, _user_ids = load_watchlist(resolve_watchlist(args))
    seen = {} if args.dry_run else load_seen(args.seen)
    secret = "" if args.dry_run else require_secret()
    url = push_url()

    def poster(payload: dict) -> dict:
        return post_alert(url, secret, payload)

    api = None
    try:
        api, sj = login_market_data()
        if args.once:
            return run_once(api, sj, rules, seen, args.seen, poster, args.dry_run, args.ignore_hours)
        return run_ticks(api, sj, rules, seen, args.seen, poster, args.dry_run, args.ignore_hours)
    finally:
        if api is not None:
            try:
                api.logout()
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
