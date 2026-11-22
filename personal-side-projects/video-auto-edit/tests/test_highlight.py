"""ハイライト PoC の構成判断(planner)の規則。モデルを使わず、特徴量を直接与えて確かめる"""
import os

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
        assert b["start"] >= a["end"] - 1e-6                      # 同じ映像を2回出さない(重なりゼロ)


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
            assert s["dur"] >= planner.MIN_CUT_SEC - 1e-6 or s["end"] >= 15 - 1e-3   # 2 秒未満の細切れにしない
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


def test_metrics_flags_duplicates_defects_and_speech_cuts():
    clips = [_clip(0, 20, 1000, 5, speech=[(2.0, 5.0)]), _clip(1, 20, 2000, 5), _clip(2, 20, 3000, 2, sharp=0.0, bright=0.0)]
    planner.frame_scores(clips)
    edl = {"segments": [
        {"clip": 0, "start": 2.5, "end": 4.0, "dur": 1.5, "cat": "scenery"},          # 話(2.0〜5.0)の途中で始まって切れる
        {"clip": 1, "start": 1.0, "end": 3.0, "dur": 2.0, "cat": "scenery"},          # clip0 とほぼ同じ映像
        {"clip": 2, "start": 0.0, "end": 2.0, "dur": 2.0, "cat": "scenery"}]}         # 真っ黒でぼやけている
    m = planner.metrics(clips, edl, beat=0.5)
    assert m["near_duplicate_pairs"] == 1 and m["defect_segments"] == 1 and m["speech_cut_segments"] == 1
    assert m["clips_used"] == 3 and m["beat_error"] == 0.0 and m["ends_with_scenery"]


# ------------------------------------------------------------ 実動画で見つかった問題(2026-11-22): 切れ目が多すぎる・字幕が崩れる
from vae.highlight import render as hrender  # noqa: E402


def test_trim_to_shot_never_straddles_a_cut():
    assert planner.trim_to_shot(11.5, 13.5, [12.35]) == (12.47, 13.5)            # 長い側(12.35〜13.5)だけを使い、切り替わりから離す
    assert planner.trim_to_shot(11.5, 13.5, []) == (11.5, 13.5)
    s, e = planner.trim_to_shot(10.0, 16.0, [12.0, 15.8])
    assert not any(s < c < e for c in (12.0, 15.8))


def test_candidates_do_not_cross_source_cuts_and_short_pieces_are_dropped():
    c = _clip(0, 30, 1000, 0)
    c["cuts"] = [7.0]                                                           # 15 秒の素材の 7 秒に切り替わり
    planner.frame_scores([c])
    for cand in planner.candidates([c]):
        assert not (cand["start"] + 0.2 < 7.0 < cand["end"] - 0.2)
        assert cand["end"] - cand["start"] >= 2.0 - 1e-3                        # 2 秒未満の細切れは候補にしない


def test_beat_snap_stays_inside_the_shot():
    c = _clip(0, 40, 1000, 0)
    c["cuts"] = [10.0]
    seg = {"clip": 0, "start": 7.6, "end": 9.8, "speech": False, "dur": 2.2}
    planner.snap_to_beats([seg], [c], 0.5)
    assert seg["end"] <= 10.0 - planner.CUT_MARGIN + 1e-6                       # 次の切り替わりの手前まで


def test_segment_count_is_limited():
    clips = [_clip(0, 60, 1000, 0)]
    clips[0]["shots"] = [(i * 8, i * 8 + 8) for i in range(7)]
    edl = planner.plan(clips, target=12.0, beat=0.5)
    assert len(edl["segments"]) <= max(1, int(12.0 / planner.MIN_SEC_PER_CUT))


def test_subtitles_only_for_confident_sentences():
    clip = {"tsegments": [{"s": 0.0, "e": 2.0, "text": "確か"}, {"s": 2.0, "e": 4.0, "text": "怪しい"}, {"s": 4.0, "e": 6.0, "text": "ほぼ確か"}],
            "words": [{"s": 0.1, "e": 0.5, "w": "は", "p": 0.95}, {"s": 0.6, "e": 1.0, "w": "い", "p": 0.9},
                      {"s": 2.1, "e": 2.5, "w": "え", "p": 0.4}, {"s": 2.6, "e": 3.0, "w": "ん", "p": 0.9},
                      {"s": 4.1, "e": 4.5, "w": "ふ", "p": 0.99}, {"s": 4.6, "e": 5.0, "w": "む", "p": 0.01}]}
    groups, dropped = hrender.confident_words(clip, 0.0, 6.0)
    assert [[w["w"] for w in g] for g in groups] == [["は", "い"]] and dropped == 2   # 平均が低い文・1語でも極端に低い文は出さない


def test_boundary_words_are_not_duplicated_across_sentences():
    """実動画(2026-11-22): 文の境目の語が前後の両方の文に入り、字幕が「じゃあ、じゃあ」「これは、これは、これは」になった"""
    clip = {"tsegments": [{"s": 0.0, "e": 1.0, "text": "a"}, {"s": 1.0, "e": 2.0, "text": "b"}],
            "words": [{"s": 0.0, "e": 0.8, "w": "あ", "p": 0.9}, {"s": 0.9, "e": 1.2, "w": "じゃあ、", "p": 0.9},   # 境目(1.0 をまたぐ)
                      {"s": 1.3, "e": 2.0, "w": "い", "p": 0.9}]}
    groups, _ = hrender.confident_words(clip, 0.0, 2.0)
    flat = [w["w"] for g in groups for w in g]
    assert flat.count("じゃあ、") == 1 and flat == ["あ", "じゃあ、", "い"]


def test_natural_edges_start_at_shot_start_and_leave_lead_in():
    s, e = planner.natural_edges(25.8, 34.0, [25.06], 35.5, speech=True)          # 場面の先頭(25.06 の切り替わり)のすぐ近くから選ばれたなら、先頭から使う
    assert abs(s - 25.18) < 1e-6 and e <= 35.5
    s2, e2 = planner.natural_edges(20.0, 23.0, [10.0], 35.5, speech=True)         # 場面の先頭から遠い区間は動かさず、話の前に助走だけ
    assert abs(s2 - 19.5) < 1e-6 and abs(e2 - 23.4) < 1e-6
    assert planner.natural_edges(20.0, 23.0, [10.0], 35.5, speech=False) == (20.0, 23.0)   # 話が無ければ助走・余韻は付けない


def test_dedupe_repeats_removes_stutter_but_keeps_short_words():
    W = lambda *t: [{"w": x} for x in t]
    f = lambda ws: "".join(w["w"] for w in hrender.dedupe_repeats(ws))
    assert f(W("これ", "は", "、", "これ", "は", "何", "でしょう")) == "これは何でしょう"          # 最初のコピーを外し、後ろに続く言葉を残す
    assert f(W("パ", "ック、", "パ", "ック")) == "パック"
    assert f(W("はい", "はい")) == "はいはい"                                  # 2 文字の繰り返し(相づち)は残す
    assert f(W("じゃあ", "、", "いただき", "ます")) == "じゃあ、いただきます"


def test_very_short_fragments_are_not_subtitled():
    clip = {"tsegments": [{"s": 0.0, "e": 0.4, "text": "断片"}, {"s": 1.0, "e": 2.5, "text": "文"}],
            "words": [{"s": 0.0, "e": 0.2, "w": "パ", "p": 0.99}, {"s": 0.2, "e": 0.4, "w": "ック", "p": 0.99},
                      {"s": 1.0, "e": 1.5, "w": "ほ", "p": 0.9}, {"s": 1.5, "e": 2.4, "w": "ん", "p": 0.9}]}
    groups, dropped = hrender.confident_words(clip, 0.0, 3.0)
    assert [[w["w"] for w in g] for g in groups] == [["ほ", "ん"]] and dropped == 1


def test_llm_runs_only_once(tmp_path):
    """オーナーの条件: 実際に送るのは1回だけ。失敗した後の再実行も止める"""
    from vae.highlight import planner_llm as pl
    led = pl.load_ledger(str(tmp_path / "none.json"))
    est = {"jpy_worst": 10.0}
    pl.check_budget(est, led)                                   # 最初は通る
    led["runs"].append({"status": "error", "jpy": 10.0})
    with pytest.raises(pl.BudgetExceeded):
        pl.check_budget(est, led)


def test_llm_default_ledger_is_in_repo_docs():
    from vae.highlight import planner_llm as pl
    assert pl.LEDGER.endswith(os.path.join("docs", "autonomous-hq", "llm_ledger.json")) or os.environ.get("VAE_LLM_LEDGER")


def test_best_window_at_the_end_of_a_clip_is_not_lost():
    """動画の終端に掛かって2秒未満になった窓で、素材ごと候補が消えていた(実動画 scene1)。手前に伸ばして残す"""
    c = _clip(0, 25, 1000, 0)                                    # 25 フレーム = 12.5 秒
    c["duration"] = 12.379                                       # 実際の長さは、最後のフレームより少し短い
    for i, f in enumerate(c["frames"]):
        f["sharp"] = 400.0 if i >= 21 else 20.0                  # 一番良い窓は、ちょうど終端の 4 フレーム(10.5 秒から)
    planner.frame_scores([c])
    cands = planner.candidates([c])
    assert cands and all(x["end"] - x["start"] >= 2.0 - 1e-3 for x in cands)
    assert max(x["end"] for x in cands) <= 12.379 + 1e-6


def test_adjacent_or_overlapping_pieces_of_one_clip_are_merged():
    """同じ動画の 0.0〜2.5 秒 と 2.0〜9.1 秒 を別々に採ると、0.5 秒の同じ映像が2回出る。1つにつなぐ"""
    a = {"clip": 0, "start": 0.0, "end": 2.5, "dur": 2.5, "score": 1.4, "speech": True, "faces": 8}
    b = {"clip": 0, "start": 2.0, "end": 9.1, "dur": 7.1, "score": 0.45, "speech": True, "faces": 6}
    c = {"clip": 1, "start": 0.0, "end": 2.5, "dur": 2.5, "score": 0.4, "speech": False, "faces": 0}
    reasons = {id(a): "採用", id(b): "採用", id(c): "採用"}
    out = planner.merge_adjacent([b, c, a], reasons)
    assert len(out) == 2
    m = next(s for s in out if s["clip"] == 0)
    assert (m["start"], m["end"]) == (0.0, 9.1) and m["score"] == 1.4 and "つないだ" in reasons[id(m)]
    assert reasons[id(b)].startswith("統合")                      # つないで消えた側は「採用」のままにしない


def test_weak_pieces_are_not_used_just_to_fill_the_target_length():
    """長さの目標を満たすために、評価の低い区間を足さない(短くても、良い素材だけの動画にする)"""
    good = _clip(0, 16, 1000, 0, sharp=300.0, faces=2)
    weak = _clip(1, 16, 2000, 1, sharp=30.0, bright=50.0, motion=30.0)
    planner.frame_scores([good, weak])
    edl = planner.plan([good, weak], target=40.0)
    extra = [s for s in edl["segments"] if s["clip"] == 1 and s["score"] < planner.FILL_MIN_SCORE]
    assert len(extra) <= 1                                         # 弱い動画は、代表の1区間まで(それ以上は足さない)


def test_speech_pieces_close_together_are_merged_to_not_cut_a_conversation():
    a = {"clip": 0, "start": 6.0, "end": 8.0, "dur": 2.0, "score": 0.5, "speech": True, "faces": 4}
    b = {"clip": 0, "start": 8.4, "end": 10.5, "dur": 2.1, "score": 0.3, "speech": True, "faces": 4}
    out = planner.merge_adjacent([a, b], {id(a): "", id(b): ""})
    assert len(out) == 1 and (out[0]["start"], out[0]["end"]) == (6.0, 10.5)
    # 片方が会話でないなら、間隔 0.4 秒では結合しない(結合は元の辞書を更新するので、新しく作る)
    p = {"clip": 0, "start": 6.0, "end": 8.0, "dur": 2.0, "score": 0.5, "speech": False, "faces": 4}
    q = {"clip": 0, "start": 8.4, "end": 10.5, "dur": 2.1, "score": 0.3, "speech": True, "faces": 4}
    assert len(planner.merge_adjacent([p, q], {})) == 2


def test_single_clip_is_not_cut_down_to_a_tiny_video(monkeypatch):
    """1 本の素材で、代表の区間だけが採られ、他は『評価が低い』として退けられて、2 秒の動画になっていた(実動画 REAL-1 の後退)。
    完成が最低の長さに満たないうちは、評価が低くても足す。評価の値は素材全体の相対値なので、下限を上げて『弱い候補』を作る"""
    n, bounds = 54, [0, 6, 22, 38, 54]
    c = _clip(0, n, 1000, 0, shots=[(a, b) for a, b in zip(bounds, bounds[1:])])
    for k, (a, b) in enumerate(zip(bounds, bounds[1:])):
        e = np.zeros(512, np.float32)
        e[k] = 1.0
        c["emb"][a:b] = e                                       # 場面ごとに別の絵(同じ場面として重複除外されない)
        for i in range(a, b):
            c["frames"][i]["sharp"] = 300.0 if k == 0 else 100.0   # 最初の場面だけが良く、他は評価が下限を下回る
    monkeypatch.setattr(planner, "FILL_MIN_SCORE", 0.5)
    monkeypatch.setattr(planner, "MIN_OUTPUT_SEC", 0.0)
    tiny = planner.plan([c], target=15.0)["total_sec"]            # 最低の長さの規則が無いとき(以前の動き)
    monkeypatch.setattr(planner, "MIN_OUTPUT_SEC", 8.0)
    edl = planner.plan([c], target=15.0)
    assert tiny < 8.0 and edl["total_sec"] >= 8.0 - 0.5
    assert any("短すぎる" in s["reason"] or "つないだ" in s["reason"] for s in edl["segments"])   # 足した区間は、そのまま、または隣と 1 つにつながって残る
