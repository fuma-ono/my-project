"""恋愛ジャンルnoteアカウントの、初回ログインセッションを保存するスクリプト。

オーナーのPCで一度だけ実行する。実行すると実ブラウザが開くので、
note.comに手動でログインし、ターミナルに戻ってEnterを押すこと。
パスワードはこのスクリプト・Claude側には一切渡らない
(ブラウザに直接入力するだけで、保存されるのはログイン後のセッション情報のみ)。

★「Googleでログイン」はここでは使わないこと★
Googleは自動操作ツール(Playwright)から起動したブラウザを検知して
「安全ではないブラウザ」としてログインをブロックする仕様になっている。
事前にnote.com側でメールアドレス+パスワードのログインを設定し(Googleログインとは別に、
note.comのアカウント設定画面から追加できる)、ここではそのメール+パスワードでログインすること。
"""

import pathlib
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).parent
STORAGE_STATE = HERE / "storage-state.json"

with sync_playwright() as p:
    # インストール済みの実Chromeを使う(channel="chrome")。Playwright付属の
    # Chromiumより自動化として検知されにくいが、Googleログインは検知対策として
    # 使わない前提であることに変わりはない。実Chromeが無ければ自動でChromiumにフォールバックする。
    try:
        browser = p.chromium.launch(headless=False, channel="chrome")
    except Exception:
        print("実Chromeが見つからなかったため、付属のChromiumで起動します。")
        browser = p.chromium.launch(headless=False)

    context = browser.new_context()
    page = context.new_page()
    page.goto("https://note.com/login")

    input(
        "ブラウザでnote.com(恋愛ジャンル専用アカウント)にログインしてください。\n"
        "※「Googleでログイン」は使わず、メールアドレス+パスワードでログインしてください\n"
        "(パスワード未設定の場合は、普段のブラウザでnote.comのアカウント設定から先に設定してください)。\n"
        "ログインが完了したら、ここでEnterキーを押してください..."
    )

    context.storage_state(path=str(STORAGE_STATE))
    browser.close()

print(f"保存しました: {STORAGE_STATE}")
print("このファイルは絶対に他人に渡さない・commitしないこと(.gitignore済み)。")
