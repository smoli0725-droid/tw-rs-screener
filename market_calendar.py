# -*- coding: utf-8 -*-
"""台股是否休市（週末、證交所開休市表、臨時休市）。

交易日資料晚到仍應由 rs_calculator 以 exit 2 結束，等下一個時段。
休市日沒有當日收盤，在下載全市場之前以 exit 0 略過。

休市表優先用證交所當年公布的 holidaySchedule。端點沒有該年資料或連線
失敗時，用 data/twse_market_closures.json。名稱含「開始交易」或
「最後交易」的列是交易日備註，不是休市。

颱風等臨時休市通常不在年初表內。若 TWSE 新聞標題寫明今天休市
（或昨日宣布明日休市），也視為休市。判斷失敗時視為交易日，避免
誤擋正常更新。
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys

TAIPEI_TZ = dt.timezone(dt.timedelta(hours=8))
_DATA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "data", "twse_market_closures.json")
_RWD_URL = (
    "https://www.twse.com.tw/rwd/zh/holidaySchedule/holidaySchedule"
    "?date={year}0101&response=json"
)
_OPENAPI_URL = "https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule"
_NEWS_URL = "https://openapi.twse.com.tw/v1/news/newsList"
_HTTP_HEADERS = {"User-Agent": "tw-rs-screener/market-calendar"}

_CLOSURE_IN_TITLE = re.compile(r"休市|停止交易")
_TODAY_WORD = re.compile(r"本日|今日")
_TOMORROW_WORD = re.compile(r"明日")
_ISO_IN_TITLE = re.compile(r"(20\d{2})-(\d{2})-(\d{2})")
_MD_IN_TITLE = re.compile(r"(?<!\d)(\d{1,2})月(\d{1,2})日")


def taipei_today() -> dt.date:
    return dt.datetime.now(TAIPEI_TZ).date()


def parse_market_date(val) -> dt.date | None:
    """西元 YYYY-MM-DD / YYYYMMDD，或民國 7 碼（1150925）。"""
    if val is None:
        return None
    raw = str(val).strip()
    if not raw or raw.lower() == "nan":
        return None
    compact = re.sub(r"\D", "", raw)
    try:
        if len(compact) == 7:
            y, m, d = int(compact[:3]) + 1911, int(compact[3:5]), int(compact[5:7])
        elif len(compact) == 8:
            y, m, d = int(compact[:4]), int(compact[4:6]), int(compact[6:8])
        elif len(compact) == 6:
            y, m, d = int(compact[:2]) + 1911, int(compact[2:4]), int(compact[4:6])
        else:
            return None
        return dt.date(y, m, d)
    except ValueError:
        return None


def is_scheduled_closure(name: str, description: str = "") -> bool:
    """開休市表裡，開始／最後交易日是備註，其餘列視為休市。"""
    del description  # 說明欄常複述補假規則，不以它覆寫名稱
    text = str(name or "").strip()
    if not text:
        return False
    if "開始交易" in text or "最後交易" in text:
        return False
    return True


def parse_holiday_schedule(payload) -> dict[dt.date, str]:
    """解析證交所 holidaySchedule（官網 data 列或 OpenAPI 物件陣列）。"""
    rows: list[tuple] = []
    if isinstance(payload, list):
        for item in payload:
            if isinstance(item, dict):
                rows.append((
                    item.get("Date") or item.get("日期"),
                    item.get("Name") or item.get("名稱"),
                    item.get("Description") or item.get("說明") or "",
                ))
    elif isinstance(payload, dict):
        for item in payload.get("data") or []:
            if isinstance(item, (list, tuple)) and len(item) >= 2:
                desc = item[2] if len(item) > 2 else ""
                rows.append((item[0], item[1], desc))
            elif isinstance(item, dict):
                rows.append((
                    item.get("Date") or item.get("日期"),
                    item.get("Name") or item.get("名稱"),
                    item.get("Description") or item.get("說明") or "",
                ))
    closures: dict[dt.date, str] = {}
    for raw_date, name, desc in rows:
        if not is_scheduled_closure(name, desc):
            continue
        parsed = parse_market_date(raw_date)
        if parsed is None:
            continue
        closures[parsed] = str(name).strip()
    return closures


def load_fallback_closures(path: str | None = None) -> dict[dt.date, str]:
    path = path or _DATA_PATH
    with open(path, encoding="utf-8") as fh:
        payload = json.load(fh)
    closures: dict[dt.date, str] = {}
    for row in payload.get("closures") or []:
        parsed = parse_market_date(row.get("date"))
        name = str(row.get("name") or "").strip()
        if parsed is None or not is_scheduled_closure(name):
            continue
        closures[parsed] = name
    return closures


def _http_get_json(url: str):
    import requests
    response = requests.get(url, timeout=20, headers=_HTTP_HEADERS)
    response.raise_for_status()
    return response.json()


def fetch_holiday_schedule(year: int) -> dict[dt.date, str] | None:
    """取得該年休市日。沒有資料或連線失敗回傳 None，由呼叫端改用內建表。"""
    urls = (_RWD_URL.format(year=year), _OPENAPI_URL)
    saw_error = False
    for url in urls:
        try:
            parsed = parse_holiday_schedule(_http_get_json(url))
        except Exception as exc:
            saw_error = True
            print(f"[calendar] 休市表取得失敗 {url}: {exc}", flush=True)
            continue
        year_rows = {day: name for day, name in parsed.items() if day.year == year}
        if year_rows:
            print(f"[calendar] 休市表 {year} 來自線上（{len(year_rows)} 日）", flush=True)
            return year_rows
        print(f"[calendar] 線上休市表沒有 {year} 的資料", flush=True)
    if saw_error:
        print("[calendar] 改用內建休市表", flush=True)
    return None


def fetch_twse_news() -> list | None:
    try:
        payload = _http_get_json(_NEWS_URL)
    except Exception as exc:
        print(f"[calendar] TWSE 新聞取得失敗: {exc}", flush=True)
        return None
    return payload if isinstance(payload, list) else None


def _dates_in_title(title: str, year: int) -> set[dt.date]:
    found: set[dt.date] = set()
    for y, m, d in _ISO_IN_TITLE.findall(title):
        try:
            found.add(dt.date(int(y), int(m), int(d)))
        except ValueError:
            continue
    for m, d in _MD_IN_TITLE.findall(title):
        try:
            found.add(dt.date(year, int(m), int(d)))
        except ValueError:
            continue
    return found


def closure_from_news(items, today: dt.date) -> str | None:
    """新聞標題明確指向 today 的休市（含昨日宣布的明日休市）。"""
    if not items:
        return None
    yesterday = today - dt.timedelta(days=1)
    for item in items:
        if not isinstance(item, dict):
            continue
        title = str(item.get("Title") or item.get("title") or "").strip()
        if not title or not _CLOSURE_IN_TITLE.search(title):
            continue
        named = _dates_in_title(title, today.year)
        if "休市原則" in title and not named:
            continue
        if named:
            if today in named:
                return title
            continue
        news_day = parse_market_date(item.get("Date") or item.get("date"))
        if _TODAY_WORD.search(title) and news_day in (today, yesterday):
            return title
        if _TOMORROW_WORD.search(title) and news_day == yesterday:
            return title
    return None


def closures_for_year(year: int) -> dict[dt.date, str]:
    """線上該年休市表優先；沒有則用內建備援。"""
    live = fetch_holiday_schedule(year)
    if live:
        return live
    fallback = {day: name for day, name in load_fallback_closures().items()
                if day.year == year}
    if fallback:
        print(f"[calendar] 使用內建休市表 {year}（{len(fallback)} 日）", flush=True)
    else:
        print(f"[calendar] 沒有 {year} 休市表，只排除週末", flush=True)
    return fallback


def is_market_closed(today: dt.date | None = None) -> tuple[bool, str]:
    """回傳 (是否休市, 原因)。原因給日誌；交易日的原因是空字串。"""
    today = today or taipei_today()
    if today.weekday() >= 5:
        return True, "週末"
    try:
        closures = closures_for_year(today.year)
        if today in closures:
            return True, closures[today]
        title = closure_from_news(fetch_twse_news() or [], today)
        if title:
            return True, title
    except Exception as exc:
        print(f"[calendar] 休市判斷失敗，視為交易日繼續: {exc}", flush=True)
        return False, ""
    return False, ""


def skip_message(today: dt.date) -> str:
    return f"今天({today.isoformat()})休市，略過"


def ensure_market_open(today: dt.date | None = None) -> None:
    """休市則印出略過訊息並以 exit 0 結束。交易日直接返回。"""
    today = today or taipei_today()
    closed, reason = is_market_closed(today)
    if not closed:
        return
    print(skip_message(today), flush=True)
    if reason:
        print(f"[calendar] {reason}", flush=True)
    sys.exit(0)


def _github_output(key: str, value: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if not path:
        return
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(f"{key}={value}\n")


def main() -> int:
    today = taipei_today()
    closed, reason = is_market_closed(today)
    if closed:
        print(skip_message(today), flush=True)
        if reason:
            print(f"[calendar] {reason}", flush=True)
        _github_output("closed", "true")
        return 0
    print(f"[calendar] {today.isoformat()} 交易日，繼續更新", flush=True)
    _github_output("closed", "false")
    return 0


if __name__ == "__main__":
    sys.exit(main())
