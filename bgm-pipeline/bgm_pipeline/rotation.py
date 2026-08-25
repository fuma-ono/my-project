"""Picks the next preset to publish so the channel doesn't post the same
content repeatedly (the first two videos both happened to be
sleep_rain_focus — an owner-flagged problem this exists to prevent).

Tracks long-form and Shorts rotation separately (they run on different
cadences) in a small git-tracked JSON file — not a secret, so unlike
credentials/ this is meant to be committed and reviewed like any other
state a human might want to see or edit by hand.

**2026-08-25 incident**: this repeated anyway. On 2026-08-12, three
long-form videos were manually re-published outside this rotation (a
branding fix — new thumbnails/backgrounds, old versions set private) and
`rotation_state.json`'s `long` key was left unchanged during that batch —
only `last_long_form_video_id` got updated. Two weeks later the routine
long-form publish called `next_preset("long")`, which advanced from that
stale value and picked `baby_sleep_noise` — a preset that had, in
reality, already gone out as a long-form video 13 days earlier. The
public channel briefly had two live `baby_sleep_noise` long-form videos.
Caught by the owner watching the channel, not by anything in this code.

**The lesson**: `long`/`shorts` here are just single "last used" pointers
— cheap, but only correct if *every* publish to that surface goes through
`next_preset()`. Any one-off/manual (re-)publish that bypasses it (a
branding fix, a manual `--preset` override, fixing a broken upload) will
silently desync this file from what's actually live on the channel, and
the desync won't surface until the rotation happens to loop back onto the
skipped preset. If you publish something manually outside the normal
Routine call path, update `rotation_state.json`'s relevant key by hand in
the same commit — set it to the preset you just used, exactly as
`next_preset()` itself would have recorded. When in doubt, cross-check
against what's actually live (see the 2026-08-25 fix: `videos.list` on
the channel's uploads, filtered to `privacyStatus: public`, matched by
title against `PRESET_METADATA`) rather than trusting this file blindly.
"""
from __future__ import annotations

import json
from pathlib import Path

from . import presets

STATE_PATH = Path(__file__).resolve().parent.parent / "rotation_state.json"


def _load_state() -> dict:
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text())
    return {}


def _save_state(state: dict) -> None:
    STATE_PATH.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")


def next_preset(kind: str) -> str:
    """kind is any label used to track a separate rotation, e.g. "long" or
    "shorts" — each cycles independently through all presets in a fixed
    order so every preset gets equal turns.
    """
    order = sorted(presets.PRESETS.keys())
    state = _load_state()
    last = state.get(kind)
    next_index = (order.index(last) + 1) % len(order) if last in order else 0
    chosen = order[next_index]
    state[kind] = chosen
    _save_state(state)
    return chosen


def peek_next_preset(kind: str) -> str:
    """Same as next_preset but doesn't advance/persist the rotation — for
    dry-run / reporting purposes.
    """
    order = sorted(presets.PRESETS.keys())
    state = _load_state()
    last = state.get(kind)
    next_index = (order.index(last) + 1) % len(order) if last in order else 0
    return order[next_index]


def set_last_long_form(video_id: str) -> None:
    """Records the most recently published long-form video, so
    publish_shorts.py can default --link-video-id to it — the whole point
    of doing Shorts here is pulling viewers into a specific long-form
    video, not just posting into the void.
    """
    state = _load_state()
    state["last_long_form_video_id"] = video_id
    _save_state(state)


def get_last_long_form() -> str | None:
    return _load_state().get("last_long_form_video_id")
