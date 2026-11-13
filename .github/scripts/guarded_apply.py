#!/usr/bin/env python3
"""DEV への書き込みの安全装置(HQ指示 2026-11-13「承認した範囲だけ実行」)。

使い方:
  guarded_apply.py decide <name> <dryrun-output-file> <rules-json>   dry-run の出力が、承認した内容と一致するかを判定する
  guarded_apply.py report <name> <output-file> <exit-file>            実行の結果(1行の JSON)を注記にする

decide: dry-run の出力(最後の行の JSON)を読み、rules に照らして decision を GITHUB_OUTPUT に書く。
  rules = {"apply": {"a.b": 値, ...}, "noop": {"a.b": 値, ...}, "empty": ["errors", ...], "null": ["credit_refusal", ...]}
  - empty / null の条件がすべて成り立ち、かつ apply の等式がすべて成り立つ → decision=apply(これから書く)
  - empty / null の条件がすべて成り立ち、かつ noop の等式がすべて成り立つ → decision=noop(すでに反映済み。何も書かない)
  - それ以外 → decision=stop(書かない。ステップは失敗にする)
  出力する注記には、件数と判定だけを入れる(鍵・接続情報は元の出力に無い)。
"""
import json
import os
import sys


def note(title, value):
    body = json.dumps(value, ensure_ascii=False).replace('%', '%25').replace('\r', '').replace('\n', '%0A')
    print(f'::notice title={title}::{body[:3800]}')


def dig(data, path):
    cur = data
    for key in path.split('.'):
        if not isinstance(cur, dict) or key not in cur:
            return ('<missing>',)
        cur = cur[key]
    return cur


def last_json(text):
    for line in reversed(text.strip().splitlines()):
        line = line.strip()
        if line.startswith('{'):
            return json.loads(line)
    raise ValueError('no JSON line in the output')


def set_output(name, value):
    path = os.environ.get('GITHUB_OUTPUT')
    if path:
        with open(path, 'a', encoding='utf-8') as f:
            f.write(f'{name}={value}\n')


def decide(name, out_file, rules_json):
    rules = json.loads(rules_json)
    try:
        data = last_json(open(out_file, encoding='utf-8', errors='replace').read())
    except Exception as error:  # 読めなければ書かない
        note(f'apply {name} decision', {'decision': 'stop', 'reason': f'unreadable dry-run output: {error}'})
        set_output('decision', 'stop')
        return 1
    problems = []
    for path in rules.get('empty', []):
        if dig(data, path) != []:
            problems.append(f'{path} is not empty')
    for path in rules.get('null', []):
        if dig(data, path) is not None:
            problems.append(f'{path} is not null')
    if data.get('dry_run') is not True:
        problems.append('the output is not a dry run')

    def matches(expect):
        return all(dig(data, path) == value for path, value in expect.items())

    if problems:
        decision = 'stop'
    elif matches(rules['apply']):
        decision = 'apply'
    elif matches(rules['noop']):
        decision = 'noop'
    else:
        decision = 'stop'
    observed = {path: dig(data, path) for path in {*rules['apply'], *rules['noop']}}
    note(
        f'apply {name} decision',
        {'decision': decision, 'problems': problems, 'observed': observed, 'expected_apply': rules['apply']},
    )
    set_output('decision', decision)
    return 1 if decision == 'stop' else 0


def report(name, out_file, exit_file):
    note(f'apply {name} exit', open(exit_file).read().strip())
    text = open(out_file, encoding='utf-8', errors='replace').read()
    try:
        data = last_json(text)
    except Exception:
        note(f'apply {name} raw', text[-1500:])
        return 0
    plan = data.pop('plan', None)
    note(f'apply {name} result', data)
    if plan is not None:
        note(f'apply {name} plan', plan)
    return 0


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'decide':
        sys.exit(decide(sys.argv[2], sys.argv[3], sys.argv[4]))
    if cmd == 'report':
        sys.exit(report(sys.argv[2], sys.argv[3], sys.argv[4]))
    sys.exit(f'unknown command {cmd}')
