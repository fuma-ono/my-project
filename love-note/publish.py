"""恋愛ジャンルnote 自動投稿スクリプト。

★重要: このスクリプトはオーナーのPC上でのみ実行できる。
このリポジトリのクラウド環境からは note.com への接続がネットワークポリシーで
ブロックされていることを確認済み(bgm-pipelineのnote連携でも同じ制約に当たった)。

★重要: note.comの実際のログイン画面・エディタ画面に対して、この環境からは
一度もアクセスできていないため、下記のセレクタ(CSSセレクタ)は未検証。
初回実行は必ず --debug を付けて、ブラウザの動きを目で確認しながら
セレクタを実際の画面に合わせて調整すること(bgm-pipelineのnote連携の
初回導入時と同じ手順)。

## セットアップ(初回のみ、オーナーのPCで実行)

1. `pip install playwright && playwright install chromium`
2. `python love-note/auth_setup.py` を実行 → 開いたブラウザで手動ログイン
   → ログイン後にEnterを押すとセッション情報が `love-note/storage-state.json`
   に保存される(このファイルはパスワードそのものではなく、ログイン済みの
   ブラウザセッション情報。第三者に渡すとアカウントを乗っ取られるのと同じ
   なので、.gitignore 済み・絶対にコミットしない)
3. 以降は `python love-note/publish.py --debug` で動作確認しながら本番実行

## 定期実行したい場合

このリポジトリのRoutine(クラウド)からは実行できないため、オーナー自身の
PC/家サーバー等でcron・タスクスケジューラ等に登録する。
"""

import argparse
import json
import pathlib
import sys
from datetime import datetime, timezone

HERE = pathlib.Path(__file__).parent
STORAGE_STATE = HERE / "storage-state.json"
PENDING_DIR = HERE / "pending"
PUBLISHED_DIR = HERE / "published"
LOG_FILE = HERE / "publish-log.jsonl"

NOTE_NEW_ARTICLE_URL = "https://note.com/notes/new"  # 未検証。実際のURLと異なる場合は要修正


def load_next_pending():
    files = sorted(PENDING_DIR.glob("*.json"))
    if not files:
        return None
    with open(files[0], encoding="utf-8") as f:
        data = json.load(f)
    return files[0], data


def log_result(entry: dict) -> None:
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def publish(debug: bool) -> None:
    if not STORAGE_STATE.exists():
        print("storage-state.json が見つかりません。先に auth_setup.py を実行してください。")
        sys.exit(1)

    pending = load_next_pending()
    if pending is None:
        print("公開待ちの下書きがありません(love-note/pending/ が空です)。")
        return

    path, article = pending
    title = article["title"]
    body = article["body"]

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright がインストールされていません: pip install playwright && playwright install chromium")
        sys.exit(1)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not debug)
        context = browser.new_context(storage_state=str(STORAGE_STATE))
        page = context.new_page()

        page.goto(NOTE_NEW_ARTICLE_URL)
        if debug:
            print("エディタ画面を開きました。実際の画面を確認し、下記セレクタが合っているか確認してください。")
            page.pause()  # --debug時はここで一時停止し、実画面を見ながらセレクタを調整できる

        # ▼▼▼ 以下は未検証のプレースホルダー。実際のnote.com編集画面のDOM構造に
        # 合わせて必ず調整すること ▼▼▼
        page.click("text=タイトル", timeout=5000)  # 未検証
        page.keyboard.type(title)
        page.click("[contenteditable='true']", timeout=5000)  # 未検証: 本文エリア
        page.keyboard.type(body)
        page.click("text=公開に進む", timeout=5000)  # 未検証
        page.click("text=投稿する", timeout=5000)  # 未検証
        # ▲▲▲ ここまで ▲▲▲

        page.wait_for_timeout(2000)
        published_url = page.url

        context.close()
        browser.close()

    PUBLISHED_DIR.mkdir(exist_ok=True)
    path.rename(PUBLISHED_DIR / path.name)
    log_result({
        "title": title,
        "published_at": datetime.now(timezone.utc).isoformat(),
        "url": published_url,
        "source_file": path.name,
    })
    print(f"公開処理を実行しました: {title}")
    print(f"公開後のURLを開いて、実際に読める状態か目視で確認してください: {published_url}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--debug", action="store_true", help="ブラウザを表示し、途中で一時停止する")
    args = parser.parse_args()
    publish(debug=args.debug)
