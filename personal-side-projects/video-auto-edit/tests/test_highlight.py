"""ハイライト PoC の構成判断(planner)の規則。モデルを使わず、特徴量を直接与えて確かめる"""
import numpy as np

from vae.highlight import music, planner
from vae.highlight.analyze import CATEGORIES


def _clip(idx, n_frames, created, emb_dir, cat="scenery", sharp=200.0, bright=120.0, motion=3.0, faces=0, speech=(), shots=None):
    e = np.zeros(512, np.float32)
    e[emb_dir] = 1.0
    frames = [{"t": i / 2, "sharp": sharp, "bright": bright, "sat": 80, "motion": motion, "faces": faces, "face_area": 0.02 * faces,
               "appeal": 0.1, "loud": -30.0, "cat": {k: (0.9 if k == cat else 0.01) for k in CATEGORIES}} for i in range(n_frames)]
    return {"idx": idx, "name": f"c{idx}.mp4", "path": f"c{idx}.mp4", "duration": n_frames / 2, "width": 1080, "height": 1920,
            "has_audio": True, "created": created, "created_source": "metadata", "frames": frames,
            "emb": np.tile(e, (n_frames, 1)), "shots": shots or [(0, n_frames)], "speech": list(speech), "words": []}


def test_every_clip_contributes_and_chronological_order():
    clips = [_clip(0, 20, 1000, 0, "transport"), _clip(1, 20, 3000, 1, "food"), _clip(2, 20, 2000, 2, "people", faces=2)]
    edl = planner.plan(clips)
    used = [s["clip"] for s in edl["segments"]]
    assert set(used) == {0, 1, 2}                                # 撮った素材を無意味に捨てない
    order = [s["created"] for s in edl["segments"][1:]]
    assert order == sorted(order)                                # 冒頭の掴みを除き撮影順


def test_duplicate_takes_are_merged():
    clips = [_clip(0, 12, 1000, 5), _clip(1, 12, 1010, 5)]       # 同じ場面の撮り直し
    edl = planner.plan(clips)
    assert len({s["clip"] for s in edl["segments"]}) <= 2
    assert any("ほぼ同じ場面" in r["reason"] for r in edl["rejected"]) or len(edl["segments"]) == 2


def test_black_or_shaky_clip_is_dropped_but_others_kept():
    clips = [_clip(0, 16, 1000, 0), _clip(1, 16, 2000, 1, sharp=0.0, bright=0.0, motion=0.0)]
    edl = planner.plan(clips)
    assert {s["clip"] for s in edl["segments"]} == {0}
    assert any(r["clip"] == 1 and "除外" in r["reason"] for r in edl["rejected"])


def test_overlapping_ranges_are_not_used_twice():
    c = _clip(0, 40, 1000, 0, shots=[(0, 14), (8, 40)], speech=[(1.0, 9.0)])
    edl = planner.plan([c])
    segs = sorted(edl["segments"], key=lambda s: s["start"])
    for a, b in zip(segs, segs[1:]):
        assert b["start"] >= a["end"] - 0.3 * min(a["end"] - a["start"], b["end"] - b["start"])


def test_cuts_snap_to_beats_and_speech_is_not_cut():
    bpm = 120
    beat = 60 / bpm
    clips = [_clip(0, 30, 1000, 0), _clip(1, 30, 2000, 1, speech=[(2.0, 6.3)], cat="people")]
    edl = planner.plan(clips, beat=beat)
    for s in edl["segments"]:
        n = s["dur"] / beat
        assert abs(n - round(n)) < 0.02 or s["end"] >= 15 - 1e-3       # 拍の整数倍(素材の終わりで詰まる場合を除く)
        if not s["speech"]:
            assert round(n) % 2 == 0
        else:
            assert s["start"] <= 2.0 + 1e-6 and s["end"] >= 6.3 - 1e-6   # 話の途中で切らない


def test_music_beat_grid():
    track, beats, downbeats, bpm = music.generate(10, "calm")
    assert track.shape[1] == 2 and len(track) >= 10 * music.SR
    assert abs(beats[1] - beats[0] - 60 / bpm) < 1e-9 and downbeats[1] == beats[4]
    assert np.abs(track).max() <= 0.81


def test_total_length_stays_near_target():
    clips = [_clip(i, 20, 1000 + i * 100, i) for i in range(8)]
    edl = planner.plan(clips, target=20.0, beat=0.5)
    assert len({s["clip"] for s in edl["segments"]}) == 8
    assert edl["total_sec"] <= 20.0 * 1.3
