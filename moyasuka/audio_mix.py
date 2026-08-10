"""Shared helper: mix a set of individual narration clips into one audio
track, each placed at a specific start time.

Used by both voicevox_narrate.py (clips from the VOICEVOX HTTP API) and
manual_narration.py (clips exported by hand from a phone TTS app) so the
two never drift apart on how placement/mixing works — this was pulled out
of voicevox_narrate.py once manual_narration.py needed the exact same
adelay/amix logic.
"""
from __future__ import annotations

import subprocess
import wave


def wav_duration(path: str) -> float:
    """Seconds of audio in a wav file — shared by voicevox_narrate.py and
    manual_narration.py, which both need to know each clip's real length
    to place the next one correctly (was duplicated identically in both
    until 2026-08-09's tech-debt pass)."""
    with wave.open(path, "rb") as wf:
        return wf.getnframes() / wf.getframerate()


def mix_clips_at_times(
    clip_paths: dict[int, str],
    arrivals: list[tuple[float, float, dict]],
    total_seconds: float,
    out_wav: str,
) -> None:
    """clip_paths: {item_index: path to a wav file for that item}, where
    item_index is the position of that item in the `items` list originally
    passed to estimate_arrivals() (and thus indexes into `arrivals` too).
    Items with no entry in clip_paths are silently skipped (e.g. sfx/card/
    image/sticker items carry no narration clip)."""
    inputs = ["-f", "lavfi", "-i", f"anullsrc=r=44100:cl=mono:d={total_seconds}"]
    filter_parts = ["[0:a]aformat=sample_rates=44100:channel_layouts=mono[a0]"]
    mix_labels = ["[a0]"]
    n = 1
    for i, (start, _end, _item) in enumerate(arrivals):
        if i not in clip_paths:
            continue
        inputs += ["-i", clip_paths[i]]
        delay_ms = max(int(start * 1000), 0)
        filter_parts.append(
            f"[{n}:a]aformat=sample_rates=44100:channel_layouts=mono,adelay=delays={delay_ms}:all=1[c{n}]"
        )
        mix_labels.append(f"[c{n}]")
        n += 1

    filter_complex = (
        ";".join(filter_parts)
        + f";{''.join(mix_labels)}amix=inputs={len(mix_labels)}:duration=first:dropout_transition=0:normalize=0[out]"
    )
    subprocess.run(
        ["ffmpeg", "-y", *inputs, "-filter_complex", filter_complex, "-map", "[out]", out_wav],
        check=True, capture_output=True,
    )
