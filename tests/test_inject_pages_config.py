from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_inject():
    spec = importlib.util.spec_from_file_location(
        "inject_pages_config", ROOT / "scripts" / "inject_pages_config.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_strip_d1_binding_keeps_vars():
    mod = load_inject()
    sample = """name = "tradingvenator"

[[d1_databases]]
binding = "DB"
database_name = "tradingvenator"
database_id = "00000000-0000-0000-0000-000000000000"

[vars]
CLERK_PUBLISHABLE_KEY = "__CLERK_PUBLISHABLE_KEY__"
"""
    out = mod.strip_d1_binding(sample)
    assert "d1_databases" not in out
    assert 'database_id' not in out
    assert "[vars]" in out
    assert "CLERK_PUBLISHABLE_KEY" in out
    assert 'name = "tradingvenator"' in out
