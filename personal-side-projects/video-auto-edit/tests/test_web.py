"""Web API のテスト(AC-U1〜U5, AC-S6, AC-B1)。Whisper は使わず、偽の文字起こしと音量 VAD で動かす"""
import http.client
import json
import os
import threading
import time
import urllib.parse

import pytest

from vae import testing
from vae.jobs import JobStore
from vae.web import server as web

CLIENT_A = "a" * 32
CLIENT_B = "b" * 32
SEGMENTS = [(0.5, False), (1.2, True), (0.8, False), (1.0, True), (0.7, False), (1.3, True), (0.5, False)]  # 6.0 秒


@pytest.fixture(scope="module")
def srv(tmp_path_factory):
    root = tmp_path_factory.mktemp("web")
    store = JobStore(str(root / "data"), transcriber_factory=testing.fake_factory, vad_fn=testing.energy_vad,
                     min_free_gb=0.0)
    s = web.make_server("127.0.0.1", 0, store)
    th = threading.Thread(target=s.serve_forever, daemon=True)
    th.start()
    vids = root / "videos"
    vids.mkdir()
    yield {"port": s.server_address[1], "store": store, "vids": vids}
    s.shutdown()
    s.server_close()


def req(srv, method, path, body=None, headers=None, client=CLIENT_A):
    c = http.client.HTTPConnection("127.0.0.1", srv["port"], timeout=60)
    h = dict(headers or {})
    if client:
        h["Cookie"] = f"vae_client={client}"
    if isinstance(body, (dict, list)):
        body = json.dumps(body).encode()
        h.setdefault("Content-Type", "application/json")
    c.request(method, path, body=body, headers=h)
    r = c.getresponse()
    data = r.read()
    c.close()
    return r.status, dict(r.getheaders()), data


def jbody(data):
    return json.loads(data.decode("utf-8"))


def upload(srv, path, name=None, client=CLIENT_A, plan=None):
    with open(path, "rb") as f:
        data = f.read()
    h = {"X-Filename": urllib.parse.quote(name or os.path.basename(path)), "Content-Type": "application/octet-stream"}
    if plan:
        h["X-Plan"] = plan
    return req(srv, "POST", "/api/jobs", body=data, headers=h, client=client)


def wait_state(srv, job_id, states, timeout=120, client=CLIENT_A):
    t0 = time.time()
    while time.time() - t0 < timeout:
        st, _, data = req(srv, "GET", f"/api/jobs/{job_id}", client=client)
        assert st == 200
        job = jbody(data)
        if job["state"] in states:
            return job
        assert job["state"] != "error", job
        time.sleep(0.5)
    raise AssertionError(f"timeout waiting for {states}: {job}")


def test_index_and_plans_ac_u1_ac_b1(srv):
    st, h, data = req(srv, "GET", "/", client=None)
    assert st == 200 and h["Content-Type"].startswith("text/html")
    assert "30秒まで無料" in data.decode("utf-8")
    cookie = h.get("Set-Cookie", "")
    assert "vae_client=" in cookie and "HttpOnly" in cookie and "SameSite=Lax" in cookie
    st, _, data = req(srv, "GET", "/api/plans")
    d = jbody(data)
    plans = {p["name"]: p for p in d["plans"]}
    assert st == 200 and plans["free"]["max_project_seconds"] == 30.0 and plans["free"]["price_jpy"] == 0
    assert plans["standard"]["price_jpy"] == 980 and plans["pro"]["price_jpy"] == 1980      # 料金仕様 v1
    assert d["purchase_terms"] and any("自動" in t for t in d["purchase_terms"])            # 購入前に条件を示す(AC-P15)


def test_full_flow_upload_review_edit_render_ac_u1_to_u5_ac_s6(srv):
    src = testing.make_video(str(srv["vids"] / "talk.mp4"), SEGMENTS)
    # AC-U1: アップロード → 解析開始
    st, _, data = upload(srv, src, name="私の動画.mp4")
    assert st == 200, data
    job = jbody(data)
    assert "client_id" not in job and "hash" not in job and "path" not in job.get("media", {})
    assert job["filename"] == "私の動画.mp4"
    # AC-U2: 進捗を見ながら解析完了まで待つ
    job = wait_state(srv, job["id"], ("ready",))
    assert 0 < job["progress"] <= 1 and job["message"]
    jid = job["id"]
    # AC-U3: 字幕・言い淀み・長さ
    st, _, data = req(srv, "GET", f"/api/jobs/{jid}/plan")
    assert st == 200
    plan = jbody(data)
    assert plan["subtitles"], plan
    assert plan["out_duration"] < plan["source"]["duration"]
    assert "path" not in plan["source"]
    assert isinstance(plan["filler_candidates"], list)
    # 元動画のプレビュー(Range)
    st, h, data = req(srv, "GET", f"/api/jobs/{jid}/input", headers={"Range": "bytes=0-99"})
    assert st == 206 and len(data) == 100 and h["Content-Range"].startswith("bytes 0-99/")
    # AC-S6: 字幕の修正が保存される
    sub = plan["subtitles"][0]
    st, _, data = req(srv, "POST", f"/api/jobs/{jid}/subtitles/{sub['id']}", body={"text": "修正した字幕です"})
    assert st == 200, data
    ev = jbody(data)
    assert ev["edited"] and "".join(ev["lines"]) == "修正した字幕です"
    st, _, data = req(srv, "GET", f"/api/jobs/{jid}/plan")
    assert "".join(jbody(data)["subtitles"][0]["lines"]) == "修正した字幕です"
    st, _, _ = req(srv, "POST", f"/api/jobs/{jid}/subtitles/99999", body={"text": "x"})
    assert st == 404
    st, _, data = req(srv, "POST", f"/api/jobs/{jid}/subtitles/{sub['id']}", body={"text": "あ" * 201})
    assert st == 400 and jbody(data)["error"]["code"] == "subtitle_too_long"
    # 書き出し前は output が無い
    st, _, _ = req(srv, "GET", f"/api/jobs/{jid}/output")
    assert st == 404
    # AC-U4: 書き出し
    st, _, data = req(srv, "POST", f"/api/jobs/{jid}/render")
    assert st == 202 and jbody(data)["state"] == "rendering"
    st, _, data = req(srv, "POST", f"/api/jobs/{jid}/render")       # 二重開始はできない
    assert st == 409
    st, _, _ = req(srv, "POST", f"/api/jobs/{jid}/subtitles/{sub['id']}", body={"text": "x"})
    assert st == 409                                                 # 書き出し中は修正できない
    job = wait_state(srv, jid, ("done",), timeout=150)
    assert job["result"]["verify"]["ok"], job["result"]
    # AC-U5: 完成動画の配信(Range 対応)
    st, h, data = req(srv, "GET", f"/api/jobs/{jid}/output")
    assert st == 200 and h["Content-Type"] == "video/mp4" and h["Accept-Ranges"] == "bytes"
    size = len(data)
    assert size > 1000 and data[4:8] == b"ftyp"
    st, h, part = req(srv, "GET", f"/api/jobs/{jid}/output", headers={"Range": "bytes=10-"})
    assert st == 206 and len(part) == size - 10 and h["Content-Range"] == f"bytes 10-{size - 1}/{size}"
    st, h, part = req(srv, "GET", f"/api/jobs/{jid}/output", headers={"Range": "bytes=-16"})
    assert st == 206 and part == data[-16:]
    st, _, _ = req(srv, "GET", f"/api/jobs/{jid}/output", headers={"Range": f"bytes={size}-"})
    assert st == 416
    st, h, _ = req(srv, "GET", f"/api/jobs/{jid}/output?download=1", headers={"Range": "bytes=0-0"})
    assert "attachment" in h["Content-Disposition"]
    # 完成後も字幕を直して再書き出しできる(AC-S6)
    st, _, _ = req(srv, "POST", f"/api/jobs/{jid}/subtitles/{sub['id']}", body={"text": "もう一度直した"})
    assert st == 200
    # 他の端末からは見えない(404)
    for path in ("", "/plan", "/output", "/input"):
        st, _, _ = req(srv, "GET", f"/api/jobs/{jid}{path}", client=CLIENT_B)
        assert st == 404, path
    st, _, _ = req(srv, "POST", f"/api/jobs/{jid}/render", client=CLIENT_B)
    assert st == 404
    st, _, _ = req(srv, "DELETE", f"/api/jobs/{jid}", client=CLIENT_B)
    assert st == 404
    # 同じ動画をもう一度送ると既存のジョブ(無料枠を二重に使わない)
    st, _, data = upload(srv, src, name="私の動画.mp4")
    assert st == 200 and jbody(data)["id"] == jid and jbody(data)["duplicate"]
    # 削除
    st, _, _ = req(srv, "DELETE", f"/api/jobs/{jid}")
    assert st == 200
    st, _, _ = req(srv, "GET", f"/api/jobs/{jid}")
    assert st == 404


def test_over_plan_limit_ac_b1(srv):
    src = testing.make_video(str(srv["vids"] / "long.mp4"), [(31.0, True)], size=(160, 90))
    st, _, data = upload(srv, src)
    assert st == 400
    err = jbody(data)["error"]
    assert err["code"] == "over_plan_limit" and err["message"] and err["hint"]


def test_client_declared_plan_is_ignored_ac_p6(srv):
    """プランはサーバー側の購読で決める。クライアントが X-Plan: pro と申告しても上限は広がらない(料金仕様 v1 3章)"""
    src = testing.make_video(str(srv["vids"] / "long2.mp4"), [(31.0, True)], size=(64, 64))
    st, _, data = upload(srv, src, plan="pro", client="c" * 32)
    assert st == 400 and jbody(data)["error"]["code"] == "over_plan_limit" and jbody(data)["error"]["upgrade"]


def test_unsupported_extension_ac_u1(srv):
    st, _, data = req(srv, "POST", "/api/jobs", body=b"hello world",
                      headers={"X-Filename": urllib.parse.quote("メモ.txt")})
    assert st == 400
    err = jbody(data)["error"]
    assert err["code"] == "unsupported_format" and err["hint"]


def test_length_required_and_too_large(srv):
    c = http.client.HTTPConnection("127.0.0.1", srv["port"], timeout=10)
    c.putrequest("POST", "/api/jobs")
    c.putheader("Cookie", f"vae_client={CLIENT_A}")
    c.putheader("X-Filename", "a.mp4")
    c.endheaders()
    r = c.getresponse()
    assert r.status == 411
    c.close()
    c = http.client.HTTPConnection("127.0.0.1", srv["port"], timeout=10)
    c.putrequest("POST", "/api/jobs")
    c.putheader("Cookie", f"vae_client={CLIENT_A}")
    c.putheader("X-Filename", "a.mp4")
    c.putheader("Content-Length", str(2 * 1024 ** 3))
    c.endheaders()
    r = c.getresponse()
    assert r.status == 413 and json.loads(r.read())["error"]["code"] == "too_large"
    c.close()


def test_bad_ids_404(srv):
    for path in ("/api/jobs/0123456789abcdef", "/api/jobs/../../etc/passwd", "/api/jobs/ZZZ", "/nothing"):
        st, _, data = req(srv, "GET", path)
        assert st == 404, path
        assert "Traceback" not in data.decode("utf-8", "replace")


def test_foreign_host_rejected(srv):
    st, _, _ = req(srv, "GET", "/api/plans", headers={"Host": "evil.example.com"})
    assert st == 403


# ------------------------------------------------------------ 料金仕様 v1(AC-P2〜P5, AC-P15)
CLIENT_C = "d" * 32


def test_account_reedit_cancel_versions_ac_p2_p3_p15(srv):
    st, _, data = req(srv, "GET", "/api/account", client=CLIENT_C)
    acc = jbody(data)
    assert st == 200 and acc["plan"]["name"] == "free" and acc["new_edits_remaining"] == 3 and acc["purchase_terms"]
    assert "app_account_token" in acc and "client_id" not in json.dumps(acc)
    src = testing.make_video(str(srv["vids"] / "acc.mp4"), SEGMENTS)
    with open(src, "rb") as f:
        body = f.read()
    h = {"X-Filename": "acc.mp4", "Idempotency-Key": "upload-acc-0001"}
    st, _, data = req(srv, "POST", "/api/jobs", body=body, headers=h, client=CLIENT_C)
    job = jbody(data)
    assert st == 200 and "usage_id" not in job and "account_id" not in job
    st2, _, data2 = req(srv, "POST", "/api/jobs", body=body, headers=h, client=CLIENT_C)    # リトライ
    assert st2 == 200 and jbody(data2)["id"] == job["id"] and jbody(data2)["duplicate"]
    wait_state(srv, job["id"], ("ready",), client=CLIENT_C)
    req(srv, "POST", f"/api/jobs/{job['id']}/render", body={}, client=CLIENT_C)
    wait_state(srv, job["id"], ("done",), client=CLIENT_C)
    acc = jbody(req(srv, "GET", "/api/account", client=CLIENT_C)[2])
    assert acc["new_edits_used"] == 1 and acc["projects"][job["id"]]["reedits_remaining"] == 1
    # 同じ設定の再編集は回数を使わない
    st, _, data = req(srv, "POST", f"/api/jobs/{job['id']}/reedit", body={"concept": "standard"}, client=CLIENT_C)
    assert st == 200 and jbody(data)["no_change"]
    # AI 再編集
    st, _, data = req(srv, "POST", f"/api/jobs/{job['id']}/reedit", body={"concept": "tempo"},
                      headers={"Idempotency-Key": "reedit-acc-0001"}, client=CLIENT_C)
    assert st == 202
    done = wait_state(srv, job["id"], ("done",), client=CLIENT_C)
    for _ in range(50):
        done = jbody(req(srv, "GET", f"/api/jobs/{job['id']}", client=CLIENT_C)[2])
        if done["state"] == "done" and done.get("versions"):
            break
        time.sleep(0.2)
    assert done["versions"] and done["versions"][0]["name"] == "v1.mp4"
    st, h2, _ = req(srv, "GET", f"/api/jobs/{job['id']}/versions/v1.mp4", client=CLIENT_C, headers={"Range": "bytes=0-1"})
    assert st == 206 and h2["Content-Type"] == "video/mp4"
    assert req(srv, "GET", f"/api/jobs/{job['id']}/versions/..%2Fjob.json", client=CLIENT_C)[0] == 404
    assert req(srv, "GET", f"/api/jobs/{job['id']}/versions/v1.mp4", client=CLIENT_B)[0] == 404   # 他の端末からは見えない
    # 上限
    st, _, data = req(srv, "POST", f"/api/jobs/{job['id']}/reedit", body={"concept": "standard"}, client=CLIENT_C)
    err = jbody(data)["error"]
    assert st == 400 and err["code"] == "limit_reached" and err["kind"] == "reedit" and err["upgrade"]
    # 終わったジョブのキャンセルは受け付けない
    assert req(srv, "POST", f"/api/jobs/{job['id']}/cancel", body={}, client=CLIENT_C)[0] == 409


def test_apple_endpoints_reject_unverified_ac_p10(srv):
    st, _, data = req(srv, "POST", "/api/billing/apple/transactions", body={"signedTransactions": ["a.b.c"]}, client=CLIENT_C)
    assert st == 400 and jbody(data)["error"]["code"] == "invalid_transaction"
    assert req(srv, "POST", "/api/billing/apple/transactions", body={"signedTransactions": []}, client=CLIENT_C)[0] == 400
    st, _, data = req(srv, "POST", "/api/billing/apple/notifications", body={"signedPayload": "x.y.z"}, client=None)
    assert st == 400
    acc = jbody(req(srv, "GET", "/api/account", client=CLIENT_C)[2])
    assert acc["plan"]["name"] == "free"                               # 検証できない購入では変わらない


def test_bad_idempotency_key(srv):
    st, _, data = req(srv, "POST", "/api/jobs", body=b"x", headers={"X-Filename": "a.mp4", "Idempotency-Key": "bad key!"},
                      client=CLIENT_C)
    assert st == 400
