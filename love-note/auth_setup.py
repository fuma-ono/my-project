"""恋愛ジャンルnoteアカウントの、初回ログインセッションを保存するスクリプト。

オーナーのPCで一度だけ実行する。

★このスクリプトは、真っさらな自動操作ブラウザではなく、
オーナーの「実際のChromeプロフィール」をそのまま起動する方式に変更した★

理由: note.comのreCAPTCHA・Googleのログイン確認は、Playwrightが作る
真っさらなブラウザ(自動操作の痕跡がある)を検知して、認証そのものを
表示しない/ブロックすることがある。実際に普段使っているChromeプロフィールを
そのまま使えば、これは通常のブラウザ利用と見分けがつかなくなる。

## 事前準備(このスクリプトを実行する前に)

1. Chromeで新しいプロフィールを作成する(個人の普段使いとは分ける):
   右上の丸いアイコン →「プロフィールを追加」
2. その新しいプロフィールのChromeで、普通に手動でnote.com(恋愛ジャンル専用アカウント)に
   ログインしておく(ここでのreCAPTCHA/Googleログインは、正真正銘ふつうのChromeなので問題なく通る)
3. ログインできたら、Chromeを完全に閉じる(すべてのウィンドウ)
4. 新しいプロフィールでもう一度Chromeを開き、アドレスバーに `chrome://version` と入力、
   「プロフィール パス」の一番最後のフォルダ名を確認する(例: `Profile 3`)
5. 確認できたらChromeをまた完全に閉じる(このスクリプトが同じプロフィールを使うため、
   起動中のChromeがあると失敗する)

## 実行方法

```
python love-note/auth_setup.py
```

実行すると、上で確認したプロフィール名の入力を求められる。入力するとそのプロフィールで
Chromeが自動的に開く(既にログイン済みのはずなので、ログイン画面は出ないはず)。
そのままEnterキーを押せばセッション情報が保存される。
"""

import pathlib
import os
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).parent
STORAGE_STATE = HERE / "storage-state.json"

default_user_data_dir = os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\User Data")

print(f"Chromeのユーザーデータフォルダ(既定値: {default_user_data_dir})")
user_data_dir = input("そのまま使う場合はEnter、違う場合はフォルダのパスを入力: ").strip() or default_user_data_dir

profile_directory = input("chrome://version で確認したプロフィール名(例: Profile 3。既定 'Default' の場合はそのままEnter): ").strip() or "Default"

with sync_playwright() as p:
    context = p.chromium.launch_persistent_context(
        user_data_dir=user_data_dir,
        channel="chrome",
        headless=False,
        args=[f"--profile-directory={profile_directory}"],
    )
    page = context.new_page()
    page.goto("https://note.com/")

    input(
        "ブラウザが開きました。もし既にログイン済みならそのままEnterを押してください。\n"
        "まだログインしていなければ、ここで通常通りログインしてからEnterを押してください。\n"
        "(このプロフィールはあなたの普段のChromeそのものなので、reCAPTCHAが出ても普通に解けます)"
    )

    context.storage_state(path=str(STORAGE_STATE))
    context.close()

print(f"保存しました: {STORAGE_STATE}")
print("このファイルは絶対に他人に渡さない・commitしないこと(.gitignore済み)。")
print("以降の週次公開(publish.py)は、この保存済みセッションを使うので、ここまでで準備完了です。")
