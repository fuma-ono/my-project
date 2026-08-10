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

2026-08-10: pulled the module-level functions' bodies into a `YouTubeAuth`
class so a second YouTube channel (moyasuka, a separate channel/account
from this one — see moyasuka/youtube_auth.py) can reuse this exact device-
flow implementation against its own credentials_dir/token, without the two
channels' tokens overwriting each other. The module-level `login()` /
`get_access_token()` below are unchanged in behavior — they're just now
thin calls onto a default instance pointed at this package's own
credentials/, so every existing call site (`youtube_auth.get_access_token()`
etc., across this package) keeps working exactly as before.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import requests

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


class YouTubeAuth:
    """Device-flow OAuth against one credentials_dir (one client_secret.json
    + one persisted token.json). Each authorized YouTube channel needs its
    own instance — the token is tied to whichever Google account/channel
    approved that particular device-code prompt."""

    def __init__(self, credentials_dir: Path, client_secret_path: Path | None = None):
        self.credentials_dir = credentials_dir
        # client_secret_path defaults to living alongside the token, but can
        # point elsewhere — moyasuka reuses bgm-pipeline's client_secret.json
        # (same GCP OAuth client) rather than making the owner set up a
        # second one just to authorize a second channel.
        self.client_secret_path = client_secret_path or (credentials_dir / "client_secret.json")
        self.token_path = credentials_dir / "youtube_token.json"

    def _load_client_secret(self) -> dict:
        if not self.client_secret_path.exists():
            raise SystemExit(
                f"Missing {self.client_secret_path}. Create an OAuth client (type: TVs and "
                "Limited Input devices) in Google Cloud Console and save its JSON there. "
                "See bgm-pipeline/README.md."
            )
        data = json.loads(self.client_secret_path.read_text())
        return data.get("installed") or data.get("web") or data

    def login(self) -> None:
        """Run the device flow once and persist a refresh token."""
        client = self._load_client_secret()
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
                self.credentials_dir.mkdir(exist_ok=True)
                self.token_path.write_text(json.dumps(payload, indent=2))
                self.token_path.chmod(0o600)
                print(f"Authorized. Token saved to {self.token_path}")
                return
            error = payload.get("error")
            if error == "authorization_pending":
                continue
            if error == "slow_down":
                interval += 5
                continue
            raise SystemExit(f"Device flow failed: {payload}")

        raise SystemExit("Device code expired before approval. Run login again.")

    def get_access_token(self) -> str:
        """Return a valid access token, refreshing via the stored refresh token if needed."""
        if not self.token_path.exists():
            raise SystemExit(f"Not authorized yet for {self.credentials_dir}. Run this module's login().")
        token = json.loads(self.token_path.read_text())
        client = self._load_client_secret()

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


CREDENTIALS_DIR = Path(__file__).resolve().parent.parent / "credentials"
CLIENT_SECRET_PATH = CREDENTIALS_DIR / "client_secret.json"
TOKEN_PATH = CREDENTIALS_DIR / "youtube_token.json"

_default = YouTubeAuth(CREDENTIALS_DIR)


def login() -> None:
    _default.login()


def get_access_token() -> str:
    return _default.get_access_token()


if __name__ == "__main__":
    login()
