# モヤスカ ナレーション: Google Cloud TTSへの切替(14日ルール)

`docs/ai-company-os/2026-08-11-operating-principles-v2.md`の「モヤスカの14日ルール」(期限2026-08-25)を実行するための、オーナー対応が必要な一度きりのセットアップ手順。

## 背景

iPad Shortcuts経由でtts.quest APIを叩く現行方式(`docs/projects/moyasuka/voicevox-setup.md`の方式A')は、AI経営パートナーの調査(2026-08-11)で**このクラウド環境から依存先APIに構造的に到達できない**ことが確認された(直接テスト: `api.tts.quest`・`voicevox.su-shiki.com`は接続不能、`texttospeech.googleapis.com`は到達可能)。加えて毎回オーナーの手作業(Shortcut起動・zipアップロード)が必要で、直近の実績では成功率が実用に耐えない水準だった。

Google Cloud Text-to-Speechへの切替で、これらすべてが解消する: 到達可能・完全無人・実費ほぼ¥0(台本1本あたり約480字、月30本でも月1.5万字 ≪ 無料枠)。

## オーナー対応(所要 約10分)

1. **Cloud Text-to-Speech APIを有効化する**: `bgm-pipeline`のYouTube/GCS連携で既に使っている同じGoogle Cloudプロジェクトで([Google Cloud Console](https://console.cloud.google.com/) → 「APIとサービス」→「ライブラリ」→ "Cloud Text-to-Speech API" を検索 → 有効化)。新しいプロジェクトを作る必要はない。
2. **`@moyasuka`のOAuth認可を(再)実行する**: `moyasuka/youtube_auth.py`のスコープに`cloud-platform`を追加済みなので、まだ未認可なら通常通り:
   ```bash
   python3 -m moyasuka.youtube_auth login
   ```
   表示されるURL・コードで、`@moyasuka`を管理しているGoogleアカウント(≒手順1と同じGCPプロジェクトを使えるアカウント)で承認する。**既に一度認可済みの場合も、スコープが増えているため再度ログインが必要。**

以上で完了。以降は完全無人で動く。

## 動作確認(社長側で実施)

```bash
python3 -m moyasuka.gcp_tts_narrate --script moyasuka/scripts/01-sample.md --out /tmp/moyasuka-01-gcp
python3 -m moyasuka.line_chat --script moyasuka/scripts/01-sample.md \
    --audio /tmp/moyasuka-01-gcp.wav --durations /tmp/moyasuka-01-gcp.durations.json \
    --out /tmp/moyasuka-01-gcp-final.mp4
```

成功すれば、この2コマンドがそのまま`moyasuka/publish.py`の`--audio`/`--durations`引数に渡す実運用フローになる。

## 既知のトレードオフ

- 声はVOICEVOXキャラ(ずんだもん等)ではなく、Cloud TTSの汎用日本語音声になる(`gcp_tts_narrate.py`の`CLOUD_TTS_VOICES`参照、既存の5役配役はそのまま維持し声質だけ差し替え)。チャンネル概要欄の【使用音声】クレジット(`channel-description.md`)は切替完了後に実態に合わせて更新する
- 視聴維持率への影響は未検証(AI経営パートナーが指摘したリスク)。ただし現状(投稿0本)より悪化しようがないため許容
