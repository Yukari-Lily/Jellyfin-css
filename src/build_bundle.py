#!/usr/bin/env python3
"""Build Anime Modern entirely from local sources for EdgeOne Pages.

Usage: python3 src/build_bundle.py [--palette anime-hoshizora]
"""
import argparse
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
PALETTES = ("anime-hoshizora", "anime-sakura", "anime-matcha", "anime-hinata")


def local(path: Path) -> str:
    return path.read_text(encoding="utf8")


def without_imports(text: str) -> str:
    return re.sub(r"^@import[^\n]*\n", "", text, flags=re.M)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--palette", choices=PALETTES, default="anime-hoshizora")
    args = parser.parse_args()

    # Font declarations are stored with the source sheets; binary files stay in /fonts/.
    quicksand = local(SRC / "fonts-quicksand.css").replace(
        "url(Quicksand-", "url(fonts/Quicksand-"
    )
    symbols = local(SRC / "fonts-symbols.css").replace(
        "url(MaterialSymbolsRounded.woff2)", "url(fonts/MaterialSymbolsRounded.woff2)"
    )
    login = local(SRC / "login.css").replace(
        'url("images/anime-login.svg")', 'url("img/anime-login.svg")'
    )
    base = without_imports(local(SRC / "base.css"))
    anime = without_imports(local(SRC / "anime.css"))
    palette = local(SRC / "colors" / f"{args.palette}.css").replace(
        "../images/anime-login.svg", "img/anime-login.svg"
    ).replace("../logos/anime-modern.svg", "img/anime-modern.svg")
    overrides = local(SRC / "overrides.css")

    parts = [
        ("local Quicksand font", quicksand),
        ("local Material Symbols font", symbols),
        ("local login page", login),
        ("Anime Modern independent base", base),
        ("Anime Modern enhancements", anime),
        (f"default palette: {args.palette}", palette),
        ("layout refinements", overrides),
    ]
    banner = """/* ============================================================
   Anime Modern · independent self-hosted bundle
   Jellyfin 10.11+ / 12 Modern
   built by src/build_bundle.py; edit src/ and rebuild.
   No Jellyfish or third-party CDN dependency at runtime.
   ============================================================ */
"""
    css = banner + "".join(
        f"\n/* ==== {name} ==== */\n{body.strip()}\n" for name, body in parts
    )
    (ROOT / "jellyfish.css").write_text(css, encoding="utf8")

    (ROOT / "colors").mkdir(exist_ok=True)
    for name in PALETTES:
        text = local(SRC / "colors" / f"{name}.css").replace(
            "../images/anime-login.svg", "../img/anime-login.svg"
        ).replace("../logos/anime-modern.svg", "../img/anime-modern.svg")
        (ROOT / "colors" / f"{name}.css").write_text(text, encoding="utf8")

    (ROOT / "img").mkdir(exist_ok=True)
    for name in ("anime-login.svg", "anime-modern.svg"):
        shutil.copy2(SRC / "assets" / name, ROOT / "img" / name)

    (ROOT / "edgeone.json").write_text(json.dumps({"headers": [
        {"source": "/fonts/*", "headers": [
            {"key": "Access-Control-Allow-Origin", "value": "*"},
            {"key": "Cache-Control", "value": "public, max-age=31536000, immutable"},
        ]},
        {"source": "/img/*", "headers": [
            {"key": "Access-Control-Allow-Origin", "value": "*"},
            {"key": "Cache-Control", "value": "public, max-age=86400"},
        ]},
        {"source": "/colors/*", "headers": [
            {"key": "Access-Control-Allow-Origin", "value": "*"},
            {"key": "Cache-Control", "value": "public, max-age=300"},
        ]},
        {"source": "/jellyfish.css", "headers": [
            {"key": "Access-Control-Allow-Origin", "value": "*"},
            {"key": "Cache-Control", "value": "public, max-age=300"},
        ]},
    ]}, indent=2), encoding="utf8")
    print(f"built {ROOT / 'jellyfish.css'} and {len(PALETTES)} palettes")


if __name__ == "__main__":
    main()
