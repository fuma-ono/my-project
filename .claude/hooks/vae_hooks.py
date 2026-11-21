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


def _segments(cmd):
    """; && || | 改行 で区切る(引用符の中は区切らない)。ヒアドキュメントの本文は除く"""
    cmd = re.sub(r"<<-?\s*'?\"?(\w+)'?\"?\n.*?\n\1\b", "", cmd, flags=re.S)   # ヒアドキュメントの本文は実行されない
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


def _protected_hit(toks, cwd_hints):
    """引数のどれかが保護対象(ユーザーの動画素材・確認用出力・製品の data/)を指すか"""
    home = os.path.expanduser("~")
    for t in toks:
        t2 = t.replace("${HOME}", home).replace("$HOME", home)
        if t2.startswith("~"):
            t2 = home + t2[1:]
        parts = [x for x in t2.split("/") if x not in ("", ".")]
        joined = "/" + "/".join(parts)
        # パスの区切りごとに完全一致で判定する(名前の一部に含むだけのパスは止めない)
        if "video-eval-output" in parts:
            return True
        if "/.claude/uploads" in joined + "/" and (joined + "/").find("/.claude/uploads/") >= 0 or joined.endswith("/.claude/uploads"):
            return True
        if "/video-auto-edit/data" in joined and (joined.endswith("/video-auto-edit/data") or "/video-auto-edit/data/" in joined):
            return True
        first = parts[0] if parts and not t2.startswith("/") else ""
        if first == "uploads" and any(".claude" in h for h in cwd_hints):
            return True
        if first == "data" and any("video-auto-edit" in h for h in cwd_hints):
            return True
    return False


def guard(data):
    cmd = (data.get("tool_input") or {}).get("command", "")
    if not cmd:
        return
    segs = _segments(cmd)
    cwd_hints = []
    for seg in segs:
        toks = _tokens(seg)
        if not toks:
            continue
        prog = os.path.basename(toks[0])
        if prog == "cd" and len(toks) > 1:
            cwd_hints.append(toks[1])
            continue
        args = toks[1:]
        # 1) ユーザーの動画素材の削除・移動(実行されるコマンドの引数だけを見る。コメントや文字列の中は見ない)
        destructive = prog in ("rm", "shred", "truncate", "unlink", "mv") or \
            (prog == "find" and ("-delete" in args or ("-exec" in args and "rm" in args))) or \
            (prog == "rsync" and any(a.startswith("--delete") for a in args)) or \
            (prog.startswith("python") and "-c" in args and re.search(r"rmtree|remove|unlink", " ".join(args)))
        check_args = args
        if prog.startswith("python") and "-c" in args:
            # コードの中の引用符で囲まれた文字列をパスとして調べる
            check_args = re.findall(r"['\"]([^'\"]+)['\"]", " ".join(args))
        if destructive and _protected_hit(check_args, cwd_hints):
            block("ユーザーの動画素材・確認用出力の削除・移動は禁止されています(" + ", ".join(PROTECTED_MEDIA) +
                  ")。不要なら HQ が BLOCKERS に記録し、人間に確認してください。")
        if prog == "git" and args[:1] == ["clean"] and any(re.match(r"^-[a-zA-Z]*[xX]", a) for a in args[1:]):
            block("`git clean -x` / `-X` は .gitignore 対象(動画素材・確認用出力・data/)を消すため禁止されています。")
        # 2) main/master への強制 push(refspec だけを見る。他事業のブランチ名に main を含んでも止めない)
        if prog == "git" and args[:1] == ["push"]:
            opts = [a for a in args[1:] if a.startswith("-")]
            pos = [a for a in args[1:] if not a.startswith("-")]
            refs = pos[1:]
            force = any(o in ("-f", "--force") or o.startswith("--force-with-lease") for o in opts) or \
                any(r.startswith("+") for r in refs)
            if force:
                targets = [r.lstrip("+").split(":")[-1] for r in refs] or [git("branch", "--show-current").strip()]
                if any(t in ("main", "master", "refs/heads/main", "refs/heads/master") or
                       (t == "HEAD" and git("branch", "--show-current").strip() in ("main", "master")) for t in targets):
                    block("main/master への強制 push は禁止されています。")
        # 3) VAE の本番公開(人間の承認が必要)。deploy 系のコマンドで、VAE を対象にしたものだけ
        deploy = prog in ("vercel", "netlify", "fly", "flyctl", "firebase", "render", "railway") or \
            "deploy" in args[:3] or prog.endswith("deploy")
        vae_ctx = any("video-auto-edit" in x for x in [seg] + cwd_hints)
        if deploy and vae_ctx and any(a in ("--prod", "--production", "production", "prod") for a in args):
            block("本番公開には人間の承認が必要です。RELEASE_STATUS.md に記録して停止してください。")


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
