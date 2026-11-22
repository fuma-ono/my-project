"""品質評価ライブラリ(vae.quality)の確認。モデルを使わず、数値と ffmpeg の合成映像で、測定が正しく働くことを確かめる。
これは『測定器の動作確認』であり、編集の品質の評価ではない。"""
import subprocess

import numpy as np
import pytest

from vae import quality as q


def _seg(clip, start, end, speech=False, dur=None, cat="people"):
    return {"clip": clip, "start": start, "end": end, "dur": dur or (end - start), "speech": speech, "cat": cat}


def test_lin_scores_and_direction():
    assert q.lin(0.0, 0.0, 1.0) == 0.0 and q.lin(1.0, 0.0, 1.0) == 5.0 and q.lin(0.5, 0.0, 1.0) == 2.5
    assert q.lin(-1.0, 0.0, -1.0) == 5.0 and q.lin(0.0, 0.0, -1.0) == 0.0     # 小さいほど良い指標
    assert q.lin(None, 0, 1) is None and q.lin(9, 0, 1) == 5.0


def test_cer():
    assert q.cer("これは、テストです。", "これはテストです") == 0.0
    assert q.cer("あいうえお", "あいくえお") == pytest.approx(0.2)
    assert q.cer("", "x") is None


def test_same_clip_overlap_and_cut_stats():
    edl = {"segments": [_seg(0, 0.0, 2.5), _seg(0, 2.0, 9.0), _seg(1, 0.0, 3.0)]}
    assert q.same_clip_overlap(edl) == pytest.approx(0.5)
    edl2 = {"segments": [_seg(0, 0, 3, dur=3.0), _seg(1, 0, 5, dur=5.0), _seg(2, 0, 1.5, dur=1.5)]}
    c = q.cut_stats(edl2, beat=0.5)
    assert c["n_cuts"] == 2 and c["median_sec"] == 3.0 and c["short_share"] == pytest.approx(1 / 3, abs=1e-3) and c["beat_error"] == 0.0
    assert q.cut_stats(edl2, beat=0.7)["beat_error"] > 0.0


def test_straddle_and_speech_cuts_use_independent_sources():
    clips = [{"idx": 0, "cuts": [5.0], "tsegments": [{"s": 1.0, "e": 4.0}]}]
    assert q.straddled_source_cuts(clips, {"segments": [_seg(0, 3.0, 7.0)]}) == 1
    assert q.straddled_source_cuts(clips, {"segments": [_seg(0, 5.2, 8.0)]}) == 0
    assert q.speech_cuts(clips, {"segments": [_seg(0, 2.0, 6.0)]}) == 1          # 文(1〜4 秒)の途中から始まっている
    assert q.speech_cuts(clips, {"segments": [_seg(0, 0.5, 4.2)]}) == 0


def _frames(n, bright=120, sharp=200, motion=3, faces=0):
    return [{"bright": bright, "sharp": sharp, "motion": motion, "faces": faces, "score": 0.0} for _ in range(n)]


def test_selection_detects_unusable_and_lift():
    good = {"idx": 0, "name": "good.mp4", "frames": _frames(20, faces=1), "created": 1, "created_source": "metadata", "width": 1920, "height": 1080}
    black = {"idx": 1, "name": "black.mp4", "frames": _frames(20, bright=2, sharp=0), "created": 2, "created_source": "metadata", "width": 1920, "height": 1080}
    u = q.clip_usability([good, black])
    assert u[0]["usable"] and not u[1]["usable"]
    ok = q.selection_stats([good, black], {"segments": [_seg(0, 0, 5)]})
    bad = q.selection_stats([good, black], {"segments": [_seg(1, 0, 5)]})
    assert ok["unusable_selected_share"] == 0.0 and ok["lift_percentile"] > bad["lift_percentile"]
    assert bad["unusable_selected_share"] == 1.0
    st = q.story_stats([good, black], {"segments": [_seg(1, 0, 5)], "total_sec": 5, "target_sec": 5}, u)
    assert st["unusable_clips_used"] == 1 and st["coverage_usable"] == 0.0


def test_repeated_footage_ignores_flat_frames():
    rng = np.random.default_rng(0)
    a, b = rng.random((9, 16)) * 255, rng.random((9, 16)) * 255
    frames = [a, b, a, b, b, b, a, b] + [np.zeros((9, 16))] * 4                 # a が 0 秒・3 秒・... に再び出る / 黒は数えない
    r = q.repeated_footage(np.array(frames, np.float32), min_gap_sec=1.0)
    assert r["repeat_sec"] > 0
    assert q.repeated_footage(np.zeros((12, 9, 16), np.float32))["repeat_sec"] == 0


def _lavfi(path, vf, dur=4, audio=None):
    cmd = ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"{vf}=s=320x180:r=30:d={dur}"]
    if audio:
        cmd += ["-f", "lavfi", "-i", audio]
    cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p"] + (["-c:a", "aac", "-shortest"] if audio else []) + [path]
    subprocess.run(cmd, check=True)


def test_black_freeze_and_luma_jump_measure_real_video(tmp_path):
    p = str(tmp_path / "bf.mp4")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=320x180:r=30:d=2", "-f", "lavfi", "-i",
                    "color=c=white:s=320x180:r=30:d=2", "-filter_complex", "[0][1]concat=n=2:v=1:a=0", "-pix_fmt", "yuv420p", p], check=True)
    bf = q.black_freeze(p)
    assert bf["black_sec"] >= 1.5 and bf["freeze_sec"] >= 1.5                    # 黒 2 秒、静止(黒→白それぞれ)
    g = q.read_gray(p, 10)
    j = q.luma_jumps(g, [2.0])
    assert j["jumps"][0] > 200 and j["share_over_thr"] == 1.0


def test_loudness_and_speech_prominence(tmp_path):
    p = str(tmp_path / "tone.mp4")
    _lavfi(p, "testsrc2", dur=6, audio="sine=f=440:d=6")
    L = q.loudness(p)
    assert L["integrated_lufs"] is not None and L["true_peak_dbtp"] is not None and len(L["m_series"]) > 30
    m = [(t / 10, -20.0 if t < 30 else -30.0) for t in range(60)]
    assert q.speech_prominence(m, [(0, 3, True), (3, 6, False)]) == pytest.approx(10.0)
    assert q.speech_prominence(m, [(0, 6, True)]) is None                       # 比べる相手がなければ測らない


def test_subtitle_stats_and_axes_smoke():
    tl = [(0, 5, True), (5, 8, False)]
    sb = q.subtitle_stats([(0.5, 2.0, "こんにちは"), (1.9, 2.5, "重なり"), (3.0, 4.5, "ok")], tl)
    assert sb["overlaps"] == 1 and sb["too_short"] == 1 and sb["covered_share"] == pytest.approx((1.5 + 0.6 + 1.5) / 5)
    clips = [{"idx": 0, "name": "a.mp4", "frames": _frames(30, faces=1), "created": 1, "created_source": "metadata", "cuts": [], "tsegments": [],
              "height": 1080, "width": 1920}]
    edl = {"segments": [_seg(0, 0, 4, dur=4.0)], "total_sec": 4.0, "target_sec": 4.0}
    m = {"selection": q.selection_stats(clips, edl), "story": q.story_stats(clips, edl, q.clip_usability(clips)), "repeat": {"repeat_sec": 0.0},
         "same_clip_overlap": 0.0, "cuts": q.cut_stats(edl, 0.5), "straddle": 0, "speech_cuts": 0,
         "audio": {"true_peak_dbtp": -2.0, "integrated_lufs": -16.0, "lra": 5.0, "speech_prominence": 8.0},
         "subtitles": sb, "cer": None, "clip_usability": q.clip_usability(clips), "clips_used": ["a.mp4"],
         "finish": {"black_sec": 0.0, "freeze_sec": 0.0, "dark_share": 0.0, "luma_jump_share": 0.0, "short_side": 1080}}
    ax = q.score_axes(m, labels={"clips": {"a.mp4": {"expected_video": "usable"}}})
    assert set(ax) == set(q.AXES)
    assert ax["understanding"]["score"] == 5.0 and ax["audio"]["score"] == 5.0 and ax["finish"]["score"] == 5.0
    assert ax["overall"]["score"] is None and all("human_needed" in v for v in ax.values())      # 総合は自動で決めない
    assert 0 < ax["effects"]["score"] < 5                                                       # 機能の一覧との比較(実装されていない演出がある)


def test_cer_events_matches_against_a_part_of_the_script():
    ref = "今日は天気がとても良いので公園に出かけました。桜の花が咲いていました。"
    assert q.cer_events(ref, ["公園に出かけました", "桜の花が咲いていました"]) == 0.0           # 台本の一部だけを使っても誤りにしない
    assert q.cer_events(ref, ["公園に出かけました"]) == 0.0
    assert q.cer_events(ref, ["公園に出掛けました"]) == pytest.approx(1 / 9, abs=1e-3)           # 1 文字違い
    assert q.cer_events(ref, ["まったく違う内容です"]) > 0.5
    assert q.cer_events(ref, []) is None


def test_understanding_scores_the_engines_decision_not_the_meter():
    """映像・内容の理解は、エンジンが使えない動画を使ったか(ラベルとの比較)で採点する。測定器の判定の一致は参考値(採点しない)"""
    clips = [{"idx": 0, "name": "good.mp4", "frames": _frames(20, faces=1)}, {"idx": 1, "name": "black.mp4", "frames": _frames(20, bright=2, sharp=0)}]
    labels = {"clips": {"good.mp4": {"expected_video": "usable"}, "black.mp4": {"expected_video": "unusable"}}}
    base = {"selection": {"unusable_selected_share": 0, "lift_percentile": 60}, "story": {"unusable_clips_used": 0, "coverage_usable": 1.0, "length_ratio_to_target": 1.0,
            "chronology_adjacent_ok": None}, "repeat": {"repeat_sec": 0}, "same_clip_overlap": 0, "cuts": q.cut_stats({"segments": [_seg(0, 0, 4, dur=4.0)]}, 0.5),
            "straddle": 0, "speech_cuts": 0, "audio": {"true_peak_dbtp": -2, "integrated_lufs": -16, "lra": 5, "speech_prominence": 1.0}, "subtitles": None, "cer": None,
            "clip_usability": q.clip_usability(clips), "finish": {"black_sec": 0, "freeze_sec": 0, "dark_share": 0, "luma_jump_share": 0, "short_side": 1080}}
    good = q.score_axes(dict(base, clips_used=["good.mp4"]), labels)["understanding"]
    bad = q.score_axes(dict(base, clips_used=["good.mp4", "black.mp4"]), labels)["understanding"]
    assert good["score"] == 5.0 and bad["score"] == 0.0 and "black.mp4" in bad["indicators"][0]["rule"]
    assert good["indicators"][1]["score"] is None                                # 測定器の校正は、採点しない
    assert q.score_axes(dict(base, clips_used=["good.mp4"]), labels)["audio"]["indicators"][-1]["score"] is None   # 会話の音量差は参考値


def test_repeated_footage_ignores_dark_frames():
    rng = np.random.default_rng(1)
    dark = rng.random((9, 16)) * 12                                              # ほぼ黒の雑音(平均 6)。同じ画が続いても『繰り返し』にしない
    assert q.repeated_footage(np.array([dark] * 12, np.float32), min_gap_sec=1.0)["repeat_sec"] == 0
