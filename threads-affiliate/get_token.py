"""Threads API のアクセストークンを取得するスクリプト(初回のみ実行)。

事前に developers.facebook.com でMeta開発者アプリを作り、Threads APIを
有効化し、「App ID」「App Secret」を控えておくこと(README.md参照)。
リダイレクトURIはこのスクリプトが使う `https://example.com/oauth-callback`
をMeta側のアプリ設定にも登録しておくこと。

## なぜ example.com を使うのか(ローカルサーバー方式をやめた理由)

以前はPC上にローカルのHTTPSサーバーを立てて認可コードを自動受信する
方式だったが、これは「ブラウザとサーバーが同じ端末上にある」ことが前提
になる。iPad + Codespacesのような構成(Safariは端末側、スクリプトは
クラウド側)では、Codespaces内のlocalhostにSafari側からアクセスする
ことができず、原理的に成立しない。

そこで、認可後のリダイレクト先を実在するダミードメイン(example.com、
IANAが管理する常時アクセス可能なドメイン)にし、**リダイレクト後の
アドレスバーのURLを手動でコピペする**方式に変更した。これならローカル
サーバーもHTTPS証明書も不要で、iPad・PC・Codespaces、どの組み合わせでも
動く(認可画面を開くブラウザさえあれば、スクリプト自体はどこで実行しても
よい)。

## 実行方法

1. このスクリプトを実行(Codespacesでも可)
2. App ID・App Secretを入力
3. 表示されるURLをコピーし、ブラウザ(Safari等、どの端末でもよい)で開く
4. Threadsアカウントで「許可する」を押す
5. example.comのページにリダイレクトされる(中身は「Example Domain」と
   いう簡素なページで問題ない)。**そのページのアドレスバーのURL全体を
   コピー**する
6. ターミナルに戻り、コピーしたURLを貼り付けてEnter
"""

import json
import pathlib
import urllib.parse
import urllib.request

HERE = pathlib.Path(__file__).parent
TOKEN_FILE = HERE / "access-token.json"
REDIRECT_URI = "https://example.com/oauth-callback"


def http_get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.loads(resp.read().decode())


def http_post_json(url: str, data: dict) -> dict:
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def extract_code(pasted: str) -> str | None:
    """貼り付けられた文字列(URL全体、またはcodeの値そのもの)からcodeを取り出す。

    認可自体が失敗した場合、Threadsは code の代わりに
    error_message / error_code を含むURLを返す。これをcodeと誤認して
    トークン交換に進むと無意味な400エラーになるため、ここで検出して
    Noneを返す(呼び出し側でエラー内容を表示して中断する)。
    """
    pasted = pasted.strip()
    parsed = urllib.parse.urlparse(pasted)
    params = urllib.parse.parse_qs(parsed.query)
    if "error_message" in params or "error_code" in params:
        message = params.get("error_message", ["(詳細不明)"])[0]
        code_num = params.get("error_code", ["?"])[0]
        print(f"\n認可自体が失敗しています(error_code={code_num}): {message}")
        print(
            "考えられる原因: ①Threadsテスターへの招待をアカウント側で承認していない "
            "②「アクセス許可と機能」でthreads_basic/threads_content_publishが有効に"
            "なっていない ③App IDが誤っている、のいずれか。"
        )
        return None
    if "code" in params:
        return params["code"][0]
    return pasted  # URL形式でなければ、code値がそのまま貼られたとみなす


def main() -> None:
    client_id = input("Meta開発者アプリの App ID(数字だけの値): ").strip()
    client_secret = input("Meta開発者アプリの App Secret: ").strip()

    # 2026-09-09: threads_manage_insightsが抜けていたため、Insights API呼び出しが
    # 全metricで「Application does not have permission for this action」(code 10)
    # になっていた(metric名の問題ではなく、スコープ自体が無かったのが原因)。
    # 2026-09-10: 完全自動返信機能(fetch_replies.py/send_replies.py)のため、
    # 返信の取得・投稿・メンション取得に必要な3スコープを追加した。
    scope = (
        "threads_basic,threads_content_publish,threads_manage_insights,"
        "threads_read_replies,threads_manage_replies,threads_manage_mentions"
    )
    authorize_url = (
        "https://threads.net/oauth/authorize?"
        + urllib.parse.urlencode({
            "client_id": client_id,
            "redirect_uri": REDIRECT_URI,
            "scope": scope,
            "response_type": "code",
        })
    )

    print("\n以下のURLをコピーして、ブラウザ(iPadのSafariでもOK)で開いてください:\n")
    print(authorize_url)
    print(
        "\nThreadsアカウントで「許可する」を押すと、example.comのページに"
        "リダイレクトされます。\nそのページのアドレスバーに表示されている"
        "URL全体をコピーして、下に貼り付けてください。"
    )
    pasted = input("\nリダイレクト後のURL(またはcodeの値): ").strip()
    code = extract_code(pasted)
    if not code:
        print("codeを読み取れませんでした。もう一度実行してください。")
        return

    # 短期トークンを取得
    short_lived = http_post_json(
        "https://graph.threads.net/oauth/access_token",
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "authorization_code",
            "redirect_uri": REDIRECT_URI,
            "code": code,
        },
    )
    short_token = short_lived["access_token"]

    # 長期トークン(60日)に交換
    long_lived = http_get_json(
        "https://graph.threads.net/access_token?"
        + urllib.parse.urlencode({
            "grant_type": "th_exchange_token",
            "client_id": client_id,
            "client_secret": client_secret,
            "access_token": short_token,
        })
    )
    long_token = long_lived["access_token"]

    # Threadsユーザーidを取得
    me = http_get_json(
        f"https://graph.threads.net/v1.0/me?fields=id,username&access_token={long_token}"
    )

    TOKEN_FILE.write_text(
        json.dumps(
            {
                "access_token": long_token,
                "threads_user_id": me["id"],
                "username": me.get("username"),
                "client_id": client_id,
                "client_secret": client_secret,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"保存しました: {TOKEN_FILE}(60日有効。refresh_token.pyで延長できます)")
    print("このファイルは絶対に他人に渡さない・commitしないこと(.gitignore済み)。")


if __name__ == "__main__":
    main()
