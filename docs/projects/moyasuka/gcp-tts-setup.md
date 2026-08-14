# モヤスカ ナレーション: Google Cloud TTSへの切替

`docs/ai-company-os/2026-08-11-operating-principles-v2.md`の「モヤスカの14日ルール」を実行するための、オーナー対応が必要な一度きりのセットアップ手順。2026-08-14、オーナー方針転換により1本目からこの方式を採用することになった。

## 背景

iPad Shortcuts経由でtts.quest APIを叩く現行方式(`docs/projects/moyasuka/voicevox-setup.md`の方式A')は、AI経営パートナーの調査(2026-08-11)で**このクラウド環境から依存先APIに構造的に到達できない**ことが確認された(直接テスト: `api.tts.quest`・`voicevox.su-shiki.com`は接続不能、`texttospeech.googleapis.com`は到達可能)。加えて毎回オーナーの手作業(Shortcut起動・音声アップロード)が必要だった。

Google Cloud Text-to-Speechへの切替で、これらすべてが解消する: 到達可能・完全無人・実費ほぼ¥0(台本1本あたり約480字、月30本でも月1.5万字 ≪ 無料枠)。

## 認証方式の変遷(2026-08-14、2回の失敗を経て確定)

1. **当初案**: `@moyasuka`のYouTube用OAuthトークンに`cloud-platform`スコープを追加し、1回のログインで済ませる想定だった → Googleのデバイスフローが組み合わせを`invalid_scope`で拒否
2. **2回目の案**: スコープを分離し、Cloud TTS専用の2本目のログインを別途行う想定に変更 → **`cloud-platform`スコープは単独で要求しても同じく`invalid_scope`で拒否される**ことが判明(デバイスフロー自体がこのスコープに未対応)
3. **確定方式**: OAuthのデバイスフロー(ユーザーのログイン)ではなく、**サービスアカウント**(プロジェクトに紐づく非対話型の認証情報)を使う。YouTubeアップロードのような「特定のユーザー・チャンネルの代理で操作する」性質がCloud TTSには不要なため、そもそもユーザーログインを介する必要がなかった

## オーナー対応(所要 約10分、対話的なログイン操作は不要)

1. **Cloud Text-to-Speech APIを有効化する**: `bgm-pipeline`のYouTube/GCS連携で既に使っている同じGoogle Cloudプロジェクトで([Google Cloud Console](https://console.cloud.google.com/) → 「APIとサービス」→「ライブラリ」→ "Cloud Text-to-Speech API" を検索 → 有効化)。新しいプロジェクトを作る必要はない。
2. **サービスアカウントを作成する**: 同じプロジェクトで、[IAMと管理 → サービスアカウント](https://console.cloud.google.com/iam-admin/serviceaccounts) → 「サービスアカウントを作成」。名前は任意(例: `moyasuka-tts`)。
3. **ロールを付与する**: 作成時のロール選択で「Cloud Text-to-Speech ユーザー」を選択(見当たらない場合は「編集者」で代用可)。
4. **JSONキーを発行する**: 作成したサービスアカウントの「キー」タブ → 「鍵を追加」→「新しい鍵を作成」→ JSON形式でダウンロード。
5. **ダウンロードしたJSONファイルを共有する**: このチャットにアップロードしてください。`moyasuka/credentials/gcp_tts_service_account.json`として保存します(このディレクトリは`.gitignore`済みで、リポジトリにはコミットされません)。

以上で完了。以降はログイン操作なしで完全無人動作する(サービスアカウントは期限切れ・再認可の概念がないため、YouTube側のような7日ごとの再認可も不要)。

## 動作確認(社長側で実施)

```bash
python3 -m moyasuka.gcp_tts_auth       # サービスアカウントの疎通確認のみ
python3 -m moyasuka.gcp_tts_narrate --script moyasuka/scripts/01-sample.md --out /tmp/moyasuka-01-gcp
python3 -m moyasuka.line_chat --script moyasuka/scripts/01-sample.md \
    --audio /tmp/moyasuka-01-gcp.wav --durations /tmp/moyasuka-01-gcp.durations.json \
    --out /tmp/moyasuka-01-gcp-final.mp4
```

成功すれば、この2コマンドがそのまま`moyasuka/publish.py`の`--audio`/`--durations`引数に渡す実運用フローになる。

## 既知のトレードオフ

- 声はVOICEVOXキャラ(ずんだもん等)ではなく、Cloud TTSの汎用日本語音声になる(`gcp_tts_narrate.py`の`CLOUD_TTS_VOICES`参照、既存の5役配役はそのまま維持し声質だけ差し替え)。チャンネル概要欄・各動画概要欄の【使用音声】クレジットは実態に合わせて更新済み(`channel-description.md`・`publish.py`)
- 視聴維持率への影響は未検証。ただし現状(投稿0本)より悪化しようがないため許容
