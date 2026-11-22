"""同じ動画の再アップロードの検出(AC-B4)。

プランの上限・利用回数は `vae.billing`(config/plans.json と SQLite)で管理する(料金仕様 v1)。
ここでは「同じ端末が同じ動画をもう一度送ったら、新しく処理せずに既存のジョブを返す」ための記録だけを持つ。
"""
import hashlib
import json
import os
import threading

from .billing import config as _config


def get(name=None):
    """設定ファイルのプランを返す(無い名前は free)。CLI と互換のための入口"""
    return _config.load().plan(name or "free")


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
    """処理済み動画のハッシュ → ジョブ ID(ローカルの JSON ファイル)"""

    def __init__(self, path: str):
        self.path = path
        self.lock = threading.Lock()

    def _load(self):
        try:
            with open(self.path) as f:
                d = json.load(f)
        except (OSError, json.JSONDecodeError):
            d = {}
        d.setdefault("hashes", {})
        return d

    def _save(self, d):
        tmp = self.path + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"hashes": d["hashes"]}, f)
        os.replace(tmp, self.path)

    def find(self, content_key: str):
        with self.lock:
            return self._load()["hashes"].get(content_key)

    def remember(self, content_key: str, job_id: str):
        with self.lock:
            d = self._load()
            d["hashes"][content_key] = job_id
            self._save(d)

    def forget_job(self, job_id: str):
        with self.lock:
            d = self._load()
            d["hashes"] = {h: j for h, j in d["hashes"].items() if j != job_id}
            self._save(d)
