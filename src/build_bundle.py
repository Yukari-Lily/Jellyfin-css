#!/usr/bin/env python3
"""Build one self-hosted stylesheet for EdgeOne (no jsDelivr at runtime).

Pulls the Jellyfish theme files the site actually needs, inlines every @import in
the same order a browser would apply them, rewrites asset URLs to relative paths,
and appends the local override sheet.

Output: deploy/jellyfin/{jellyfish.css, fonts/*.woff2, img/jellypurple.jpg}

usage: python3 tools/build_bundle.py [--palette jellypurple] [--base https://cdn.jsdelivr.net/gh/n00bcodr/Jellyfish@main]
"""
import argparse
import json
import re
import shutil
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "deploy" / "jellyfin"
CUSTOM = ROOT / "custom" / "jellyfish-refined.css"


UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36"}


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf8")


def fetch_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def local(p: Path) -> str:
    return p.read_text(encoding="utf8")


def main() -> None:
    global OUT, CUSTOM
    ap = argparse.ArgumentParser()
    ap.add_argument("--palette", default="anime-sakura")
    ap.add_argument("--base", default="https://cdn.jsdelivr.net/gh/n00bcodr/Jellyfish@main")
    ap.add_argument("--icon-css", default="https://cdn.jsdelivr.net/gh/Druidblack/jellyfin-icon-metadata/public-icon.css")
    ap.add_argument("--logo", default="https://s2.loli.net/2024/12/18/gUJ7l2iuzme1hcb.png")
    ap.add_argument("--out", default=str(OUT), help="output directory")
    ap.add_argument("--overrides", default=str(CUSTOM), help="your override css")
    args = ap.parse_args()

    base = args.base.rstrip("/")
    OUT = Path(args.out).resolve()
    CUSTOM = Path(args.overrides).resolve()
    repo = ROOT / "repo"

    # remote files (fall back to the local clone when it is there)
    def remote(path: str) -> str:
        f = repo / path
        return local(f) if f.exists() else fetch(f"{base}/{path}")

    theme = remote("theme.css")
    quicksand = remote("fonts/quicksand.css")
    symbols = remote("fonts/materialSymbolsRounded.css")
    loginpage = remote("loginpage.css")
    jellyblue = remote("colors/jellyblue.css")
    # palettes ship with this repo (src/colors), so building works offline
    local_palette = ROOT / "src" / "colors" / f"{args.palette}.css"
    palette = local(local_palette) if local_palette.exists() else remote(f"colors/{args.palette}.css")
    card_buttons = remote("card_buttons.css")
    icons = fetch(args.icon_css) if args.icon_css else ""

    # theme.css: drop its @import block, it is inlined here instead
    theme_body = re.sub(r"^@import[^\n]*\n", "", theme, flags=re.M)

    # relative asset paths inside the inlined sheets point at fonts/ and img/
    quicksand = quicksand.replace("url(Quicksand-", "url(fonts/Quicksand-")
    symbols = symbols.replace("url(MaterialSymbolsRounded.woff2)", "url(fonts/MaterialSymbolsRounded.woff2)")

    # palette background image -> local copy
    def localise_images(text: str) -> str:
        return re.sub(
            r"https://cdn\.jsdelivr\.net/gh/n00bcodr/[Jj]ellyfish[^\"')]*colors/images/([\w.-]+)",
            r"img/\1",
            text,
        )

    palette = localise_images(palette)
    # jellyblue ships too and still names its background image; keep it same-origin.
    jellyblue = localise_images(jellyblue)
    # loginpage.css keeps a hard-coded imgur fallback behind var(--background-image).
    # Every palette we ship sets that variable, so it is unreachable today, but a
    # future palette that forgets it would silently pull an image from imgur.com.
    loginpage = loginpage.replace(
        "https://i.imgur.com/Ewk3Pqw.png", "img/jellypurple.jpg"
    )

    # 先把 logo 拿到手，拿不到就不要覆盖 --logo，免得出图 404
    logo_ok = False
    if args.logo:
        try:
            logo_bytes = fetch_bytes(args.logo)
            logo_ok = len(logo_bytes) > 100
        except Exception as e:
            print(f"  ! logo download failed ({e}), keep the theme default")
            logo_bytes = b""

    parts = [
        ("fonts/quicksand.css", quicksand),
        ("public-icon.css (Druidblack, MIT)", icons),
        ("fonts/materialSymbolsRounded.css", symbols),
        ("loginpage.css", loginpage),
        ("colors/jellyblue.css", jellyblue),
        ("theme.css", theme_body),
        (f"colors/{args.palette}.css", palette),
        ("card_buttons.css", card_buttons),
        ("custom overrides", local(CUSTOM)),
        # 站点 logo 也一起收进来，前端就完全不再请求第三方域名
        ("site logo", ':root { --logo: url("img/logo.png"); }' if logo_ok else ""),
    ]

    banner = (
        "/* ============================================================\n"
        "   Jellyfish self-hosted bundle\n"
        f"   theme: {base}\n"
        "   built by tools/build_bundle.py - do not edit by hand,\n"
        "   edit custom/jellyfish-refined.css and rebuild.\n"
        "   ============================================================ */\n\n"
    )
    css = banner + "".join(f"\n/* ==== {name} ==== */\n{body.strip()}\n" for name, body in parts)

    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "fonts").mkdir(parents=True)
    (OUT / "img").mkdir(parents=True)

    for f in ("MaterialSymbolsRounded.woff2", "Quicksand-latin.woff2",
              "Quicksand-latin-ext.woff2", "Quicksand-vietnamese.woff2"):
        src = repo / "fonts" / f
        if src.exists():
            shutil.copy2(src, OUT / "fonts" / f)
        else:
            (OUT / "fonts" / f).write_bytes(urllib.request.urlopen(f"{base}/fonts/{f}", timeout=120).read())

    # This repo's palettes are colour-only (no background image), so a missing
    # palette image is expected and must not fail the build.
    img = repo / "colors" / "images" / f"{args.palette}.jpg"
    if img.exists():
        shutil.copy2(img, OUT / "img" / img.name)
    elif args.palette == "jellypurple":
        (OUT / "img" / img.name).write_bytes(
            urllib.request.urlopen(f"{base}/colors/images/{img.name}", timeout=120).read()
        )

    # The bundled jellyblue palette still names img/jellyblue.jpg, and a colour-only
    # palette does not override it - ship the file so the login background resolves.
    fallback_img = repo / "colors" / "images" / "jellyblue.jpg"
    if not (OUT / "img" / "jellyblue.jpg").exists():
        if fallback_img.exists():
            shutil.copy2(fallback_img, OUT / "img" / "jellyblue.jpg")
        else:
            (OUT / "img" / "jellyblue.jpg").write_bytes(
                urllib.request.urlopen(f"{base}/colors/images/jellyblue.jpg", timeout=120).read()
            )

    if logo_ok:
        (OUT / "img" / "logo.png").write_bytes(logo_bytes)

    (OUT / "jellyfish.css").write_text(css, encoding="utf8")

    # EdgeOne Pages 响应头：字体是跨域加载的，必须给 Access-Control-Allow-Origin
    (OUT / "edgeone.json").write_text(
        json.dumps(
            {
                "headers": [
                    {
                        "source": "/fonts/*",
                        "headers": [
                            {"key": "Access-Control-Allow-Origin", "value": "*"},
                            {"key": "Cache-Control", "value": "public, max-age=31536000, immutable"},
                        ],
                    },
                    {
                        "source": "/img/*",
                        "headers": [
                            {"key": "Access-Control-Allow-Origin", "value": "*"},
                            {"key": "Cache-Control", "value": "public, max-age=31536000, immutable"},
                        ],
                    },
                    {
                        "source": "/jellyfish.css",
                        "headers": [
                            {"key": "Access-Control-Allow-Origin", "value": "*"},
                            {"key": "Cache-Control", "value": "public, max-age=300"},
                        ],
                    },
                ]
            },
            indent=2,
        ),
        encoding="utf8",
    )

    size = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    print(f"built {OUT}")
    for f in sorted(OUT.rglob("*")):
        if f.is_file():
            print(f"  {f.relative_to(OUT)}  {f.stat().st_size / 1024:.0f} KB")
    print(f"  total {size / 1024:.0f} KB")


main()
