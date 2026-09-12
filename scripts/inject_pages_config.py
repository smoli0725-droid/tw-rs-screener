#!/usr/bin/env python3
"""Inject Clerk / D1 placeholders before Cloudflare Pages deploy.

Reads GitHub Actions env:
  CLERK_PUBLISHABLE_KEY
  D1_DATABASE_ID

Never prints secret values.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLACEHOLDER_PK = "__CLERK_PUBLISHABLE_KEY__"
PLACEHOLDER_D1 = "00000000-0000-0000-0000-000000000000"


def replace_token(path: Path, token: str, value: str) -> bool:
    text = path.read_text(encoding="utf-8")
    if token not in text:
        return False
    path.write_text(text.replace(token, value), encoding="utf-8")
    return True


def strip_d1_binding(toml_text: str) -> str:
    lines = toml_text.splitlines(keepends=True)
    out = []
    skipping = False
    for line in lines:
        stripped = line.lstrip()
        if stripped.startswith("[[d1_databases]]"):
            skipping = True
            continue
        if skipping:
            if stripped.startswith("[") and not stripped.startswith("[[d1_databases]]"):
                skipping = False
                out.append(line)
            continue
        out.append(line)
    return "".join(out)


def main() -> None:
    pk = os.environ.get("CLERK_PUBLISHABLE_KEY", "").strip()
    d1 = os.environ.get("D1_DATABASE_ID", "").strip()

    if pk and pk != PLACEHOLDER_PK:
        for rel in ("site/js/config.js", "site/index.html"):
            path = ROOT / rel
            if replace_token(path, PLACEHOLDER_PK, pk):
                print(f"Injected Clerk publishable key into {rel}")
        toml_path = ROOT / "wrangler.toml"
        toml = toml_path.read_text(encoding="utf-8")
        toml_path.write_text(
            re.sub(
                r'CLERK_PUBLISHABLE_KEY\s*=\s*".*?"',
                "CLERK_PUBLISHABLE_KEY = " + json.dumps(pk),
                toml,
                count=1,
            ),
            encoding="utf-8",
        )
        print("Injected Clerk publishable key into wrangler.toml [vars]")
    else:
        print("::warning::CLERK_PUBLISHABLE_KEY not set; site will show Clerk setup screen")

    toml_path = ROOT / "wrangler.toml"
    toml = toml_path.read_text(encoding="utf-8")
    if d1 and d1 != PLACEHOLDER_D1:
        toml_path.write_text(toml.replace(PLACEHOLDER_D1, d1), encoding="utf-8")
        print("Injected D1_DATABASE_ID into wrangler.toml")
    else:
        toml_path.write_text(strip_d1_binding(toml), encoding="utf-8")
        print("::warning::D1_DATABASE_ID not set; deploying without DB binding (/api returns 503)")


if __name__ == "__main__":
    main()
