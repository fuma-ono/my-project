"""OAuth for Google APIs (YouTube Data API + Cloud Storage) using the
Device Authorization flow.

This flow exists specifically for apps with no local browser to redirect
back to (exactly this situation: an agent running in a headless
environment). The user visits a URL on their own device and enters a code
shown here — no password is ever seen or stored by this app, only a
long-lived OAuth token. The same token also covers Cloud Storage
(used by gcs_temp_host.py to give Instagram's API a public URL to fetch
video from — Instagram's Content Publishing API pulls from a URL rather
than accepting a direct file upload).

One-time setup required in Google Cloud Console (see bgm-pipeline/README.md):
create an OAuth client of type "TVs and Limited Input devices", download
its client_secret.json into bgm-pipeline/credentials/.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import requests

CREDENTIALS_DIR = Path(__file__).resolve().parent.parent / "credentials"
CLIENT_SECRET_PATH = CREDENTIALS_DIR / "client_secret.json"
TOKEN_PATH = CREDENTIALS_DIR / "youtube_token.json"

DEVICE_CODE_URL = "https://oauth2.googleapis.com/device/code"
TOKEN_URL = "https://oauth2.googleapis.com/token"
# yt-analytics.readonly is NOT usable here: confirmed live against Google's
# device/code endpoint (2026-08), it rejects that scope outright for the
# "TVs and Limited Input devices" flow ({"error": "invalid_scope"}) even
# though youtube.upload and devstorage.read_write both work fine. Getting
# analytics access needs a normal authorization-code flow with a local
# redirect instead, which (like note_publish/) would have to run on the
# owner's own machine — not implemented yet, see youtube_analytics.py.
# "youtube" (full manage scope, confirmed device-flow compatible) replaces
# the narrower youtube.upload + youtube.readonly combo: videos.update
# (fixing a title/description after the fact) needs it and upload/read
# both still work under it too, so one scope covers everything this
# project does short of Analytics.
SCOPE = (
    "https://www.googleapis.com/auth/youtube "
    "https://www.googleapis.com/auth/devstorage.read_write"
)


def _load_client_secret() -> dict:
    if not CLIENT_SECRET_PATH.exists():
        raise SystemExit(
            f"Missing {CLIENT_SECRET_PATH}. Create an OAuth client (type: TVs and "
            "Limited Input devices) in Google Cloud Console and save its JSON there. "
            "See bgm-pipeline/README.md."
        )
    data = json.loads(CLIENT_SECRET_PATH.read_text())
    return data.get("installed") or data.get("web") or data


def login() -> None:
    """Run the device flow once and persist a refresh token."""
    client = _load_client_secret()
    client_id = client["client_id"]
    client_secret = client["client_secret"]

    resp = requests.post(
        DEVICE_CODE_URL,
        data={"client_id": client_id, "scope": SCOPE},
        timeout=30,
    )
    resp.raise_for_status()
    device = resp.json()

    print(f"\n1. Open: {device['verification_url']}")
    print(f"2. Enter this code: {device['user_code']}\n")
    print("Waiting for approval...")

    interval = device.get("interval", 5)
    expires_at = time.time() + device.get("expires_in", 1800)

    while time.time() < expires_at:
        time.sleep(interval)
        token_resp = requests.post(
            TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "device_code": device["device_code"],
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            },
            timeout=30,
        )
        payload = token_resp.json()
        if token_resp.status_code == 200:
            CREDENTIALS_DIR.mkdir(exist_ok=True)
            TOKEN_PATH.write_text(json.dumps(payload, indent=2))
            TOKEN_PATH.chmod(0o600)
            print(f"Authorized. Token saved to {TOKEN_PATH}")
            return
        error = payload.get("error")
        if error == "authorization_pending":
            continue
        if error == "slow_down":
            interval += 5
            continue
        raise SystemExit(f"Device flow failed: {payload}")

    raise SystemExit("Device code expired before approval. Run login again.")


def get_access_token() -> str:
    """Return a valid access token, refreshing via the stored refresh token if needed."""
    if not TOKEN_PATH.exists():
        raise SystemExit("Not authorized yet. Run: python -m bgm_pipeline.youtube_auth login")
    token = json.loads(TOKEN_PATH.read_text())
    client = _load_client_secret()

    resp = requests.post(
        TOKEN_URL,
        data={
            "client_id": client["client_id"],
            "client_secret": client["client_secret"],
            "refresh_token": token["refresh_token"],
            "grant_type": "refresh_token",
        },
        timeout=30,
    )
    resp.raise_for_status()
    fresh = resp.json()
    return fresh["access_token"]


if __name__ == "__main__":
    login()
