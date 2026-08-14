"""OAuth login for the モヤスカ YouTube channel (@moyasuka) — a separate
channel/Google account from bgm_pipeline's, so it needs its own token even
though it reuses bgm_pipeline's device-flow implementation (and, to avoid
making the owner set up a second GCP OAuth client just for a second
channel, its client_secret.json too — a single "TVs and Limited Input
devices" OAuth client can issue tokens to any Google account that
approves its own device-code prompt; only the resulting token is
channel-specific).

2026-08-14: reverted to YouTube-only scope. 2026-08-11 briefly combined
this with Cloud Text-to-Speech's `cloud-platform` scope in one login, but
that combined request is rejected outright by Google's device-flow
endpoint ({"error": "invalid_scope"}, confirmed live) — `cloud-platform`
isn't usable in the same device-code grant as `youtube`/`devstorage`, so
the "one login covers both" plan never actually worked. Cloud TTS now has
its own separate login — see gcp_tts_auth.py — while this module stays
scoped to exactly what moyasuka.publish needs (upload + the temp-hosting
bucket for other channels' publish flows).

One-time setup (same device-flow UX as bgm_pipeline's youtube_auth.py —
open a URL, enter a code, approve while signed into whichever Google
account manages @moyasuka):

    python3 -m moyasuka.youtube_auth login

After that, moyasuka.publish uses get_access_token() below —
completely independent of bgm-pipeline/credentials/youtube_token.json, so
authorizing this channel never touches the other one's token.
"""
from __future__ import annotations

import sys
from pathlib import Path

# bgm_pipeline lives in a sibling directory (bgm-pipeline/bgm_pipeline/),
# which isn't on sys.path when moyasuka scripts run as `python3 -m
# moyasuka.x` from the repo root — add it explicitly rather than
# duplicating youtube_auth.py's ~150 lines of device-flow OAuth a second
# time for a second channel.
_BGM_PIPELINE_ROOT = Path(__file__).resolve().parent.parent / "bgm-pipeline"
if str(_BGM_PIPELINE_ROOT) not in sys.path:
    sys.path.insert(0, str(_BGM_PIPELINE_ROOT))

from bgm_pipeline.youtube_auth import SCOPE as _BGM_SCOPE  # noqa: E402
from bgm_pipeline.youtube_auth import YouTubeAuth  # noqa: E402

CREDENTIALS_DIR = Path(__file__).resolve().parent / "credentials"
_BGM_CLIENT_SECRET = _BGM_PIPELINE_ROOT / "credentials" / "client_secret.json"
SCOPE = _BGM_SCOPE  # youtube + devstorage.read_write only — see gcp_tts_auth.py for Cloud TTS's separate token

auth = YouTubeAuth(CREDENTIALS_DIR, client_secret_path=_BGM_CLIENT_SECRET, scope=SCOPE)


def login() -> None:
    auth.login()


def get_access_token() -> str:
    return auth.get_access_token()


if __name__ == "__main__":
    login()
