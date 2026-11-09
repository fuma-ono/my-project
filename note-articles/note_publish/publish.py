"""Posts the next queued note.com draft using the session saved by note_auth.py.

Requires a one-time login (see note_auth.py's docstring) run on your own
machine — this cannot run in a Claude Code cloud session (no display,
and note.com is unreachable from that container's network policy).

Usage:
    python publish.py                   # types the draft into note's editor,
                                         # does NOT publish (note autosaves it
                                         # as a draft in your account — safe)
    python publish.py --publish         # actually publishes it live
    python publish.py --file 07-foo.md --publish
    python publish.py --debug           # visible browser, pauses before closing

Draft files live in ../drafts/*.md: first line "# Title", the rest is
the body, with blank lines as paragraph breaks (matches the existing
files written for the copy-paste queue page).

IMPORTANT — selectors below are best-effort, based on publicly documented
note.com editor behavior as of 2026-08, and were NOT verified against a
live login: this environment cannot reach note.com to test against the
real DOM (see docs/security/checklist.md). Expect the first real run to
need debugging. Run with --debug, watch where it stalls, and fix the
`get_by_placeholder`/`get_by_role` calls below to match what you see.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from playwright.sync_api import sync_playwright

from note_auth import get_storage_state_path

HERE = Path(__file__).resolve().parent
DRAFTS_DIR = HERE.parent / "drafts"
MANIFEST_PATH = HERE / "posted.json"

NEW_ARTICLE_URL = "https://note.com/notes/new"


def _load_manifest() -> dict:
    if MANIFEST_PATH.exists():
        return json.loads(MANIFEST_PATH.read_text())
    return {}


def _save_manifest(manifest: dict) -> None:
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False))


def _parse_draft(path: Path) -> tuple[str, list[str]]:
    text = path.read_text(encoding="utf-8").strip()
    lines = text.split("\n")
    if not lines[0].startswith("# "):
        raise SystemExit(f"{path}: expected first line to start with '# ' (title)")
    title = lines[0][2:].strip()
    body = "\n".join(lines[1:]).strip()
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
    return title, paragraphs


def _next_draft(manifest: dict, explicit: str | None) -> Path:
    if explicit:
        path = DRAFTS_DIR / explicit
        if not path.exists():
            raise SystemExit(f"No such draft: {path}")
        return path
    for path in sorted(DRAFTS_DIR.glob("*.md")):
        if path.name not in manifest:
            return path
    raise SystemExit("No unposted drafts left in note-articles/drafts/.")


def post_draft(path: Path, publish: bool, debug: bool) -> str:
    title, paragraphs = _parse_draft(path)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not debug)
        context = browser.new_context(storage_state=get_storage_state_path())
        page = context.new_page()
        page.goto(NEW_ARTICLE_URL)

        page.get_by_placeholder("記事タイトル").click()
        page.keyboard.type(title)

        page.get_by_placeholder(re.compile("本文")).click()
        for i, para in enumerate(paragraphs):
            if i > 0:
                page.keyboard.press("Enter")
                page.keyboard.press("Enter")
            page.keyboard.type(para)

        # note autosaves the article as a draft in your account as you type,
        # so the "safe" (non --publish) path just stops here.
        page.wait_for_timeout(2000)
        url = page.url

        if publish:
            page.get_by_role("button", name=re.compile("公開に進む")).click()
            page.get_by_role("button", name=re.compile("^投稿する$")).click()
            page.wait_for_url(re.compile(r"note\.com/[^/]+/n/"), timeout=30000)
            url = page.url

        if debug:
            input("Debug mode: browser stays open, press Enter to close...")
        browser.close()
        return url


def main() -> int:
    parser = argparse.ArgumentParser(description="Post the next queued note.com draft.")
    parser.add_argument("--file", help="specific draft filename in note-articles/drafts/")
    parser.add_argument("--publish", action="store_true", help="publish live (default: leave as autosaved draft)")
    parser.add_argument("--debug", action="store_true", help="visible browser, pause before closing")
    args = parser.parse_args()

    manifest = _load_manifest()
    draft_path = _next_draft(manifest, args.file)
    print(f"Posting {draft_path.name} ({'PUBLISH' if args.publish else 'draft only'})...")

    url = post_draft(draft_path, publish=args.publish, debug=args.debug)

    if args.publish:
        manifest[draft_path.name] = {"url": url}
        _save_manifest(manifest)
        print(f"Published: {url}")
    else:
        print(f"Typed into note's editor and autosaved as a draft: {url}")
        print("Review it on note.com, then run again with --publish to post it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
