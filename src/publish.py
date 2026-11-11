#!/usr/bin/env python3
"""Build, validate, commit and push Anime Modern in one step.

Usage:
    python3 src/publish.py
    python3 src/publish.py --type fix --summary "improve card contrast"

The patch version is incremented automatically. Never rewrites Git history.
"""
import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def run(*args: str, capture: bool = False) -> str:
    result = subprocess.run(
        args,
        cwd=ROOT,
        check=True,
        text=True,
        stdout=subprocess.PIPE if capture else None,
    )
    return result.stdout.strip() if capture else ""


def validate() -> None:
    css_files = [ROOT / "jellyfish.css", *sorted((ROOT / "colors").glob("anime-*.css"))]
    if len(css_files) != 5:
        raise RuntimeError("Expected jellyfish.css and exactly four anime palettes")

    for path in css_files:
        text = path.read_text(encoding="utf8")
        if text.count("{") != text.count("}"):
            raise RuntimeError(f"Unbalanced CSS braces: {path}")
        if re.search(r'@import\s+url\(["\']?https?://', text):
            raise RuntimeError(f"Remote runtime import is not allowed: {path}")
        for url in re.findall(r'url\(["\']?([^"\')]+)', text):
            if url.startswith(("data:", "http:", "https:", "var(")):
                continue
            if not (path.parent / url).resolve().is_file():
                raise RuntimeError(f"Missing asset in {path.name}: {url}")

    bundle = (ROOT / "jellyfish.css").read_text(encoding="utf8")
    if "Anime Modern enhancements" not in bundle:
        raise RuntimeError("Anime enhancement layer is missing from the bundle")
    print("Validated bundle, four palettes and all local assets")


def next_version() -> str:
    subject = run("git", "log", "-1", "--format=%s", capture=True)
    match = re.search(r"\bv(\d+)\.(\d+)\.(\d+)\b", subject)
    if not match:
        return "1.1.1"
    major, minor, patch = map(int, match.groups())
    return f"{major}.{minor}.{patch + 1}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--type", choices=("feat", "fix", "refactor", "docs", "test", "ci", "style"), default="feat")
    parser.add_argument("--summary", default="update anime theme")
    args = parser.parse_args()

    run(sys.executable, "src/build_bundle.py")
    validate()
    run("git", "add", "-A")
    if subprocess.run(("git", "diff", "--cached", "--quiet"), cwd=ROOT).returncode == 0:
        print("No changes to publish")
        return

    version = next_version()
    title = f"{args.type}: v{version} — {args.summary}"
    run("git", "commit", "-m", title)
    remotes = run("git", "remote", capture=True).splitlines()
    remote = "selfhosted" if "selfhosted" in remotes else "origin"
    run("git", "push", remote, "HEAD:main")
    print(f"Published {title} to {remote}/main; EdgeOne will deploy automatically")


if __name__ == "__main__":
    main()
