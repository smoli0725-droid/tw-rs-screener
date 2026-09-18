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

[[r2_buckets]]
binding = "TEACHING_COVERS"
bucket_name = "flashpick-teaching"

[vars]
CLERK_PUBLISHABLE_KEY = "__CLERK_PUBLISHABLE_KEY__"
"""
    out = mod.strip_d1_binding(sample)
    assert "d1_databases" not in out
    assert 'database_id' not in out
    assert "[vars]" in out
    assert "CLERK_PUBLISHABLE_KEY" in out
    assert 'name = "tradingvenator"' in out
    assert "TEACHING_COVERS" in out


def test_strip_r2_binding_keeps_d1_and_vars():
    mod = load_inject()
    sample = """name = "tradingvenator"

[[d1_databases]]
binding = "DB"
database_id = "00000000-0000-0000-0000-000000000000"

[[r2_buckets]]
binding = "TEACHING_COVERS"
bucket_name = "flashpick-teaching"

[vars]
CLERK_PUBLISHABLE_KEY = "__CLERK_PUBLISHABLE_KEY__"
"""
    out = mod.strip_r2_binding(sample)
    assert "r2_buckets" not in out
    assert "TEACHING_COVERS" not in out
    assert "d1_databases" in out
    assert "[vars]" in out


def test_bucket_name_from_secret():
    mod = load_inject()
    assert mod.bucket_name_from_secret("true") == "flashpick-teaching"
    assert mod.bucket_name_from_secret("flashpick-teaching") == "flashpick-teaching"
    assert mod.bucket_name_from_secret("my-covers-bucket") == "my-covers-bucket"
    assert mod.bucket_name_from_secret("NOPE") == "flashpick-teaching"


def test_replace_r2_bucket_name():
    mod = load_inject()
    sample = """[[r2_buckets]]
binding = "TEACHING_COVERS"
bucket_name = "flashpick-teaching"

[vars]
x = "1"
"""
    out = mod.replace_r2_bucket_name(sample, "custom-bucket")
    assert 'bucket_name = "custom-bucket"' in out
    assert "TEACHING_COVERS" in out
    assert "[vars]" in out
