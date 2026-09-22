from __future__ import annotations

import json
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from scripts.alerts.confirm_watch import (
    build_alert,
    consider,
    dedupe_key,
    is_hit,
    parse_watchlist,
    save_seen,
    load_seen,
    within_market_hours,
)

ROOT = Path(__file__).resolve().parents[1]
TAIPEI = ZoneInfo("Asia/Taipei")


def test_market_hours_window():
    assert within_market_hours(datetime(2026, 9, 22, 9, 0, tzinfo=TAIPEI))
    assert within_market_hours(datetime(2026, 9, 22, 13, 30, tzinfo=TAIPEI))
    assert not within_market_hours(datetime(2026, 9, 22, 8, 59, tzinfo=TAIPEI))
    assert not within_market_hours(datetime(2026, 9, 22, 13, 31, tzinfo=TAIPEI))
    assert not within_market_hours(datetime(2026, 9, 26, 10, 0, tzinfo=TAIPEI))


def test_hit_and_dedupe_key():
    assert is_hit(Decimal("950"), Decimal("950"), "above")
    assert not is_hit(Decimal("949.5"), Decimal("950"), "above")
    assert is_hit(Decimal("180"), Decimal("180"), "below")
    assert not is_hit(Decimal("180.5"), Decimal("180"), "below")
    assert dedupe_key("2330", "above", Decimal("950.00")) == "2330|above|950"


def test_parse_watchlist_applies_user_ids():
    rules, user_ids = parse_watchlist(
        {
            "user_ids": ["user_abc"],
            "symbols": [{"symbol": "2330", "name": "台積電", "target": 950, "direction": "above"}],
        }
    )
    assert user_ids == ["user_abc"]
    assert rules[0]["user_ids"] == ["user_abc"]
    assert rules[0]["target"] == Decimal("950")


def test_parse_watchlist_rejects_bad_direction():
    with pytest.raises(ValueError):
        parse_watchlist({"symbols": [{"symbol": "2330", "target": 1, "direction": "sideways"}]})


def test_consider_sends_once_then_dedupes(tmp_path: Path):
    rule = {
        "symbol": "2330",
        "name": "台積電",
        "target": Decimal("950"),
        "direction": "above",
        "user_ids": [],
    }
    seen: dict = {}
    sent: list = []
    now = datetime(2026, 9, 22, 10, 0, tzinfo=TAIPEI)
    assert consider(rule, Decimal("949"), seen, poster=sent.append, now=now) == "skip"
    assert consider(rule, Decimal("950"), seen, poster=sent.append, now=now) == "sent"
    assert consider(rule, Decimal("960"), seen, poster=sent.append, now=now) == "deduped"
    assert len(sent) == 1
    assert sent[0]["symbol"] == "2330"
    assert "不會下單" in sent[0]["body"]
    path = tmp_path / ".alert-hits.json"
    save_seen(path, seen)
    assert "2330|above|950" in load_seen(path)


def test_consider_does_not_dedupe_when_post_fails():
    rule = {
        "symbol": "2317",
        "name": "鴻海",
        "target": Decimal("180"),
        "direction": "below",
        "user_ids": [],
    }
    seen: dict = {}
    now = datetime(2026, 9, 22, 10, 0, tzinfo=TAIPEI)

    def boom(_payload):
        raise RuntimeError("push API 503")

    assert consider(rule, Decimal("179"), seen, poster=boom, now=now, cooldown={}) == "error"
    assert seen == {}


def test_closed_market_skips_without_ignore():
    rule = {
        "symbol": "2330",
        "name": "台積電",
        "target": Decimal("1"),
        "direction": "above",
        "user_ids": [],
    }
    now = datetime(2026, 9, 22, 18, 0, tzinfo=TAIPEI)
    assert consider(rule, Decimal("2"), {}, poster=lambda _p: None, now=now) == "closed"
    assert (
        consider(rule, Decimal("2"), {}, poster=lambda _p: None, now=now, ignore_hours=True) == "sent"
    )


def test_build_alert_includes_optional_user_filter():
    payload = build_alert(
        {
            "symbol": "2330",
            "name": "台積電",
            "target": Decimal("950"),
            "direction": "above",
            "user_ids": ["user_abc"],
        },
        Decimal("951"),
    )
    assert payload["user_ids"] == ["user_abc"]
    assert payload["url"] == "/#portfolio"


def test_script_does_not_place_orders():
    text = (ROOT / "scripts" / "alerts" / "confirm_watch.py").read_text(encoding="utf-8")
    assert "activate_ca(" not in text
    assert "place_order(" not in text
    assert "OrderState" not in text


def test_example_watchlist_parses():
    data = json.loads((ROOT / "scripts" / "alerts" / "watchlist.example.json").read_text(encoding="utf-8"))
    rules, _ids = parse_watchlist(data)
    assert {rule["symbol"] for rule in rules} == {"2330", "2317"}
