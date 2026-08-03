"""Picks the next preset to publish so the channel doesn't post the same
content repeatedly (the first two videos both happened to be
sleep_rain_focus — an owner-flagged problem this exists to prevent).

Tracks long-form and Shorts rotation separately (they run on different
cadences) in a small git-tracked JSON file — not a secret, so unlike
credentials/ this is meant to be committed and reviewed like any other
state a human might want to see or edit by hand.
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
