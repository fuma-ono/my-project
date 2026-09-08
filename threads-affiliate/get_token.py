"""Threads API のアクセストークンを取得するスクリプト(オーナーのPCで初回のみ実行)。

事前に developers.facebook.com でMeta開発者アプリを作り、Threads APIを
有効化し、「App ID」「App Secret」を控えておくこと(README.md参照)。
リダイレクトURIはこのスクリプトが使う `https://localhost:8910/callback` を
Meta側のアプリ設定にも登録しておくこと。

★2026年時点でThreads APIは全リダイレクトURIにHTTPSを必須化しており、
`http://localhost`は使えない(実機で `Redirect URIs: すべてのリダイレクト
URLでHTTPSが必要です` エラーを確認済み)。そのため、このスクリプトは
自己署名証明書を自動生成し、ローカルでHTTPSサーバーを立てて認可コードを
受け取る。ブラウザに「この接続ではプライバシーが保護されません」等の警告が
出るが、自分自身が今立てたローカルサーバーへの接続なので、
「詳細設定」→「localhostにアクセスする(安全ではありません)」を選んで進めてよい。

実行するとブラウザが開き、Threadsアカウントでの認可画面が出る。
「許可する」を押すと、このスクリプトが自動でトークンを受け取り保存する。
"""

import datetime
import http.server
import json
import pathlib
import ssl
import threading
import urllib.parse
import urllib.request
import webbrowser

HERE = pathlib.Path(__file__).parent
TOKEN_FILE = HERE / "access-token.json"
CERT_FILE = HERE / "localhost-cert.pem"
KEY_FILE = HERE / "localhost-key.pem"
REDIRECT_PORT = 8910
REDIRECT_URI = f"https://localhost:{REDIRECT_PORT}/callback"

received_code = {}


def ensure_self_signed_cert() -> None:
    """localhost向けの自己署名証明書を(無ければ)生成する。"""
    if CERT_FILE.exists() and KEY_FILE.exists():
        return
    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.x509.oid import NameOID
    except ImportError:
        raise SystemExit(
            "自己署名証明書の作成に `cryptography` パッケージが必要です。\n"
            "先に `pip install cryptography` を実行してから、もう一度実行してください。"
        )

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + datetime.timedelta(days=825))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName("localhost")]), critical=False)
        .sign(key, hashes.SHA256())
    )
    CERT_FILE.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    KEY_FILE.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    print(f"自己署名証明書を作成しました: {CERT_FILE.name} / {KEY_FILE.name}(.gitignore済み)")


class CallbackHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        if "code" in params:
            received_code["code"] = params["code"][0]
            self.send_response(200)
            self.send_header("Content-type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write("認可できました。このタブは閉じてターミナルに戻ってください。".encode())
        else:
            self.send_response(400)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # 標準出力を汚さない


def http_get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.loads(resp.read().decode())


def http_post_json(url: str, data: dict) -> dict:
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def main() -> None:
    client_id = input("Meta開発者アプリの App ID: ").strip()
    client_secret = input("Meta開発者アプリの App Secret: ").strip()

    scope = "threads_basic,threads_content_publish"
    authorize_url = (
        "https://threads.net/oauth/authorize?"
        + urllib.parse.urlencode({
            "client_id": client_id,
            "redirect_uri": REDIRECT_URI,
            "scope": scope,
            "response_type": "code",
        })
    )

    ensure_self_signed_cert()
    server = http.server.HTTPServer(("localhost", REDIRECT_PORT), CallbackHandler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certfile=str(CERT_FILE), keyfile=str(KEY_FILE))
    server.socket = context.wrap_socket(server.socket, server_side=True)
    server_thread = threading.Thread(target=server.handle_request)
    server_thread.start()

    print("ブラウザで認可画面を開きます。Threadsアカウントで「許可する」を押してください...")
    print("(認可後、localhostへのリダイレクト時に「安全ではありません」という警告が")
    print(" 出ますが、自己署名証明書によるものです。「詳細設定」から進んでください)")
    webbrowser.open(authorize_url)
    server_thread.join(timeout=180)

    if "code" not in received_code:
        print("認可コードを受け取れませんでした。もう一度実行してください。")
        return

    # 短期トークンを取得
    short_lived = http_post_json(
        "https://graph.threads.net/oauth/access_token",
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "authorization_code",
            "redirect_uri": REDIRECT_URI,
            "code": received_code["code"],
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
