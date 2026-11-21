#!/usr/bin/env python3
"""動画自動編集AI(VAE)の HQ 用フック。

リポジトリには他の事業も同居しているため、どのフックも VAE に関係する操作のときだけ働き、
それ以外は何もしないで終了する(終了コード0)。

使い方(.claude/settings.json から呼ばれる):
  vae_hooks.py guard        PreToolUse(Bash)  危険な操作を止める
  vae_hooks.py precommit    PreToolUse(Bash)  git commit の前に VAE の検査を行う
  vae_hooks.py stop         Stop              VAE の未コミット変更・状態ファイル未更新を知らせる
  vae_hooks.py session      SessionStart      VAE のブランチなら HANDOVER を案内する

終了コード 2 = Claude Code にその操作を止めさせる(stderr の内容がモデルに渡る)。
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
PRODUCT = "personal-side-projects/video-auto-edit"
VAE_PATHS = (PRODUCT + "/", "docs/autonomous-hq/", "docs/projects/video-auto-edit/", ".claude/",
             ".github/workflows/video-auto-edit-ci.yml")
PROTECTED_MEDIA = ("/root/.claude/uploads", "video-eval-output", PRODUCT + "/data")
MEDIA_EXT = (".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".wav", ".mp3", ".m4a", ".aac", ".flac")
SECRET_PATTERNS = [
    re.compile(r"AKIA[0-9A-Z]{16}"),                     # AWS
    re.compile(r"gh[pousr]_[A-Za-z0-9]{30,}"),           # GitHub
    re.compile(r"sk-[A-Za-z0-9_\-]{32,}"),               # OpenAI / Anthropic 形式
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"xox[baprs]-[A-Za-z0-9-]{20,}"),         # Slack
    re.compile(r"AIza[0-9A-Za-z_\-]{35}"),               # Google API
]


def git(*args):
    r = subprocess.run(["git", "-C", ROOT, *args], capture_output=True, text=True)
    return r.stdout


def block(msg):
    sys.stderr.write("[VAE HQ フック] " + msg + "\n")
    sys.exit(2)


def read_input():
    try:
        return json.load(sys.stdin)
    except Exception:
        return {}


def _tokens(seg):
    import shlex
    try:
        return shlex.split(seg, comments=True)
    except ValueError:
        return seg.split()


HEREDOC_RE = re.compile(r"<<-?\s*(['\"]?)(\w+)\1([^\n]*)\n.*?\n\2[ \t]*(?=\n|$)", re.S)
WRAPPERS = ("sudo", "env", "nohup", "time", "nice", "ionice", "timeout", "xargs", "command", "exec")
MEDIA_GLOB = re.compile(r"\*\.(mp4|mov|m4v|mkv|webm|wav|mp3|m4a|aac|flac)\b", re.I)


def _segments(cmd):
    """; && || | 改行 で区切る(引用符の中は区切らない)。ヒアドキュメントの本文は実行されないので除く
    (区切り記号の後ろにリダイレクトがある `cat <<'EOF' > file` の形にも対応)"""
    cmd = HEREDOC_RE.sub(lambda m: m.group(3), cmd)
    out, cur, q = [], "", None
    i = 0
    while i < len(cmd):
        c = cmd[i]
        if q:
            cur += c
            if c == q:
                q = None
        elif c in "'\"":
            q = c
            cur += c
        elif cmd.startswith("&&", i) or cmd.startswith("||", i):
            out.append(cur)
            cur = ""
            i += 1
        elif c in ";|\n":
            out.append(cur)
            cur = ""
        else:
            cur += c
        i += 1
    out.append(cur)
    return [s.strip() for s in out if s.strip()]


def _protected_targets():
    home = os.path.expanduser("~")
    return [os.path.join(home, ".claude", "uploads"), os.path.join(ROOT, "video-eval-output"),
            os.path.join(ROOT, PRODUCT, "data")]


def _resolve(t, cwd):
    import fnmatch  # noqa: F401
    home = os.path.expanduser("~")
    t = t.replace("${HOME}", home).replace("$HOME", home)
    if t.startswith("~"):
        t = home + t[1:]
    base = cwd if cwd else ROOT
    return os.path.normpath(t if t.startswith("/") else os.path.join(base, t))


def _protected_hit(toks, cwd, ancestors=True):
    """引数のどれかが保護対象(ユーザーの動画素材・確認用出力・製品の data/)そのもの、その中身、またはその親フォルダを指すか"""
    import fnmatch
    targets = _protected_targets()
    for t in toks:
        if not t or t.startswith("-"):
            continue
        p = _resolve(t, cwd)
        for tgt in targets:
            if p == tgt or p.startswith(tgt + os.sep):           # 保護対象そのもの・中身
                return True
            if ancestors and tgt.startswith(p + os.sep) and p not in ("/", "/tmp"):   # 親フォルダごと消す
                return True
            if any(ch in t for ch in "*?[") and (fnmatch.fnmatch(tgt, p) or fnmatch.fnmatch(tgt, p + "/*")):
                return True                                       # ワイルドカード(video-eval-* など)
    return False


def _unwrap(toks):
    """sudo / env / timeout などの前置きを外し、bash -c '...' は中身を返す"""
    while toks and os.path.basename(toks[0]) in WRAPPERS:
        toks = toks[1:]
        while toks and (toks[0].startswith("-") or "=" in toks[0] or re.fullmatch(r"\d+[smh]?", toks[0])):
            toks = toks[1:]
    if toks and os.path.basename(toks[0]) in ("bash", "sh", "zsh") and "-c" in toks:
        i = toks.index("-c")
        if i + 1 < len(toks):
            return None, toks[i + 1]
    return toks, None


def _git_sub(args):
    """git の -C <dir> などの前置きを外して (サブコマンド, 残り, -C の場所) を返す"""
    cdir = None
    while args and args[0].startswith("-"):
        if args[0] == "-C" and len(args) > 1:
            cdir = args[1]
            args = args[2:]
        elif args[0] in ("-c",) and len(args) > 1:
            args = args[2:]
        else:
            args = args[1:]
    return (args[0] if args else ""), args[1:], cdir


def _check_segment(seg, state, depth=0):
    toks = _tokens(seg)
    toks, inner = _unwrap(toks)
    if inner is not None:
        if depth < 3:
            for s2 in _segments(inner):
                _check_segment(s2, state, depth + 1)
        return
    if not toks:
        return
    prog = os.path.basename(toks[0])
    args = toks[1:]
    if prog == "cd":
        target = args[0] if args else os.path.expanduser("~")
        state["cwd"] = _resolve(target, state["cwd"])            # 最後の cd だけを有効にする
        return
    cwd = state["cwd"]
    # 1) ユーザーの動画素材の削除・移動(実行されるコマンドの引数だけを見る)
    check_args, ancestors = None, True
    if prog in ("rm", "shred", "truncate", "unlink"):
        check_args = args
    elif prog == "mv":
        check_args = [a for a in args if not a.startswith("-")][:-1]   # 移動元だけ(保護フォルダへの移動は許可)
    elif prog == "find" and ("-delete" in args or ("-exec" in args and "rm" in args)):
        if MEDIA_GLOB.search(" ".join(args)):
            block("動画・音声ファイルを find でまとめて削除することは禁止されています(ユーザーの動画素材を巻き込むおそれ)。")
        check_args = [a for a in args if not a.startswith("-")][:1] or ["."]
        ancestors = False                                  # 条件に合うものだけを消すので、親フォルダの指定は許可
    elif prog == "rsync" and any(a.startswith("--delete") for a in args):
        check_args = [a for a in args if not a.startswith("-")][-1:]
        ancestors = False
    elif prog.startswith("python") and "-c" in args and re.search(r"rmtree|remove|unlink|rmdir", " ".join(args)):
        check_args = re.findall(r"['\"]([^'\"]+)['\"]", " ".join(args))
    if check_args is not None:
        globbed = [a for a in check_args if a in ("*", "./*", ".") ]
        if _protected_hit([a for a in check_args if a not in globbed], cwd, ancestors) or \
                (globbed and cwd and any(cwd == t or cwd.startswith(t + os.sep) or t.startswith(cwd + os.sep)
                                         for t in _protected_targets())):
            block("ユーザーの動画素材・確認用出力の削除・移動は禁止されています(" + ", ".join(PROTECTED_MEDIA) +
                  ")。不要なら HQ が BLOCKERS に記録し、人間に確認してください。")
    if prog == "git":
        sub, rest, cdir = _git_sub(args)
        if sub == "clean" and any(re.match(r"^-[a-zA-Z]*[xX]", a) for a in rest):
            block("`git clean -x` / `-X` は .gitignore 対象(動画素材・確認用出力・data/)を消すため禁止されています。")
        # 2) main/master への強制 push(refspec だけを見る。他事業のブランチ名に main を含んでも止めない)
        if sub == "push":
            opts = [a for a in rest if a.startswith("-")]
            pos = [a for a in rest if not a.startswith("-")]
            refs = pos[1:]
            force = any(o == "--force" or o.startswith("--force-with-lease") or
                        (re.fullmatch(r"-[a-zA-Z]+", o) and "f" in o) for o in opts) or any(r.startswith("+") for r in refs)
            if force:
                cur = git("branch", "--show-current").strip()
                targets = [r.lstrip("+").split(":")[-1] for r in refs] or [cur]
                if any(t in ("main", "master", "refs/heads/main", "refs/heads/master") or (t == "HEAD" and cur in ("main", "master"))
                       for t in targets):
                    block("main/master への強制 push は禁止されています。")
    # 3) VAE の本番公開(人間の承認が必要)。deploy 系のコマンドで、VAE を対象にしたものだけ
    deploy = prog in ("vercel", "netlify", "fly", "flyctl", "firebase", "render", "railway") or \
        "deploy" in args[:3] or prog.endswith("deploy")
    vae_ctx = "video-auto-edit" in seg or (cwd and "video-auto-edit" in cwd)
    if deploy and vae_ctx and any(a in ("--prod", "--production", "production", "prod") for a in args):
        block("本番公開には人間の承認が必要です。RELEASE_STATUS.md に記録して停止してください。")


def guard(data):
    cmd = (data.get("tool_input") or {}).get("command", "")
    if not cmd:
        return
    state = {"cwd": None}
    for seg in _segments(cmd):
        _check_segment(seg, state)


def find_python():
    for p in (os.path.join(ROOT, PRODUCT, ".venv/bin/python"), "/tmp/vedit-poc/.venv/bin/python"):
        if os.path.exists(p):
            return p
    return None


def precommit(data):
    cmd = (data.get("tool_input") or {}).get("command", "")
    if not re.search(r"\bgit\b(?:\s+-C\s+\S+)?\s+commit\b", cmd):
        return
    staged = [f for f in git("diff", "--cached", "--name-only").splitlines() if f]
    # `git commit -a` / `git add ... && git commit` は、この時点ではまだ未ステージの可能性がある
    if re.search(r"\bcommit\b[^;&|]*\s-(a|am)\b", cmd) or "git add" in cmd:
        staged += [f for f in git("diff", "--name-only").splitlines() if f]
        staged += [f for f in git("ls-files", "--others", "--exclude-standard").splitlines() if f]
    vae_files = sorted({f for f in staged if f.startswith(VAE_PATHS)})
    if not vae_files:
        return
    problems = []
    # 1) 動画・音声ファイルのコミット禁止
    media = [f for f in vae_files if f.lower().endswith(MEDIA_EXT)]
    if media:
        problems.append("動画・音声ファイルはコミットできません: " + ", ".join(media[:5]))
    # 2) 秘密情報
    for f in vae_files:
        path = os.path.join(ROOT, f)
        if not os.path.isfile(path) or os.path.getsize(path) > 2_000_000:
            continue
        try:
            text = open(path, encoding="utf-8", errors="ignore").read()
        except OSError:
            continue
        for pat in SECRET_PATTERNS:
            if pat.search(text):
                problems.append(f"秘密情報らしき文字列があります: {f}(パターン {pat.pattern[:20]}…)")
                break
    # 3) 製品コードを含むなら、構文チェックと速いテスト
    code = [f for f in vae_files if f.startswith(PRODUCT + "/") and f.endswith(".py")]
    if code:
        py = find_python()
        if py is None:
            sys.stderr.write("[VAE HQ フック] 警告: テスト用の Python 環境が見つからないため、テストを省略しました。"
                             f"`cd {PRODUCT} && make setup` で用意してください。\n")
        else:
            existing = [os.path.join(ROOT, f) for f in code if os.path.exists(os.path.join(ROOT, f))]
            r = subprocess.run([py, "-m", "py_compile", *existing], capture_output=True, text=True)
            if r.returncode != 0:
                problems.append("構文エラー:\n" + r.stderr[-1500:])
            else:
                r = subprocess.run([py, "-m", "pytest", "-m", "not slow", "-q", "-x", "-p", "no:cacheprovider"],
                                   cwd=os.path.join(ROOT, PRODUCT), capture_output=True, text=True, timeout=900)
                if r.returncode not in (0, 5):          # 5 = テストが0件
                    problems.append("速いテストが失敗しました(pytest -m 'not slow'):\n" + (r.stdout + r.stderr)[-2500:])
    if problems:
        block("コミット前の検査で問題が見つかりました。修正してから再度コミットしてください。\n- " + "\n- ".join(problems))


VAE_STOP_PATHS = (PRODUCT + "/", "docs/autonomous-hq/", "docs/projects/video-auto-edit/",
                  ".github/workflows/video-auto-edit-ci.yml", ".claude/hooks/vae_hooks.py", ".claude/hooks/test_vae_hooks.py")


def stop(data):
    if data.get("stop_hook_active"):
        return                                         # 無限ループ防止
    # VAE の作業ブランチのセッションだけ対象にする(他事業のセッションを止めない)
    if not re.search(r"video|vae", git("branch", "--show-current").strip()):
        return
    changed = [l[3:] for l in git("status", "--porcelain").splitlines() if len(l) > 3]
    vae_changed = [f for f in changed if f.startswith(VAE_STOP_PATHS)]
    if not vae_changed:
        return
    code_changed = [f for f in vae_changed if f.startswith(PRODUCT + "/")]
    state_touched = any(f.startswith("docs/autonomous-hq/") for f in vae_changed)
    msg = ["VAE の未コミット変更があります: " + ", ".join(vae_changed[:8]) + (" ほか" if len(vae_changed) > 8 else "")]
    if code_changed and not state_touched:
        msg.append("製品コードを変えた場合は docs/autonomous-hq/ の PROJECT_STATE.md・TASKS.md・HANDOVER.md も更新してください。")
    msg.append("テストを実行してからコミット・プッシュしてください(session-handover スキル参照)。")
    block("\n".join(msg))


def session(data):
    branch = git("branch", "--show-current").strip()
    if not re.search(r"video|vae", branch):
        return
    hand = os.path.join(ROOT, "docs/autonomous-hq/HANDOVER.md")
    if os.path.exists(hand):
        print(f"[VAE HQ] ブランチ {branch}: まず docs/autonomous-hq/HANDOVER.md を読んで再開してください"
              "(session-handover スキル)。")


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    data = read_input()
    {"guard": guard, "precommit": precommit, "stop": stop, "session": session}.get(mode, lambda d: None)(data)


if __name__ == "__main__":
    main()
