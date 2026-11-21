"""アカウント・購読・プロジェクト・利用枠・原価の保存(SQLite)。PRICING_DESIGN.md の2〜5章。

利用枠を変える処理は BEGIN IMMEDIATE の1トランザクションで行い、同時リクエストやリトライで二重に数えない。
"""
import os
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, app_account_token TEXT UNIQUE NOT NULL, created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS client_links (
  client_id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS subscriptions (
  original_transaction_id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
  product_id TEXT NOT NULL, plan TEXT NOT NULL, expires_at REAL NOT NULL, auto_renew INTEGER NOT NULL DEFAULT 1,
  revoked_at REAL, environment TEXT, last_transaction_id TEXT, source TEXT NOT NULL, updated REAL NOT NULL);
CREATE INDEX IF NOT EXISTS subscriptions_account ON subscriptions(account_id);
CREATE TABLE IF NOT EXISTS apple_events (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, received REAL NOT NULL);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS project_videos (
  project_id TEXT NOT NULL REFERENCES projects(id), idx INTEGER NOT NULL, seconds REAL NOT NULL,
  width INTEGER, height INTEGER, content_hash TEXT, PRIMARY KEY (project_id, idx));
CREATE TABLE IF NOT EXISTS usage (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, project_id TEXT NOT NULL, kind TEXT NOT NULL,
  period TEXT NOT NULL, status TEXT NOT NULL, idempotency_key TEXT UNIQUE NOT NULL, plan TEXT NOT NULL,
  created REAL NOT NULL, updated REAL NOT NULL, reason TEXT);
CREATE INDEX IF NOT EXISTS usage_account_period ON usage(account_id, kind, period, status);
CREATE INDEX IF NOT EXISTS usage_project ON usage(project_id, kind, status);
CREATE TABLE IF NOT EXISTS cost_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT, project_id TEXT, usage_id TEXT, run_kind TEXT NOT NULL,
  plan TEXT NOT NULL, resolution_class TEXT, source_seconds REAL, output_seconds REAL, wall_seconds REAL,
  cpu_seconds REAL, peak_mb REAL, api_cost_jpy REAL NOT NULL DEFAULT 0, server_cost_jpy REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL, created REAL NOT NULL);
"""

KINDS = ("new_edit", "reedit")
ACTIVE = ("reserved", "consumed")       # 上限の判定では予約中と消費済みを合わせて数える


class LimitReached(Exception):
    def __init__(self, kind, limit, used, plan):
        self.kind, self.limit, self.used, self.plan = kind, limit, used, plan
        super().__init__(f"{kind}: {used}/{limit} ({plan})")


class ProjectTooLong(Exception):
    def __init__(self, total, limit, plan):
        self.total, self.limit, self.plan = total, limit, plan
        super().__init__(f"{total:.1f}s > {limit:.1f}s ({plan})")


class MultiVideoNotAllowed(Exception):
    pass


class SubscriptionConflict(Exception):
    """別のアカウントに結び付いた購読を付け替えようとした(二重登録の防止)"""


class BillingStore:
    def __init__(self, path, config):
        self.path = os.path.abspath(path)
        self.config = config
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        self._local = threading.local()
        c = self._conn()
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript(SCHEMA)                   # executescript は自分でコミットするのでトランザクションの外で実行する

    # ------------------------------------------------------------ 接続とトランザクション
    def _conn(self):
        c = getattr(self._local, "conn", None)
        if c is None:
            c = sqlite3.connect(self.path, timeout=30, isolation_level=None, check_same_thread=False)
            c.row_factory = sqlite3.Row
            c.execute("PRAGMA foreign_keys=ON")
            self._local.conn = c
        return c

    @contextmanager
    def _tx(self):
        """書き込みのトランザクション。BEGIN IMMEDIATE で他の書き込みを待たせ、判定と記録の間に割り込ませない"""
        c = self._conn()
        if c.in_transaction:                      # 入れ子は外側のトランザクションに含める
            yield c
            return
        c.execute("BEGIN IMMEDIATE")
        try:
            yield c
            c.execute("COMMIT")
        except BaseException:
            c.execute("ROLLBACK")
            raise

    def period(self, now=None):
        t = (now or time.time()) + self.config.timezone_offset_hours * 3600
        return time.strftime("%Y-%m", time.gmtime(t))

    # ------------------------------------------------------------ アカウント
    def account_for_client(self, client_id):
        """端末 ID に対応するアカウントを返す(無ければ作る)"""
        with self._tx() as c:
            r = c.execute("SELECT a.* FROM client_links l JOIN accounts a ON a.id = l.account_id WHERE l.client_id=?",
                          (client_id,)).fetchone()
            if r:
                return dict(r)
            now = time.time()
            acc = {"id": uuid.uuid4().hex, "app_account_token": str(uuid.uuid4()), "created": now}
            c.execute("INSERT INTO accounts(id, app_account_token, created) VALUES (?,?,?)",
                      (acc["id"], acc["app_account_token"], now))
            c.execute("INSERT INTO client_links(client_id, account_id, created) VALUES (?,?,?)", (client_id, acc["id"], now))
            return acc

    def account(self, account_id):
        r = self._conn().execute("SELECT * FROM accounts WHERE id=?", (account_id,)).fetchone()
        if not r:
            raise KeyError(account_id)
        return dict(r)

    def account_by_token(self, token):
        r = self._conn().execute("SELECT * FROM accounts WHERE app_account_token=?", (str(token).lower(),)).fetchone()
        return dict(r) if r else None

    # ------------------------------------------------------------ 購読
    def active_subscriptions(self, account_id, now=None):
        now = now or time.time()
        rows = self._conn().execute(
            "SELECT * FROM subscriptions WHERE account_id=? AND revoked_at IS NULL AND expires_at > ?",
            (account_id, now)).fetchall()
        dev_ok = os.environ.get("VAE_DEV_BILLING") == "1"   # DEV 用の購読は DEV のときだけ有効(本番で効かない)
        return [dict(r) for r in rows if r["source"] != "dev" or dev_ok]

    def effective_plan(self, account_id, now=None):
        """有効な購読のうち最上位のプラン。無ければ free。戻り値: (PlanSpec, 購読 or None)"""
        best, best_sub = self.config.plan("free"), None
        for s in self.active_subscriptions(account_id, now):
            p = self.config.plan(s["plan"])
            if p.priority > best.priority or (p.priority == best.priority and best_sub and s["expires_at"] > best_sub["expires_at"]):
                best, best_sub = p, s
        return best, best_sub

    def upsert_subscription(self, account_id, original_transaction_id, product_id, expires_at, *, environment=None,
                            last_transaction_id=None, auto_renew=True, source="apple", revoked_at=None):
        """購読を登録・更新する。別のアカウントに結び付いていれば SubscriptionConflict(付け替えない)"""
        plan = self.config.plan_for_product(product_id)
        if plan is None and source != "dev":
            raise ValueError(f"設定に無い商品 ID です: {product_id}")
        plan_name = plan.name if plan else product_id
        with self._tx() as c:
            r = c.execute("SELECT * FROM subscriptions WHERE original_transaction_id=?", (original_transaction_id,)).fetchone()
            now = time.time()
            if r and r["account_id"] != account_id:
                raise SubscriptionConflict(original_transaction_id)
            if r:
                # 古い取引が後から届いても、失効日時を短くしない
                exp = max(float(r["expires_at"]), float(expires_at))
                c.execute("UPDATE subscriptions SET product_id=?, plan=?, expires_at=?, auto_renew=?, revoked_at=?, "
                          "environment=COALESCE(?, environment), last_transaction_id=COALESCE(?, last_transaction_id), updated=? "
                          "WHERE original_transaction_id=?",
                          (product_id, plan_name, exp, int(auto_renew), revoked_at, environment, last_transaction_id, now,
                           original_transaction_id))
            else:
                c.execute("INSERT INTO subscriptions(original_transaction_id, account_id, product_id, plan, expires_at, "
                          "auto_renew, revoked_at, environment, last_transaction_id, source, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                          (original_transaction_id, account_id, product_id, plan_name, float(expires_at), int(auto_renew),
                           revoked_at, environment, last_transaction_id, source, now))
            return dict(c.execute("SELECT * FROM subscriptions WHERE original_transaction_id=?",
                                  (original_transaction_id,)).fetchone())

    def subscription(self, original_transaction_id):
        r = self._conn().execute("SELECT * FROM subscriptions WHERE original_transaction_id=?",
                                 (original_transaction_id,)).fetchone()
        return dict(r) if r else None

    def update_subscription(self, original_transaction_id, **kw):
        allowed = {"expires_at", "auto_renew", "revoked_at", "product_id", "plan", "last_transaction_id"}
        sets = {k: v for k, v in kw.items() if k in allowed}
        if not sets:
            return self.subscription(original_transaction_id)
        with self._tx() as c:
            c.execute("UPDATE subscriptions SET " + ", ".join(f"{k}=?" for k in sets) + ", updated=? WHERE original_transaction_id=?",
                      (*sets.values(), time.time(), original_transaction_id))
        return self.subscription(original_transaction_id)

    def mark_event(self, event_id, kind):
        """取引・通知を初めて見たなら True(2回目以降は False で、処理しない)"""
        with self._tx() as c:
            cur = c.execute("INSERT OR IGNORE INTO apple_events(id, kind, received) VALUES (?,?,?)", (event_id, kind, time.time()))
            return cur.rowcount == 1

    # ------------------------------------------------------------ プロジェクト
    def create_project(self, account_id, project_id=None):
        pid = project_id or uuid.uuid4().hex
        with self._tx() as c:
            c.execute("INSERT INTO projects(id, account_id, created) VALUES (?,?,?)", (pid, account_id, time.time()))
        return pid

    def project_account(self, project_id):
        r = self._conn().execute("SELECT account_id FROM projects WHERE id=?", (project_id,)).fetchone()
        if not r:
            raise KeyError(project_id)
        return r["account_id"]

    def project_seconds(self, project_id):
        r = self._conn().execute("SELECT COALESCE(SUM(seconds), 0) s, COUNT(*) n FROM project_videos WHERE project_id=?",
                                 (project_id,)).fetchone()
        return float(r["s"]), int(r["n"])

    def add_video(self, project_id, seconds, plan, width=None, height=None, content_hash=None):
        """元動画を足す。合計時間・複数動画の可否をプランで検証する(サーバー側の判定)"""
        with self._tx() as c:
            r = c.execute("SELECT COALESCE(SUM(seconds), 0) s, COUNT(*) n FROM project_videos WHERE project_id=?",
                          (project_id,)).fetchone()
            total, n = float(r["s"]) + float(seconds), int(r["n"])
            if n >= 1 and not plan.multi_video:
                raise MultiVideoNotAllowed(plan.name)
            if total > plan.max_project_seconds + 0.05:          # 長さの測り方の誤差(コンテナの丸め)を少し許す
                raise ProjectTooLong(total, plan.max_project_seconds, plan.name)
            c.execute("INSERT INTO project_videos(project_id, idx, seconds, width, height, content_hash) VALUES (?,?,?,?,?,?)",
                      (project_id, n, float(seconds), width, height, content_hash))
            return total

    def check_project_fits(self, project_id, plan):
        total, n = self.project_seconds(project_id)
        if n > 1 and not plan.multi_video:
            raise MultiVideoNotAllowed(plan.name)
        if total > plan.max_project_seconds + 0.05:
            raise ProjectTooLong(total, plan.max_project_seconds, plan.name)
        return total

    # ------------------------------------------------------------ 利用枠
    def _used(self, c, account_id, project_id, kind, period):
        if kind == "new_edit":
            q = "SELECT COUNT(*) FROM usage WHERE account_id=? AND kind='new_edit' AND period=? AND status IN ('reserved','consumed')"
            return c.execute(q, (account_id, period)).fetchone()[0]
        q = "SELECT COUNT(*) FROM usage WHERE project_id=? AND kind='reedit' AND status IN ('reserved','consumed')"
        return c.execute(q, (project_id,)).fetchone()[0]

    def reserve(self, account_id, project_id, kind, idempotency_key=None, now=None):
        """処理の前に利用枠を確保する。上限なら LimitReached。同じ冪等キーには同じ予約を返す"""
        if kind not in KINDS:
            raise ValueError(kind)
        key = idempotency_key or uuid.uuid4().hex
        now = now or time.time()
        with self._tx() as c:
            r = c.execute("SELECT * FROM usage WHERE idempotency_key=?", (key,)).fetchone()
            if r:
                if r["account_id"] != account_id or r["project_id"] != project_id or r["kind"] != kind:
                    raise ValueError("同じ冪等キーが別の操作に使われています")
                return dict(r, replayed=True)
            plan, _ = self.effective_plan(account_id, now)
            if kind == "reedit":
                self.check_project_fits(project_id, plan)
            period = self.period(now)
            used = self._used(c, account_id, project_id, kind, period)
            limit = plan.monthly_new_edits if kind == "new_edit" else plan.reedits_per_project
            if used >= limit:
                raise LimitReached(kind, limit, used, plan.name)
            uid = uuid.uuid4().hex
            c.execute("INSERT INTO usage(id, account_id, project_id, kind, period, status, idempotency_key, plan, created, updated) "
                      "VALUES (?,?,?,?,?,?,?,?,?,?)", (uid, account_id, project_id, kind, period, "reserved", key, plan.name, now, now))
            return dict(c.execute("SELECT * FROM usage WHERE id=?", (uid,)).fetchone(), replayed=False)

    def _finish(self, usage_id, status, reason=None):
        with self._tx() as c:
            r = c.execute("SELECT status FROM usage WHERE id=?", (usage_id,)).fetchone()
            if not r:
                raise KeyError(usage_id)
            if r["status"] != "reserved":            # 確定済みは変えない(二重の返却・消費を防ぐ)
                return r["status"]
            c.execute("UPDATE usage SET status=?, reason=?, updated=? WHERE id=?", (status, reason, time.time(), usage_id))
            return status

    def consume(self, usage_id):
        return self._finish(usage_id, "consumed")

    def release(self, usage_id, reason):
        return self._finish(usage_id, "released", reason)

    def usage(self, usage_id):
        r = self._conn().execute("SELECT * FROM usage WHERE id=?", (usage_id,)).fetchone()
        if not r:
            raise KeyError(usage_id)
        return dict(r)

    def recover_reserved(self, reason="interrupted"):
        """サーバーの再起動で予約のまま残った利用枠を返却する(処理は終わっていないので消費しない)"""
        with self._tx() as c:
            cur = c.execute("UPDATE usage SET status='released', reason=?, updated=? WHERE status='reserved'",
                            (reason, time.time()))
            return cur.rowcount

    def status(self, account_id, project_ids=(), now=None):
        """マイページ用: プラン・契約・今月の残り・プロジェクトごとの再編集の残り"""
        now = now or time.time()
        plan, sub = self.effective_plan(account_id, now)
        c = self._conn()
        period = self.period(now)
        used = self._used(c, account_id, None, "new_edit", period)
        projects = {}
        for pid in project_ids:
            n = self._used(c, None, pid, "reedit", period)
            projects[pid] = {"reedits_used": n, "reedits_remaining": max(0, plan.reedits_per_project - n),
                             "seconds": self.project_seconds(pid)[0]}
        return {"plan": plan.public(), "period": period,
                "subscription": None if not sub else {"product_id": sub["product_id"], "expires_at": sub["expires_at"],
                                                      "auto_renew": bool(sub["auto_renew"]), "source": sub["source"]},
                "new_edits_used": used, "new_edits_remaining": max(0, plan.monthly_new_edits - used),
                "projects": projects}

    # ------------------------------------------------------------ 原価
    def record_cost(self, *, account_id, project_id, usage_id, run_kind, plan, resolution_class, source_seconds,
                    output_seconds, wall_seconds, cpu_seconds, peak_mb, status, api_cost_jpy=0.0):
        server = cpu_seconds / 3600.0 * self.config.server_cost_jpy_per_cpu_hour
        with self._tx() as c:
            c.execute("INSERT INTO cost_records(account_id, project_id, usage_id, run_kind, plan, resolution_class, source_seconds, "
                      "output_seconds, wall_seconds, cpu_seconds, peak_mb, api_cost_jpy, server_cost_jpy, status, created) "
                      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                      (account_id, project_id, usage_id, run_kind, plan, resolution_class, source_seconds, output_seconds,
                       wall_seconds, cpu_seconds, peak_mb, api_cost_jpy, round(server, 4), status, time.time()))

    def cost_summary(self):
        """プラン別・処理の種類別・解像度別の件数と平均原価、プランごとの採算の目安"""
        rows = self._conn().execute(
            "SELECT plan, run_kind, resolution_class, status, COUNT(*) n, AVG(wall_seconds) wall, AVG(cpu_seconds) cpu, "
            "AVG(source_seconds) src, AVG(api_cost_jpy + server_cost_jpy) cost, SUM(api_cost_jpy + server_cost_jpy) total "
            "FROM cost_records GROUP BY plan, run_kind, resolution_class, status ORDER BY plan, run_kind, resolution_class").fetchall()
        groups = [{k: (round(r[k], 3) if isinstance(r[k], float) else r[k]) for k in r.keys()} for r in rows]
        margin = {}
        for name, p in self.config.plans.items():
            ok = [g for g in groups if g["plan"] == name and g["status"] == "ok"]
            n = sum(g["n"] for g in ok)
            avg = sum(g["total"] for g in ok) / n if n else None
            per_month = avg * (p.monthly_new_edits * (1 + p.reedits_per_project)) if avg is not None else None
            net = p.price_jpy * (1 - self.config.store_fee_rate)
            margin[name] = {"price_jpy": p.price_jpy, "net_after_fee_jpy": round(net, 1),
                            "avg_cost_per_run_jpy": None if avg is None else round(avg, 3),
                            "worst_case_monthly_cost_jpy": None if per_month is None else round(per_month, 1),
                            "note": "最大利用(新規の上限 × (1 + 再編集の上限))での原価。実測の件数が少ないうちは参考値"}
        return {"groups": groups, "margin": margin}
