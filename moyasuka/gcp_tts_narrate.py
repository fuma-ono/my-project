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
from moyasuka.line_chat import HARSH_TRIGGER_WORDS, PAUSE_SECONDS, estimate_arrivals, is_pause_only, parse_chat_script, timing_fingerprint, total_seconds_for
from moyasuka.voicevox_narrate import CHARACTER_SPEAKER_IDS, DEFAULT_SPEAKER_ID

SYNTHESIZE_URL = "https://texttospeech.googleapis.com/v1/text:synthesize"

# One Cloud TTS voice per existing VOICEVOX speaker id (docs/projects/
# moyasuka/content-backlog.mdの5声固定キャスト運用と1対1対応、キャラクター
# 名→id のマッピング自体はvoicevox_narrate.pyのCHARACTER_SPEAKER_IDSを
# そのまま流用する). pitch offsets differentiate same-gender voices that
# would otherwise sound too similar mid-conversation (the exact problem
# 2026-08-06's 5-voice VOICEVOX expansion solved for the original cast).
# 2026-08-18: switched from Wavenet/Standard to Chirp3-HD (owner: "声を
# 変えて...プロの方々でこれは面白いと思える作品を作ってください" — this is
# Google's newest, most natural/expressive Japanese TTS family, a real
# step up from Wavenet's flatter delivery for a comedy-leaning script.
# Trade-off: confirmed against the live API that Chirp3-HD rejects the
# `pitch` param outright, so these entries have no "pitch" key at all —
# synth_line() only sends pitch when the key is present (see there).
CLOUD_TTS_VOICES: dict[int, dict] = {
    3: {"name": "ja-JP-Chirp3-HD-Kore"},        # ずんだもん役 — 私(主人公)
    2: {"name": "ja-JP-Chirp3-HD-Despina"},     # 四国めたん役 — 主な敵役
    8: {"name": "ja-JP-Chirp3-HD-Leda"},        # 春日部つむぎ役 — 女性の証人役、別の声質
    11: {"name": "ja-JP-Chirp3-HD-Puck"},       # 玄野武宏役 — 主な男性役
    12: {"name": "ja-JP-Chirp3-HD-Fenrir"},     # 白上虎太郎役 — 男性の証人役、別の声質
    # 2026-08-18: 台本06「ことね」専用(既存5声のどのロールにも属さない、
    # オーナー指示「かわいらしい感じで」「もう少し若い声」に対応する声)。
    # ja-JP Chirp3-HD女性ボイス全14種の試聴サンプルをオーナーに送り、
    # Sulafatを選定。既存ロール(主な敵役=Despina等)を上書きせず、新規
    # speaker_id=13として追加(voicevox_narrate.CHARACTER_SPEAKER_IDSの
    # "ことね"エントリと対応)。
    13: {"name": "ja-JP-Chirp3-HD-Sulafat"},    # ことね役(06)
}
DEFAULT_VOICE = CLOUD_TTS_VOICES[DEFAULT_SPEAKER_ID]


# Owner feedback (2026-08-17, round 1): "もう少し話すスピードを早くして"
# — applied as a flat multiplier on top of every bucket in _prosody_for
# below, rather than raising each bucket's rate individually, so the
# relative pacing differences between e.g. a hesitant line and an
# exclamation are preserved exactly, just all shifted faster together.
# Round 2 (same day, on the モヤスカ v13 render): "もう少し話すスピードを
# 早くして。チャットもそれに合わせて" — bumped further. The "チャットも
# それに合わせて" part needs no separate code change: bubble timing is
# already driven entirely by the real per-line audio durations
# (durations.json), so regenerating narration with the new rate and
# re-rendering is sufficient — the chat automatically follows.
# Round 3 (2026-08-18): "1.25倍くらい速度を早くして" — a specific target
# this time rather than "a bit more", so set directly instead of nudging.
# Round 4 (same day, next round): "もう少し話速を1.4倍にして" — again a
# direct target.
# Round 5 (2026-08-18, on 台本06): "テンポをもう少し速くして" — after the
# 変な間(dead-gap) fixes elsewhere in this same round, tempo was still
# flagged as slow. Bumped once more.
GLOBAL_RATE_MULTIPLIER = 1.5


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
    same lines).

    2026-08-18 correction: the pitch magnitudes below (originally ±1.5 to
    ±4.0 semitones) were tuned back when _build_ssml() silently dropped
    pitch entirely for Chirp3-HD (see that function's docstring) — they
    were never actually heard in production. The same day, pitch was
    wired up for real via SSML <prosody>, and at the original magnitudes
    it overshot badly: swinging a single character's pitch by up to ~6.5
    semitones line-to-line (e.g. a hesitant -2.5 line next to a harsh-word
    +4.0 line) made ONE character sound like several different voices —
    owner feedback: "登場人物3人しかいないのに声の種類がおおい" on a
    3-character script. Chirp3-HD's own built-in prosody is already
    considerably more expressive than the flat Wavenet baseline this
    bucket scheme was originally designed for, so it doesn't need as large
    an explicit push. Values below are cut to roughly a third of the
    original magnitudes — keeps a perceptible lift on questions/
    exclamations/harsh words without breaking character-voice identity."""
    stripped = text.rstrip("。、!！?？…‥.")
    if any(w in text for w in HARSH_TRIGGER_WORDS):
        pitch, rate = 1.4, 1.15          # shock/anger — sharp and fast
    elif text.endswith(("?", "？")):
        pitch, rate = 1.0, 1.08          # question — rises
    elif text.endswith(("!", "！")):
        pitch, rate = 1.2, 1.15          # exclamation — pushes harder
    elif "…" in text or "..." in text:
        pitch, rate = -0.8, 0.85         # hesitation/trailing off — slower and lower
    elif len(stripped) <= 6:
        pitch, rate = -0.5, 0.92         # short reaction line — weighty, deliberate
    elif len(stripped) >= 15:
        # 2026-08-18: was rate=1.05 ("a bit more energy so it doesn't
        # drone") — combined with GLOBAL_RATE_MULTIPLIER=1.5 that's an
        # effective 1.575x on exactly the lines carrying the most plot
        # information per line (long enough to hit this bucket), which is
        # backwards: a dense reveal line needs more room to be parsed by
        # ear, not less. Owner report on 台本06's misdirected-message line
        # ("たっくん、今日私も熱っぽいから...") specifically: "早口すぎる
        # から修正して". Dropped below 1.0 so long lines are the one
        # bucket that's calmer than baseline, not faster.
        pitch, rate = 0.5, 0.85
    else:
        pitch, rate = 0.2, 1.02          # everything else still gets a small lift, never the untouched default
    return pitch, rate * GLOBAL_RATE_MULTIPLIER


_SSML_ESCAPE = str.maketrans({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"})


def _build_ssml(text: str, pitch_delta: float) -> str:
    """Wraps any HARSH_TRIGGER_WORDS hit in <emphasis>, and the whole
    utterance in <prosody pitch="...st">, to actually deliver
    _prosody_for's per-line pitch_delta.

    2026-08-18 fix: the previous version left pitch_delta unused for
    Chirp3-HD voices — synth_line() used to try setting it via the
    top-level `audioConfig.pitch` field, which Chirp3-HD rejects outright
    ("This voice does not support pitch parameters at this time"), so that
    branch was written to simply skip pitch for every Chirp3-HD voice
    (i.e. all of them, see CLOUD_TTS_VOICES). The rationale at the time was
    "Chirp3-HD's built-in prosody is expressive enough on its own" — the
    owner's actual listening test proved that wrong ("抑揚をしっかりつけて。
    棒読みだから"): with pitch fully dropped, only speakingRate was varying
    per line, which reads as flat/monotone exactly as reported. Confirmed
    live against the API that SSML-level `<prosody pitch="+Nst">` (semitone
    units, same numeric scale _prosody_for already returns) IS accepted
    even though the audioConfig-level field isn't — different mechanism,
    not documented anywhere obvious either. So pitch now goes through SSML
    instead of audioConfig, for every voice (Chirp3-HD or otherwise)."""
    escaped = text.translate(_SSML_ESCAPE)
    for word in HARSH_TRIGGER_WORDS:
        if word in text:
            escaped = escaped.replace(word, f'<emphasis level="strong">{word}</emphasis>')
    return f'<speak><prosody pitch="{pitch_delta:+.1f}st">{escaped}</prosody></speak>'


def synth_line(text: str, speaker_id: int) -> bytes:
    """Calls Cloud Text-to-Speech's synthesize endpoint and returns wav
    bytes (LINEAR16 encoding — a complete, self-contained .wav file, same
    as what VOICEVOX's engine returns)."""
    voice = CLOUD_TTS_VOICES.get(speaker_id, DEFAULT_VOICE)
    pitch_delta, rate = _prosody_for(text)
    access_token = gcp_tts_auth.get_access_token()
    audio_config = {"audioEncoding": "LINEAR16", "speakingRate": rate}
    resp = requests.post(
        SYNTHESIZE_URL,
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
        json={
            "input": {"ssml": _build_ssml(text, pitch_delta)},
            "voice": {"languageCode": "ja-JP", "name": voice["name"]},
            "audioConfig": audio_config,
        },
        timeout=30,
    )
    resp.raise_for_status()
    payload = resp.json()
    return base64.b64decode(payload["audioContent"])


def build_narration(script_path: str, out_wav: str, out_durations_json: str) -> float:
    """IMPORTANT: every spoken clip's position in the returned .wav is
    baked in using `estimate_arrivals()` *at the moment this runs* (see
    `mix_clips_at_times` below). render_video() independently recomputes
    `estimate_arrivals()` again at render time from the same script +
    durations.json — normally identical, so the two stay in sync. But if
    line_chat.py's timing logic (LEAD_IN_SECONDS, POST_HOOK_*, GAP_SECONDS,
    etc.) changes *after* a narration .wav was generated, re-rendering with
    that same old .wav desyncs the audio from the bubbles: the clips are
    still sitting at their old baked-in positions while the bubbles now
    follow the new timing (2026-08-17, real incident: "チャットと音声が
    合っていない" after a timing-only line_chat.py change reused a
    pre-existing .wav — root cause, not a hypothetical). Rule: whenever
    line_chat.py's arrival-timing logic changes, always regenerate
    narration before the next render, even if the script's own text/items
    didn't change — reusing an old .wav is only safe when *nothing* about
    how arrivals are computed changed since it was generated."""
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
        # 2026-08-18: use the shared total_seconds_for() rather than a
        # local `+ 1.2` — this used to be its own independent copy of the
        # same formula, and it drifted from line_chat.py's copy the moment
        # only one of them was updated to give a trailing `!sfx:` cue (e.g.
        # otoko_iyahho moved to be the video's last item) enough tail room.
        # See total_seconds_for()'s docstring for the full incident.
        total_seconds = total_seconds_for(items, arrivals)
        mix_clips_at_times(clip_paths, arrivals, total_seconds, out_wav)

    with open(out_durations_json, "w", encoding="utf-8") as f:
        json.dump(durations, f, ensure_ascii=False)

    # stamp the timing logic's fingerprint at the moment clip positions
    # were baked into out_wav — see line_chat.timing_fingerprint()'s
    # docstring. render_video() checks this against the current code and
    # warns if line_chat.py's timing logic changed since this .wav was built.
    Path(f"{out_durations_json}.timing").write_text(timing_fingerprint(), encoding="utf-8")

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
