"""Service-account auth for Google Cloud Text-to-Speech, used only by
gcp_tts_narrate.py.

2026-08-14, second revision: this file originally tried OAuth *device
flow* (the same mechanism youtube_auth.py uses to authorize @moyasuka's
channel), first combined with the YouTube scope, then split into its own
separate device-flow login after the combined request failed. Neither
works — confirmed live, `cloud-platform` is rejected by Google's
device-flow endpoint even requested entirely on its own:

    POST https://oauth2.googleapis.com/device/code {"scope": "https://www.googleapis.com/auth/cloud-platform"}
    -> 400 {"error": "invalid_scope",
            "error_description": "Invalid device flow scope: https://www.googleapis.com/auth/cloud-platform"}

So splitting the scopes was solving the wrong problem — the restriction
is on `cloud-platform` itself in this grant type, not on combining it with
other scopes.

The actual fix: Cloud TTS doesn't need "on behalf of a specific signed-in
user" semantics the way a YouTube upload does (upload to *this* channel,
approved by *that* account) — it only needs project-level API access.
That's exactly what a **service account** is for. Service-account auth
(JWT-bearer grant, handled by the `google-auth` library below) is a
completely different OAuth grant type from the device flow, so it isn't
subject to this restriction at all — and it needs no interactive
login/approval, ever, which is a better fit for a fully unattended
pipeline than a device code anyway.

One-time setup (needs the Cloud Text-to-Speech API enabled on the same
GCP project bgm_pipeline already uses — see docs/projects/moyasuka/
gcp-tts-setup.md for the full walkthrough):
  1. Google Cloud Console -> IAM & Admin -> Service Accounts -> Create.
  2. Grant it a role that can call Cloud TTS (the "Cloud Text-to-Speech
     User" predefined role covers it; "Editor" also works if that role
     isn't offered on the project).
  3. That service account's Keys tab -> Add key -> Create new key -> JSON.
     Save the downloaded file as
     moyasuka/credentials/gcp_tts_service_account.json (gitignored, same
     as every other credential in this project).
  4. `python3 -m pip install -r moyasuka/requirements.txt` (installs
     google-auth) if not already done in this environment.

gcp_tts_narrate.py calls get_access_token() below — no `login()` step
exists here because there's nothing to log into.
"""
from __future__ import annotations

import sys
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2 import service_account

CREDENTIALS_DIR = Path(__file__).resolve().parent / "credentials"
SERVICE_ACCOUNT_PATH = CREDENTIALS_DIR / "gcp_tts_service_account.json"
SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]

_credentials: service_account.Credentials | None = None


def _load_credentials() -> service_account.Credentials:
    global _credentials
    if _credentials is None:
        if not SERVICE_ACCOUNT_PATH.exists():
            raise SystemExit(
                f"Missing {SERVICE_ACCOUNT_PATH}. Create a Service Account in Google Cloud "
                "Console (same project as Cloud Text-to-Speech), download its JSON key, and "
                "save it there. See docs/projects/moyasuka/gcp-tts-setup.md."
            )
        _credentials = service_account.Credentials.from_service_account_file(
            str(SERVICE_ACCOUNT_PATH), scopes=SCOPES
        )
    return _credentials


def get_access_token() -> str:
    creds = _load_credentials()
    if not creds.valid:
        creds.refresh(Request())
    return creds.token


def main(argv: list[str] | None = None) -> int:
    """Sanity check: loads the key and fetches a real token, so setup
    problems (missing file, wrong project, API not enabled) surface here
    instead of mid-narration."""
    creds = _load_credentials()
    creds.refresh(Request())
    print(f"OK — token acquired for service account: {creds.service_account_email}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
