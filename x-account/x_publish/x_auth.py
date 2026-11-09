"""One-time login for X (twitter.com) posting automation.

As of 2026-02, X removed its free API tier entirely — write access now
costs per post ($0.015/post, +$0.20 if it contains a URL), which nearly
every post from this account will, since the whole point is linking out
to YouTube/note/the app (docs/marketing/2026-08-04-x-strategy.md). That
recurring per-post cost doesn't fit the "start free, add spend only once
there's traction" budget call in that doc.

So this follows the same exception note.com already required: no
official free posting path exists, so a real browser drives x.com's own
login page and *you* type your password into *X's own page*, not into
this script. This code never sees or stores the password — only the
session cookies X issues after you log in.

Treat the resulting credentials/x_state.json exactly like a password:
gitignored, never share it, and if you ever suspect it leaked, log out
of all sessions from X's account settings (invalidates the file) and
re-run login.

This MUST run on your own machine, not a Claude Code cloud session —
confirmed by testing that this project's cloud sessions cannot open a
direct connection to x.com/twitter.com at all (blocked by the container's
network policy, same as note.com).

Setup (on your own machine):
    cd x-account/x_publish
    python3 -m venv .venv
    .venv/bin/pip install -r requirements.txt
    .venv/bin/playwright install chromium
    .venv/bin/python x_auth.py login

A browser window opens to X's login page. Log in normally as
@QuietHoursceo. Once you see your home timeline, go back to the
terminal and press Enter — the session is saved and reused by
publish.py from then on.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from playwright.sync_api import sync_playwright

CREDENTIALS_DIR = Path(__file__).resolve().parent / "credentials"
STATE_PATH = CREDENTIALS_DIR / "x_state.json"

LOGIN_URL = "https://x.com/login"


def login() -> None:
    CREDENTIALS_DIR.mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        page.goto(LOGIN_URL)
        print("\nA browser window has opened to X's login page.")
        print("Log in normally as @QuietHoursceo (this script never sees your password).")
        input("Once you see your home timeline, press Enter here...")
        context.storage_state(path=str(STATE_PATH))
        STATE_PATH.chmod(0o600)
        print(f"Session saved to {STATE_PATH}")
        browser.close()


def get_storage_state_path() -> str:
    if not STATE_PATH.exists():
        raise SystemExit(
            f"Not logged in yet. Run: python x_auth.py login\n"
            "(must run on your own machine with a screen — see this file's docstring)"
        )
    return str(STATE_PATH)


def main() -> int:
    parser = argparse.ArgumentParser(description="One-time X login for posting automation.")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("login")
    args = parser.parse_args()
    if args.command == "login":
        login()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
