"""Auth for the Instagram Graph API (Meta).

Meta's Graph API doesn't offer a device-flow equivalent for headless apps,
so unlike YouTube this needs one manual step in Meta's own official web
tool (Graph API Explorer) instead of a password: the user generates a
short-lived User Access Token there, with the required permissions, and
gives it to this app once. From that point on, this module exchanges it
for a long-lived token (~60 days) and keeps it refreshed automatically —
no password or session cookie is ever handled here.

See bgm-pipeline/README.md for the one-time setup (Meta Developer App,
Facebook Page link, Graph API Explorer token, App Review submission).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import requests

CREDENTIALS_DIR = Path(__file__).resolve().parent.parent / "credentials"
APP_CONFIG_PATH = CREDENTIALS_DIR / "meta_app.json"  # {"app_id": "...", "app_secret": "..."}
TOKEN_PATH = CREDENTIALS_DIR / "meta_token.json"

GRAPH_API = "https://graph.facebook.com/v21.0"
REFRESH_IF_OLDER_THAN_DAYS = 50  # long-lived tokens last ~60 days


def _load_app_config() -> dict:
    if not APP_CONFIG_PATH.exists():
        raise SystemExit(
            f"Missing {APP_CONFIG_PATH}. Create a Meta Developer App and save its "
            '{"app_id": "...", "app_secret": "..."} there. See bgm-pipeline/README.md.'
        )
    return json.loads(APP_CONFIG_PATH.read_text())


def import_short_lived_token(short_lived_token: str) -> None:
    """One-time: exchange a token from Graph API Explorer for a long-lived one."""
    app = _load_app_config()
    resp = requests.get(
        f"{GRAPH_API}/oauth/access_token",
        params={
            "grant_type": "fb_exchange_token",
            "client_id": app["app_id"],
            "client_secret": app["app_secret"],
            "fb_exchange_token": short_lived_token,
        },
        timeout=30,
    )
    resp.raise_for_status()
    payload = resp.json()

    ig_user_id = _lookup_ig_user_id(payload["access_token"])

    CREDENTIALS_DIR.mkdir(exist_ok=True)
    data = {
        "access_token": payload["access_token"],
        "obtained_at": time.time(),
        "ig_user_id": ig_user_id,
    }
    TOKEN_PATH.write_text(json.dumps(data, indent=2))
    TOKEN_PATH.chmod(0o600)
    print(f"Saved long-lived token. Instagram Business Account ID: {ig_user_id}")


def _lookup_ig_user_id(access_token: str) -> str:
    """Finds the Instagram Business Account linked to the user's Facebook Page(s)."""
    resp = requests.get(
        f"{GRAPH_API}/me/accounts",
        params={"access_token": access_token, "fields": "instagram_business_account,name"},
        timeout=30,
    )
    resp.raise_for_status()
    pages = resp.json().get("data", [])
    for page in pages:
        ig_account = page.get("instagram_business_account")
        if ig_account:
            return ig_account["id"]
    raise SystemExit(
        "No Instagram Business Account linked to any Facebook Page on this token. "
        "Link the Instagram account to a Page in Meta Business Suite first."
    )


def get_access_token() -> str:
    if not TOKEN_PATH.exists():
        raise SystemExit(
            "Not authorized yet. Get a short-lived token from Graph API Explorer, then run:\n"
            "  python -m bgm_pipeline.instagram_auth import --token <token>"
        )
    data = json.loads(TOKEN_PATH.read_text())
    age_days = (time.time() - data["obtained_at"]) / 86400

    if age_days > REFRESH_IF_OLDER_THAN_DAYS:
        app = _load_app_config()
        resp = requests.get(
            f"{GRAPH_API}/oauth/access_token",
            params={
                "grant_type": "fb_exchange_token",
                "client_id": app["app_id"],
                "client_secret": app["app_secret"],
                "fb_exchange_token": data["access_token"],
            },
            timeout=30,
        )
        resp.raise_for_status()
        data["access_token"] = resp.json()["access_token"]
        data["obtained_at"] = time.time()
        TOKEN_PATH.write_text(json.dumps(data, indent=2))

    return data["access_token"]


def get_ig_user_id() -> str:
    data = json.loads(TOKEN_PATH.read_text())
    return data["ig_user_id"]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Import a Meta short-lived token.")
    sub = parser.add_subparsers(dest="command", required=True)
    imp = sub.add_parser("import")
    imp.add_argument("--token", required=True)
    args = parser.parse_args(argv)

    if args.command == "import":
        import_short_lived_token(args.token)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
