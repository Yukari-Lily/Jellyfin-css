#!/usr/bin/env python3
"""Build one self-hosted stylesheet for EdgeOne (no third-party request, build or runtime).

Upstream theme files and the metadata icons are vendored under src/upstream/ and img/icons/,
so this script reads only local files and the output references no remote URL.

Pulls the Jellyfish theme files the site actually needs, inlines every @import in
the same order a browser would apply them, rewrites asset URLs to relative paths,
and appends the local override sheet.

Output: deploy/jellyfin/{jellyfish.css, fonts/*.woff2, img/jellypurple.jpg}

usage: python3 src/build_bundle.py --overrides src/overrides.css --out /tmp/build
"""
import argparse
import json
import re
import shutil
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = Path("/tmp/build")          # 产物目录（会被整个删除，别指向仓库根）
CUSTOM = ROOT / "src" / "overrides.css"


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
    ap.add_argument("--upstream", default=str(ROOT / "src" / "upstream"),
                    help="vendored upstream theme files (theme.css, loginpage.css, ...)")
    ap.add_argument("--icon-css", default=str(ROOT / "src" / "upstream" / "public-icon.css"))
    ap.add_argument("--logo", default="", help="optional remote logo URL (default: use local img/logo.png)")
    ap.add_argument("--out", default=str(OUT), help="output directory")
    ap.add_argument("--overrides", default=str(CUSTOM), help="your override css")
    args = ap.parse_args()

    base = Path(args.upstream).resolve()
    OUT = Path(args.out).resolve()
    CUSTOM = Path(args.overrides).resolve()

    # 输出目录会被整个删除：一旦指到仓库根，就会毁掉 src/、patch/、README 和登录壁纸
    if OUT == ROOT or (OUT / ".git").exists() or (OUT / "src").is_dir() or (OUT / "patch").is_dir():
        sys.exit(f"refusing to build into {OUT}: it looks like the repository root (output dir is deleted first)")
    # 上游文件已随仓库 vendored 在 --upstream 下，构建不再联网
    def remote(path: str) -> str:
        f = base / path
        if not f.exists():
            sys.exit(f"missing vendored upstream file: {f}")
        return local(f)

    theme = remote("theme.css")
    quicksand = remote("fonts/quicksand.css")
    symbols = remote("fonts/materialSymbolsRounded.css")
    loginpage = remote("loginpage.css")
    jellyblue = remote("colors/jellyblue.css")
    # palettes ship with this repo (src/colors), so building works offline
    local_palette = ROOT / "src" / "colors" / f"{args.palette}.css"
    palette = local(local_palette) if local_palette.exists() else remote(f"colors/{args.palette}.css")
    card_buttons = remote("card_buttons.css")
    icons = ""
    if args.icon_css:
        icon_path = Path(args.icon_css)
        icons = local(icon_path) if icon_path.exists() else fetch(args.icon_css)

    # theme.css: drop its @import block, it is inlined here instead
    theme_body = re.sub(r"^@import[^\n]*\n", "", theme, flags=re.M)

    # relative asset paths inside the inlined sheets point at fonts/ and img/
    quicksand = quicksand.replace("url(Quicksand-", "url(fonts/Quicksand-")
    symbols = symbols.replace("url(MaterialSymbolsRounded.woff2)", "url(fonts/MaterialSymbolsRounded.woff2)")

    # palette background image -> local copy
    def localise_images(text: str) -> str:
        text = re.sub(
            r"https://cdn\.jsdelivr\.net/gh/n00bcodr/[Jj]ellyfish[^\"')]*colors/images/([\w.-]+)",
            r"img/\1",
            text,
        )
        # 上游调色板还带一个自带的 logo，站点用自己的那张
        return text.replace(
            "https://cdn.jsdelivr.net/gh/n00bcodr/jellyfish/logos/jellyfish.png", "img/logo.png"
        ).replace(
            "https://cdn.jsdelivr.net/gh/n00bcodr/Jellyfish/logos/jellyfish.png", "img/logo.png"
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
    logo_ok = (ROOT / "img" / "logo.png").exists()
    logo_bytes = b""
    if not logo_ok and args.logo:
        try:
            logo_bytes = fetch_bytes(args.logo)
            logo_ok = len(logo_bytes) > 100
        except Exception as e:
            print(f"  ! logo download failed ({e}), keep the theme default")

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
        "   theme: n00bcodr/Jellyfish@7dc9422 (+ Druidblack icons@b3f5b73), vendored under src/upstream\n"
        "   built by tools/build_bundle.py - do not edit by hand,\n"
        "   edit custom/jellyfish-refined.css and rebuild.\n"
        "   ============================================================ */\n\n"
    )
    css = banner + "".join(f"\n/* ==== {name} ==== */\n{body.strip()}\n" for name, body in parts)

    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "fonts").mkdir(parents=True)
    (OUT / "img").mkdir(parents=True)

    # 本地资产：字体、背景图、图标都随仓库走，构建过程不联网
    for f in ("MaterialSymbolsRounded.woff2", "Quicksand-latin.woff2",
              "Quicksand-latin-ext.woff2", "Quicksand-vietnamese.woff2"):
        src = ROOT / "fonts" / f
        if not src.exists():
            sys.exit(f"missing vendored font: {src}")
        shutil.copy2(src, OUT / "fonts" / f)

    for name in ("jellyblue.jpg", "jellypurple.jpg", "login-bg.jpg", "logo.png"):
        src = ROOT / "img" / name
        if src.exists():
            shutil.copy2(src, OUT / "img" / name)

    if (ROOT / "img" / "icons").is_dir():
        shutil.copytree(ROOT / "img" / "icons", OUT / "img" / "icons")

    if logo_bytes:
        (OUT / "img" / "logo.png").write_bytes(logo_bytes)

    (OUT / "jellyfin.css").write_text(css, encoding="utf8")

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
                        # 图片的文件名是固定的：给 immutable 一年会让换图（登录壁纸）一年不生效
                        "source": "/img/*",
                        "headers": [
                            {"key": "Access-Control-Allow-Origin", "value": "*"},
                            {"key": "Cache-Control", "value": "public, max-age=3600"},
                        ],
                    },
                    {
                        "source": "/jellyfin.css",
                        "headers": [
                            {"key": "Access-Control-Allow-Origin", "value": "*"},
                            {"key": "Cache-Control", "value": "public, max-age=300"},
                        ],
                    },
                    # 网页端补丁：按文件精确匹配（用 /patch/* 会把 404 也标成 JS）
                    *[
                        {
                            "source": f"/patch/{name}",
                            "headers": [
                                {"key": "Access-Control-Allow-Origin", "value": "*"},
                                {"key": "Cache-Control", "value": "no-cache"},
                                # 直接打开 .js 时浏览器按响应字符集解码，缺 charset 会被当成本地编码显示成乱码
                                {"key": "Content-Type", "value": "application/javascript; charset=utf-8"},
                                {"key": "X-Content-Type-Options", "value": "nosniff"},
                            ],
                        }
                        for name in ("boot.js", "home-poster.js", "item-links.js", "danmaku.js")
                    ],
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
