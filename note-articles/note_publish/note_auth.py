"""One-time login for note.com posting automation.

note.com has no official API and no OAuth-style device flow for posting
(reconfirmed 2026-08 — still unreleased; see docs/security/checklist.md).
The only way to automate posting is to drive a real browser through
note's own login form and reuse the resulting session. That is a real
exception to this project's "never handle a password" rule used for
YouTube (device flow) and Instagram (Graph API Explorer token): this
script opens a real browser window pointed at note.com's real login
page, and *you* type your password into *note's own page*, not into
this script. This code never sees or stores the password — only the
session cookies note.com issues after you log in.

Treat the resulting credentials/note_state.json exactly like a password:
gitignored, never share it, and if you ever suspect it leaked, log out
of all sessions from note.com's account settings (this invalidates the
file) and re-run login.

This MUST run on your own machine, not a Claude Code cloud session:
  1. A cloud session has no display to show you the browser window.
  2. This project's cloud sessions run in a network-restricted
     container that (confirmed by testing) cannot open a direct
     connection to note.com at all — only a fixed set of approved tool
     paths (WebFetch, WebSearch, git, package registries) are allowed
     through the proxy. Browser automation against arbitrary sites like
     note.com is blocked by policy, not by accident.

Setup (on your own machine):
    cd note-articles/note_publish
    python3 -m venv .venv
    .venv/bin/pip install -r requirements.txt
    .venv/bin/playwright install chromium
    .venv/bin/python note_auth.py login

A browser window opens to note.com's login page. Log in normally. Once
you see your note.com home feed, go back to the terminal and press
Enter — the session is saved and reused by publish.py from then on.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from playwright.sync_api import sync_playwright

CREDENTIALS_DIR = Path(__file__).resolve().parent / "credentials"
STATE_PATH = CREDENTIALS_DIR / "note_state.json"

LOGIN_URL = "https://note.com/login"


def login() -> None:
    CREDENTIALS_DIR.mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        page.goto(LOGIN_URL)
        print("\nA browser window has opened to note.com's login page.")
        print("Log in normally (this script never sees your password).")
        input("Once you see your note.com home feed, press Enter here...")
        context.storage_state(path=str(STATE_PATH))
        STATE_PATH.chmod(0o600)
        print(f"Session saved to {STATE_PATH}")
        browser.close()


def get_storage_state_path() -> str:
    if not STATE_PATH.exists():
        raise SystemExit(
            f"Not logged in yet. Run: python note_auth.py login\n"
            "(must run on your own machine with a screen — see this file's docstring)"
        )
    return str(STATE_PATH)


def main() -> int:
    parser = argparse.ArgumentParser(description="One-time note.com login for posting automation.")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("login")
    args = parser.parse_args()
    if args.command == "login":
        login()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
