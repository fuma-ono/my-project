"""ローカル Web UI と JSON API(AC-U1〜U5, AC-S6, AC-B1)

標準ライブラリだけで動く。既定では 127.0.0.1 にだけ待ち受ける。

  GET    /                                   画面(static/index.html)
  GET    /api/plans                          プラン一覧・価格・期間・更新条件・編集コンセプト(料金仕様 v1)
  GET    /api/account                        現在のプラン・契約・今月の新規編集の残り・プロジェクトごとの再編集の残り
  POST   /api/jobs                           動画本体をそのまま送る。X-Filename(URL エンコード)、Idempotency-Key、X-Concept。
                                             プランはサーバー側の購読の状態で決める(クライアントの申告は使わない)
  GET    /api/jobs/<id>                      状態・進捗・エラー
  GET    /api/jobs/<id>/plan                 字幕・言い淀み候補・残す区間・長さ
  POST   /api/jobs/<id>/subtitles/<sub_id>   {"text": "..."} 字幕の修正(AC-S6)
  POST   /api/jobs/<id>/render               書き出し開始(字幕の手動変更の反映。利用枠は使わない)
  POST   /api/jobs/<id>/reedit               {"concept": "..."} AI 再編集(利用枠を使う)。Idempotency-Key
  POST   /api/jobs/<id>/cancel               処理のキャンセル(利用枠は返却)
  POST   /api/jobs/<id>/videos               動画を足す(STANDARD / PRO の複数動画。POST /api/jobs に X-Collect: 1 で作ったもの)
  POST   /api/jobs/<id>/start                集めた動画で新規編集を始める(利用枠をここで予約)。Idempotency-Key
  GET    /api/jobs/<id>/versions/<name>      AI 再編集の前の完成動画
  POST   /api/billing/apple/transactions     {"signedTransactions": [...]} iOS の購入・復元の取引(JWS)を検証して反映
  POST   /api/billing/apple/notifications    App Store Server Notifications V2({"signedPayload": "..."})
  GET    /api/jobs/<id>/output               書き出した動画(Range 対応)
  GET    /api/jobs/<id>/input                元動画のプレビュー(Range 対応)
  DELETE /api/jobs/<id>                      ジョブの削除

ジョブは作った端末(Cookie vae_client)からしか見えない。他の端末からは 404。
"""
import http.cookies
import json
import logging
import os
import re
import secrets
import shutil
import tempfile
import threading
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .. import errors, pipeline
from ..billing import store as bstore
from ..jobs import JobStore

log = logging.getLogger("vae.web")

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
MAX_UPLOAD_BYTES = 1 << 30            # 1 GB
MAX_JSON_BYTES = 64 * 1024
MAX_SUBTITLE_CHARS = 200
CHUNK = 1 << 20
COOKIE_NAME = "vae_client"
EDITABLE_STATES = ("ready", "done")
BUSY_STATES = ("analyzing", "rendering")
PRIVATE_JOB_KEYS = ("client_id", "hash", "input_name", "account_id", "usage_id", "prev_settings")
_KEY_RE = re.compile(r"^[A-Za-z0-9_.:-]{8,100}$")
_VERSION_RE = re.compile(r"^v\d{1,4}\.mp4$")
# 購入前に示す条件(画面とアップグレードの案内に使う。価格は config/plans.json)
PURCHASE_TERMS = ("月額の自動更新の定期購読です。購入の確定時に Apple ID に請求されます。",
                  "期間の終わりの24時間前までに自動更新をオフにしない限り、同じ価格・期間で自動的に更新されます。",
                  "解約(自動更新のオフ)は iPhone の「設定」→ Apple ID →「サブスクリプション」からいつでもできます。"
                  "解約しても、契約期間の終わりまでは引き続き使えます。",
                  "利用回数の上限に達しても、自動で課金されることはありません。")
CLEANUP_INTERVAL_SEC = 3600

_JOB_RE = re.compile(r"^/api/jobs/([0-9a-f]{1,64})(/.*)?$")
_CLIENT_RE = re.compile(r"^[0-9a-f]{32}$")


class HTTPError(Exception):
    def __init__(self, status, code, message, hint=""):
        super().__init__(message)
        self.status, self.code, self.message, self.hint = status, code, message, hint


def _not_found():
    return HTTPError(404, "not_found", "見つかりませんでした。", "最初の画面から、もう一度動画を選んでください。")


def public_job(job):
    """利用者に返すジョブ情報(端末 ID・ハッシュ・サーバーのパス・内部の詳細は含めない)"""
    out = {k: v for k, v in job.items() if k not in PRIVATE_JOB_KEYS}
    if isinstance(out.get("media"), dict):
        out["media"] = {k: v for k, v in out["media"].items() if k != "path"}
    if isinstance(out.get("error"), dict):
        out["error"] = {k: out["error"][k] for k in ("code", "message", "hint", "upgrade", "kind", "limit", "used", "phase")
                        if k in out["error"]}
    res = out.get("result")
    if isinstance(res, dict):
        out["result"] = {k: res[k] for k in ("verify", "mix_metrics", "timings_sec", "out_duration", "output_size",
                                             "resolution_class") if k in res}
    if isinstance(out.get("clips"), list):
        out["clips"] = [{"filename": c.get("filename"), "seconds": c.get("seconds")} for c in out["clips"]]
    if isinstance(out.get("versions"), list):
        out["versions"] = [{"name": v.get("name"), "created": v.get("created"),
                            "concept": (v.get("settings") or {}).get("concept")} for v in out["versions"]]
    return out


def public_plan(plan):
    src = {k: v for k, v in (plan.get("source") or {}).items() if k != "path"}
    subs = [{k: e.get(k) for k in ("id", "s", "e", "src_s", "src_e", "lines", "edited", "short", "overflow")}
            for e in plan.get("subtitles", [])]
    cands = [{k: c.get(k) for k in ("text", "s", "e", "kind", "decision", "reason")}
             for c in plan.get("filler_candidates", [])]
    return {"subtitles": subs, "filler_candidates": cands, "keep": plan.get("keep", []),
            "out_duration": plan.get("out_duration"), "source": src}


class VAEServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, addr, store):
        super().__init__(addr, Handler)
        self.store = store
        self.plan_lock = threading.Lock()          # plan.json の読み書きと書き出し開始を直列にする
        self.upload_dir = os.path.join(store.root, "uploads_tmp")
        os.makedirs(self.upload_dir, exist_ok=True)
        self.bind_host = addr[0]


class Handler(BaseHTTPRequestHandler):
    timeout = 60                                         # 遅いクライアントに接続を占有されないように
    server_version = "VAE"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    # ------------------------------------------------------------ 共通
    def log_message(self, fmt, *args):
        log.info("%s %s", self.address_string(), fmt % args)

    @property
    def store(self) -> JobStore:
        return self.server.store

    def _client(self):
        """Cookie の端末 ID。無ければ作り、応答で Set-Cookie する"""
        if hasattr(self, "_cid"):
            return self._cid
        cid = None
        raw = self.headers.get("Cookie")
        if raw:
            try:
                c = http.cookies.SimpleCookie(raw)
                if COOKIE_NAME in c and _CLIENT_RE.match(c[COOKIE_NAME].value):
                    cid = c[COOKIE_NAME].value
            except http.cookies.CookieError:
                cid = None
        self._new_cookie = cid is None
        self._cid = cid or secrets.token_hex(16)
        return self._cid

    def _common_headers(self):
        self._client()
        if self._new_cookie:
            self.send_header("Set-Cookie", f"{COOKIE_NAME}={self._cid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")

    def _send_json(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self._common_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_error(self, status, code, message, hint=""):
        self._send_json(status, {"error": {"code": code, "message": message, "hint": hint}})

    def _host_ok(self):
        """DNS リバインディング対策: ローカルで待ち受けるときは Host をローカル名に限る"""
        if self.server.bind_host not in ("127.0.0.1", "localhost", "::1"):
            return True
        host = (self.headers.get("Host") or "").strip().lower()
        if host.startswith("["):
            name = host[1:].split("]")[0]
        else:
            name = host.rsplit(":", 1)[0] if ":" in host else host
        return name in ("127.0.0.1", "localhost", "::1")

    def _dispatch(self, method):
        try:
            if not self._host_ok():
                raise HTTPError(403, "forbidden_host", "この接続先からは利用できません。", "http://127.0.0.1 で開いてください。")
            url = urllib.parse.urlsplit(self.path)
            self._query = urllib.parse.parse_qs(url.query)
            self._route(method, url.path)
        except HTTPError as e:
            self._drain_if_needed(e.status)
            self._send_error(e.status, e.code, e.message, e.hint)
        except errors.VAEError as e:
            self._send_json(400, {"error": e.to_dict()})
        except KeyError:
            self._drain_if_needed(404)
            self._send_json(404, {"error": {"code": "not_found", "message": "見つかりませんでした。",
                                            "hint": "最初の画面から、もう一度動画を選んでください。"}})
        except (BrokenPipeError, ConnectionResetError, TimeoutError):   # 配信の途中で読み込みが止まった場合も同じ扱い
            self.close_connection = True
        except Exception:
            log.exception("内部エラー: %s %s", method, self.path)     # 詳細はサーバー側にだけ残す
            self.close_connection = True
            try:
                self._send_json(500, {"error": errors.internal().to_dict()})
            except Exception:
                pass

    def _drain_if_needed(self, status):
        # 本文を読まずに応答する場合は接続を閉じる(残りの本文が次の要求として解釈されないように)
        if self.command in ("POST", "PUT") and not getattr(self, "_body_consumed", False):
            self.close_connection = True

    def do_GET(self):
        self._dispatch("GET")

    def do_HEAD(self):
        self._dispatch("HEAD")

    def do_POST(self):
        self._dispatch("POST")

    def do_DELETE(self):
        self._dispatch("DELETE")

    # ------------------------------------------------------------ ルーティング
    def _route(self, method, path):
        if path in ("/", "/index.html") and method in ("GET", "HEAD"):
            return self._static("index.html")
        if path == "/api/plans" and method in ("GET", "HEAD"):
            cfg = self.store.config
            return self._send_json(200, {"plans": [p.public() for p in cfg.plans.values()],
                                         "concepts": [{"id": c["id"], "label": c["label"], "tier": c["tier"]} for c in cfg.concepts],
                                         "purchase_terms": PURCHASE_TERMS, "purchase_on": "ios",
                                         "default": "free", "max_upload_bytes": MAX_UPLOAD_BYTES})
        if path == "/api/account" and method in ("GET", "HEAD"):
            cid = self._client()
            ids = [j["id"] for j in self.store.list() if j.get("client_id") == cid]
            st = self.store.account_status(cid, ids)
            st["purchase_terms"] = PURCHASE_TERMS
            return self._send_json(200, st)
        if path == "/api/jobs" and method == "POST":
            return self._create_job()
        if path == "/api/billing/apple/transactions" and method == "POST":
            return self._apple_transactions()
        if path == "/api/billing/apple/notifications" and method == "POST":
            return self._apple_notification()
        m = _JOB_RE.match(path)
        if not m:
            raise _not_found()
        job_id, rest = m.group(1), m.group(2) or ""
        job = self._own_job(job_id)
        if rest == "" and method in ("GET", "HEAD"):
            return self._send_json(200, public_job(job))
        if rest == "" and method == "DELETE":
            try:
                self.store.delete(job_id)               # 状態の確認と削除は JobStore のロックの中で行う
            except ValueError:
                raise HTTPError(409, "busy", "処理中のため削除できません。", "処理が終わってから削除してください。")
            return self._send_json(200, {"deleted": job_id})
        if rest == "/plan" and method in ("GET", "HEAD"):
            return self._send_json(200, public_plan(self._load_plan(job)))
        if rest == "/render" and method == "POST":
            return self._render(job)
        if rest == "/reedit" and method == "POST":
            return self._reedit(job)
        if rest == "/cancel" and method == "POST":
            self._read_json()
            ok = self.store.cancel(job_id)
            return self._send_json(202 if ok else 409, {"cancelled": ok, "job": public_job(self.store.get(job_id))})
        if rest == "/videos" and method == "POST":
            return self._add_video(job)
        if rest == "/start" and method == "POST":
            self._read_json()
            try:
                job = self.store.start_collected(job_id, self._client(), idempotency_key=self._idempotency_key())
            except ValueError:
                raise HTTPError(409, "not_collecting", "この編集はすでに始まっています。", "")
            return self._send_json(202, public_job(job))
        vm = re.match(r"^/versions/([^/]+)$", rest)
        if vm and method in ("GET", "HEAD"):
            name = vm.group(1)
            if not _VERSION_RE.match(name) or name not in [v.get("name") for v in job.get("versions") or []]:
                raise _not_found()
            return self._send_file(os.path.join(self.store.paths(job_id)["versions"], name), "video/mp4")
        sm = re.match(r"^/subtitles/(\d{1,6})$", rest)
        if sm and method == "POST":
            return self._edit_subtitle(job, int(sm.group(1)))
        if rest == "/output" and method in ("GET", "HEAD"):
            if job["state"] != "done":
                raise HTTPError(404, "not_ready", "まだ書き出しが終わっていません。", "完成するまでお待ちください。")
            p = self.store.paths(job_id)["output"]
            name = None
            if self._query.get("download"):
                base = os.path.splitext(job.get("filename") or "video")[0] or "video"
                name = f"{base}_edited.mp4"
            return self._send_file(p, "video/mp4", download_name=name)
        if rest == "/input" and method in ("GET", "HEAD"):
            p = self.store.paths(job_id)["input"]
            ext = os.path.splitext(p)[1].lower()
            ctype = {".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
                     ".mkv": "video/x-matroska"}.get(ext, "application/octet-stream")
            return self._send_file(p, ctype)
        raise _not_found()

    def _own_job(self, job_id):
        job = self.store.get(job_id)                    # 無い ID は KeyError → 404
        if job.get("client_id") != self._client():
            raise _not_found()                          # 他の端末のジョブは存在も知らせない
        return job

    # ------------------------------------------------------------ 受付(AC-U1, AC-B1)
    def _create_job(self):
        length = self.headers.get("Content-Length")
        if self.headers.get("Transfer-Encoding") or length is None:
            raise HTTPError(411, "length_required", "ファイルの大きさが分かりませんでした。", "ページを再読み込みして、もう一度選んでください。")
        try:
            length = int(length)
        except ValueError:
            raise HTTPError(400, "bad_request", "ファイルの大きさが正しくありません。", "もう一度選んでください。")
        if length > MAX_UPLOAD_BYTES:
            raise HTTPError(413, "too_large", f"ファイルが大きすぎます({length / 1e9:.1f}GB)。",
                            "1GB 以下の動画を選んでください。30秒以内に切り出すと小さくなります。")
        if length <= 0:
            raise HTTPError(400, "broken_file", "ファイルが空です。", "別の動画を選んでください。")
        filename = urllib.parse.unquote(self.headers.get("X-Filename") or "")
        filename = os.path.basename(filename.replace("\\", "/"))[:200]
        plan_name = None                                # プランはサーバー側で決める(X-Plan は使わない)
        self._idem = self._idempotency_key()
        self._concept = (self.headers.get("X-Concept") or "").strip()[:40] or None
        self._collect = (self.headers.get("X-Collect") or "").strip() == "1"
        free = self.store.free_gb()                     # 受け取る前にディスクの空きを確認する
        if free < self.store.min_free_gb + length / 1e9:
            raise HTTPError(507, "disk_full", f"保存領域の空きが足りません(残り {free:.1f}GB)。",
                            "古いジョブを削除してから、もう一度試してください。")
        tmp = self._receive_body(length)
        try:
            job = self._create_from_tmp(tmp, filename, plan_name)
        finally:
            try:
                os.remove(tmp)
            except OSError:
                pass
        dup = bool(job.get("duplicate"))
        if not dup and job["state"] != "collecting":
            self.store.start(job["id"], "analyze")
        return self._send_json(200, dict(public_job(job), duplicate=dup))

    def _add_video(self, job):
        length = self.headers.get("Content-Length")
        if self.headers.get("Transfer-Encoding") or length is None:
            raise HTTPError(411, "length_required", "ファイルの大きさが分かりませんでした。", "もう一度選んでください。")
        try:
            length = int(length)
        except ValueError:
            raise HTTPError(400, "bad_request", "ファイルの大きさが正しくありません。", "もう一度選んでください。")
        if length <= 0 or length > MAX_UPLOAD_BYTES:
            raise HTTPError(413 if length > 0 else 400, "too_large" if length > 0 else "broken_file",
                            "ファイルの大きさが正しくありません。", "1GB 以下の動画を選んでください。")
        free = self.store.free_gb()
        if free < self.store.min_free_gb + length / 1e9:
            raise HTTPError(507, "disk_full", f"保存領域の空きが足りません(残り {free:.1f}GB)。", "古いジョブを削除してください。")
        filename = os.path.basename(urllib.parse.unquote(self.headers.get("X-Filename") or "").replace("\\", "/"))[:200]
        tmp = self._receive_body(length)
        try:
            job = self.store.add_clip(job["id"], tmp, filename, self._client(), move=True)
        except ValueError:
            raise HTTPError(409, "not_collecting", "この編集にはもう動画を追加できません。", "")
        finally:
            try:
                os.remove(tmp)
            except OSError:
                pass
        return self._send_json(200, public_job(job))

    def _receive_body(self, length):
        """本文を少しずつ一時ファイルへ書く(全体をメモリに読まない)"""
        fd, tmp = tempfile.mkstemp(dir=self.server.upload_dir, prefix="up_", suffix=".part")
        remaining = length
        try:
            with os.fdopen(fd, "wb") as f:
                while remaining > 0:
                    b = self.rfile.read(min(CHUNK, remaining))
                    if not b:
                        break
                    f.write(b)
                    remaining -= len(b)
        except Exception:
            os.remove(tmp)
            raise
        self._body_consumed = remaining == 0
        if remaining:
            os.remove(tmp)
            self.close_connection = True
            raise HTTPError(400, "upload_incomplete", "アップロードが途中で切れました。", "通信状態を確認して、もう一度選んでください。")
        return tmp

    def _create_from_tmp(self, tmp, filename, plan_name):
        cid = self._client()
        job = self.store.create(tmp, filename, plan_name, cid, move=True,      # コピーせず移動(ディスクを2倍使わない)
                                idempotency_key=self._idem, concept=self._concept, collect=self._collect)
        if not job.get("duplicate"):
            return job
        if job.get("state") == "error":
            # 以前失敗した同じ動画はやり直せるようにする
            self.store.delete(job["id"])
            job = self.store.create(tmp, filename, plan_name, cid, concept=self._concept)
        return job

    # ------------------------------------------------------------ 確認・修正(AC-U3, AC-S6)
    def _load_plan(self, job):
        if job["state"] not in ("ready", "rendering", "done"):
            raise HTTPError(409, "not_ready", "まだ解析が終わっていません。", "解析が終わるまでお待ちください。")
        p = self.store.paths(job["id"])["plan"]
        if not os.path.isfile(p):
            raise _not_found()
        with self.server.plan_lock:
            return pipeline.load_plan(p)

    def _read_json(self):
        length = self.headers.get("Content-Length")
        if length is None:
            raise HTTPError(411, "length_required", "送信内容の大きさが分かりませんでした。", "もう一度保存してください。")
        try:
            length = int(length)
        except ValueError:
            raise HTTPError(400, "bad_request", "送信内容が正しくありません。", "もう一度保存してください。")
        if length > MAX_JSON_BYTES:
            raise HTTPError(413, "too_large", "送信内容が大きすぎます。", "字幕を短くしてください。")
        raw = self.rfile.read(length) if length > 0 else b""
        self._body_consumed = True
        try:
            return json.loads(raw.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise HTTPError(400, "bad_request", "送信内容が正しくありません。", "もう一度保存してください。")

    def _edit_subtitle(self, job, sub_id):
        body = self._read_json()
        text = body.get("text") if isinstance(body, dict) else None
        if not isinstance(text, str):
            raise HTTPError(400, "bad_request", "字幕の文言がありません。", "文字を入力してから保存してください。")
        if len(text) > MAX_SUBTITLE_CHARS:
            raise HTTPError(400, "subtitle_too_long", f"字幕が長すぎます({len(text)}文字)。",
                            f"{MAX_SUBTITLE_CHARS}文字以内にしてください。長い文は2つの字幕に分けると読みやすくなります。")
        with self.server.plan_lock:
            job = self.store.get(job["id"])
            if job["state"] not in EDITABLE_STATES:
                raise HTTPError(409, "not_editable", "いまは字幕を修正できません。", "解析または書き出しが終わってから修正してください。")
            p = self.store.paths(job["id"])["plan"]
            plan = pipeline.load_plan(p)
            try:
                ev = pipeline.edit_subtitle(plan, sub_id, text)
            except KeyError:
                raise HTTPError(404, "not_found", "この字幕が見つかりませんでした。", "ページを再読み込みしてください。")
            pipeline.save_plan(plan, p)
        out = {k: ev.get(k) for k in ("id", "s", "e", "src_s", "src_e", "lines", "edited", "short", "overflow")}
        return self._send_json(200, out)

    # ------------------------------------------------------------ 書き出し(AC-U4)
    def _render(self, job):
        self._body_consumed = True
        n = int(self.headers.get("Content-Length") or 0)
        if 0 < n <= MAX_JSON_BYTES:
            self.rfile.read(n)
        elif n > MAX_JSON_BYTES:
            self._body_consumed = False
            raise HTTPError(413, "too_large", "送信内容が大きすぎます。", "")
        with self.server.plan_lock:
            job = self.store.get(job["id"])
            if job["state"] not in EDITABLE_STATES:
                raise HTTPError(409, "not_ready", "いまは書き出しを始められません。", "解析が終わってから書き出してください。")
            # 状態をすぐ「書き出し中」にする(古い完成状態を画面が読まないように、二重開始も防ぐ)
            try:
                job = self.store.begin_render(job["id"])
            except ValueError:
                raise HTTPError(409, "not_ready", "いまは書き出しを始められません。", "解析が終わってから書き出してください。")
        return self._send_json(202, public_job(job))

    def _idempotency_key(self):
        key = (self.headers.get("Idempotency-Key") or "").strip()
        if not key:
            return None
        if not _KEY_RE.match(key):
            raise HTTPError(400, "bad_request", "操作の識別子が正しくありません。", "ページを再読み込みしてください。")
        return f"{self._client()}:{key}"            # 端末ごとに分ける(他の端末のキーと衝突させない)

    # ------------------------------------------------------------ AI 再編集(料金仕様 v1)
    def _reedit(self, job):
        body = self._read_json()
        if not isinstance(body, dict):
            raise HTTPError(400, "bad_request", "送信内容が正しくありません。", "")
        concept = body.get("concept")
        if concept is not None and not isinstance(concept, str):
            raise HTTPError(400, "bad_request", "編集コンセプトが正しくありません。", "")
        with self.server.plan_lock:
            try:
                job = self.store.begin_reedit(job["id"], self._client(), concept=concept,
                                              idempotency_key=self._idempotency_key())
            except ValueError:
                raise HTTPError(409, "not_ready", "いまは AI 再編集を始められません。", "書き出しが終わってから試してください。")
        status = 200 if job.get("no_change") or job.get("duplicate") else 202
        return self._send_json(status, dict(public_job(job), no_change=bool(job.get("no_change")),
                                            duplicate=bool(job.get("duplicate"))))

    # ------------------------------------------------------------ App Store(料金仕様 v1 5章)
    def _apple_transactions(self):
        from ..billing import appstore
        body = self._read_json()
        txs = body.get("signedTransactions") if isinstance(body, dict) else None
        if not isinstance(txs, list) or not txs or len(txs) > 20 or not all(isinstance(t, str) for t in txs):
            raise HTTPError(400, "bad_request", "購入情報が正しくありません。", "アプリから「購入を復元」を試してください。")
        acc = self.store.account_for(self._client())
        out = []
        for t in txs:
            try:
                out.append(appstore.apply_signed_transaction(self.store.billing, self.store.config, acc["id"], t))
            except bstore.SubscriptionConflict:
                raise HTTPError(409, "subscription_in_use", "この購読は別のアカウントで使われています。",
                                "購入したときのアカウントでログインしてください。二重に登録・請求されることはありません。")
            except (appstore.AppStoreVerificationError, ValueError):
                raise HTTPError(400, "invalid_transaction", "購入情報を確認できませんでした。",
                                "アプリから「購入を復元」を試してください。続く場合はお問い合わせください。")
        return self._send_json(200, {"applied": out, "account": self.store.account_status(self._client())})

    def _apple_notification(self):
        from ..billing import appstore
        body = self._read_json()
        payload = body.get("signedPayload") if isinstance(body, dict) else None
        if not isinstance(payload, str):
            raise HTTPError(400, "bad_request", "通知が正しくありません。", "")
        try:
            res = appstore.apply_notification(self.store.billing, self.store.config, payload)
        except (appstore.AppStoreVerificationError, ValueError):
            raise HTTPError(400, "invalid_notification", "通知を確認できませんでした。", "")
        except bstore.SubscriptionConflict:
            raise HTTPError(409, "subscription_in_use", "購読のアカウントが一致しません。", "")
        return self._send_json(200, {"status": res.get("status")})

    # ------------------------------------------------------------ ファイル配信(Range 対応)
    def _static(self, name):
        p = os.path.join(STATIC_DIR, name)
        with open(p, "rb") as f:
            body = f.read()
        self.send_response(200)
        self._common_headers()
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
                         "media-src 'self' blob:; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_file(self, path, ctype, download_name=None):
        if not os.path.isfile(path):
            raise _not_found()
        size = os.path.getsize(path)
        start, end, status = 0, size - 1, 200
        rng = self.headers.get("Range")
        if rng:
            m = re.match(r"^bytes=(\d*)-(\d*)$", rng.strip())
            if not m or (m.group(1) == "" and m.group(2) == ""):
                return self._range_not_satisfiable(size)
            if m.group(1) == "":
                n = int(m.group(2))
                if n == 0:
                    return self._range_not_satisfiable(size)
                start = max(0, size - n)
            else:
                start = int(m.group(1))
                if m.group(2):
                    end = min(int(m.group(2)), size - 1)
            if start >= size or start > end:
                return self._range_not_satisfiable(size)
            status = 206
        length = end - start + 1
        self.send_response(status)
        self._common_headers()
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        if download_name:
            q = urllib.parse.quote(download_name)
            self.send_header("Content-Disposition", f"attachment; filename=\"edited.mp4\"; filename*=UTF-8''{q}")
        self.end_headers()
        if self.command == "HEAD":
            return
        with open(path, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                b = f.read(min(CHUNK, remaining))
                if not b:
                    break
                self.wfile.write(b)
                remaining -= len(b)

    def _range_not_satisfiable(self, size):
        self.send_response(416)
        self._common_headers()
        self.send_header("Content-Range", f"bytes */{size}")
        self.send_header("Content-Length", "0")
        self.end_headers()


# ------------------------------------------------------------ 起動
def make_store(data_dir):
    if os.environ.get("VAE_FAKE_TRANSCRIBER") == "1":
        from .. import testing                     # 操作テスト用: モデルを使わない
        return JobStore(data_dir, transcriber_factory=testing.fake_factory, vad_fn=testing.energy_vad)
    return JobStore(data_dir)


def make_server(host, port, store):
    return VAEServer((host, port), store)


def _cleanup_loop(store, stop):
    while not stop.wait(CLEANUP_INTERVAL_SEC):
        try:
            store.cleanup_expired()
        except Exception:
            log.exception("期限切れジョブの削除に失敗")


def serve(host="127.0.0.1", port=8765, data_dir="data", store=None):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    store = store or make_store(data_dir)
    try:
        store.cleanup_expired()
    except Exception:
        log.exception("期限切れジョブの削除に失敗")
    shutil.rmtree(os.path.join(store.root, "uploads_tmp"), ignore_errors=True)   # 前回の途中アップロード
    srv = make_server(host, port, store)
    stop = threading.Event()
    threading.Thread(target=_cleanup_loop, args=(store, stop), daemon=True).start()
    h, p = srv.server_address[:2]
    print(f"VAE を起動しました: http://{'127.0.0.1' if h in ('0.0.0.0', '') else h}:{p}/  (終了は Ctrl+C)", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        srv.server_close()
