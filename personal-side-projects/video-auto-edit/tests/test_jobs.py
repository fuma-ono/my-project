"""ジョブ・料金プラン: AC-B1, AC-B2, AC-B4, AC-E3, AC-V6"""
import os
import time

import pytest

from vae import errors, jobs, plans, testing


@pytest.fixture()
def store(tmp_path):
    return jobs.JobStore(str(tmp_path / "data"), transcriber_factory=testing.fake_factory, vad_fn=testing.energy_vad,
                         min_free_gb=0)


def test_ac_b1_free_plan_rejects_over_30s(store, tmp_path):
    p = testing.make_video(str(tmp_path / "long.mp4"), [(31.0, True)], size=(160, 90))
    with pytest.raises(errors.VAEError) as e:
        store.create(p, "long.mp4", "free")
    assert e.value.code == "over_plan_limit"
    assert os.listdir(store.jobs_dir) == []                     # 受付に失敗したら残さない


def test_ac_b2_plans_are_configurable():
    """プランの上限は config/plans.json で決める(料金仕様 v1)"""
    assert plans.get("free").max_project_seconds == 30
    assert plans.get("standard").max_project_seconds == 180
    assert plans.get("pro").max_project_seconds == 600
    assert plans.get("unknown").name == "free"


def test_ac_b4_duplicate_content_reuses_job(store, speechy_video):
    j1 = store.create(speechy_video, "a.mp4", "free", client_id="c1")
    j2 = store.create(speechy_video, "b.mp4", "free", client_id="c1")
    assert j2["id"] == j1["id"] and j2.get("duplicate")
    # 同じ動画の再送は利用枠を使わない
    assert store.account_status("c1")["new_edits_used"] == 1


def test_filename_is_not_used_as_path(store, speechy_video):
    j = store.create(speechy_video, "../../evil.mp4", "free")
    p = store.paths(j["id"])
    assert os.path.dirname(p["input"]) == p["dir"] and os.path.basename(p["input"]) == "input.mp4"
    with pytest.raises(KeyError):
        store.get("../etc")


def test_ac_e3_job_runs_and_expires(store, speechy_video):
    j = store.create(speechy_video, "a.mp4", "free")
    assert store.run_all(j["id"])
    done = store.get(j["id"])
    assert done["state"] == "done" and done["result"]["verify"]["ok"]
    assert store.cleanup_expired(now=time.time() + 25 * 3600) == [j["id"]]
    assert not os.path.exists(os.path.join(store.jobs_dir, j["id"]))


def test_ac_v6_error_job_reports_hint(store, tmp_path):
    p = testing.make_video(str(tmp_path / "quiet.mp4"), [(3.0, False)], size=(160, 90))
    j = store.create(p, "quiet.mp4", "free")
    assert store.run_all(j["id"]) is False
    e = store.get(j["id"])
    assert e["state"] == "error" and e["error"]["code"] == "no_speech" and e["error"]["hint"]


def test_disk_guard(tmp_path, speechy_video):
    s = jobs.JobStore(str(tmp_path / "d3"), min_free_gb=10 ** 6)
    with pytest.raises(errors.VAEError) as e:
        s.create(speechy_video, "a.mp4")
    assert e.value.code == "disk_full"


def test_duplicate_detection_is_per_client(store, speechy_video):
    j1 = store.create(speechy_video, "a.mp4", "free", client_id="c1")
    j2 = store.create(speechy_video, "a.mp4", "free", client_id="c2")
    assert j2["id"] != j1["id"] and not j2.get("duplicate")


def test_recover_stale_jobs(tmp_path, speechy_video):
    root = str(tmp_path / "d4")
    s = jobs.JobStore(root, min_free_gb=0)
    j = s.create(speechy_video, "a.mp4", "free")
    s._update(j["id"], state="analyzing")
    s2 = jobs.JobStore(root, min_free_gb=0)               # 再起動
    e = s2.get(j["id"])
    assert e["state"] == "error" and e["error"]["code"] == "interrupted"


def test_begin_render_rejects_wrong_state(store, speechy_video):
    j = store.create(speechy_video, "a.mp4", "free")
    with pytest.raises(ValueError):
        store.begin_render(j["id"])                         # まだ解析していない
