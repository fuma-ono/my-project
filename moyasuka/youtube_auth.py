"""OAuth login for the モヤスカ YouTube channel (@moyasuka) — a separate
channel/Google account from bgm_pipeline's, so it needs its own token even
though it reuses bgm_pipeline's device-flow implementation (and, to avoid
making the owner set up a second GCP OAuth client just for a second
channel, its client_secret.json too — a single "TVs and Limited Input
devices" OAuth client can issue tokens to any Google account that
approves its own device-code prompt; only the resulting token is
channel-specific).

2026-08-11 (14日ルール, docs/ai-company-os/2026-08-11-operating-principles-v2.md):
this token's scope now also covers Cloud Text-to-Speech (`cloud-platform`),
not just YouTube upload — one login covers both the channel and the
narration synthesis API `gcp_tts_narrate.py` calls, so the owner doesn't
need a second OAuth dance just to unblock narration. Requires the Cloud
Text-to-Speech API to be enabled on the same GCP project as the existing
OAuth client (one-time, in Google Cloud Console) — see
docs/projects/moyasuka/gcp-tts-setup.md.

One-time setup (same device-flow UX as bgm_pipeline's youtube_auth.py —
open a URL, enter a code, approve while signed into whichever Google
account manages @moyasuka):

    python3 -m moyasuka.youtube_auth login

After that, moyasuka.publish and moyasuka.gcp_tts_narrate both use
get_access_token() below — completely independent of
bgm-pipeline/credentials/youtube_token.json, so authorizing this channel
never touches the other one's token.
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
# cloud-platform is the standard broad scope Cloud Text-to-Speech's REST API
# expects from user OAuth (it has no narrower dedicated scope). Appended to
# bgm_pipeline's existing youtube+devstorage scope rather than replacing it,
# since publish.py still needs those for upload.
SCOPE = f"{_BGM_SCOPE} https://www.googleapis.com/auth/cloud-platform"

auth = YouTubeAuth(CREDENTIALS_DIR, client_secret_path=_BGM_CLIENT_SECRET, scope=SCOPE)


def login() -> None:
    auth.login()


def get_access_token() -> str:
    return auth.get_access_token()


if __name__ == "__main__":
    login()
