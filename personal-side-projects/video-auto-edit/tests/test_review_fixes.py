"""独立レビュー(2026-11-21)の指摘に対する回帰テスト: M1, M2, M3, m7, m8, m10, m11, m13"""
import errno
import os
import sys
import time

import pytest

from vae import errors, jobs, pipeline, proc, render, subtitles, testing


@pytest.fixture()
def store(tmp_path):
    return jobs.JobStore(str(tmp_path / "data"), transcriber_factory=testing.fake_factory, vad_fn=testing.energy_vad,
                         min_free_gb=0)


def test_m1_render_failure_keeps_job_retryable(store, speechy_video, monkeypatch):
    j = store.create(speechy_video, "a.mp4", "free")
    assert store.run_all(j["id"])
    out = store.paths(j["id"])["output"]
    before = open(out, "rb").read()
    real = render.render_video

    def boom(*a, **k):
        raise proc.ProcError(["ffmpeg"], 1, "injected failure")
    monkeypatch.setattr(render, "render_video", boom)
    assert store.run_render(j["id"]) is False
    job = store.get(j["id"])
    assert job["state"] == "done" and job["error"]["phase"] == "render"     # 以前の出力を引き続き取り出せる
    assert open(out, "rb").read() == before
    assert not [f for f in os.listdir(os.path.dirname(out)) if f.endswith(".part.mp4")]   # m7
    monkeypatch.setattr(render, "render_video", real)
    store.begin_render(j["id"]).get("state")                                   # やり直せる
    for _ in range(600):
        if store.get(j["id"])["state"] != "rendering":
            break
        time.sleep(0.1)
    assert store.get(j["id"])["state"] == "done" and store.get(j["id"])["error"] is None


def test_m1_first_render_failure_returns_to_ready(store, speechy_video, monkeypatch):
    j = store.create(speechy_video, "a.mp4", "free")
    assert store.run_analyze(j["id"])
    monkeypatch.setattr(render, "render_video", lambda *a, **k: (_ for _ in ()).throw(proc.ProcError(["ffmpeg"], 1, "x")))
    assert store.run_render(j["id"]) is False
    job = store.get(j["id"])
    assert job["state"] == "ready" and job["error"]["phase"] == "render"
    assert os.path.exists(store.paths(j["id"])["plan"])                       # 字幕の修正を含む計画が残る


def test_m3_ass_injection_is_escaped():
    ass = subtitles.to_ass([dict(s=0, e=1, lines=["A{\\fs400}B", "C\\ND"])], 720, 1280, 54, 4, 22, 90)
    body = [l for l in ass.splitlines() if l.startswith("Dialogue:")][0].split(",", 9)[9]
    assert "{" not in body and "}" not in body
    assert body.count("\\N") == 1                                             # 改行は区切りの1つだけ
    assert "｛＼fs400｝" in body


def test_m3_braces_are_rendered_as_text(tmp_path, speechy_video, bgm_cache):
    plan, _ = pipeline.run(speechy_video, str(tmp_path / "o.mp4"), str(tmp_path / "w"), transcriber=testing.FakeTranscriber(),
                           vad_fn=testing.energy_vad, bgm_cache=bgm_cache)
    pipeline.edit_subtitle(plan, plan["subtitles"][0]["id"], "{笑}テスト")
    res = pipeline.render_plan(plan, speechy_video, str(tmp_path / "o2.mp4"), str(tmp_path / "w"), bgm_cache=bgm_cache)
    assert res["verify"]["ok"]
    assert "｛笑｝テスト" in open(tmp_path / "w" / "subs.ass", encoding="utf-8").read()


def test_m8_odd_dimensions_render(tmp_path, bgm_cache):
    src = testing.make_video(str(tmp_path / "odd.webm"), [(0.5, False), (1.5, True), (0.6, False), (1.2, True)],
                             size=(361, 641), codec="libvpx-vp9", acodec="libopus",
                             ext_args=("-deadline", "realtime", "-cpu-used", "8"))
    plan, res = pipeline.run(src, str(tmp_path / "o.mp4"), str(tmp_path / "w"), transcriber=testing.FakeTranscriber(),
                             vad_fn=testing.energy_vad, bgm_cache=bgm_cache)
    assert res["verify"]["ok"] and (res["verify"]["width"], res["verify"]["height"]) == (360, 640)


def test_n15_work_path_with_quote(tmp_path, speechy_video, bgm_cache):
    w = tmp_path / "it's work"
    _, res = pipeline.run(speechy_video, str(tmp_path / "o.mp4"), str(w), transcriber=testing.FakeTranscriber(),
                          vad_fn=testing.energy_vad, bgm_cache=bgm_cache)
    assert res["verify"]["ok"]


def test_m2_timeout_kills_process():
    t = time.time()
    with pytest.raises(proc.Timeout):
        proc.run([sys.executable, "-c", "import time; time.sleep(30)"], timeout=1)
    assert time.time() - t < 10
    with pytest.raises(proc.Timeout):
        proc.run_stderr([sys.executable, "-c", "import time; time.sleep(30)"], timeout=1)


def test_m2_no_direct_subprocess_outside_proc():
    """FFmpeg などの外部プロセスは vae.proc 経由(development.md 規則4)"""
    root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "vae")
    bad = []
    for dirpath, _, files in os.walk(root):
        for f in files:
            if f.endswith(".py") and f not in ("proc.py", "testing.py"):
                text = open(os.path.join(dirpath, f), encoding="utf-8").read()
                if "subprocess.run(" in text or "subprocess.Popen(" in text:
                    bad.append(f)
    assert bad == []


def test_m10_delete_busy_job_is_refused(store, speechy_video):
    j = store.create(speechy_video, "a.mp4", "free")
    with pytest.raises(ValueError):
        store.delete(j["id"])                                                 # queued
    store.delete(j["id"], force=True)


def test_m11_verify_failure_is_error(tmp_path, speechy_video, bgm_cache, monkeypatch):
    plan = pipeline.analyze(speechy_video, str(tmp_path / "w"), transcriber=testing.FakeTranscriber(), vad_fn=testing.energy_vad)
    real = render.verify
    monkeypatch.setattr(render, "verify", lambda *a, **k: dict(real(*a, **k), ok=False,
                                                              checks={"frames_match": False}))
    with pytest.raises(errors.VAEError) as e:
        pipeline.render_plan(plan, speechy_video, str(tmp_path / "o.mp4"), str(tmp_path / "w"), bgm_cache=bgm_cache)
    assert e.value.code == "verify_failed"


def test_m13_cli_removes_temp_work(tmp_path, monkeypatch, speechy_video):
    import tempfile
    from vae import cli
    made = []
    orig = tempfile.mkdtemp
    monkeypatch.setattr(tempfile, "mkdtemp", lambda *a, **k: made.append(orig(*a, **k)) or made[-1])
    monkeypatch.setattr(pipeline, "run", lambda *a, **k: (_ for _ in ()).throw(errors.no_speech()))
    assert cli.main(["run", speechy_video, "-o", str(tmp_path / "o.mp4")]) == 1
    assert made and not os.path.exists(made[0])


# --- 独立レビュー2回目の指摘(N1〜N5) ---
def test_n2_rerender_verify_failure_keeps_previous_output(store, speechy_video, monkeypatch):
    j = store.create(speechy_video, "a.mp4", "free")
    assert store.run_all(j["id"])
    out = store.paths(j["id"])["output"]
    before = open(out, "rb").read()
    real = render.verify

    def bad(path, **k):
        r = real(path, **k)
        r["checks"]["frames_match"] = False
        r["ok"] = False
        return r
    monkeypatch.setattr(render, "verify", bad)
    assert store.run_render(j["id"]) is False
    job = store.get(j["id"])
    assert job["state"] == "done" and job["stage"] == "render_failed" and job["error"]["code"] == "verify_failed"
    assert open(out, "rb").read() == before                                   # 不合格の出力で上書きしない
    assert not os.path.exists(os.path.join(store.paths(j["id"])["work"], "candidate.mp4"))


def test_n1_api_exposes_render_failure(store, speechy_video, monkeypatch):
    j = store.create(speechy_video, "a.mp4", "free")
    assert store.run_analyze(j["id"])
    monkeypatch.setattr(render, "render_video", lambda *a, **k: (_ for _ in ()).throw(proc.ProcError(["ffmpeg"], 1, "x")))
    assert store.run_render(j["id"]) is False
    pub = store.get(j["id"])
    assert pub["stage"] == "render_failed" and pub["error"]["message"]        # UI はこの2つで失敗を表示する


def test_n4_width_measured_after_escape():
    m = subtitles.Measurer(54, 4)
    assert m.width("{a}") == m.width("｛a｝")


def test_n5_ass_name_must_be_safe(tmp_path):
    with pytest.raises(ValueError):
        render.render_video("x.mp4", [(0, 1)], render.Fraction(30), "a.wav", str(tmp_path / "o.mp4"), str(tmp_path),
                            ass=str(tmp_path / "su b's.ass"))


# --- 独立レビュー3回目の指摘(m1, m3, m4) ---
@pytest.mark.parametrize("method", ["select", "legacy", "segments"])
def test_r3_m1_render_with_ass_in_odd_work_dir(tmp_path, method):
    """作業フォルダのパスに ' , : や空白があっても、3方式とも字幕付きで書き出せる"""
    src = str(tmp_path / "src.mp4")
    testing.make_video(src, [(2, True)], size=(160, 120))
    work = tmp_path / "w o'rk,x:y"
    work.mkdir()
    wav = str(work / "a.wav")
    proc.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "1", wav], timeout=60)
    ass = str(work / "subs.ass")
    with open(ass, "w", encoding="utf-8") as f:
        f.write(subtitles.to_ass([dict(s=0, e=1, lines=["テスト"])], 160, 120, 20, 2, 8, 10))
    out = str(work / "o.mp4")
    render.render_video(src, [(0, 15), (30, 45)], render.Fraction(30), wav, out, str(work), method=method, ass=ass)
    assert os.path.getsize(out) > 0
    assert render.verify(out)["frames"] == 30


def test_r3_m3_output_on_other_filesystem(tmp_path, monkeypatch):
    src, dst = tmp_path / "c.mp4", tmp_path / "out.mp4"
    src.write_bytes(b"new")
    dst.write_bytes(b"old")
    real = os.replace

    def exdev(a, b):
        if str(a) == str(src):
            raise OSError(errno.EXDEV, "cross-device link")
        return real(a, b)
    monkeypatch.setattr(pipeline.os, "replace", exdev)
    pipeline._move_into_place(str(src), str(dst))
    assert dst.read_bytes() == b"new" and not src.exists() and not os.path.exists(str(dst) + ".part")
