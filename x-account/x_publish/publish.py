"""Posts a thread from x-account/drafts/*.md using the session saved by x_auth.py.

Requires a one-time login (see x_auth.py's docstring) run on your own
machine — this cannot run in a Claude Code cloud session (no display,
and x.com is unreachable from that container's network policy).

Usage:
    python publish.py --file 001-launch-thread.md            # dry run: prints each post's text
    python publish.py --file 001-launch-thread.md --publish  # actually posts the thread
    python publish.py --file 001-launch-thread.md --publish --debug  # visible browser

Draft format: each post in the thread is a "**N/**" marker on its own
line, followed by the post text (see drafts/001-launch-thread.md).
Anything before the first marker (title/notes) is ignored.

IMPORTANT — selectors below are best-effort, based on X's commonly
documented data-testid attributes (tweetTextarea_0, tweetButtonInline,
etc.) as of 2026-08, and were NOT verified against a live session: this
environment cannot reach x.com to test against the real DOM (see
docs/security/checklist.md). Expect the first real run to need
debugging. Run with --debug, watch where it stalls, and fix the
selectors below to match what you see.
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

from playwright.sync_api import sync_playwright

from x_auth import get_storage_state_path

HERE = Path(__file__).resolve().parent
DRAFTS_DIR = HERE.parent / "drafts"

COMPOSE_URL = "https://x.com/compose/post"
MARKER_RE = re.compile(r"^\*\*(\d+)/\*\*\s*$", re.MULTILINE)


def _parse_thread(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    matches = list(MARKER_RE.finditer(text))
    if not matches:
        raise SystemExit(f"{path}: no '**N/**' post markers found")
    posts = []
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        if body:
            posts.append(body)
    return posts


def post_thread(posts: list[str], publish: bool, debug: bool) -> str | None:
    print(f"Thread has {len(posts)} posts:\n")
    for i, p in enumerate(posts, 1):
        print(f"--- {i}/{len(posts)} ---\n{p}\n")

    if not publish:
        print("Dry run only (pass --publish to actually post). Nothing was sent to X.")
        return None

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not debug)
        context = browser.new_context(storage_state=get_storage_state_path())
        page = context.new_page()
        page.goto(COMPOSE_URL)

        for i, post_text in enumerate(posts):
            textarea = page.locator(f'[data-testid="tweetTextarea_{i}"]')
            textarea.click()
            textarea.type(post_text, delay=8)
            if i < len(posts) - 1:
                page.locator('[data-testid="addButton"]').click()
                page.wait_for_timeout(400)

        page.locator('[data-testid="tweetButtonInline"]').click()
        page.wait_for_timeout(3000)

        # best-effort: X redirects to the profile/status URL after a successful post
        url = page.url

        if debug:
            input("Debug mode: browser stays open, press Enter to close...")
        browser.close()
        return url


def main() -> int:
    parser = argparse.ArgumentParser(description="Post a thread to X from a drafts/*.md file.")
    parser.add_argument("--file", required=True, help="draft filename in x-account/drafts/")
    parser.add_argument("--publish", action="store_true", help="actually post (default: dry run, prints only)")
    parser.add_argument("--debug", action="store_true", help="visible browser, pause before closing")
    args = parser.parse_args()

    path = DRAFTS_DIR / args.file
    if not path.exists():
        raise SystemExit(f"No such draft: {path}")

    posts = _parse_thread(path)
    url = post_thread(posts, publish=args.publish, debug=args.debug)
    if url:
        print(f"Posted. Landed on: {url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
