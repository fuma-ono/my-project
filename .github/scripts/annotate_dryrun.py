#!/usr/bin/env python3
"""dry-run の出力(RUNNER_TEMP/<name>.json・.err・.exit)を、GitHub Actions の注記(::notice)にする(HQ指示 2026-11-13)。

出すもの: 終了コード・標準エラー(先頭だけ)・要約(plan を除く)・plan を [指標, 操作, 日時または期間, 値, 理由] の表にしたもの。
鍵・接続情報は、出力の元(ジョブの dry-run)が出さない。使い方: python3 annotate_dryrun.py <name>
"""
import json
import os
import sys

tmp, name = os.environ['RUNNER_TEMP'], sys.argv[1]


def out(title, value):
    body = json.dumps(value, ensure_ascii=False).replace('%', '%25').replace('\r', '').replace('\n', '%0A')
    print(f'::notice title={title}::{body[:3800]}')


out(f'gbauca {name} exit', open(f'{tmp}/{name}.exit').read().strip())
err = open(f'{tmp}/{name}.err', errors='replace').read().strip()
if err:
    out(f'gbauca {name} stderr', err[:1500])
text = open(f'{tmp}/{name}.json', errors='replace').read().strip()
try:
    data = json.loads(text.splitlines()[-1])
except Exception:
    out(f'gbauca {name} raw', text[:1500])
    raise SystemExit(0)
plan = data.pop('plan', [])
out(f'gbauca {name} summary', data)
rows = [
    [p.get('indicator'), p.get('action'), p.get('release_datetime') or p.get('period'), p.get('value'), p.get('reason')]
    for p in plan
]
for i in range(0, min(len(rows), 60), 20):
    out(f'gbauca {name} plan {i // 20 + 1}', rows[i : i + 20])
