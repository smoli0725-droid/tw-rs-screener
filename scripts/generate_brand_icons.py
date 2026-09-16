#!/usr/bin/env python3
"""Rasterize FlashPick / 閃電選股 brand icons from brand/cheetah-face.jpg."""

from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "brand" / "cheetah-face.jpg"
SITE_ICONS = ROOT / "site" / "icons"
APP = ROOT / "app"


def resize_square(im: Image.Image, size: int) -> Image.Image:
    return im.resize((size, size), Image.Resampling.LANCZOS)


def content_crop(im: Image.Image, pad_ratio: float = 0.08) -> Image.Image:
    """Tighten navy padding so tiny favicons still show the face."""
    gray = im.convert("L")
    # Background is ~2–8; face is much brighter.
    mask = gray.point(lambda p: 255 if p > 28 else 0)
    bbox = mask.getbbox()
    if not bbox:
        return im
    left, top, right, bottom = bbox
    w, h = right - left, bottom - top
    pad = int(max(w, h) * pad_ratio)
    left = max(0, left - pad)
    top = max(0, top - pad)
    right = min(im.width, right + pad)
    bottom = min(im.height, bottom + pad)
    side = max(right - left, bottom - top)
    cx = (left + right) // 2
    cy = (top + bottom) // 2
    half = side // 2
    box = (
        max(0, cx - half),
        max(0, cy - half),
        min(im.width, cx + half),
        min(im.height, cy + half),
    )
    cropped = im.crop(box)
    if cropped.size[0] != cropped.size[1]:
        square = Image.new("RGB", (side, side), im.getpixel((2, 2)))
        square.paste(cropped, ((side - cropped.size[0]) // 2, (side - cropped.size[1]) // 2))
        return square
    return cropped


def save_png(im: Image.Image, path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    resize_square(im, size).save(path, format="PNG", optimize=True)


def make_og(im: Image.Image, path: Path) -> None:
    w, h = 1200, 630
    bg = im.getpixel((8, 8))
    canvas = Image.new("RGB", (w, h), bg)
    face = resize_square(im, 560)
    canvas.paste(face, ((w - face.width) // 2, (h - face.height) // 2))
    path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(path, format="PNG", optimize=True)


def main() -> None:
    src = Image.open(SRC).convert("RGB")
    tight = content_crop(src)

    SITE_ICONS.mkdir(parents=True, exist_ok=True)
    save_png(src, SITE_ICONS / "icon-180.png", 180)
    save_png(src, SITE_ICONS / "icon-192.png", 192)
    save_png(src, SITE_ICONS / "icon-512.png", 512)
    save_png(tight, SITE_ICONS / "favicon-32.png", 32)
    make_og(src, SITE_ICONS / "og-1200x630.png")

    ico_base = resize_square(tight, 256)
    ico_base.save(
        ROOT / "site" / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )

    save_png(src, APP / "assets" / "brand" / "cheetah.png", 192)

    android = APP / "android" / "app" / "src" / "main" / "res"
    for folder, size in {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }.items():
        save_png(src, android / folder / "ic_launcher.png", size)

    save_png(src, android / "drawable" / "launch_logo.png", 288)
    save_png(src, android / "drawable-v21" / "launch_logo.png", 288)

    ios_icon = APP / "ios" / "Runner" / "Assets.xcassets" / "AppIcon.appiconset"
    ios_sizes = {
        "Icon-App-20x20@1x.png": 20,
        "Icon-App-20x20@2x.png": 40,
        "Icon-App-20x20@3x.png": 60,
        "Icon-App-29x29@1x.png": 29,
        "Icon-App-29x29@2x.png": 58,
        "Icon-App-29x29@3x.png": 87,
        "Icon-App-40x40@1x.png": 40,
        "Icon-App-40x40@2x.png": 80,
        "Icon-App-40x40@3x.png": 120,
        "Icon-App-60x60@2x.png": 120,
        "Icon-App-60x60@3x.png": 180,
        "Icon-App-76x76@1x.png": 76,
        "Icon-App-76x76@2x.png": 152,
        "Icon-App-83.5x83.5@2x.png": 167,
        "Icon-App-1024x1024@1x.png": 1024,
    }
    for name, size in ios_sizes.items():
        save_png(src, ios_icon / name, size)

    launch = APP / "ios" / "Runner" / "Assets.xcassets" / "LaunchImage.imageset"
    save_png(src, launch / "LaunchImage.png", 168)
    save_png(src, launch / "LaunchImage@2x.png", 336)
    save_png(src, launch / "LaunchImage@3x.png", 504)

    print("wrote brand icons from", SRC)


if __name__ == "__main__":
    main()
