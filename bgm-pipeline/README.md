# bgm-pipeline

AI-generated ambient/lo-fi BGM, rendered straight into upload-ready YouTube
(16:9) and TikTok/Reels/Shorts (9:16) videos. Everything (audio synthesis +
background visuals) is generated algorithmically with numpy/scipy and
ffmpeg — no paid APIs, sample packs, or stock footage, so per-video marginal
cost is effectively zero.

## Setup

```bash
sudo apt-get install -y ffmpeg   # if not already installed
cd bgm-pipeline
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Usage

Generate audio only:

```bash
.venv/bin/python -m bgm_pipeline.generate --preset sleep_deep_drone --minutes 60 --out output/sleep.wav
```

Generate audio + both video orientations + upload metadata in one step:

```bash
.venv/bin/python -m bgm_pipeline.produce --preset study_lofi_chill --minutes 60
```

Available presets (see `bgm_pipeline/presets.py`):

- `sleep_deep_drone` — low, slow-moving pad + brown noise, for deep sleep
- `sleep_rain_focus` — filtered rain texture + soft pad
- `study_lofi_chill` — lo-fi chords, vinyl texture, laid-back pulse
- `study_focus_binaural` — 10Hz alpha binaural beat + soft pad

For real YouTube uploads, run with `--minutes 60` to `--minutes 180` (long
listen-while-you-work/sleep videos perform best for watch-time-driven ad
revenue). Shorts/Reels should stay well under a minute — use `produce.py`'s
`_shorts.mp4` output and trim in the upload tool if needed, or lower
`--minutes` for a short-specific render.

## Adding a new preset

Add a function to `bgm_pipeline/presets.py` that returns a `core.StereoTrack`,
register it in `PRESETS`, and add a title/description/tags entry to
`PRESET_METADATA`. Reuse the primitives in `bgm_pipeline/core.py` (oscillators,
noise, filters, reverb) rather than writing new synthesis code inline.

## Automated YouTube publishing

`publish.py` generates a track, renders it, generates a custom thumbnail,
uploads it via the YouTube Data API with an SEO-oriented title/description/
tags/hashtags (see `presets.PRESET_METADATA` and `presets.build_description`),
waits for YouTube to confirm processing succeeded, sets the custom thumbnail,
then **deletes the local audio/video/thumbnail files** — nothing is kept on
disk after a video actually ships (not just uploads; see the "verify before
declaring success" note below).

```bash
.venv/bin/python -m bgm_pipeline.publish --preset sleep_rain_focus --minutes 60 --privacy public
```

Thumbnails matter more for click-through than tags or hashtags do
(`docs/marketing/2026-08-youtube-seo.md` has the research and rationale) —
`thumbnail.py` generates one per preset reusing the channel's brand palette
(`branding.py`) plus a duration badge, rather than relying on YouTube's
auto-picked video frame.

If `--preset` is omitted, the next preset in the rotation is picked
automatically (`rotation.py`, state in `rotation_state.json`) instead of
posting the same preset repeatedly.

## Automated YouTube Shorts publishing

`publish_shorts.py` is the same idea for a short (default 45s) vertical
clip, uploaded as a YouTube Short with a link back to a matching
long-form video in the description — the actual point of doing Shorts
for this channel: get discovered short, pull viewers into the long-form
video that earns real watch time.

```bash
.venv/bin/python -m bgm_pipeline.publish_shorts --seconds 45 --link-video-id <long-form video ID>
```

See `docs/marketing/2026-08-content-calendar.md` for the posting cadence
this and `publish.py` are meant to follow.

### Required: verify the channel's phone number first

YouTube caps unverified channels at **15-minute videos**. Since this
project's whole point is long-form content (sleep/study BGM, often
30-120+ minutes), skipping this means every real upload gets rejected
during processing ("Processing aborted — video is too long") — this
happened on the first real publish attempt (2026-08-03) before anyone
noticed, because `publish.py` at the time declared success right after
the upload API call instead of waiting to confirm processing succeeded
(fixed now, see `wait_for_processing()` in `youtube_upload.py`).

Go to [youtube.com/verify](https://www.youtube.com/verify) (or YouTube
Studio → Settings → Channel → Feature eligibility) and verify with a
real mobile number — takes ~2 minutes and raises the limit to 12
hours / 256GB. Note: a phone number can reportedly only verify ~2
channels per year, and virtual/VoIP numbers are often rejected.

### One-time OAuth setup (needs a human, ~5 minutes, free)

This uses the [Device Authorization flow](https://developers.google.com/identity/protocols/oauth2/limited-input-device),
so no password is ever typed into this app — you approve access on your own
device via a short code.

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and sign in
   with the channel's Google account. Create a new project (any name, e.g. "Focus Sleep Sounds").
2. In the project, go to **APIs & Services → Library**, search for **YouTube Data API v3**, and enable it.
3. Go to **APIs & Services → OAuth consent screen**. Choose **External**, fill in
   the required fields (app name, your email), and add your own Google account
   as a **test user** (this keeps it in "Testing" mode, which is fine — no Google review needed).
   **The test user email must exactly match the Google account you'll use to approve
   the login in step 6** — YouTube's upload scope is a restricted scope, so any
   mismatch (e.g. approving with a different account than the one added as a test
   user) shows a "Google hasn't verified this app" screen with no way past it.
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   Application type: **TVs and Limited Input devices**.
5. Download the resulting JSON and save it as `bgm-pipeline/credentials/client_secret.json`
   (this path is gitignored — it will never be committed).
6. Run the login flow once:
   ```bash
   .venv/bin/python -m bgm_pipeline.youtube_auth login
   ```
   It prints a URL and a short code — open the URL on any device, enter the code,
   approve. You'll likely see the "Google hasn't verified this app" warning (expected
   for an unpublished app) — click **Advanced → Go to [project name] (unsafe)** to
   proceed; this is safe since it's our own project. A refresh token is saved to
   `bgm-pipeline/credentials/youtube_token.json` (also gitignored).

   **Known limitation**: while the OAuth consent screen stays in "Testing" publishing
   status (the default, and the only option that avoids a Google review), refresh
   tokens reportedly expire after **7 days** rather than lasting indefinitely. If
   uploads start failing after about a week, re-run the login command above. Moving
   to "In production" status removes this, but restricted scopes like `youtube.upload`
   still require completing Google's verification process to actually work there for
   real — not attempted yet, tracked as a follow-up if the 7-day expiry proves
   disruptive to the weekly publish cadence.

## Automated Instagram Reels publishing

`publish_instagram.py` generates a short (5-90s) vertical clip, hosts it
temporarily on Cloud Storage (Instagram's Content Publishing API fetches
from a public URL rather than accepting a direct upload), publishes it as
a Reel, then **deletes the Cloud Storage object and local files**.

```bash
.venv/bin/python -m bgm_pipeline.publish_instagram --preset sleep_rain_focus --seconds 45 --bucket <your-bucket-name>
```

### One-time setup (needs a human)

Unlike YouTube, Meta's Graph API has no device-authorization flow, so the
one manual step happens in Meta's own official web tool instead of a
password prompt:

1. Instagram account must be a **Business** account (not Creator) linked
   to a Facebook Page via [Meta Business Suite](https://business.facebook.com).
2. Create a Meta Developer App at [developers.facebook.com/apps](https://developers.facebook.com/apps)
   (type: Business). Save its App ID/App Secret as
   `bgm-pipeline/credentials/meta_app.json`:
   ```json
   {"app_id": "...", "app_secret": "..."}
   ```
3. In [Graph API Explorer](https://developers.facebook.com/tools/explorer), select the app, add
   permissions `instagram_business_basic`, `instagram_business_content_publish`,
   `pages_show_list`, and generate a short-lived User Access Token.
4. Exchange it for a long-lived token (auto-refreshed afterward, ~60 day validity):
   ```bash
   .venv/bin/python -m bgm_pipeline.instagram_auth import --token <token from step 3>
   ```
   This looks up the linked Instagram Business Account ID and saves everything
   to `bgm-pipeline/credentials/meta_token.json` (gitignored).
5. Submit `instagram_business_basic` and `instagram_business_content_publish`
   for **App Review** in the Meta Developer dashboard — required before the
   API works for a real (non-tester) account. Takes 2-4 weeks; post manually
   until it's approved.
6. In the same Google Cloud project used for YouTube, enable **Cloud
   Storage**, create a bucket with **Fine-grained** access control (not
   Uniform bucket-level access — that would block the per-object
   `publicRead` ACL this uses), and pass its name as `--bucket`.

## What still needs a human

- The one-time OAuth setup above (YouTube)
- The one-time Meta/Instagram setup above, including the 2-4 week App Review wait
- TikTok uploads (no equivalent official upload API wired up yet)
- Enabling monetization (YouTube Partner Program, TikTok Creator
  Rewards, etc. — each has its own eligibility requirements)
- Thumbnail/channel branding decisions
