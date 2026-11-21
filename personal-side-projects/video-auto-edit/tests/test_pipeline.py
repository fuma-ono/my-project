"""パイプライン全体(偽の文字起こし): AC-V5, AC-E1, AC-E3, AC-A2, AC-S6"""
import hashlib
import os

import pytest

from vae import errors, pipeline, testing


def _sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


@pytest.fixture(scope="module")
def run_result(tmp_path_factory, speechy_video, bgm_cache):
    d = tmp_path_factory.mktemp("run")
    before = _sha(speechy_video)
    plan, res = pipeline.run(speechy_video, str(d / "out.mp4"), str(d / "work"), pipeline.Settings(),
                             transcriber=testing.FakeTranscriber(), vad_fn=testing.energy_vad, bgm_cache=bgm_cache)
    return d, plan, res, before


def test_ac_v5_source_unchanged(run_result, speechy_video):
    _, _, _, before = run_result
    assert _sha(speechy_video) == before


def test_ac_a2_silence_is_cut(run_result):
    _, plan, res, _ = run_result
    assert plan["out_duration"] < plan["source"]["duration"] - 1.5
    assert res["verify"]["ok"], res["verify"]                      # AC-E1, AC-V2


def test_ac_e3_work_dir_cleaned(run_result):
    d, _, _, _ = run_result
    left = sorted(os.listdir(d / "work"))
    assert not [f for f in left if f.endswith((".wav", ".part.mp4"))], left
    assert "plan.json" in left and "result.json" in left


def test_ac_b3_cost_and_timings_recorded(run_result):
    _, _, res, _ = run_result
    assert res["external_cost_jpy"] == 0
    assert res["render"]["ffmpeg_peak_mb"] > 0 and "render" in res["timings_sec"]


def test_ac_s6_edit_subtitle_and_rerender(run_result, speechy_video, bgm_cache):
    d, plan, _, _ = run_result
    sub = plan["subtitles"][0]
    ev = pipeline.edit_subtitle(plan, sub["id"], "修正したテロップ")
    assert ev["lines"] == ["修正したテロップ"] and ev["edited"]
    res2 = pipeline.render_plan(plan, speechy_video, str(d / "out2.mp4"), str(d / "work"), bgm_cache=bgm_cache)
    assert res2["verify"]["ok"]
    ass = open(d / "work" / "subs.ass", encoding="utf-8").read()
    assert "修正したテロップ" in ass


def test_no_speech_raises(tmp_path, bgm_cache):
    p = testing.make_video(str(tmp_path / "quiet.mp4"), [(3.0, False)], size=(320, 180))
    with pytest.raises(errors.VAEError) as e:
        pipeline.run(p, str(tmp_path / "o.mp4"), str(tmp_path / "w"), transcriber=testing.FakeTranscriber(),
                     vad_fn=testing.energy_vad, bgm_cache=bgm_cache)
    assert e.value.code == "no_speech"
    assert not os.path.exists(tmp_path / "o.mp4")
