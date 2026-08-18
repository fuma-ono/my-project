"""恋愛ジャンルnoteアカウントの、初回ログインセッションを保存するスクリプト。

オーナーのPCで一度だけ実行する。実行すると実ブラウザが開くので、
note.comに手動でログインし、ターミナルに戻ってEnterを押すこと。
パスワードはこのスクリプト・Claude側には一切渡らない
(ブラウザに直接入力するだけで、保存されるのはログイン後のセッション情報のみ)。
"""

import pathlib
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).parent
STORAGE_STATE = HERE / "storage-state.json"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False)
    context = browser.new_context()
    page = context.new_page()
    page.goto("https://note.com/login")

    input(
        "ブラウザでnote.com(恋愛ジャンル専用アカウント)にログインしてください。"
        "ログインが完了したら、ここでEnterキーを押してください..."
    )

    context.storage_state(path=str(STORAGE_STATE))
    browser.close()

print(f"保存しました: {STORAGE_STATE}")
print("このファイルは絶対に他人に渡さない・commitしないこと(.gitignore済み)。")
