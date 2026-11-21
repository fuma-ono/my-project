"""ジョブ(= プロジェクト)の保存・実行・後始末と、利用枠(料金仕様 v1)の予約・消費・返却

data/jobs/<job_id>/
  input<ext>   元動画(以後、読み取り専用として扱う)
  job.json     状態・進捗・エラー・結果
  work/        一時ファイル(完了後に大きなものを削除。再編集用の transcript.json と mix.wav は期限まで残す)
  output.mp4   最新の書き出し結果
  versions/    AI 再編集の前の完成動画(v1.mp4, v2.mp4 …)
data/vae.db    アカウント・購読・利用枠・原価(vae.billing.store)

利用枠の扱い(PRICING_DESIGN.md 3章):
- 新規編集: 受付時に予約し、最初の書き出しの成功で消費。解析の失敗・削除・期限切れ・中断で返却
- AI 再編集: 開始時に予約し、成功で消費。失敗で返却し、前の計画・出力に戻す
- 字幕の手動変更の書き出し: 利用枠を使わない
"""
import heapq
import itertools
import json
import os
import resource
import shutil
import threading
import time
import traceback
import uuid

from . import errors, media, pipeline, plans
from .billing import config as bconfig
from .billing import store as bstore

MIN_FREE_GB = 2.0
EXPIRE_HOURS = 24.0
STATES = ("queued", "analyzing", "ready", "rendering", "done", "error")
BUSY = ("queued", "analyzing", "rendering")


class PriorityGate:
    """同時に1つだけ処理する。待っている間は優先度の高い(PRO など)ジョブから順に通す。同じ優先度は到着順"""

    def __init__(self):
        self._cv = threading.Condition()
        self._busy = False
        self._waiting = []
        self._seq = itertools.count()

    def acquire(self, priority=0):
        with self._cv:
            item = (-priority, next(self._seq))
            heapq.heappush(self._waiting, item)
            while self._busy or self._waiting[0] != item:
                self._cv.wait()
            heapq.heappop(self._waiting)
            self._busy = True

    def release(self):
        with self._cv:
            self._busy = False
            self._cv.notify_all()


def _cpu_seconds():
    a, b = resource.getrusage(resource.RUSAGE_SELF), resource.getrusage(resource.RUSAGE_CHILDREN)
    return a.ru_utime + a.ru_stime + b.ru_utime + b.ru_stime


class JobStore:
    def __init__(self, root, transcriber_factory=None, vad_fn=None, min_free_gb=MIN_FREE_GB, billing_config=None):
        self.root = os.path.abspath(root)
        self.jobs_dir = os.path.join(self.root, "jobs")
        os.makedirs(self.jobs_dir, exist_ok=True)
        self.ledger = plans.UsageLedger(os.path.join(self.root, "usage.json"))
        self.config = billing_config or bconfig.load()
        self.billing = bstore.BillingStore(os.path.join(self.root, "vae.db"), self.config)
        self.bgm_cache = os.path.join(self.root, "bgm_cache")
        self.transcriber_factory = transcriber_factory
        self.vad_fn = vad_fn
        self.min_free_gb = min_free_gb
        self._lock = threading.RLock()
        self._gate = PriorityGate()               # 同時に動かすジョブは1つ(CPU とメモリを守る)。PRO を先に処理
        self._runs = {}                           # job_id -> 計測の開始値(原価の記録用)
        self._cancel = set()                      # キャンセルを求められたジョブ
        self.recover_stale()

    # ------------------------------------------------------------ 保存
    def _dir(self, job_id):
        if not job_id or not all(c in "0123456789abcdef" for c in job_id):
            raise KeyError(job_id)                     # パストラバーサル防止
        return os.path.join(self.jobs_dir, job_id)

    def get(self, job_id):
        try:
            with open(os.path.join(self._dir(job_id), "job.json"), encoding="utf-8") as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            raise KeyError(job_id) from e

    def _put(self, job):
        d = self._dir(job["id"])
        tmp = os.path.join(d, "job.json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(job, f, ensure_ascii=False, indent=1, default=str)
        os.replace(tmp, os.path.join(d, "job.json"))

    def _update(self, job_id, **kw):
        with self._lock:
            job = self.get(job_id)
            job.update(kw)
            job["updated"] = time.time()
            self._put(job)
            return job

    def list(self):
        out = []
        for name in sorted(os.listdir(self.jobs_dir)):
            try:
                out.append(self.get(name))
            except KeyError:
                continue
        return out

    def paths(self, job_id):
        d = self._dir(job_id)
        job = self.get(job_id)
        return {"dir": d, "input": os.path.join(d, job["input_name"]), "work": os.path.join(d, "work"),
                "plan": os.path.join(d, "work", "plan.json"), "output": os.path.join(d, "output.mp4"),
                "versions": os.path.join(d, "versions")}

    # ------------------------------------------------------------ 利用枠
    def account_for(self, client_id):
        return self.billing.account_for_client(client_id)

    def plan_for(self, client_id):
        acc = self.account_for(client_id)
        return self.billing.effective_plan(acc["id"])[0]

    def account_status(self, client_id, job_ids=()):
        acc = self.account_for(client_id)
        st = self.billing.status(acc["id"], job_ids)
        plan = self.config.plan(st["plan"]["name"])
        st["concepts"] = [{"id": c["id"], "label": c["label"]} for c in self.config.concepts_for(plan)]
        st["plans"] = [p.public() for p in self.config.plans.values()]
        st["app_account_token"] = acc["app_account_token"]
        return st

    def _release(self, usage_id, reason):
        if usage_id:
            try:
                self.billing.release(usage_id, reason)
            except KeyError:
                pass

    def _settings_for(self, plan, concept_id, base=None, override=None):
        concept = self.config.concept(concept_id or "standard", plan)
        if concept is None:
            raise errors.VAEError("concept_unavailable", "この編集コンセプトは、今のプランでは使えません。",
                                  "上位のプランに変更するか、別のコンセプトを選んでください。", upgrade=True)
        d = dict(base or {})
        d.update(concept.get("settings", {}))
        d.update({k: v for k, v in (override or {}).items() if k in pipeline.Settings.__dataclass_fields__
                  and k not in ("model", "max_short_side", "concept")})
        d.update(model=plan.model, concept=concept["id"])
        return pipeline.Settings.from_dict(d)

    def _short_side_for(self, plan, job):
        short = plan.max_short_side
        src = job.get("media") or {}
        if plan.allow_4k and self.config.allow_4k and min(src.get("width", 0), src.get("height", 0)) >= 2160:
            short = 2160                                   # 4K は設定と素材の条件がそろったときだけ(PRO)
        return short

    # ------------------------------------------------------------ 受付
    def free_gb(self):
        st = shutil.disk_usage(self.root)
        return st.free / 1e9

    def create(self, src_path, filename, plan_name=None, client_id="local", settings=None, move=False,
               idempotency_key=None, concept=None):
        """アップロードされたファイルを受け付け、新規編集の利用枠を予約する。問題があれば VAEError。戻り値: job
        plan_name は互換のために残す(プランはサーバー側の購読の状態で決める。クライアントの申告は使わない)"""
        free = self.free_gb()
        if free < self.min_free_gb:
            raise errors.disk_full(free)
        acc = self.account_for(client_id)
        plan, _ = self.billing.effective_plan(acc["id"])
        if idempotency_key:                                # 同じ操作の再送は、最初の受付の結果を返す(二重消費しない)
            prev = self._job_for_key(idempotency_key, acc["id"])
            if prev:
                return dict(prev, duplicate=True)
        ext = os.path.splitext(filename or "")[1].lower()
        if ext not in media.ALLOWED_EXT:
            raise errors.unsupported(f"(拡張子 {ext or 'なし'})")
        job_id = uuid.uuid4().hex
        d = os.path.join(self.jobs_dir, job_id)
        os.makedirs(os.path.join(d, "work"))
        dst = os.path.join(d, "input" + ext)              # 利用者のファイル名はパスに使わない
        usage = None
        try:
            (shutil.move if move else shutil.copyfile)(src_path, dst)
            info = media.validate(dst, max_seconds=plan.max_project_seconds, plan_name=plan.label)
            h = plans.file_hash(dst)
            # 同じ動画の判定は端末ごと(別の端末の結果は返さない。他人の動画の存在も漏らさない)
            other = self.ledger.find(f"{client_id}:{h}")
            if other:                                      # 同じ動画は既存のジョブを返す(利用枠を使わない)
                try:
                    existing = self.get(other)
                    if move:                                   # 呼び出し側がやり直せるよう、移動したファイルを戻す
                        shutil.move(dst, src_path)
                    shutil.rmtree(d, ignore_errors=True)
                    return dict(existing, duplicate=True)
                except KeyError:
                    self.ledger.forget_job(other)
            s = self._settings_for(plan, concept, base=settings)
            self.billing.create_project(acc["id"], job_id)
            try:
                self.billing.add_video(job_id, info.duration, plan, info.width, info.height, h)
            except bstore.ProjectTooLong as e:
                raise errors.project_too_long(e.total, e.limit, plan.label)
            except bstore.MultiVideoNotAllowed:
                raise errors.multi_video_not_allowed(plan.label)
            try:
                usage = self.billing.reserve(acc["id"], job_id, "new_edit", idempotency_key)
            except bstore.LimitReached as e:
                raise errors.limit_reached("new_edit", e.limit, e.used, plan.label)
        except Exception:
            shutil.rmtree(d, ignore_errors=True)           # 失敗したら受付時のファイルを残さない
            if usage:
                self._release(usage["id"], "create_failed")
            raise
        job = {"id": job_id, "state": "queued", "stage": "queued", "progress": 0.0, "message": "順番を待っています",
               "created": time.time(), "updated": time.time(), "expires": time.time() + EXPIRE_HOURS * 3600,
               "filename": os.path.basename(filename or "")[:120], "input_name": "input" + ext, "plan": plan.name,
               "priority": plan.priority, "client_id": client_id, "account_id": acc["id"], "hash": h,
               "media": info.to_dict(), "settings": s.__dict__, "error": None, "result": None,
               "usage_id": usage["id"], "run_kind": "new_edit", "versions": [], "reedits": 0}
        self._put(job)
        self.ledger.remember(f"{client_id}:{h}", job_id)
        return job

    def _job_for_key(self, key, account_id):
        try:
            u = self.billing._conn().execute("SELECT * FROM usage WHERE idempotency_key=?", (key,)).fetchone()
        except Exception:
            return None
        if not u or u["account_id"] != account_id:
            return None
        try:
            return self.get(u["project_id"])
        except KeyError:
            return None

    # ------------------------------------------------------------ 実行
    def _progress_cb(self, job_id):
        def cb(stage, frac, msg):
            self._check_cancel(job_id)            # 段階の区切りでキャンセルを確かめる(FFmpeg の実行中は止めない)
            self._update(job_id, stage=stage, progress=frac, message=msg)
        return cb

    def _check_cancel(self, job_id):
        if job_id in self._cancel:
            self._cancel.discard(job_id)
            raise errors.VAEError("cancelled", "処理をキャンセルしました。", "利用回数は使っていません。")

    def cancel(self, job_id):
        """処理中・待機中のジョブをキャンセルする(利用枠は返却する)。処理中なら次の段階の区切りで止まる。
        戻り値: キャンセルを受け付けたら True"""
        with self._lock:
            job = self.get(job_id)
            if job["state"] not in BUSY:
                return False
            self._cancel.add(job_id)
            if job["state"] == "queued":
                return True                        # 順番が来たら開始せずに終わる
        return True

    def _transcriber(self, model):
        return self.transcriber_factory(model) if self.transcriber_factory else None

    def _start_measure(self, job_id):
        self._runs.setdefault(job_id, {"t0": time.time(), "cpu0": _cpu_seconds()})

    def _record_cost(self, job, status, result=None):
        m = self._runs.pop(job["id"], None)
        if not m:
            return
        try:
            res = result or {}
            pk = res.get("peak_memory_mb") or {}
            self.billing.record_cost(
                account_id=job.get("account_id"), project_id=job["id"], usage_id=job.get("usage_id"),
                run_kind=job.get("run_kind", "new_edit"), plan=job.get("plan", "free"),
                resolution_class=res.get("resolution_class"), source_seconds=(job.get("media") or {}).get("duration"),
                output_seconds=res.get("out_duration"), wall_seconds=round(time.time() - m["t0"], 3),
                cpu_seconds=round(_cpu_seconds() - m["cpu0"], 3),
                peak_mb=max([v for v in pk.values() if isinstance(v, (int, float))] or [0]), status=status)
        except Exception:
            pass                                           # 原価の記録の失敗で利用者の処理を止めない

    def run_analyze(self, job_id):
        p = self.paths(job_id)
        job = self.get(job_id)
        s = pipeline.Settings.from_dict(job["settings"])
        self._gate.acquire(job.get("priority", 0))
        try:
            self._start_measure(job_id)
            try:
                self._check_cancel(job_id)
                self._update(job_id, state="analyzing", message="解析を始めます")
                pipeline.analyze(p["input"], p["work"], s, transcriber=self._transcriber(s.model), vad_fn=self.vad_fn,
                                 progress=self._progress_cb(job_id))
                self._update(job_id, state="ready", progress=0.75, message="編集内容ができました。確認して書き出してください")
            except Exception as e:
                self._fail(job_id, e, phase="analyze")
                return False
        finally:
            self._gate.release()
        return True

    def run_render(self, job_id):
        p = self.paths(job_id)
        job = self.get(job_id)
        plan_spec = self.billing.effective_plan(job["account_id"])[0] if job.get("account_id") else self.config.plan("free")
        s = pipeline.Settings.from_dict(dict(job["settings"], max_short_side=self._short_side_for(plan_spec, job)))
        self._gate.acquire(job.get("priority", 0))
        try:
            self._start_measure(job_id)
            try:
                self._check_cancel(job_id)
                self._update(job_id, state="rendering", message="書き出しています")
                plan = pipeline.load_plan(p["plan"])
                res = pipeline.render_plan(plan, p["input"], p["output"], p["work"], s,
                                           progress=self._progress_cb(job_id), bgm_cache=self.bgm_cache)
                with open(os.path.join(p["work"], "result.json"), "w", encoding="utf-8") as f:
                    json.dump(res, f, ensure_ascii=False, indent=1, default=str)
                job = self.get(job_id)
                if job.get("usage_id") and job.get("run_kind") in ("new_edit", "reedit"):
                    self.billing.consume(job["usage_id"])     # 成功したときだけ消費する
                self._record_cost(job, "ok", res)
                prev_plan = os.path.join(p["work"], "plan.prev.json")
                if os.path.exists(prev_plan):
                    os.remove(prev_plan)
                self._update(job_id, state="done", progress=1.0, stage="done", message="完了しました", result=res,
                             error=None, rendered_once=True, run_kind="manual_render", usage_id=None)
            except Exception as e:
                self._fail(job_id, e, phase="render")
                return False
        finally:
            self._gate.release()
        return True

    def begin_render(self, job_id):
        """字幕の手動変更などの書き出しを受け付ける(利用枠は使わない)。受け付けられなければ ValueError"""
        with self._lock:
            job = self.get(job_id)
            if job["state"] not in ("ready", "done"):
                raise ValueError(job["state"])
            if job.get("rendered_once") and not job.get("usage_id"):
                job["run_kind"] = "manual_render"
            elif not job.get("rendered_once") and not job.get("usage_id") and job.get("account_id"):
                # キャンセルで返却した新規編集を書き出し直す: 利用枠を予約し直す
                plan = self.billing.effective_plan(job["account_id"])[0]
                try:
                    job["usage_id"] = self.billing.reserve(job["account_id"], job_id, "new_edit")["id"]
                except bstore.LimitReached as e:
                    raise errors.limit_reached("new_edit", e.limit, e.used, plan.label)
                job["run_kind"] = "new_edit"
            job.update(state="rendering", stage="queued", progress=0.75, message="書き出しの順番を待っています",
                       error=None, updated=time.time())
            self._put(job)
        self.start(job_id, "render")
        return job

    # ------------------------------------------------------------ AI 再編集
    def begin_reedit(self, job_id, client_id, concept=None, overrides=None, idempotency_key=None):
        """AI 再編集を受け付ける。前回と同じ設定なら処理せず {"no_change": True}。上限なら VAEError(limit_reached)"""
        with self._lock:
            job = self.get(job_id)
            if job["state"] != "done" or not job.get("rendered_once"):
                raise ValueError(job["state"])
            acc = self.account_for(client_id)
            if acc["id"] != job.get("account_id"):
                raise KeyError(job_id)
            if idempotency_key:
                u = self._usage_by_key(idempotency_key)
                if u and u["project_id"] == job_id:
                    return dict(job, duplicate=True)
            plan, _ = self.billing.effective_plan(acc["id"])
            cur = pipeline.Settings.from_dict(job["settings"])
            new = self._settings_for(plan, concept or cur.concept, base=job["settings"], override=overrides)
            if _same_ai_settings(cur, new):
                return dict(job, no_change=True)           # 同じ修正は再処理せず、利用枠も使わない
            try:
                usage = self.billing.reserve(acc["id"], job_id, "reedit", idempotency_key)
            except bstore.LimitReached as e:
                raise errors.limit_reached("reedit", e.limit, e.used, plan.label)
            except bstore.ProjectTooLong as e:
                raise errors.project_too_long(e.total, e.limit, plan.label)
            except bstore.MultiVideoNotAllowed:
                raise errors.multi_video_not_allowed(plan.label)
            p = self.paths(job_id)
            versions = list(job.get("versions") or [])
            os.makedirs(p["versions"], exist_ok=True)
            if os.path.exists(p["output"]):                # 修正前の完成動画を保持する(書き出しは別ファイルに置き換えるので消えない)
                vname = f"v{len(versions) + 1}.mp4"
                os.link(p["output"], os.path.join(p["versions"], vname))
                versions.append({"name": vname, "settings": job["settings"], "result": job.get("result"),
                                 "created": time.time()})
            shutil.copyfile(p["plan"], os.path.join(p["work"], "plan.prev.json"))
            job.update(state="queued", stage="queued", progress=0.0, message="AI 再編集の順番を待っています", error=None,
                       usage_id=usage["id"], run_kind="reedit", prev_settings=job["settings"], settings=new.__dict__,
                       versions=versions, reedits=job.get("reedits", 0) + 1, plan=plan.name, priority=plan.priority,
                       updated=time.time())
            self._put(job)
        self.start(job_id, "all")
        return job

    def _usage_by_key(self, key):
        r = self.billing._conn().execute("SELECT * FROM usage WHERE idempotency_key=?", (key,)).fetchone()
        return dict(r) if r else None

    # ------------------------------------------------------------ 復旧・失敗
    def recover_stale(self):
        """サーバーの再起動などで途中のまま残ったジョブを戻し、終わらなかった処理の利用枠を返却する。戻したジョブの ID を返す"""
        fixed, keep = [], set()
        for job in self.list():
            jid = job["id"]
            if job["state"] in BUSY + ("ready",) and job.get("run_kind") == "reedit":
                self._restore_after_reedit(job, errors.VAEError(
                    "interrupted", "AI 再編集が途中で中断されました(サーバーの再起動など)。", "もう一度 AI 再編集を試してください。"
                ).to_dict())
                fixed.append(jid)
                continue
            if job["state"] == "rendering" and os.path.exists(os.path.join(self._dir(jid), "work", "plan.json")):
                state = "done" if job.get("rendered_once") else "ready"
                self._update(jid, state=state, progress=1.0 if state == "done" else 0.75,
                             message="書き出しが中断されました。もう一度書き出してください")
                fixed.append(jid)
            elif job["state"] in ("queued", "analyzing", "rendering"):
                err = errors.VAEError("interrupted", "処理が途中で中断されました(サーバーの再起動など)。",
                                      "もう一度、動画を選んでやり直してください。").to_dict()
                self._update(jid, state="error", message=err["message"], error=err)
                self._release(job.get("usage_id"), "interrupted")
                fixed.append(jid)
            job = self.get(jid)
            if job.get("usage_id") and job["state"] in ("ready", "done"):
                keep.add(job["usage_id"])                 # 書き出しをやり直せる新規編集の予約は残す
        # ジョブに結び付かない予約(受付の途中で止まったものなど)は返却する
        with self.billing._tx() as c:
            rows = c.execute("SELECT id FROM usage WHERE status='reserved'").fetchall()
            for r in rows:
                if r["id"] not in keep:
                    c.execute("UPDATE usage SET status='released', reason='interrupted', updated=? WHERE id=?",
                              (time.time(), r["id"]))
        return fixed

    def run_all(self, job_id):
        return self.run_analyze(job_id) and self.run_render(job_id)

    def start(self, job_id, target="all"):
        fn = {"all": self.run_all, "analyze": self.run_analyze, "render": self.run_render}[target]
        th = threading.Thread(target=fn, args=(job_id,), daemon=True)
        th.start()
        return th

    def _restore_after_reedit(self, job, err):
        """AI 再編集の失敗: 利用枠を返却し、前の計画・設定・出力に戻す(前の完成動画は output.mp4 に残っている)"""
        p = self.paths(job["id"])
        prev_plan = os.path.join(p["work"], "plan.prev.json")
        if os.path.exists(prev_plan):
            os.replace(prev_plan, p["plan"])
        self._release(job.get("usage_id"), "failed")
        self._record_cost(job, "failed")
        versions = list(job.get("versions") or [])
        if versions:                                       # 修正前の完成動画は output.mp4 のままなので、重複する版の記録を外す
            last = versions.pop()
            try:
                os.remove(os.path.join(p["versions"], last["name"]))
            except OSError:
                pass
        self._update(job["id"], state="done", progress=1.0, stage="reedit_failed",
                     message="AI 再編集に失敗しました。" + err["message"], error=err,
                     settings=job.get("prev_settings") or job["settings"], versions=versions, usage_id=None,
                     run_kind="manual_render", reedits=max(0, job.get("reedits", 1) - 1))

    def _fail(self, job_id, e, phase="analyze"):
        if isinstance(e, errors.VAEError):
            err = e.to_dict()
        else:
            err = errors.internal().to_dict()
            err["detail"] = "".join(traceback.format_exception_only(type(e), e))[-500:]
        p = self.paths(job_id)
        pipeline.cleanup_work(p["work"])
        err["phase"] = phase
        job = self.get(job_id)
        if job.get("run_kind") == "reedit":
            self._restore_after_reedit(job, err)
            return
        if phase == "render" and os.path.exists(p["plan"]):
            # 書き出しの失敗では、解析結果(字幕の修正を含む)を残し、やり直せる状態に戻す(M1)。
            # 新規編集の予約はやり直せる間は残す(成功するまで消費しない)
            state = "done" if job.get("rendered_once") and os.path.exists(p["output"]) else "ready"
            self._record_cost(job, "failed")
            extra = {}
            if err["code"] == "cancelled" and job.get("usage_id"):
                self._release(job["usage_id"], "cancelled")  # キャンセルは返却。書き出し直すときに予約し直す
                extra = {"usage_id": None}
            self._update(job_id, state=state, progress=1.0 if state == "done" else 0.75, stage="render_failed",
                         message="書き出しに失敗しました。" + err["message"], error=err, **extra)
            return
        self._release(job.get("usage_id"), "failed")       # AI 処理の失敗は利用回数を消費しない
        self._record_cost(job, "failed")
        self._update(job_id, state="error", message=err["message"], error=err, usage_id=None)

    # ------------------------------------------------------------ 後始末
    def delete(self, job_id, force=False):
        """ジョブを削除する。処理中(queued / analyzing / rendering)は force が無ければ ValueError"""
        d = self._dir(job_id)
        with self._lock:
            try:
                job = self.get(job_id)
            except KeyError:
                job = {}
            if not force and job.get("state") in BUSY:
                raise ValueError(job.get("state"))
            self._release(job.get("usage_id"), "deleted")    # 成功前に消したジョブの予約は返却する
            self.ledger.forget_job(job_id)
            shutil.rmtree(d, ignore_errors=True)

    def cleanup_expired(self, now=None):
        now = now or time.time()
        removed = []
        for job in self.list():
            if job.get("expires", now + 1) < now and job["state"] in ("done", "error", "ready"):
                self.delete(job["id"], force=True)
                removed.append(job["id"])
        return removed


def _same_ai_settings(a, b):
    """AI 再編集として処理し直す必要があるか(書き出しの解像度などプランで決まる値は比べない)"""
    ignore = {"max_short_side"}
    return {k: v for k, v in a.__dict__.items() if k not in ignore} == {k: v for k, v in b.__dict__.items() if k not in ignore}
