#!/usr/bin/env python3
"""要人発言の定期実行のステップの条件を確かめる(HQレビュー 2026-11-12「main workflow を GitHub Actions で検証」)。

使い方: python3 .github/scripts/check_speech_schedule_steps.py .github/workflows/fx-event-analyzer-ingestion.yml
確かめること(1つでも違えば exit 1):
  - YAML として読める
  - 「Speeches」の直後に本文、その直後に要約の定期のステップがある
  - どちらも !cancelled()・DEV の確認(steps.check.outputs.ready)・schedule イベント・'41 */3 * * *' を条件にする
  - どちらも continue-on-error・failure() を使わない(失敗はジョブの失敗として残す)
  - 本文は --scheduled、要約は --scheduled で動く
  - DEV の確認のステップが、鍵の ref と DEV_PROJECT_REF を比べている。DEV_PROJECT_REF が DEV の ref
  - 3時間ごとの回は fx-ingestion-speeches のグループで、cancel-in-progress: false
  - コードは claude/fx-settings-screens から取る
外部への通信なし(標準ライブラリと PyYAML だけ)。
"""
import re
import sys

import yaml

DEV_REF = 'pbemckwnqmeaoveelihd'
SCHEDULE = "41 */3 * * *"


def fail(message: str) -> None:
    print(f'NG: {message}')
    sys.exit(1)


def main(path: str) -> None:
    text = open(path, encoding='utf-8').read().replace('\r\n', '\n')
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as error:
        fail(f'YAML として読めない: {error}')
    steps = data['jobs']['ingest']['steps']
    names = [s.get('name', s.get('uses', '')) for s in steps]
    if 'Speeches' not in names:
        fail('Speeches のステップが無い')
    i = names.index('Speeches')
    expected = [
        ('Speech bodies (scheduled', 'npm run -s ingest:speech-bodies -- --scheduled'),
        ('Speech summaries (scheduled', 'npm run -s ingest:speech-summaries -- --scheduled'),
    ]
    for offset, (prefix, run) in enumerate(expected, start=1):
        if i + offset >= len(steps) or not str(names[i + offset]).startswith(prefix):
            fail(f'Speeches の {offset} つ後が {prefix}… でない(実際: {names[i + offset] if i + offset < len(names) else "なし"})')
        step = steps[i + offset]
        cond = str(step.get('if', ''))
        for need in ['!cancelled()', "steps.check.outputs.ready == 'true'", "github.event_name == 'schedule'",
                     f"github.event.schedule == '{SCHEDULE}'"]:
            if need not in cond:
                fail(f'{prefix}… の if に {need} が無い')
        if 'failure()' in cond or 'continue-on-error' in step:
            fail(f'{prefix}… が failure()/continue-on-error を使っている')
        if str(step.get('run', '')).strip() != run:
            fail(f'{prefix}… の run が {run} でない')
    check = next((s for s in steps if s.get('id') == 'check'), None)
    if not check or '"$KEY_REF" != "$DEV_PROJECT_REF"' not in str(check.get('run', '')):
        fail('DEV の確認(鍵の ref と DEV_PROJECT_REF の比較)が無い')
    if data['jobs']['ingest'].get('env', {}).get('DEV_PROJECT_REF') != DEV_REF:
        fail('DEV_PROJECT_REF が DEV の ref でない')
    group = str(data.get('concurrency', {}).get('group', ''))
    if not re.search(r"github\.event\.schedule == '41 \*/3 \* \* \*' \|\|.*'fx-ingestion-speeches'", group):
        fail('3時間ごとの回が fx-ingestion-speeches のグループでない')
    if data.get('concurrency', {}).get('cancel-in-progress') is not False:
        fail('cancel-in-progress が false でない')
    if 'ref: claude/fx-settings-screens' not in text:
        fail('コードを claude/fx-settings-screens から取っていない')
    print('OK: speech schedule steps')


if __name__ == '__main__':
    main(sys.argv[1])
