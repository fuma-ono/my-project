# ナレーション音声のセットアップ手順(モヤスカ)

モヤスカの最後のピース。**2026-08-07、オーナーがiPhoneのみでPCを持っていないと判明**したため、下記2つの方式を用意した。どちらも動画への同期コード(`line_chat.py --durations`)は共通で使える。

- **方式A: 手動アプリ経由**(オーナーがiPhoneのみの場合。今のところこちらが現実的)— オーナーが持っているアプリ「ずんだボイス『ずんだもん読み上げアプリ』」で1行ずつ手動生成し、まとめてアップロードしてもらう。詳細は下記
- **方式B: VOICEVOXエンジン**(もし今後PCが使える環境が手に入った場合)— 本ページ末尾に手順を残してある

検討の経緯: VOICEVOXエンジン本体はこのクラウド環境からネットワーク到達できず(GitHubリリース/Docker/API、すべてブロック確認済み)、かつVOICEVOX自体に公式iOS版が存在しないため、オーナーがiPhoneのみの場合はそもそもエンジンを起動する手段がない。代替として提案された`voicevox.su-shiki.com`(ホスト型VOICEVOX互換API)・`ondoku3.com`(Web版TTS)もこのクラウド環境からは同じネットワークポリシーでブロック(効果音ラボ等と同じ理由)されており、私から直接は呼び出せないと確認済み。最終的にオーナーが実際に持っていた読み上げアプリ(ローカルで音声ファイルを保存・共有できる)を使う方式Aを採用した。

## 方式A: 手動アプリ経由(現在採用中)

1. **チェックリストを作る**(このリポジトリ側、社長が実行):

   ```bash
   python3 -m moyasuka.manual_narration list \
     --script moyasuka/scripts/01-sample.md \
     --out /tmp/moyasuka-01-checklist.txt
   ```

   台本の中で音声が必要なセリフだけを順番に列挙し、それぞれ保存すべきファイル名(`000.wav`のように3桁の連番)を指定したチェックリストが書き出される。画像・スタンプ・効果音の行は音声不要なので含まれない。

2. **アプリで1行ずつ収録**: チェックリストを上から順に、「ずんだもん読み上げアプリ」にセリフのテキストを貼り付け→話者(キャラ)を選択→生成→チェックリストが指定したファイル名で保存・共有、を繰り返す。全部を1つのフォルダにまとめる

   - 5役のキャスト対応表は`docs/projects/moyasuka/content-backlog.md`のキャスト運用を参照。アプリのガチャで解放した声がキャラと完全一致しない場合は、そのつど一番近い声で代用でOK(声の割当が完璧に一致している必要はない、視聴者の認知コストを下げる目的なので近ければ十分)
   - `.wav`でも`.mp3`/`.m4a`でもどの形式でも自動変換されるので、アプリの標準の書き出し形式のままでよい

3. **フォルダごとチャットにアップロード**(zipでまとめてもOK)。届いたら社長側で組み立てる:

   ```bash
   python3 -m moyasuka.manual_narration assemble \
     --script moyasuka/scripts/01-sample.md \
     --clips-dir /path/to/uploaded/clips \
     --out /tmp/moyasuka-01-narration
   ```

   `<out>.wav`(実音声を正しい位置に配置した1本の音声)と`<out>.durations.json`(各セリフの実尺)が書き出される。足りないファイルがあればエラーで教えてくれる。

4. **最終レンダリング**(方式Bと共通):

   ```bash
   python3 -m moyasuka.line_chat \
     --script moyasuka/scripts/01-sample.md \
     --audio /tmp/moyasuka-01-narration.wav \
     --durations /tmp/moyasuka-01-narration.durations.json \
     --out moyasuka-01-final.mp4
   ```

このフローは1本あたり手作業(コピペ)が20〜30回程度発生する。毎日投稿の運用に対しては手間が大きいため、慣れてきたら以下のいずれかを検討したい:
- 週1回など、まとめて数本分を一度に収録してストックしておく
- Google Cloud Text-to-Speechへの切り替えで完全自動化(オーナー確認済みの選択肢。GCP課金アカウントの一度きりの登録が必要、想定実費ほぼ$0、ただし声がVOICEVOXキャラではなく汎用音声になる)

## 方式B: VOICEVOXエンジン(PCが使える場合の手順)

以下は今後PCにアクセスできる状況になった場合のために残してある。このクラウド環境からはVOICEVOXのエンジン本体(GitHubリリースのバイナリ/Dockerイメージ/APIサーバー)にネットワーク到達できないため、エンジンの起動は使えるPC側で行う必要がある(note.com/Xの自動投稿と同じ制約)。

### 1. VOICEVOXエンジンを起動する

以下のどちらか:

- **アプリ版(一番簡単)**: [VOICEVOX公式サイト](https://voicevox.hiroshiba.jp/)からインストーラーをダウンロードして起動。アプリを開いている間、内部で`http://127.0.0.1:50021`にAPIサーバーが立つ
- **エンジン単体(GUI不要・サーバー運用向け)**: [VOICEVOX ENGINE](https://github.com/VOICEVOX/voicevox_engine)のリリースから対応OSのビルドを取得し実行、または`docker run -p 50021:50021 voicevox/voicevox_engine:cpu-latest`

起動確認:

```bash
curl http://127.0.0.1:50021/version
```

バージョン文字列が返れば準備完了。

### 2. (推奨・任意)話者IDを実際のエンジンで確認する

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

### 3. ナレーション音声を生成する

```bash
cd /path/to/my-project
python3 -m moyasuka.voicevox_narrate \
  --script moyasuka/scripts/01-sample.md \
  --out /tmp/moyasuka-01-narration
```

`/tmp/moyasuka-01-narration.wav`(セリフの実音声を台本の登場順に配置した1本の音声ファイル)と`/tmp/moyasuka-01-narration.durations.json`(各セリフ・画像・スタンプの実尺のリスト)の2つが書き出される。台本内の全セリフを1行ずつVOICEVOXで合成するため、少し時間がかかる(進捗はターミナルに逐次表示される)。

`02-mom-friend.md`・`03-coworker.md`も同様に`--script`を差し替えて実行する。

### 4. 動画を実際のナレーションで最終レンダリングする

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
