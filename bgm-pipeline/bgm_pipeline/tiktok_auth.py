"""Auth for the TikTok Content Posting API (OAuth v2, authorization-code flow).

TikTok has no device-flow equivalent for headless apps (unlike YouTube), and
its redirect_uri must be a static HTTPS URL — a local http://localhost
redirect (as note_publish or a CLI tool might use) isn't accepted. Instead
this points redirect_uri at a small published page
(docs/site/tiktok-callback.html) that only reads the `code`/`state` query
params TikTok appends and displays them for copy-paste. No password or
session cookie is ever handled here.

One-time setup (see bgm-pipeline/README.md for the full walkthrough):
  1. Create an app at developers.tiktok.com, add the Login Kit and Content
     Posting API products, and register the callback URL above as the
     redirect URI.
  2. Save {"client_key": "...", "client_secret": "..."} to
     bgm-pipeline/credentials/tiktok_app.json.
  3. Run `python -m bgm_pipeline.tiktok_auth login`, open the printed URL,
     approve access, then paste the `code` shown on the callback page back
     into the prompt.

Until the app passes TikTok's audit, posts are restricted to private/
self-only visibility (same limitation Instagram's App Review imposes) —
tracked in docs/marketing, not a bug in this module.
"""
from __future__ import annotations

import argparse
import json
import secrets
import sys
import time
from pathlib import Path

import requests

CREDENTIALS_DIR = Path(__file__).resolve().parent.parent / "credentials"
APP_CONFIG_PATH = CREDENTIALS_DIR / "tiktok_app.json"  # {"client_key": "...", "client_secret": "..."}
TOKEN_PATH = CREDENTIALS_DIR / "tiktok_token.json"

AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/"
TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"
REDIRECT_URI = "https://claude.ai/code/artifact/80d423ca-3bbb-4228-a3c9-be6be5a55f66"
SCOPE = "user.info.basic,video.publish"
REFRESH_IF_EXPIRES_WITHIN_SECONDS = 3600  # access tokens last 24h; refresh with headroom


def _load_app_config() -> dict:
    if not APP_CONFIG_PATH.exists():
        raise SystemExit(
            f"Missing {APP_CONFIG_PATH}. Create a TikTok Developer app and save its "
            '{"client_key": "...", "client_secret": "..."} there. See bgm-pipeline/README.md.'
        )
    return json.loads(APP_CONFIG_PATH.read_text())


def start_login() -> str:
    app = _load_app_config()
    state = secrets.token_urlsafe(16)
    CREDENTIALS_DIR.mkdir(exist_ok=True)
    (CREDENTIALS_DIR / ".tiktok_login_state").write_text(state)

    params = {
        "client_key": app["client_key"],
        "scope": SCOPE,
        "response_type": "code",
        "redirect_uri": REDIRECT_URI,
        "state": state,
    }
    query = "&".join(f"{k}={requests.utils.quote(v)}" for k, v in params.items())
    return f"{AUTHORIZE_URL}?{query}"


def exchange_code(code: str, state: str) -> None:
    state_path = CREDENTIALS_DIR / ".tiktok_login_state"
    expected_state = state_path.read_text().strip() if state_path.exists() else None
    if expected_state and state != expected_state:
        raise SystemExit(
            "State mismatch — this code may not be from the login attempt just started. "
            "Run `tiktok_auth.py login` again and use the code from that attempt."
        )

    app = _load_app_config()
    resp = requests.post(
        TOKEN_URL,
        data={
            "client_key": app["client_key"],
            "client_secret": app["client_secret"],
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": REDIRECT_URI,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache"},
        timeout=30,
    )
    resp.raise_for_status()
    payload = resp.json()
    if "access_token" not in payload:
        raise SystemExit(f"TikTok did not return an access token: {payload}")

    _save_token(payload)
    if state_path.exists():
        state_path.unlink()
    print(f"Saved TikTok token. open_id: {payload.get('open_id')}")


def _save_token(payload: dict) -> None:
    CREDENTIALS_DIR.mkdir(exist_ok=True)
    data = {
        "access_token": payload["access_token"],
        "refresh_token": payload["refresh_token"],
        "open_id": payload.get("open_id"),
        "scope": payload.get("scope"),
        "obtained_at": time.time(),
        "expires_at": time.time() + payload.get("expires_in", 86400),
    }
    TOKEN_PATH.write_text(json.dumps(data, indent=2))
    TOKEN_PATH.chmod(0o600)


def get_access_token() -> str:
    if not TOKEN_PATH.exists():
        raise SystemExit(
            "Not authorized yet. Run:\n  python -m bgm_pipeline.tiktok_auth login"
        )
    data = json.loads(TOKEN_PATH.read_text())

    if data["expires_at"] - time.time() < REFRESH_IF_EXPIRES_WITHIN_SECONDS:
        app = _load_app_config()
        resp = requests.post(
            TOKEN_URL,
            data={
                "client_key": app["client_key"],
                "client_secret": app["client_secret"],
                "grant_type": "refresh_token",
                "refresh_token": data["refresh_token"],
            },
            headers={"Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache"},
            timeout=30,
        )
        resp.raise_for_status()
        payload = resp.json()
        if "access_token" not in payload:
            raise SystemExit(
                f"TikTok refresh failed: {payload}. The refresh token (~365 days) may have "
                "expired — run `tiktok_auth.py login` again."
            )
        _save_token(payload)
        data = json.loads(TOKEN_PATH.read_text())

    return data["access_token"]


def get_open_id() -> str:
    return json.loads(TOKEN_PATH.read_text())["open_id"]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="TikTok OAuth v2 login for the Content Posting API.")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("login")
    exch = sub.add_parser("exchange", help="second step: paste the code/state from the callback page")
    exch.add_argument("--code", required=True)
    exch.add_argument("--state", required=True)
    args = parser.parse_args(argv)

    if args.command == "login":
        url = start_login()
        print("Open this URL, log in, and approve access:\n")
        print(url)
        print(
            "\nAfter approving, TikTok redirects to the callback page — copy the `code` "
            "and `state` shown there, then run:\n"
            "  python -m bgm_pipeline.tiktok_auth exchange --code <code> --state <state>"
        )
    elif args.command == "exchange":
        exchange_code(args.code, args.state)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
