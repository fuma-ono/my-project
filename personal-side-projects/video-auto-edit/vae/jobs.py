"""ジョブの保存・実行・後始末(AC-E3, AC-U1〜U5 の土台)

data/jobs/<job_id>/
  input<ext>   元動画(以後、読み取り専用として扱う)
  job.json     状態・進捗・エラー・結果
  work/        一時ファイル(完了後に大きなものを削除)
  output.mp4   書き出し結果
"""
import json
import os
import shutil
import threading
import time
import traceback
import uuid

from . import errors, media, pipeline, plans

MIN_FREE_GB = 2.0
EXPIRE_HOURS = 24.0
STATES = ("queued", "analyzing", "ready", "rendering", "done", "error")


class JobStore:
    def __init__(self, root, transcriber_factory=None, vad_fn=None, min_free_gb=MIN_FREE_GB):
        self.root = os.path.abspath(root)
        self.jobs_dir = os.path.join(self.root, "jobs")
        os.makedirs(self.jobs_dir, exist_ok=True)
        self.ledger = plans.UsageLedger(os.path.join(self.root, "usage.json"))
        self.bgm_cache = os.path.join(self.root, "bgm_cache")
        self.transcriber_factory = transcriber_factory
        self.vad_fn = vad_fn
        self.min_free_gb = min_free_gb
        self._lock = threading.Lock()
        self._sem = threading.Semaphore(1)            # 同時に動かすジョブは1つ(CPU とメモリを守る)
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
                "plan": os.path.join(d, "work", "plan.json"), "output": os.path.join(d, "output.mp4")}

    # ------------------------------------------------------------ 受付
    def free_gb(self):
        st = shutil.disk_usage(self.root)
        return st.free / 1e9

    def create(self, src_path, filename, plan_name=None, client_id="local", settings=None, move=False):
        """アップロードされたファイルを受け付ける。問題があれば VAEError。戻り値: job"""
        free = self.free_gb()
        if free < self.min_free_gb:
            raise errors.disk_full(free)
        plan = plans.get(plan_name)
        ext = os.path.splitext(filename or "")[1].lower()
        if ext not in media.ALLOWED_EXT:
            raise errors.unsupported(f"(拡張子 {ext or 'なし'})")
        job_id = uuid.uuid4().hex
        d = os.path.join(self.jobs_dir, job_id)
        os.makedirs(os.path.join(d, "work"))
        dst = os.path.join(d, "input" + ext)              # 利用者のファイル名はパスに使わない
        try:
            (shutil.move if move else shutil.copyfile)(src_path, dst)
            info = media.validate(dst, max_seconds=plan.max_seconds, plan_name=plan.label)
            h = plans.file_hash(dst)
            # 同じ動画の判定は端末ごと(別の端末の結果は返さない。他人の動画の存在も漏らさない)
            ok, other = self.ledger.check_and_count(client_id, plan, f"{client_id}:{h}")
            if not ok:
                raise errors.VAEError("daily_limit", other, "明日もう一度試してください。")
            if other:                                      # 同じ動画は既存のジョブを返す(無料枠の重複消費を防ぐ)
                try:
                    existing = self.get(other)
                    if move:                                   # 呼び出し側がやり直せるよう、移動したファイルを戻す
                        shutil.move(dst, src_path)
                    shutil.rmtree(d, ignore_errors=True)
                    return dict(existing, duplicate=True)
                except KeyError:
                    self.ledger.forget_job(other)
        except Exception:
            shutil.rmtree(d, ignore_errors=True)           # 失敗したら受付時のファイルを残さない
            raise
        s = pipeline.Settings.from_dict(dict(settings or {}, model=plan.model))
        job = {"id": job_id, "state": "queued", "stage": "queued", "progress": 0.0, "message": "順番を待っています",
               "created": time.time(), "updated": time.time(), "expires": time.time() + EXPIRE_HOURS * 3600,
               "filename": os.path.basename(filename or "")[:120], "input_name": "input" + ext, "plan": plan.name,
               "client_id": client_id, "hash": h, "media": info.to_dict(), "settings": s.__dict__, "error": None,
               "result": None}
        self._put(job)
        self.ledger.remember(f"{client_id}:{h}", job_id)
        return job

    # ------------------------------------------------------------ 実行
    def _progress_cb(self, job_id):
        def cb(stage, frac, msg):
            self._update(job_id, stage=stage, progress=frac, message=msg)
        return cb

    def _transcriber(self, model):
        return self.transcriber_factory(model) if self.transcriber_factory else None

    def run_analyze(self, job_id):
        p = self.paths(job_id)
        job = self.get(job_id)
        s = pipeline.Settings.from_dict(job["settings"])
        with self._sem:
            self._update(job_id, state="analyzing", message="解析を始めます")
            try:
                pipeline.analyze(p["input"], p["work"], s, transcriber=self._transcriber(s.model), vad_fn=self.vad_fn,
                                 progress=self._progress_cb(job_id))
                self._update(job_id, state="ready", progress=0.75, message="編集内容ができました。確認して書き出してください")
            except Exception as e:
                self._fail(job_id, e, phase="analyze")
                return False
        return True

    def run_render(self, job_id):
        p = self.paths(job_id)
        job = self.get(job_id)
        s = pipeline.Settings.from_dict(job["settings"])
        with self._sem:
            self._update(job_id, state="rendering", message="書き出しています")
            try:
                plan = pipeline.load_plan(p["plan"])
                res = pipeline.render_plan(plan, p["input"], p["output"], p["work"], s,
                                           progress=self._progress_cb(job_id), bgm_cache=self.bgm_cache)
                with open(os.path.join(p["work"], "result.json"), "w", encoding="utf-8") as f:
                    json.dump(res, f, ensure_ascii=False, indent=1, default=str)
                self._update(job_id, state="done", progress=1.0, stage="done", message="完了しました", result=res,
                             error=None, rendered_once=True)
            except Exception as e:
                self._fail(job_id, e, phase="render")
                return False
        return True

    def begin_render(self, job_id):
        """書き出しを受け付ける(状態を確認して rendering にし、スレッドで開始)。受け付けられなければ ValueError"""
        with self._lock:
            job = self.get(job_id)
            if job["state"] not in ("ready", "done"):
                raise ValueError(job["state"])
            job.update(state="rendering", stage="queued", progress=0.75, message="書き出しの順番を待っています",
                       error=None, updated=time.time())
            self._put(job)
        self.start(job_id, "render")
        return job

    def recover_stale(self):
        """サーバーの再起動などで途中のまま残ったジョブを戻す。戻したジョブの ID を返す"""
        fixed = []
        for job in self.list():
            if job["state"] == "rendering" and os.path.exists(os.path.join(self._dir(job["id"]), "work", "plan.json")):
                self._update(job["id"], state="ready", progress=0.75, message="書き出しが中断されました。もう一度書き出してください")
                fixed.append(job["id"])
            elif job["state"] in ("queued", "analyzing", "rendering"):
                err = errors.VAEError("interrupted", "処理が途中で中断されました(サーバーの再起動など)。",
                                      "もう一度、動画を選んでやり直してください。").to_dict()
                self._update(job["id"], state="error", message=err["message"], error=err)
                fixed.append(job["id"])
        return fixed

    def run_all(self, job_id):
        return self.run_analyze(job_id) and self.run_render(job_id)

    def start(self, job_id, target="all"):
        fn = {"all": self.run_all, "analyze": self.run_analyze, "render": self.run_render}[target]
        th = threading.Thread(target=fn, args=(job_id,), daemon=True)
        th.start()
        return th

    def _fail(self, job_id, e, phase="analyze"):
        if isinstance(e, errors.VAEError):
            err = e.to_dict()
        else:
            err = errors.internal().to_dict()
            err["detail"] = "".join(traceback.format_exception_only(type(e), e))[-500:]
        p = self.paths(job_id)
        pipeline.cleanup_work(p["work"])
        err["phase"] = phase
        if phase == "render" and os.path.exists(p["plan"]):
            # 書き出しの失敗では、解析結果(字幕の修正を含む)を残し、やり直せる状態に戻す(M1)。
            # 以前に書き出しが成功していれば、その出力を引き続き取り出せる
            job = self.get(job_id)
            state = "done" if job.get("rendered_once") and os.path.exists(p["output"]) else "ready"
            self._update(job_id, state=state, progress=1.0 if state == "done" else 0.75, stage="render_failed",
                         message="書き出しに失敗しました。" + err["message"], error=err)
            return
        self._update(job_id, state="error", message=err["message"], error=err)

    # ------------------------------------------------------------ 後始末
    def delete(self, job_id, force=False):
        """ジョブを削除する。処理中(queued / analyzing / rendering)は force が無ければ ValueError"""
        d = self._dir(job_id)
        with self._lock:
            if not force:
                try:
                    state = self.get(job_id)["state"]
                except KeyError:
                    state = None
                if state in ("queued", "analyzing", "rendering"):
                    raise ValueError(state)
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
