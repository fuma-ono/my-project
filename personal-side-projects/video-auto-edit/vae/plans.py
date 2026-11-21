"""料金プランの拡張点と、無料枠の悪用防止(AC-B1, AC-B2, AC-B4)。

課金・決済は実装しない(有料サービスの契約・課金は人間の承認が必要)。
ここでは「プランごとの上限」と「無料枠の使いすぎを防ぐ仕組み」だけを持つ。
"""
import hashlib
import json
import os
import threading
import time
from dataclasses import dataclass


@dataclass(frozen=True)
class Plan:
    name: str
    label: str
    max_seconds: float          # 入力動画の長さの上限
    model: str                  # 文字起こしモデル
    daily_limit: int            # 端末(client_id)ごとの1日あたりの処理回数。0 は無制限
    max_concurrent: int = 1


PLANS = {
    "free": Plan("free", "無料", max_seconds=30.0, model="medium", daily_limit=10),
    # 有料プランの例(未提供)。課金の仕組みは人間の承認後に別途実装する
    "standard": Plan("standard", "スタンダード(準備中)", max_seconds=600.0, model="medium", daily_limit=0),
}
DEFAULT_PLAN = "free"


def get(name: str | None) -> Plan:
    return PLANS.get(name or DEFAULT_PLAN, PLANS[DEFAULT_PLAN])


def file_hash(path: str, chunk=1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


class UsageLedger:
    """端末ごとの1日の利用回数と、処理済み動画のハッシュを記録する(ローカルの JSON ファイル)"""

    def __init__(self, path: str):
        self.path = path
        self.lock = threading.Lock()

    def _load(self):
        try:
            with open(self.path) as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError):
            return {"usage": {}, "hashes": {}}

    def _save(self, d):
        tmp = self.path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(d, f)
        os.replace(tmp, self.path)

    def check_and_count(self, client_id: str, plan: Plan, content_hash: str, now=None):
        """使えるなら (True, 既存ジョブID or None)。上限超過なら (False, 理由)"""
        day = time.strftime("%Y-%m-%d", time.gmtime(now or time.time()))
        with self.lock:
            d = self._load()
            if content_hash in d["hashes"]:
                return True, d["hashes"][content_hash]          # 同じ動画は再処理せず既存の結果を返す
            key = f"{client_id}:{day}"
            used = d["usage"].get(key, 0)
            if plan.daily_limit and used >= plan.daily_limit:
                return False, f"本日の{plan.label}プランの利用回数の上限({plan.daily_limit}回)に達しました。"
            d["usage"][key] = used + 1
            cutoff = time.strftime("%Y-%m-%d", time.gmtime((now or time.time()) - 7 * 86400))
            d["usage"] = {k: v for k, v in d["usage"].items() if k.rsplit(":", 1)[-1] >= cutoff}   # 古い日付を消す
            self._save(d)
            return True, None

    def remember(self, content_hash: str, job_id: str):
        with self.lock:
            d = self._load()
            d["hashes"][content_hash] = job_id
            self._save(d)

    def forget_job(self, job_id: str):
        with self.lock:
            d = self._load()
            d["hashes"] = {h: j for h, j in d["hashes"].items() if j != job_id}
            self._save(d)
