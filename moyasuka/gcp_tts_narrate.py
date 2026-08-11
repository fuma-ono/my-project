"""Generates real narration audio for a モヤスカ script using Google Cloud
Text-to-Speech, as the 14-day-rule replacement for the iPad Shortcuts +
tts.quest workflow (`manual_narration.py`).

Why this exists (docs/ai-company-os/2026-08-11-operating-principles-v2.md,
「モヤスカの14日ルール」): the iPad/tts.quest path depends on an API that's
structurally unreachable from this cloud sandbox (confirmed by the AI経営
パートナーの独立分析, 2026-08-11 — direct connection tests: api.tts.quest
and voicevox.su-shiki.com both refuse the connection, texttospeech.
googleapis.com responds normally), on top of requiring the owner to
manually run a Shortcut and upload results every time. Cloud TTS is
reachable from here, needs no per-video owner action once authorized, and
(at ~480 chars/line, well under the free tier) costs effectively ¥0 —
see docs/projects/moyasuka/gcp-tts-setup.md for the one-time setup.

This is a structural swap, not a new voice cast: `CLOUD_TTS_VOICES` maps
the exact same numeric speaker ids `voicevox_narrate.CHARACTER_SPEAKER_IDS`
already assigns per character (2/3/8/11/12) onto 5 distinct Cloud TTS
voices, so every script written so far (and the weekly script-generation
Routine, which only ever extends CHARACTER_SPEAKER_IDS) keeps working
unchanged — nothing about how characters get cast needs to be touched to
switch synthesis backends. The tradeoff, stated plainly: these are
generic Cloud voices, not the VOICEVOX character voices (ずんだもん etc.)
the channel's About section currently credits — see the docstring note in
`publish.py`'s description template about updating that credit once this
is live.

Usage (once `python3 -m moyasuka.youtube_auth login` has been run with the
extended scope — see moyasuka/youtube_auth.py — and Cloud Text-to-Speech
is enabled on the same GCP project):

    python3 -m moyasuka.gcp_tts_narrate \\
        --script moyasuka/scripts/01-sample.md \\
        --out /tmp/moyasuka-01-narration

Writes the same two files voicevox_narrate.py / manual_narration.py do
(<out>.wav, <out>.durations.json), so everything downstream
(line_chat.py --audio --durations, moyasuka.publish) is unchanged.
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import requests

from moyasuka import youtube_auth
from moyasuka.audio_mix import mix_clips_at_times, wav_duration
from moyasuka.line_chat import estimate_arrivals, parse_chat_script
from moyasuka.voicevox_narrate import CHARACTER_SPEAKER_IDS, DEFAULT_SPEAKER_ID

SYNTHESIZE_URL = "https://texttospeech.googleapis.com/v1/text:synthesize"

# One Cloud TTS voice per existing VOICEVOX speaker id (docs/projects/
# moyasuka/content-backlog.mdの5声固定キャスト運用と1対1対応、キャラクター
# 名→id のマッピング自体はvoicevox_narrate.pyのCHARACTER_SPEAKER_IDSを
# そのまま流用する). pitch offsets differentiate same-gender voices that
# would otherwise sound too similar mid-conversation (the exact problem
# 2026-08-06's 5-voice VOICEVOX expansion solved for the original cast).
CLOUD_TTS_VOICES: dict[int, dict] = {
    3: {"name": "ja-JP-Wavenet-A", "pitch": 2.0},    # ずんだもん役 — 私(主人公)、やや高め
    2: {"name": "ja-JP-Wavenet-B", "pitch": -2.0},   # 四国めたん役 — 主な敵役、やや低め
    8: {"name": "ja-JP-Standard-A", "pitch": 0.0},   # 春日部つむぎ役 — 女性の証人役、別の声質
    11: {"name": "ja-JP-Wavenet-C", "pitch": 0.0},   # 玄野武宏役 — 主な男性役
    12: {"name": "ja-JP-Wavenet-D", "pitch": -3.0},  # 白上虎太郎役 — 男性の証人役、やや低め
}
DEFAULT_VOICE = CLOUD_TTS_VOICES[DEFAULT_SPEAKER_ID]


def synth_line(text: str, speaker_id: int) -> bytes:
    """Calls Cloud Text-to-Speech's synthesize endpoint and returns wav
    bytes (LINEAR16 encoding — a complete, self-contained .wav file, same
    as what VOICEVOX's engine returns)."""
    voice = CLOUD_TTS_VOICES.get(speaker_id, DEFAULT_VOICE)
    access_token = youtube_auth.get_access_token()
    resp = requests.post(
        SYNTHESIZE_URL,
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
        json={
            "input": {"text": text},
            "voice": {"languageCode": "ja-JP", "name": voice["name"]},
            "audioConfig": {"audioEncoding": "LINEAR16", "pitch": voice["pitch"], "speakingRate": 1.0},
        },
        timeout=30,
    )
    resp.raise_for_status()
    payload = resp.json()
    return base64.b64decode(payload["audioContent"])


def build_narration(script_path: str, out_wav: str, out_durations_json: str) -> float:
    title, items = parse_chat_script(script_path)
    if not items:
        raise ValueError(f"no chat items found in {script_path}")

    durations: list[float] = []
    clip_paths: dict[int, str] = {}

    with TemporaryDirectory() as tmp:
        for i, item in enumerate(items):
            if item["type"] == "sfx":
                durations.append(0.0)
                continue
            if item["type"] == "card":
                durations.append(1.2)
                continue
            kind = item.get("kind", "text")
            if kind == "image":
                from moyasuka.line_chat import IMAGE_VIEW_SECONDS
                durations.append(IMAGE_VIEW_SECONDS)
                continue
            if kind == "sticker":
                from moyasuka.line_chat import STICKER_VIEW_SECONDS
                durations.append(STICKER_VIEW_SECONDS)
                continue

            speaker_name = item["speaker"]
            speaker_id = CHARACTER_SPEAKER_IDS.get(speaker_name)
            if speaker_id is None:
                print(
                    f"警告: 話者「{speaker_name}」の音声IDが未設定です。"
                    f"ずんだもん役の声(id={DEFAULT_SPEAKER_ID})で代用します。",
                    file=sys.stderr,
                )
                speaker_id = DEFAULT_SPEAKER_ID

            print(f"  [{i+1}/{len(items)}] {speaker_name}: {item['text'][:20]}...")
            wav_bytes = synth_line(item["text"], speaker_id)
            clip_path = f"{tmp}/clip_{i:03d}.wav"
            Path(clip_path).write_bytes(wav_bytes)
            durations.append(wav_duration(clip_path))
            clip_paths[i] = clip_path

        arrivals = estimate_arrivals(items, durations)
        total_seconds = arrivals[-1][1] + 1.2
        mix_clips_at_times(clip_paths, arrivals, total_seconds, out_wav)

    with open(out_durations_json, "w", encoding="utf-8") as f:
        json.dump(durations, f, ensure_ascii=False)

    return total_seconds


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate モヤスカ narration via Google Cloud Text-to-Speech.")
    parser.add_argument("--script", required=True, help="path to a scripts/*.md file")
    parser.add_argument("--out", required=True, help="output prefix — writes <out>.wav and <out>.durations.json")
    args = parser.parse_args(argv)

    total = build_narration(args.script, f"{args.out}.wav", f"{args.out}.durations.json")
    print(f"wrote {args.out}.wav / {args.out}.durations.json ({total:.1f}s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
