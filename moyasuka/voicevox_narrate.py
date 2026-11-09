"""Generates real VOICEVOX narration audio for a モヤスカ script.

This is the one piece of the pipeline that has to run on a real PC, not
in the cloud sandbox that built everything else in this repo — VOICEVOX's
engine binary can't be reached from here (see moyasuka/README.md: GitHub
release-asset downloads, Docker, and a direct API fetch were all tried
and confirmed blocked), and it has no iOS app either, so it's unusable
if the owner only has an iPhone (confirmed 2026-08-07). If that's the
situation, use moyasuka/manual_narration.py instead — same two output
files, sourced from clips exported by hand from a phone TTS app rather
than a local VOICEVOX engine. Everything in *this file* is just Python +
the VOICEVOX HTTP API, so it's fully implemented and ready to run the
moment the engine is up on some PC — there was no reason to leave the
actual narration code unwritten just because it can't be test-run here.

Usage (with the VOICEVOX engine already running locally, default
http://127.0.0.1:50021 — see docs/projects/moyasuka/voicevox-setup.md):

    python3 -m moyasuka.voicevox_narrate \
        --script moyasuka/scripts/01-sample.md \
        --out /tmp/moyasuka-01-narration

Writes:
  <out>.wav              — the full narration track, one VOICEVOX clip per
                            spoken line, placed at the exact times
                            line_chat.py will use (computed via the same
                            estimate_arrivals() this module imports, so
                            the two can never drift apart)
  <out>.durations.json    — real per-item clip lengths, aligned 1:1 with
                            the script's items

Then render the final video against the real audio:

    python3 -m moyasuka.line_chat \
        --script moyasuka/scripts/01-sample.md \
        --audio /tmp/moyasuka-01-narration.wav \
        --durations /tmp/moyasuka-01-narration.durations.json \
        --out moyasuka-01-final.mp4

Without --durations, line_chat.py falls back to estimating each bubble's
on-screen time from character count — fine for testing before real audio
exists, but once it does, always pass both flags together so the video
is actually lip-timed to what's being said.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from tempfile import TemporaryDirectory

from moyasuka.audio_mix import mix_clips_at_times, wav_duration
from moyasuka.line_chat import PAUSE_SECONDS, estimate_arrivals, is_pause_only, parse_chat_script, prepare_for_tts, timing_fingerprint, total_seconds_for

VOICEVOX_URL = "http://127.0.0.1:50021"

# Standard VOICEVOX speaker/style IDs. These are tied to each character's
# model release, not per-install config, so they should be the same on
# any VOICEVOX install — but confirm with `GET /speakers` on your own
# engine before a full run, in case an ID has moved or a character needs
# a specific style variant.
#
# Fixed casting per docs/projects/moyasuka/content-backlog.md's キャスト運用,
# extended (2026-08-06) with two more voices once scripts started using
# more than one secondary character per side — without them, e.g. 叔母 and
# 義姉 in scripts/01 would both get 四国めたん and sound like the same
# person mid-conversation.
CHARACTER_SPEAKER_IDS: dict[str, int] = {
    "私": 3,          # ずんだもん(ノーマル) — protagonist, all scripts
    "義母": 2,         # 四国めたん(ノーマル) — primary antagonist, 01
    "ママ友": 2,        # 02
    "上司": 2,         # 03
    "旦那": 11,        # 玄野武宏(ノーマル) — primary male role, 01
    "夫": 11,          # 02
    "同僚": 11,        # 03
    "叔母": 8,         # 春日部つむぎ(ノーマル) — secondary female witness, 01
    "義姉": 8,         # 01
    "別のママ友": 8,     # 02
    "同期": 8,         # 04
    "先輩": 12,        # 白上虎太郎(ノーマル) — secondary male witness, 03. Verify this ID specifically; less commonly cited than the others above.
    "幹事": 2,         # 四国めたん — primary antagonist, 04 (friend-group setting instead of family/work, but same "年上の女性・主な敵役" slot per content-backlog.mdのキャスト運用)
    "店員": 2,         # 05
    "店長": 12,        # 05 — authority figure who rules in the protagonist's favor, same slot as 先輩's witness役 in 03
    # 06〜10 (若者向けリニューアル, 2026-08-18): content-backlog.mdの
    # 2026-08-18追記(役割の型は続柄でなく"主な敵役/主な相手役/証人"で汎用化)
    # に沿って、既存5声のスロットをそのまま流用。
    "りさ": 8,         # 06 — 女性の証人役
    "ゆうと": 12,       # 07(3回目) — 主な相手役(男性)。旧「陽菜」「まゆ」は
                        # 07が2026-08-20にオーナー提供の新台詞で全面差し替えに
                        # なったため削除(共有ノートネタは廃案)
    "先生": 11,        # 08(2回目) — 主な相手役(男性)
    "母": 2,          # 09 — 主な敵役(女性)。docs/projects/moyasuka/2026-08-18-youth-relaunch-plan.mdの配慮により本編では最終的に和解する役どころ
    "父": 11,         # 09 — 主な相手役(男性)
    "祖母": 8,         # 09 — 女性の証人役
    "ゆい": 2,         # 10 — 主な敵役(女性)
    "かえで": 8,        # 10 — 女性の証人役(部長)
    "たいが": 12,       # 10 — 男性の証人役
    "ことね": 13,        # 06 — 専用ボイス(Sulafat)。オーナー指示「かわいらしい
                        # 感じで」「もう少し若い声」を受け、ja-JP Chirp3-HD女性
                        # ボイス全14種を試聴してもらい選定(gcp_tts_narrate.py
                        # のCLOUD_TTS_VOICES[13]参照)。既存5声のどのロールにも
                        # 属さない、このキャラクター専用の追加スロット。
    "みお": 2,         # 11 — 主な敵役(女性)
    "そら": 12,        # 11 — 男性の証人役
    "ゆずき": 8,        # 12 — 女性の証人役(妹)
    "あかり": 2,        # 13 — 主な敵役(女性)
    "ゆうき": 12,       # 13 — 男性の証人役
}
DEFAULT_SPEAKER_ID = 3  # ずんだもん — used with a warning if a script introduces a new character name not listed above


def _check_engine_reachable() -> None:
    try:
        urllib.request.urlopen(f"{VOICEVOX_URL}/version", timeout=5)
    except (urllib.error.URLError, TimeoutError) as e:
        raise SystemExit(
            f"VOICEVOXエンジンに接続できません({VOICEVOX_URL})。\n"
            f"起動していない可能性があります。VOICEVOXアプリを起動してから再実行してください。\n"
            f"詳細エラー: {e}"
        )


def synth_line(text: str, speaker_id: int) -> bytes:
    """Calls the local VOICEVOX engine's two-step synthesis API
    (audio_query, then synthesis with that query) and returns wav bytes."""
    query_url = f"{VOICEVOX_URL}/audio_query?{urllib.parse.urlencode({'text': text, 'speaker': speaker_id})}"
    req = urllib.request.Request(query_url, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        query_body = resp.read()

    synth_url = f"{VOICEVOX_URL}/synthesis?{urllib.parse.urlencode({'speaker': speaker_id})}"
    req2 = urllib.request.Request(
        synth_url, data=query_body, method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req2, timeout=60) as resp2:
        return resp2.read()


def build_narration(script_path: str, out_wav: str, out_durations_json: str) -> float:
    _check_engine_reachable()
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
                durations.append(1.2)  # not used by current scripts, but handled gracefully
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
                # 2026-08-14: see line_chat.py's is_pause_only() — "......"
                # is a silent beat, not TTS input.
                print(f"  [{i+1}/{len(items)}] {item['speaker']}: (無音 {PAUSE_SECONDS}s)")
                durations.append(PAUSE_SECONDS)
                continue

            speaker_name = item["speaker"]
            speaker_id = CHARACTER_SPEAKER_IDS.get(speaker_name)
            if speaker_id is None:
                print(
                    f"警告: 話者「{speaker_name}」の音声IDが未設定です。"
                    f"ずんだもん(id={DEFAULT_SPEAKER_ID})で代用します。"
                    f"voicevox_narrate.pyのCHARACTER_SPEAKER_IDSに追加してください。",
                    file=sys.stderr,
                )
                speaker_id = DEFAULT_SPEAKER_ID

            print(f"  [{i+1}/{len(items)}] {speaker_name}: {item['text'][:20]}...")
            # 絵文字・末尾の「ｗ」は視覚的な記号であって単語ではない
            # (line_chat.prepare_for_tts参照)——gcp_tts_narrate.pyで判明
            # した「読み上げてしまう」問題と同じ理由で、VOICEVOX側も渡す
            # 前に取り除く。
            wav_bytes = synth_line(prepare_for_tts(item["text"]), speaker_id)
            clip_path = f"{tmp}/clip_{i:03d}.wav"
            Path(clip_path).write_bytes(wav_bytes)
            durations.append(wav_duration(clip_path))
            clip_paths[i] = clip_path

        arrivals = estimate_arrivals(items, durations)
        # shared with line_chat.render_video/gcp_tts_narrate.build_narration
        # — see total_seconds_for()'s docstring for why this must not be a
        # locally-duplicated `+ 1.2` (2026-08-18 incident).
        total_seconds = total_seconds_for(items, arrivals)
        mix_clips_at_times(clip_paths, arrivals, total_seconds, out_wav)

    with open(out_durations_json, "w", encoding="utf-8") as f:
        json.dump(durations, f, ensure_ascii=False)

    # see gcp_tts_narrate.build_narration's docstring / line_chat.
    # timing_fingerprint's docstring — same stale-audio hazard applies here
    Path(f"{out_durations_json}.timing").write_text(timing_fingerprint(), encoding="utf-8")

    return total_seconds


def main(argv: list[str] | None = None) -> int:
    global VOICEVOX_URL
    parser = argparse.ArgumentParser(description="Generate real VOICEVOX narration for a モヤスカ script.")
    parser.add_argument("--script", required=True, help="path to a scripts/*.md file")
    parser.add_argument("--out", required=True, help="output prefix — writes <out>.wav and <out>.durations.json")
    parser.add_argument("--voicevox-url", default=VOICEVOX_URL, help="override if the engine runs on a different host/port")
    args = parser.parse_args(argv)

    VOICEVOX_URL = args.voicevox_url

    total = build_narration(args.script, f"{args.out}.wav", f"{args.out}.durations.json")
    print(f"wrote {args.out}.wav / {args.out}.durations.json ({total:.1f}s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
