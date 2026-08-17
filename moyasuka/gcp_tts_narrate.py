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

Usage (once a service-account JSON key is saved at moyasuka/credentials/
gcp_tts_service_account.json — see moyasuka/gcp_tts_auth.py and
docs/projects/moyasuka/gcp-tts-setup.md — and Cloud Text-to-Speech is
enabled on the same GCP project):

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

from moyasuka import gcp_tts_auth
from moyasuka.audio_mix import mix_clips_at_times, wav_duration
from moyasuka.line_chat import HARSH_TRIGGER_WORDS, PAUSE_SECONDS, estimate_arrivals, is_pause_only, parse_chat_script
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


# Owner feedback (2026-08-17): "もう少し話すスピードを早くして" — applied
# as a flat multiplier on top of every bucket in _prosody_for below, rather
# than raising each bucket's rate individually, so the relative pacing
# differences between e.g. a hesitant line and an exclamation are
# preserved exactly, just all shifted faster together.
GLOBAL_RATE_MULTIPLIER = 1.12


def _prosody_for(text: str) -> tuple[float, float]:
    """(pitch_delta, speaking_rate), layered on top of the character's base
    voice — owner feedback (2026-08-16, round 1): "音声に抑揚つけて". Cloud
    TTS reads every line at the exact same flat pitch/rate by default.

    Round 1's version only touched harsh-word/question/exclamation/very-
    short lines — maybe 3-4 lines out of 24 in a typical script, so most of
    the narration stayed just as flat and the owner's follow-up ("まだ抑揚
    がない") was fair. This version classifies every line into one of
    several buckets (nothing falls through to a neutral 0.0/1.0 default
    anymore) so the whole narration varies, not just the rare trigger
    lines. Still simple content-based rules, not real sentiment analysis —
    same "curated list, cheap to fix a miss, not worth chasing with NLP"
    philosophy line_chat.py's HARSH_TRIGGER_WORDS itself uses (reused here
    directly, so the vocal delivery and the surprise_hit sfx land on the
    same lines)."""
    stripped = text.rstrip("。、!！?？…‥.")
    if any(w in text for w in HARSH_TRIGGER_WORDS):
        pitch, rate = 4.0, 1.15          # shock/anger — sharp and fast
    elif text.endswith(("?", "？")):
        pitch, rate = 3.0, 1.08          # question — rises
    elif text.endswith(("!", "！")):
        pitch, rate = 3.5, 1.15          # exclamation — pushes harder
    elif "…" in text or "..." in text:
        pitch, rate = -2.5, 0.85         # hesitation/trailing off — slower and lower
    elif len(stripped) <= 6:
        pitch, rate = -1.5, 0.92         # short reaction line — weighty, deliberate
    elif len(stripped) >= 15:
        pitch, rate = 1.5, 1.05          # longer explanatory line — a bit more energy so it doesn't drone
    else:
        pitch, rate = 0.5, 1.02          # everything else still gets a small lift, never the untouched default
    return pitch, rate * GLOBAL_RATE_MULTIPLIER


_SSML_ESCAPE = str.maketrans({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"})


def _build_ssml(text: str) -> str:
    """Wraps any HARSH_TRIGGER_WORDS hit in <emphasis> — a whole-utterance
    pitch/rate shift (audioConfig, above) changes the line's overall energy
    but can't accent one word within a sentence; SSML emphasis is what
    actually gives a harsh word inside an otherwise calm line its own
    punch, which is closer to what "抑揚" (real intonation) means than a
    uniform shift alone."""
    escaped = text.translate(_SSML_ESCAPE)
    for word in HARSH_TRIGGER_WORDS:
        if word in text:
            escaped = escaped.replace(word, f'<emphasis level="strong">{word}</emphasis>')
    return f"<speak>{escaped}</speak>"


def synth_line(text: str, speaker_id: int) -> bytes:
    """Calls Cloud Text-to-Speech's synthesize endpoint and returns wav
    bytes (LINEAR16 encoding — a complete, self-contained .wav file, same
    as what VOICEVOX's engine returns)."""
    voice = CLOUD_TTS_VOICES.get(speaker_id, DEFAULT_VOICE)
    pitch_delta, rate = _prosody_for(text)
    access_token = gcp_tts_auth.get_access_token()
    resp = requests.post(
        SYNTHESIZE_URL,
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
        json={
            "input": {"ssml": _build_ssml(text)},
            "voice": {"languageCode": "ja-JP", "name": voice["name"]},
            "audioConfig": {"audioEncoding": "LINEAR16", "pitch": voice["pitch"] + pitch_delta, "speakingRate": rate},
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
            if kind == "photo":
                from moyasuka.line_chat import PHOTO_VIEW_SECONDS
                durations.append(PHOTO_VIEW_SECONDS)
                continue

            if is_pause_only(item["text"]):
                # 2026-08-14: "......" beats are a silent pause, not
                # something to hand to a TTS engine (see line_chat.py's
                # is_pause_only() docstring) — no synth_line call, no
                # clip_paths entry, just a fixed-length gap in the timeline.
                print(f"  [{i+1}/{len(items)}] {item['speaker']}: (無音 {PAUSE_SECONDS}s)")
                durations.append(PAUSE_SECONDS)
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
