#!/usr/bin/env python3
"""Inject Clerk / D1 / R2 placeholders before Cloudflare Pages deploy.

Reads GitHub Actions env:
  CLERK_PUBLISHABLE_KEY
  D1_DATABASE_ID
  R2_TEACHING_BUCKET  (bucket name, or 1/true to keep default flashpick-teaching)

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
DEFAULT_R2_BUCKET = "flashpick-teaching"
TRUTHY_R2 = {"1", "true", "yes", "on"}


def replace_token(path: Path, token: str, value: str) -> bool:
    text = path.read_text(encoding="utf-8")
    if token not in text:
        return False
    path.write_text(text.replace(token, value), encoding="utf-8")
    return True


def strip_toml_table(toml_text: str, header: str) -> str:
    lines = toml_text.splitlines(keepends=True)
    out = []
    skipping = False
    for line in lines:
        stripped = line.lstrip()
        if stripped.startswith(header):
            skipping = True
            continue
        if skipping:
            if stripped.startswith("[") and not stripped.startswith(header):
                skipping = False
                out.append(line)
            continue
        out.append(line)
    return "".join(out)


def strip_d1_binding(toml_text: str) -> str:
    return strip_toml_table(toml_text, "[[d1_databases]]")


def strip_r2_binding(toml_text: str) -> str:
    return strip_toml_table(toml_text, "[[r2_buckets]]")


def bucket_name_from_secret(raw: str) -> str:
    value = str(raw).strip()
    if not value or value.lower() in TRUTHY_R2:
        return DEFAULT_R2_BUCKET
    if re.fullmatch(r"[a-z0-9][a-z0-9-]{1,61}[a-z0-9]", value):
        return value
    return DEFAULT_R2_BUCKET


def replace_r2_bucket_name(toml_text: str, bucket_name: str) -> str:
    lines = toml_text.splitlines(keepends=True)
    out = []
    in_r2 = False
    for line in lines:
        stripped = line.lstrip()
        if stripped.startswith("[[r2_buckets]]"):
            in_r2 = True
            out.append(line)
            continue
        if in_r2:
            if stripped.startswith("[") and not stripped.startswith("[[r2_buckets]]"):
                in_r2 = False
            elif stripped.startswith("bucket_name"):
                indent = line[: len(line) - len(line.lstrip())]
                newline = "\n" if line.endswith("\n") else ""
                out.append(f"{indent}bucket_name = {json.dumps(bucket_name)}{newline}")
                continue
        out.append(line)
    return "".join(out)


def main() -> None:
    pk = os.environ.get("CLERK_PUBLISHABLE_KEY", "").strip()
    d1 = os.environ.get("D1_DATABASE_ID", "").strip()
    r2 = os.environ.get("R2_TEACHING_BUCKET", "").strip()

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
        toml = toml.replace(PLACEHOLDER_D1, d1)
        print("Injected D1_DATABASE_ID into wrangler.toml")
    else:
        toml = strip_d1_binding(toml)
        print("::warning::D1_DATABASE_ID not set; deploying without DB binding (/api returns 503)")

    if r2:
        bucket = bucket_name_from_secret(r2)
        toml = replace_r2_bucket_name(toml, bucket)
        print(f"Kept R2 TEACHING_COVERS binding for bucket {bucket}")
    else:
        toml = strip_r2_binding(toml)
        print(
            "::warning::R2_TEACHING_BUCKET not set; deploying without teaching cover R2 "
            "(POST /api/lessons/cover returns 503 until the bucket is bound)"
        )

    toml_path.write_text(toml, encoding="utf-8")


if __name__ == "__main__":
    main()
