#!/usr/bin/env python3
"""VAE フックの単体テスト(python3 .claude/hooks/test_vae_hooks.py)"""
import json
import os
import subprocess
import sys

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vae_hooks.py")
ROOT = os.path.abspath(os.path.join(os.path.dirname(HOOK), "..", ".."))


def run(mode, data, env=None):
    e = dict(os.environ, CLAUDE_PROJECT_DIR=ROOT, **(env or {}))
    r = subprocess.run([sys.executable, HOOK, mode], input=json.dumps(data), capture_output=True, text=True, env=e)
    return r.returncode, r.stdout + r.stderr


CASES = [
    # (説明, モード, コマンド, 期待する終了コード)
    ("アップロード動画の削除を止める", "guard", "rm -f /root/.claude/uploads/abc/x.MOV", 2),
    ("確認用出力の削除を止める", "guard", "rm -rf video-eval-output/phase2", 2),
    ("main への強制 push を止める", "guard", "git push --force origin main", 2),
    ("main への -f push を止める", "guard", "git push -f origin main", 2),
    ("VAE の本番公開を止める", "guard", "cd personal-side-projects/video-auto-edit && deploy --prod", 2),
    ("作業ブランチへの通常 push は通す", "guard", "git push -u origin claude/video-autoedit-x", 0),
    ("他事業の通常コマンドは通す", "guard", "cd fx-event-analyzer && npm test", 0),
    ("scratchpad の削除は通す", "guard", "rm -rf /tmp/claude-0/scratch/p12", 0),
    ("別の部分のコピーと削除は通す(2026-11-21 の誤検知の再発防止)", "guard",
     "cp a.mp4 video-eval-output/x/; find personal-side-projects -name __pycache__ -exec rm -rf {} +", 0),
    ("find -delete で確認用出力を消すのは止める", "guard", "find video-eval-output -name '*.mp4' -delete", 2),
    ("&& の後ろの削除も止める", "guard", "ls && rm /root/.claude/uploads/a/b.MOV", 2),
    ("他事業の本番 deploy は対象外", "guard", "cd threads-affiliate && deploy --prod", 0),
    ("コミット以外の git は precommit 対象外", "precommit", "git status", 0),
    # --- 独立レビュー(2026-11-21)で見つかった見逃し ---
    ("git clean -fdx を止める", "guard", "git clean -fdx", 2),
    ("cd してから data を消すのを止める", "guard", "cd personal-side-projects/video-auto-edit && rm -rf data", 2),
    ("~ で始まる uploads の削除を止める", "guard", "rm -rf ~/.claude/uploads", 2),
    ("cd /root/.claude してから uploads を消すのを止める", "guard", "cd /root/.claude && rm -rf uploads", 2),
    ("確認用出力の移動を止める", "guard", "mv video-eval-output /tmp/trash", 2),
    ("rsync --delete で確認用出力を消すのを止める", "guard", "rsync -a --delete empty/ video-eval-output/", 2),
    ("python -c の rmtree を止める", "guard", "python3 -c \"import shutil; shutil.rmtree('video-eval-output')\"", 2),
    ("$HOME で始まる uploads の削除を止める", "guard", "rm -rf $HOME/.claude/uploads/x", 2),
    ("+main への push を止める", "guard", "git push origin +main", 2),
    # --- 独立レビューで見つかった誤検知(他事業の作業を止めない) ---
    ("他事業ブランチ名に main を含む強制 push は通す", "guard", "git push -f origin fx/main-page-fix", 0),
    ("強制 push と別の部分の git log main は通す", "guard", "git push --force origin feature-x && git log main", 0),
    ("production を含む grep は通す", "guard", "grep -rn production personal-side-projects/video-auto-edit/", 0),
    ("他事業の production ビルドは通す", "guard", "cd threads && npm run build -- --mode production # see video-auto-edit notes", 0),
    ("名前の一部が一致するだけのパスの削除は通す", "guard", "rm -rf /tmp/my-video-eval-output-copy", 0),
    ("コミットメッセージ内の文字列は通す", "guard", "git commit -m 'chore: rm old files under video-eval-output'", 0),
    ("ヒアドキュメントの本文は通す", "guard", "cat > notes.md <<'EOF'\nrm -rf video-eval-output は禁止\nEOF", 0),
    ("git clean -fd(.gitignore 対象は消さない)は通す", "guard", "git clean -fd", 0),
]


def main():
    fails = 0
    for desc, mode, cmd, want in CASES:
        code, out = run(mode, {"tool_input": {"command": cmd}})
        ok = code == want
        fails += not ok
        print(("OK  " if ok else "NG  ") + f"{desc}: 終了コード {code}(期待 {want})" + ("" if ok else "\n    " + out.strip()[:300]))
    # stop: stop_hook_active のときは必ず通す(無限ループ防止)
    code, _ = run("stop", {"stop_hook_active": True})
    ok = code == 0
    fails += not ok
    print(("OK  " if ok else "NG  ") + f"stop_hook_active=true は通す: 終了コード {code}")
    print(f"\n{len(CASES) + 1 - fails}/{len(CASES) + 1} 件成功")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
