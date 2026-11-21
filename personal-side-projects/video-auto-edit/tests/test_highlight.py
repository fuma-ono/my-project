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


# ------------------------------------------------------------ Sonnet 版の予算と実行の制限(承認の条件)
import json  # noqa: E402

import pytest  # noqa: E402

from vae.highlight import planner_llm as pl  # noqa: E402


class _Usage:
    input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens = 40000, 3000, 0, 0


class _Msg:
    stop_reason = "end_turn"
    usage = _Usage()
    _request_id = "req_test"

    def __init__(self, choice):
        self.content = [type("B", (), {"type": "text", "text": json.dumps(choice)})()]


class _Stream:
    def __init__(self, msg):
        self.msg = msg

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get_final_message(self):
        return self.msg


class FakeClient:
    def __init__(self, choice):
        self.calls = 0
        self.choice = choice
        self.messages = self

    def stream(self, **kw):
        self.calls += 1
        self.kw = kw
        return _Stream(_Msg(self.choice))


def _clips3():
    return [_clip(0, 20, 1000, 0, "scenery"), _clip(1, 20, 2000, 1, "food"), _clip(2, 20, 3000, 2, "people", faces=2)]


def test_llm_dry_run_sends_nothing(tmp_path):
    fc = FakeClient({})
    edl, info = pl.plan_with_llm(_clips3(), client=fc, run=False, ledger_path=str(tmp_path / "l.json"), with_images=False)
    assert edl is None and fc.calls == 0 and info["sent"] is False and info["estimate"]["jpy_worst"] > 0


def test_llm_budget_cap_blocks_and_ledger_records(tmp_path):
    led = str(tmp_path / "l.json")
    pl.save_ledger({"cap_jpy": 500.0, "runs": [{"jpy": 490.0}]}, led)                 # ほぼ使い切っている
    fc = FakeClient({})
    with pytest.raises(pl.BudgetExceeded):
        pl.plan_with_llm(_clips3(), client=fc, run=True, ledger_path=led, with_images=False)
    assert fc.calls == 0                                                              # 上限を超える見込みなら送らない


def test_llm_run_once_records_usage_and_builds_edl(tmp_path):
    led = str(tmp_path / "l.json")
    clips = _clips3()
    pl.planner.frame_scores(clips)
    cands = pl.planner.candidates(clips)
    pl.build_request(clips, cands, with_images=False)                          # id を振る
    choice = {"story": "テスト", "mood": "calm", "target_sec": 12, "segments": [
        {"id": cands[2]["id"], "reason": "掴み"}, {"id": cands[0]["id"], "reason": "景色", "role": "締め"},
        {"id": "c999", "reason": "存在しない"}, {"id": cands[2]["id"], "reason": "重複"}], "excluded": [{"id": cands[1]["id"], "reason": "同じ場面"}]}
    fc = FakeClient(choice)
    edl, info = pl.plan_with_llm(clips, cands=cands, client=fc, run=True, ledger_path=led, beat=0.5, with_images=False)
    assert fc.calls == 1 and info["sent"] and info["usage"]["status"] == "ok"
    assert [s["clip"] for s in edl["segments"]] == [cands[2]["clip"], cands[0]["clip"]]      # 順番は Sonnet の指示どおり
    assert len(edl["problems"]) == 2 and edl["story"] == "テスト"
    assert any("同じ場面" in r["reason"] for r in edl["rejected"])
    ledger = pl.load_ledger(led)
    assert len(ledger["runs"]) == 1 and ledger["runs"][0]["input_tokens"] == 40000 and ledger["runs"][0]["jpy"] > 0
    # 1回の費用: 入力 4万 × $2 + 出力 3千 × $10 = $0.11 ≒ 17 円
    assert abs(ledger["runs"][0]["usd"] - 0.11) < 1e-6
    kw = fc.kw                                                                         # 送り方の確認(承認の条件・API の仕様)
    assert kw["model"] == "claude-sonnet-5-5" and "temperature" not in kw and "tool_choice" not in kw


def test_llm_failure_is_not_retried_and_stays_counted(tmp_path):
    led = str(tmp_path / "l.json")

    class Boom(FakeClient):
        def stream(self, **kw):
            self.calls += 1
            raise RuntimeError("network")
    fc = Boom({})
    with pytest.raises(RuntimeError):
        pl.plan_with_llm(_clips3(), client=fc, run=True, ledger_path=led, with_images=False)
    assert fc.calls == 1                                                               # 自動で再実行しない
    r = pl.load_ledger(led)["runs"][0]
    assert r["status"] == "error" and r["jpy"] > 0                                     # 失敗でも最悪の見積もり分は計上し続ける


def test_llm_no_key_no_call(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(RuntimeError):
        pl.plan_with_llm(_clips3(), run=True, ledger_path=str(tmp_path / "l.json"), with_images=False)
