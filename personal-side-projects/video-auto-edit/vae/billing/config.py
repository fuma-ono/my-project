"""料金・利用制限の設定(config/plans.json)を読む。価格・上限・商品 ID はコードに書かない"""
import json
import os
from dataclasses import dataclass, field

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                            "config", "plans.json")


@dataclass(frozen=True)
class PlanSpec:
    name: str
    label: str
    price_jpy: int
    period: str
    max_project_seconds: float
    monthly_new_edits: int
    reedits_per_project: int
    max_short_side: int
    allow_4k: bool
    multi_video: bool
    priority: int
    concepts: str
    watermark: bool
    model: str
    product_ids: tuple = ()

    def public(self):
        return {"name": self.name, "label": self.label, "price_jpy": self.price_jpy, "period": self.period,
                "max_project_seconds": self.max_project_seconds, "monthly_new_edits": self.monthly_new_edits,
                "reedits_per_project": self.reedits_per_project, "max_short_side": self.max_short_side,
                "allow_4k": self.allow_4k, "multi_video": self.multi_video, "priority": self.priority > 0,
                "concepts": self.concepts, "watermark": self.watermark}


@dataclass(frozen=True)
class Config:
    plans: dict
    concepts: tuple
    timezone_offset_hours: float = 9
    server_cost_jpy_per_cpu_hour: float = 0.0
    store_fee_rate: float = 0.0
    allow_4k: bool = False
    apple: dict = field(default_factory=dict)

    def plan(self, name):
        return self.plans.get(name) or self.plans["free"]

    def plan_for_product(self, product_id):
        for p in self.plans.values():
            if product_id in p.product_ids:
                return p
        return None

    def concepts_for(self, plan):
        return [c for c in self.concepts if plan.concepts == "all" or c["tier"] == "basic"]

    def concept(self, cid, plan):
        """プランで使える編集コンセプトを返す。使えなければ None"""
        return next((c for c in self.concepts_for(plan) if c["id"] == cid), None)


def load(path=None):
    path = path or os.environ.get("VAE_PLANS_CONFIG") or DEFAULT_PATH
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    plans = {}
    for name, p in d["plans"].items():
        plans[name] = PlanSpec(name=name, label=p["label"], price_jpy=int(p["price_jpy"]), period=p["period"],
                               max_project_seconds=float(p["max_project_seconds"]),
                               monthly_new_edits=int(p["monthly_new_edits"]),
                               reedits_per_project=int(p["reedits_per_project"]), max_short_side=int(p["max_short_side"]),
                               allow_4k=bool(p["allow_4k"]), multi_video=bool(p["multi_video"]), priority=int(p["priority"]),
                               concepts=p["concepts"], watermark=bool(p["watermark"]), model=p["model"],
                               product_ids=tuple(p.get("product_ids", ())))
    if "free" not in plans:
        raise ValueError("plans.json に free プランがありません")
    return Config(plans=plans, concepts=tuple(d.get("concepts", ())),
                  timezone_offset_hours=float(d.get("timezone_offset_hours", 9)),
                  server_cost_jpy_per_cpu_hour=float(d.get("server_cost_jpy_per_cpu_hour", 0)),
                  store_fee_rate=float(d.get("store_fee_rate", 0)), allow_4k=bool(d.get("allow_4k", False)),
                  apple=dict(d.get("apple", {})))
