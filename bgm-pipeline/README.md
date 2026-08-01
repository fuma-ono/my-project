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

`publish.py` generates a track, renders it, uploads it via the YouTube Data
API, and **deletes the local audio/video files once the upload succeeds** —
nothing is kept on disk after a video ships.

```bash
.venv/bin/python -m bgm_pipeline.publish --preset sleep_rain_focus --minutes 60 --privacy public
```

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
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   Application type: **TVs and Limited Input devices**.
5. Download the resulting JSON and save it as `bgm-pipeline/credentials/client_secret.json`
   (this path is gitignored — it will never be committed).
6. Run the login flow once:
   ```bash
   .venv/bin/python -m bgm_pipeline.youtube_auth login
   ```
   It prints a URL and a short code — open the URL on any device, enter the code,
   approve. A refresh token is saved to `bgm-pipeline/credentials/youtube_token.json`
   (also gitignored) and reused for all future uploads, so this is a one-time step.

## What still needs a human

- The one-time OAuth setup above (YouTube)
- TikTok/Instagram uploads (no equivalent official upload API is wired up yet)
- Enabling monetization (YouTube Partner Program, TikTok Creator
  Rewards, etc. — each has its own eligibility requirements)
- Thumbnail/channel branding decisions
