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

## What still needs a human

- Uploading to YouTube/TikTok/Instagram (requires logged-in accounts)
- Enabling monetization (YouTube Partner Program, TikTok Creator
  Rewards, etc. — each has its own eligibility requirements)
- Thumbnail/channel branding decisions
