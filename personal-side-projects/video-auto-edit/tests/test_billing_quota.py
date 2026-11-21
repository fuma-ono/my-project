"""料金・利用制限(仕様 v1)のサーバー側の利用枠: AC-P1〜AC-P9, AC-P16"""
import os
import threading
import time

import pytest

from vae import errors, jobs, pipeline, testing
from vae.billing import config as bconfig
from vae.billing import store as bstore

STD = "com.example.videoautoedit.standard.monthly"
PRO = "com.example.videoautoedit.pro.monthly"


class CountingFactory:
    def __init__(self):
        self.calls = 0

    def __call__(self, model=None):
        fake = testing.FakeTranscriber()

        def transcribe(audio):                     # 実際に文字起こしをした回数を数える
            self.calls += 1
            return fake(audio)
        return transcribe


@pytest.fixture()
def factory():
    return CountingFactory()


@pytest.fixture()
def store(tmp_path, factory):
    return jobs.JobStore(str(tmp_path / "data"), transcriber_factory=factory, vad_fn=testing.energy_vad, min_free_gb=0)


def _video(tmp_path, name, segs=((0.5, False), (1.5, True), (0.6, False)), size=(160, 284), tone=220):
    return testing.make_video(str(tmp_path / name), list(segs), size=size, tone_hz=tone)


def _grant(store, client, product, days=30):
    acc = store.account_for(client)
    store.billing.upsert_subscription(acc["id"], f"ot-{client}-{product}", product, time.time() + days * 86400, source="dev")
    return acc


# ------------------------------------------------------------ AC-P1 設定
def test_ac_p1_limits_come_from_config():
    cfg = bconfig.load()
    f, s, p = cfg.plan("free"), cfg.plan("standard"), cfg.plan("pro")
    assert (f.max_project_seconds, f.monthly_new_edits, f.reedits_per_project, f.max_short_side) == (30, 3, 1, 720)
    assert (s.max_project_seconds, s.monthly_new_edits, s.reedits_per_project, s.max_short_side, s.price_jpy) == (180, 15, 3, 1080, 980)
    assert (p.max_project_seconds, p.monthly_new_edits, p.reedits_per_project, p.price_jpy) == (600, 40, 5, 1980)
    assert not f.multi_video and s.multi_video and p.multi_video and p.priority > s.priority > f.priority
    assert cfg.plan_for_product(PRO).name == "pro" and cfg.plan_for_product("unknown") is None


# ------------------------------------------------------------ AC-P2 新規編集の月間上限
def test_ac_p2_monthly_new_edit_limit_no_auto_charge(store, tmp_path):
    for i in range(3):
        store.create(_video(tmp_path, f"v{i}.mp4", tone=200 + i * 37), "a.mp4", client_id="c1")
    with pytest.raises(errors.VAEError) as e:
        store.create(_video(tmp_path, "v9.mp4", tone=900), "a.mp4", client_id="c1")
    d = e.value.to_dict()
    assert d["code"] == "limit_reached" and d["kind"] == "new_edit" and d["limit"] == 3 and d["upgrade"]
    assert "自動で課金されることはありません" in d["hint"]
    acc = store.account_for("c1")
    assert store.billing.active_subscriptions(acc["id"]) == []          # 上限到達で購読は作られない
    assert len(store.list()) == 3                                       # 上限で拒否した受付は残さない


def test_ac_p2_month_rolls_over_in_jst(tmp_path):
    b = bstore.BillingStore(str(tmp_path / "x.db"), bconfig.load())
    acc = b.account_for_client("c")
    # 2026-11-30 15:30 UTC = 2026-12-01 00:30 JST(日本時間の暦月で数える)
    nov = time.mktime((2026, 11, 30, 14, 0, 0, 0, 0, 0)) - time.timezone
    dec = time.mktime((2026, 11, 30, 15, 30, 0, 0, 0, 0)) - time.timezone
    assert b.period(nov) == "2026-11" and b.period(dec) == "2026-12"
    for i in range(3):
        b.reserve(acc["id"], b.create_project(acc["id"]), "new_edit", now=nov)
    with pytest.raises(bstore.LimitReached):
        b.reserve(acc["id"], b.create_project(acc["id"]), "new_edit", now=nov)
    assert b.reserve(acc["id"], b.create_project(acc["id"]), "new_edit", now=dec)["status"] == "reserved"


def test_ac_p2_upgrade_raises_limits(store, tmp_path):
    _grant(store, "c1", STD)
    assert store.account_status("c1")["plan"]["name"] == "standard"
    assert store.account_status("c1")["new_edits_remaining"] == 15


# ------------------------------------------------------------ AC-P3, AC-P8 AI 再編集
def test_ac_p3_p8_reedit_consumes_keeps_versions_and_reuses_transcript(store, tmp_path, factory):
    j = store.create(_video(tmp_path, "r.mp4"), "r.mp4", client_id="c1")
    assert store.run_all(j["id"])
    src_hash = j["hash"]
    first = open(store.paths(j["id"])["output"], "rb").read()
    calls = factory.calls
    st = store.account_status("c1", [j["id"]])
    assert st["new_edits_used"] == 1 and st["projects"][j["id"]]["reedits_remaining"] == 1
    # 同じ設定の再編集は処理せず、回数も使わない
    same = store.begin_reedit(j["id"], "c1", concept="standard")
    assert same.get("no_change")
    # コンセプトを変えた再編集(FREE でも使える basic のコンセプト)
    store.begin_reedit(j["id"], "c1", concept="tempo", idempotency_key="re-1")
    _wait(store, j["id"])
    job = store.get(j["id"])
    assert job["state"] == "done" and job["settings"]["concept"] == "tempo" and job["error"] is None
    assert factory.calls == calls                                     # 文字起こしをやり直していない(AC-P8)
    assert len(job["versions"]) == 1                                   # 修正前の完成動画を保持(AC-P8)
    v1 = os.path.join(store.paths(j["id"])["versions"], job["versions"][0]["name"])
    assert open(v1, "rb").read() == first
    assert os.path.exists(store.paths(j["id"])["input"]) and job["hash"] == src_hash   # 元動画も保持
    assert store.account_status("c1", [j["id"]])["projects"][j["id"]]["reedits_remaining"] == 0
    # 冪等: 同じキーの再送は二重に数えない
    again = store.begin_reedit(j["id"], "c1", concept="tempo", idempotency_key="re-1")
    assert again.get("duplicate")
    # 上限
    with pytest.raises(errors.VAEError) as e:
        store.begin_reedit(j["id"], "c1", concept="standard")
    assert e.value.code == "limit_reached" and e.value.extra["kind"] == "reedit"
    # FREE では使えないコンセプト
    with pytest.raises(errors.VAEError) as e2:
        store.begin_reedit(j["id"], "c1", concept="calm")
    assert e2.value.code == "concept_unavailable"


def test_ac_p3_manual_subtitle_render_does_not_consume(store, tmp_path):
    j = store.create(_video(tmp_path, "m.mp4"), "m.mp4", client_id="c1")
    assert store.run_all(j["id"])
    p = store.paths(j["id"])
    plan = pipeline.load_plan(p["plan"])
    if plan["subtitles"]:
        pipeline.edit_subtitle(plan, plan["subtitles"][0]["id"], "手で直した字幕")
        pipeline.save_plan(plan, p["plan"])
    store.begin_render(j["id"])
    _wait(store, j["id"])
    st = store.account_status("c1", [j["id"]])
    assert store.get(j["id"])["state"] == "done"
    assert st["new_edits_used"] == 1 and st["projects"][j["id"]]["reedits_used"] == 0
    kinds = [r["run_kind"] for r in store.billing.cost_summary()["groups"]]
    assert "manual_render" in kinds


# ------------------------------------------------------------ AC-P4 失敗・キャンセル・中断の返却
def test_ac_p4_failed_analysis_releases(store, tmp_path, monkeypatch):
    def boom(*a, **k):
        raise errors.no_speech()
    monkeypatch.setattr(pipeline, "analyze", boom)
    j = store.create(_video(tmp_path, "f.mp4"), "f.mp4", client_id="c1")
    assert store.run_analyze(j["id"]) is False
    assert store.get(j["id"])["state"] == "error"
    assert store.account_status("c1")["new_edits_used"] == 0


def test_ac_p4_failed_reedit_releases_and_restores(store, tmp_path, monkeypatch):
    j = store.create(_video(tmp_path, "g.mp4"), "g.mp4", client_id="c1")
    assert store.run_all(j["id"])
    before = open(store.paths(j["id"])["output"], "rb").read()
    plan_before = pipeline.load_plan(store.paths(j["id"])["plan"])
    from vae import render

    def boom(*a, **k):
        raise errors.VAEError("verify_failed", "x", "y")
    monkeypatch.setattr(render, "render_video", boom)
    store.begin_reedit(j["id"], "c1", concept="tempo")
    _wait(store, j["id"])
    job = store.get(j["id"])
    assert job["state"] == "done" and job["stage"] == "reedit_failed" and job["error"]
    assert job["settings"]["concept"] == "standard" and job["versions"] == []
    assert open(store.paths(j["id"])["output"], "rb").read() == before
    assert pipeline.load_plan(store.paths(j["id"])["plan"])["settings"] == plan_before["settings"]
    assert store.account_status("c1", [j["id"]])["projects"][j["id"]]["reedits_used"] == 0   # 返却された


def test_ac_p4_cancel_and_delete_before_success_release(store, tmp_path):
    j = store.create(_video(tmp_path, "d.mp4"), "d.mp4", client_id="c1")
    assert store.account_status("c1")["new_edits_used"] == 1
    assert store.cancel(j["id"])                                       # 開始前のキャンセル
    assert store.run_analyze(j["id"]) is False
    job = store.get(j["id"])
    assert job["state"] == "error" and job["error"]["code"] == "cancelled"
    assert store.account_status("c1")["new_edits_used"] == 0
    j2 = store.create(_video(tmp_path, "d2.mp4", tone=640), "d2.mp4", client_id="c1")
    assert store.run_analyze(j2["id"])
    store.delete(j2["id"])                                             # 書き出し前に削除
    assert store.account_status("c1")["new_edits_used"] == 0


def test_ac_p4_cancel_during_render_releases_and_rereserves(store, tmp_path):
    j = store.create(_video(tmp_path, "cr.mp4"), "cr.mp4", client_id="c1")
    assert store.run_analyze(j["id"])
    store._update(j["id"], state="rendering")
    store.cancel(j["id"])
    assert store.run_render(j["id"]) is False
    job = store.get(j["id"])
    assert job["state"] == "ready" and job["error"]["code"] == "cancelled" and job["usage_id"] is None
    assert store.account_status("c1")["new_edits_used"] == 0
    store.begin_render(j["id"])                                        # 書き出し直すと予約し直す
    _wait(store, j["id"])
    assert store.get(j["id"])["state"] == "done"
    assert store.account_status("c1")["new_edits_used"] == 1


def test_ac_p4_restart_releases_interrupted(tmp_path, factory):
    root = str(tmp_path / "data")
    s1 = jobs.JobStore(root, transcriber_factory=factory, vad_fn=testing.energy_vad, min_free_gb=0)
    j = s1.create(_video(tmp_path, "i.mp4"), "i.mp4", client_id="c1")
    s1._update(j["id"], state="analyzing")                  # 解析の途中でサーバーが止まった
    orphan = s1.billing.reserve(s1.account_for("c1")["id"], s1.billing.create_project(s1.account_for("c1")["id"]), "new_edit")
    s2 = jobs.JobStore(root, transcriber_factory=factory, vad_fn=testing.energy_vad, min_free_gb=0)
    assert s2.get(j["id"])["state"] == "error"
    assert s2.billing.usage(orphan["id"])["status"] == "released"
    assert s2.account_status("c1")["new_edits_used"] == 0


def test_ac_p4_render_failure_keeps_reservation_until_success(store, tmp_path, monkeypatch):
    from vae import render
    j = store.create(_video(tmp_path, "h.mp4"), "h.mp4", client_id="c1")
    assert store.run_analyze(j["id"])
    real = render.render_video
    monkeypatch.setattr(render, "render_video", lambda *a, **k: (_ for _ in ()).throw(errors.VAEError("x", "y")))
    assert store.run_render(j["id"]) is False
    u = store.billing.usage(store.get(j["id"])["usage_id"])
    assert u["status"] == "reserved"                       # やり直せる間は予約のまま(消費していない)
    monkeypatch.setattr(render, "render_video", real)
    assert store.run_render(j["id"])
    assert store.billing.usage(u["id"])["status"] == "consumed"


# ------------------------------------------------------------ AC-P5 同時リクエスト・リトライ
def test_ac_p5_concurrent_reservations_do_not_exceed_limit(tmp_path):
    b = bstore.BillingStore(str(tmp_path / "x.db"), bconfig.load())
    acc = b.account_for_client("c")
    out = []

    def go(i):
        try:
            out.append(b.reserve(acc["id"], b.create_project(acc["id"]), "new_edit", f"k{i}")["id"])
        except bstore.LimitReached:
            out.append(None)
    ths = [threading.Thread(target=go, args=(i,)) for i in range(12)]
    [t.start() for t in ths]
    [t.join() for t in ths]
    assert len([x for x in out if x]) == 3


def test_ac_p5_retry_with_same_key_returns_same_job(store, tmp_path):
    v = _video(tmp_path, "k.mp4")
    j1 = store.create(v, "k.mp4", client_id="c1", idempotency_key="upload-1")
    j2 = store.create(_video(tmp_path, "k2.mp4", tone=500), "k.mp4", client_id="c1", idempotency_key="upload-1")
    assert j2["id"] == j1["id"] and j2.get("duplicate")
    assert store.account_status("c1")["new_edits_used"] == 1


def test_ac_p5_consume_release_are_final(tmp_path):
    b = bstore.BillingStore(str(tmp_path / "x.db"), bconfig.load())
    acc = b.account_for_client("c")
    u = b.reserve(acc["id"], b.create_project(acc["id"]), "new_edit")
    assert b.consume(u["id"]) == "consumed"
    assert b.release(u["id"], "late") == "consumed"            # 消費済みを返却しない(二重の扱いを防ぐ)


# ------------------------------------------------------------ AC-P6 元動画の合計時間・複数動画
def test_ac_p6_project_length_checked_on_server(store, tmp_path):
    long = _video(tmp_path, "long.mp4", segs=((31.0, True),), size=(64, 64))
    with pytest.raises(errors.VAEError) as e:
        store.create(long, "long.mp4", client_id="c1")
    assert e.value.code == "over_plan_limit"
    assert store.account_status("c1")["new_edits_used"] == 0
    _grant(store, "c1", STD)
    j = store.create(long, "long.mp4", client_id="c1")                  # STANDARD(3分)なら受け付ける
    assert j["plan"] == "standard"


def test_ac_p6_multi_video_and_total(tmp_path):
    cfg = bconfig.load()
    b = bstore.BillingStore(str(tmp_path / "x.db"), cfg)
    acc = b.account_for_client("c")
    p = b.create_project(acc["id"])
    b.add_video(p, 20, cfg.plan("free"))
    with pytest.raises(bstore.MultiVideoNotAllowed):
        b.add_video(p, 5, cfg.plan("free"))
    q = b.create_project(acc["id"])
    b.add_video(q, 100, cfg.plan("standard"))
    b.add_video(q, 70, cfg.plan("standard"))
    with pytest.raises(bstore.ProjectTooLong):
        b.add_video(q, 20, cfg.plan("standard"))                       # 合計190秒 > 180秒


def test_ac_p6_reedit_after_downgrade_is_blocked(store, tmp_path):
    long = _video(tmp_path, "dl.mp4", segs=((0.5, False), (31.0, True)), size=(64, 64))
    acc = _grant(store, "c1", STD, days=30)
    j = store.create(long, "dl.mp4", client_id="c1")
    assert store.run_all(j["id"])
    store.billing.update_subscription(f"ot-c1-{STD}", expires_at=time.time() - 1)   # 期間が終わった
    assert store.billing.effective_plan(acc["id"])[0].name == "free"
    with pytest.raises(errors.VAEError) as e:
        store.begin_reedit(j["id"], "c1", concept="tempo")
    assert e.value.code == "over_plan_limit" and e.value.extra["upgrade"]
    assert os.path.exists(store.paths(j["id"])["output"])             # 作った動画はそのまま取り出せる


# ------------------------------------------------------------ AC-P7 書き出しの解像度
def test_ac_p7_free_exports_720p(store, tmp_path):
    j = store.create(_video(tmp_path, "hd.mp4", size=(1080, 1920)), "hd.mp4", client_id="c1")
    assert store.run_all(j["id"])
    res = store.get(j["id"])["result"]
    assert res["output_size"] == [720, 1280] and res["resolution_class"] == "720p" and res["verify"]["ok"]


def test_ac_p7_paid_keeps_1080p_and_never_upscales(store, tmp_path):
    _grant(store, "c1", STD)
    j = store.create(_video(tmp_path, "hd2.mp4", size=(1080, 1920)), "hd2.mp4", client_id="c1")
    assert store.run_all(j["id"])
    assert store.get(j["id"])["result"]["output_size"] == [1080, 1920]
    assert pipeline.output_size(360, 640, 1080) == (360, 640)            # 拡大しない
    assert pipeline.output_size(3840, 2160, 1080) == (1920, 1080)
    assert pipeline.output_size(1921, 1081, 720) == (1280, 720)


def test_ac_p7_4k_only_when_enabled(tmp_path, factory):
    import dataclasses
    cfg = dataclasses.replace(bconfig.load(), allow_4k=True)
    s = jobs.JobStore(str(tmp_path / "data"), transcriber_factory=factory, vad_fn=testing.energy_vad, min_free_gb=0,
                      billing_config=cfg)
    pro, std = cfg.plan("pro"), cfg.plan("standard")
    uhd = {"media": {"width": 3840, "height": 2160}}
    assert s._short_side_for(pro, uhd) == 2160 and s._short_side_for(std, uhd) == 1080
    assert s._short_side_for(pro, {"media": {"width": 1920, "height": 1080}}) == 1080
    off = jobs.JobStore(str(tmp_path / "d2"), min_free_gb=0)                 # 既定は allow_4k=false
    assert off._short_side_for(pro, uhd) == 1080


# ------------------------------------------------------------ AC-P9 原価
def test_ac_p9_cost_records_by_kind_and_plan(store, tmp_path):
    j = store.create(_video(tmp_path, "c.mp4"), "c.mp4", client_id="c1")
    assert store.run_all(j["id"])
    store.begin_reedit(j["id"], "c1", concept="tempo")
    _wait(store, j["id"])
    s = store.billing.cost_summary()
    kinds = {(g["plan"], g["run_kind"], g["status"]) for g in s["groups"]}
    assert ("free", "new_edit", "ok") in kinds and ("free", "reedit", "ok") in kinds
    rows = store.billing._conn().execute("SELECT * FROM cost_records").fetchall()
    assert all(r["wall_seconds"] > 0 and r["cpu_seconds"] >= 0 and r["api_cost_jpy"] == 0 for r in rows)
    assert all(r["resolution_class"] for r in rows if r["status"] == "ok")
    assert set(s["margin"]) == {"free", "standard", "pro"}


# ------------------------------------------------------------ AC-P16 優先処理
def test_ac_p16_priority_gate_serves_pro_first():
    g = jobs.PriorityGate()
    g.acquire(0)                                       # 実行中のジョブ
    order = []

    def waiter(name, prio):
        g.acquire(prio)
        order.append(name)
        g.release()
    ths = [threading.Thread(target=waiter, args=("free", 0)), threading.Thread(target=waiter, args=("pro", 2)),
           threading.Thread(target=waiter, args=("std", 1))]
    for t in ths:
        t.start()
        time.sleep(0.05)
    g.release()
    for t in ths:
        t.join()
    assert order == ["pro", "std", "free"]


def _wait(store, job_id, timeout=120):
    t0 = time.time()
    while time.time() - t0 < timeout:
        st = store.get(job_id)["state"]
        if st in ("done", "error"):
            time.sleep(0.05)
            if store.get(job_id)["state"] in ("done", "error"):
                return
        time.sleep(0.1)
    raise TimeoutError(job_id)
