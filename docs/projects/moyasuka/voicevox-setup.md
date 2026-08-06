# VOICEVOXセットアップ手順(オーナー対応・手元PC)

モヤスカの最後のピース。動画合成パイプライン(`line_chat.py`)・音声合成コード(`voicevox_narrate.py`)はすでに実装済みで、VOICEVOXエンジンが手元で立ち上がった瞬間から使える状態。このクラウド環境からはVOICEVOXのエンジン本体(GitHubリリースのバイナリ/Dockerイメージ/APIサーバー)にネットワーク到達できないため、エンジンの起動だけはオーナー自身のPCで行う必要がある(note.com/Xの自動投稿と同じ制約)。

## 1. VOICEVOXエンジンを起動する

以下のどちらか:

- **アプリ版(一番簡単)**: [VOICEVOX公式サイト](https://voicevox.hiroshiba.jp/)からインストーラーをダウンロードして起動。アプリを開いている間、内部で`http://127.0.0.1:50021`にAPIサーバーが立つ
- **エンジン単体(GUI不要・サーバー運用向け)**: [VOICEVOX ENGINE](https://github.com/VOICEVOX/voicevox_engine)のリリースから対応OSのビルドを取得し実行、または`docker run -p 50021:50021 voicevox/voicevox_engine:cpu-latest`

起動確認:

```bash
curl http://127.0.0.1:50021/version
```

バージョン文字列が返れば準備完了。

## 2. (推奨・任意)話者IDを実際のエンジンで確認する

`moyasuka/voicevox_narrate.py`の`CHARACTER_SPEAKER_IDS`は一般に安定しているVOICEVOX標準の話者IDだが、特に`白上虎太郎=12`は確認優先度をコード内コメントで明記している。念のため一致を確認:

```bash
curl http://127.0.0.1:50021/speakers | python3 -m json.tool | grep -A2 '"name"'
```

各キャラクター名と`styles[].id`が下記の対応になっていればOK(ズレていた場合は`voicevox_narrate.py`の`CHARACTER_SPEAKER_IDS`を実際の値に書き換える):

| 役割 | キャラクター | style id |
|---|---|---|
| 主人公(私) | ずんだもん(ノーマル) | 3 |
| 年上の女性・敵役(義母/ママ友/上司) | 四国めたん(ノーマル) | 2 |
| 男性(旦那/夫/同僚) | 玄野武宏(ノーマル) | 11 |
| 第三者・女性(叔母/義姉/別のママ友) | 春日部つむぎ(ノーマル) | 8 |
| 第三者・男性(先輩) | 白上虎太郎(ノーマル) | 12 |

## 3. ナレーション音声を生成する

```bash
cd /path/to/my-project
python3 -m moyasuka.voicevox_narrate \
  --script moyasuka/scripts/01-sample.md \
  --out /tmp/moyasuka-01-narration
```

`/tmp/moyasuka-01-narration.wav`(セリフの実音声を台本の登場順に配置した1本の音声ファイル)と`/tmp/moyasuka-01-narration.durations.json`(各セリフ・画像・スタンプの実尺のリスト)の2つが書き出される。台本内の全セリフを1行ずつVOICEVOXで合成するため、少し時間がかかる(進捗はターミナルに逐次表示される)。

`02-mom-friend.md`・`03-coworker.md`も同様に`--script`を差し替えて実行する。

## 4. 動画を実際のナレーションで最終レンダリングする

```bash
python3 -m moyasuka.line_chat \
  --script moyasuka/scripts/01-sample.md \
  --audio /tmp/moyasuka-01-narration.wav \
  --durations /tmp/moyasuka-01-narration.durations.json \
  --out moyasuka-01-final.mp4
```

`--audio`と`--durations`を両方渡すことで、チャット吹き出しの表示タイミングが実際の音声の長さに正確に同期する(`--durations`を省略すると文字数からの概算になり、実音声とズレる)。

これで`moyasuka-01-final.mp4`が完成品。あとはYouTube Studioにアップロードするか、既存の`bgm-pipeline/publish_shorts.py`と同じ要領で投稿を自動化する(モヤスカ用の投稿スクリプトは別途整備予定)。

## 補足

- VOICEVOXは各キャラクターの利用規約(クレジット表記の要否など)を守れば商用利用も無料。詳細は[VOICEVOX公式の利用規約ページ](https://voicevox.hiroshiba.jp/term/)を参照。現時点のチャンネル概要欄(`docs/projects/moyasuka/channel-description.md`)にはすでに使用音声のクレジットを記載済み
- 3本とも生成できたら、`docs/projects/moyasuka/team.md`のチェックリストを更新して報告してください。ダッシュボード側は自動で最新状況を追従する
