# ナレーション音声のセットアップ手順(モヤスカ)

モヤスカの最後のピース。**2026-08-07、オーナーがiPhoneのみでPCを持っていないと判明**したため、まず方式Aで着手。その後「1行ずつのコピペが手間」というフィードバックを受け、**2026-08-07に方式A'(Shortcuts自動化)を追加**した。動画への同期コード(`line_chat.py --durations`)はどの方式でも共通で使える。

- **方式A': Shortcuts自動化(iPad完結・推奨)** — オーナーのiPad上のShortcutsアプリから、WEB版VOICEVOX API(tts.quest / su-shiki.com)を直接叩いて全セリフを自動ループ生成する。1行ずつのコピペ作業がなくなる。詳細は下記
- **方式A: 手動アプリ経由**(Shortcutsを組む前の暫定、または少数行だけ直したい時向け)— オーナーが持っているアプリ「ずんだボイス『ずんだもん読み上げアプリ』」で1行ずつ手動生成し、まとめてアップロードしてもらう。詳細は下記
- **方式B: VOICEVOXエンジン**(もし今後PCが使える環境が手に入った場合)— 本ページ末尾に手順を残してある

検討の経緯: VOICEVOXエンジン本体はこのクラウド環境からネットワーク到達できず(GitHubリリース/Docker/API、すべてブロック確認済み)、かつVOICEVOX自体に公式iOS版が存在しないため、オーナーがiPhoneのみの場合はそもそもエンジンを起動する手段がない。代替として提案された`voicevox.su-shiki.com`(ホスト型VOICEVOX互換API)・`ondoku3.com`(Web版TTS)・`api.tts.quest`もこのクラウド環境からは同じネットワークポリシーでブロック(効果音ラボ等と同じ理由、`curl`で403を確認済み)されており、私(このリポジトリ側の実装環境)から直接は呼び出せない。ただし**オーナーのiPad自体は通常のインターネット回線を使っているため、この制約の対象外**——iPad上のShortcutsアプリからなら同じAPIが呼べる。そこでまず方式A(オーナーが実際に持っていた読み上げアプリを使う手動方式)を採用して稼働させたあと、1行ずつのコピペの手間(1本あたり20〜30回)を減らすため、方式A'としてこのAPI呼び出し自体をiPad上で自動ループさせるShortcutを追加提案した。

## 方式A': Shortcuts自動化(iPad完結・推奨)

**正直な限界を先に書く**: 私たち(このプロジェクトの実装側)はiOS実機を持っておらず、このクラウド環境から`voicevox.su-shiki.com`・`api.tts.quest`にもアクセスできないため、以下のShortcutが実際にこの通りに動くかは検証できていない。iOSのバージョンやShortcutsアプリの仕様変更でアクション名・挙動が変わっている可能性もある。オーナーに実機で実際に組んでもらい、1〜2行のテストで動作確認してから本番の台本全体に適用することをお願いしたい。うまく動かない場合は方式A(手動)にいつでも戻せる。

### 1. APIキーを取得する(初回のみ)

1. iPadのSafariで`https://voicevox.su-shiki.com/su-shikiapis/`を開く
2. Googleアカウントでログイン
3. APIキーを生成(ページの案内に従う。場合によっては別途申請フォームへの記入が必要になることがある)。無料
4. 発行されたAPIキーを控えておく(Shortcutの中でURLパラメータとして使う)

VOICEVOXの利用規約(キャラクターごとのクレジット表記義務など)を守ること。詳細は本ページ末尾の補足を参照。

### 2. 台本のJSONチェックリストを作る(このリポジトリ側、社長が実行)

```bash
python3 -m moyasuka.manual_narration list \
  --script moyasuka/scripts/01-sample.md \
  --out /tmp/moyasuka-01-checklist.json \
  --format json
```

`--format text`(デフォルト)の代わりに`--format json`を指定すると、人間向けチェックリストではなく、Shortcutsが読み込みやすい配列形式で書き出される:

```json
[
  {"index": 0, "speaker_id": 2, "speaker": "義母", "text": "今日も朝から掃除"},
  {"index": 1, "speaker_id": 2, "speaker": "義母", "text": "洗濯も晩ごはんも"},
  ...
]
```

話者名→話者IDの対応は`moyasuka/voicevox_narrate.py`の`CHARACTER_SPEAKER_IDS`をそのまま使っており(二重管理を避けるため)、未対応の話者名が出た場合は警告を出しつつずんだもん(id=3)に自動フォールバックする。このJSONファイルをオーナーにアップロードしてもらい、iPad側(iCloud Driveなど)に保存してもらう。

**話者IDについての注意**: 上記の値は本家VOICEVOXエンジンでの確認を優先して決めたもの(`voicevox_narrate.py`のコード内コメント参照、特に`白上虎太郎=12`は確認優先度が高いと明記済み)。WEB版APIでも同じ値がそのまま使える前提で書いているが、エンジン側の実装によってはIDがズレる可能性があるため、**初回は下記の`/speakers`エンドポイントで実際の対応を確認してから本番投入することを推奨する**。

```
GET https://voicevox.su-shiki.com/speakers または対応するspeakers系エンドポイント
```

正確なエンドポイントURLはAPIキー発行ページ(`https://voicevox.su-shiki.com/su-shikiapis/`)のドキュメントを参照。

### 3. Shortcutを組む(iPad側、オーナー作業)

1本のShortcutで完結させる設計。大きく2ステップ:

**ステップ1: 自己クリーンアップ**(Shortcutの一番最初に置く)

- 「フォルダの内容を取得」(Get Contents of Folder)アクションで、出力先フォルダ(例: iCloud Drive内に専用フォルダを1つ作っておく、`Moyasuka Narration`など)の中身を取得
- 続けて「ファイルを削除」(Delete Files)アクションで、取得した中身をすべて削除

これにより、実行するたびに前回のクリップが自動的に一掃される。古いクリップが溜まって容量を圧迫するのを防ぐための仕組み。**この自己クリーンアップがあるため、下記の運用ルール(前の動画のアップロード完了を待ってから次を回す)を必ず守ること。**

**ステップ2: ループ生成**

- 「ファイルを取得」(Get File)アクションで、手順2で作ったJSONファイルを読み込む
- 「JSONを解析」(Get Dictionary from Input / Get Value from JSON)アクションでJSON配列に変換
- 「各項目を処理」(Repeat with Each)アクションでその配列をループ
  - ループの各回で、その項目の辞書から`text`と`speaker_id`の値を「辞書の値を取得」(Get Value for Key)で取り出す
  - 「URLの内容を取得」(Get Contents of URL)アクションで、WEB版VOICEVOX APIのシンプルAPI(例: `https://voicevox.su-shiki.com/simple/`系、正確なURLはAPIキー発行ページのドキュメント参照)に対して、`text`(セリフ)・`speaker`(話者ID)・APIキーをURLエンコードされたパラメータとしてGETまたはPOSTでリクエスト。音声データがレスポンスとして直接返る
  - 返ってきたファイルを「ファイルを保存」(Save File)アクションで、出力先フォルダに`{index:03d}.wav`(または`.mp3`。`index`はゼロ埋め3桁、例:`000.wav`)というファイル名で保存。`index`の値もJSONの同じ辞書から取得できる

上記のアクション名・引数の並びは実機のShortcutsアプリの仕様(iOSバージョンによって変わりうる)に合わせて実際に調整が必要。特に「ファイル名をゼロ埋め3桁にする」部分は、Shortcutsの「テキスト」アクションで`000`のような形式を作る一手間が必要になる可能性が高い。

### 4. 生成が終わったら、フォルダごとアップロード

Shortcutの実行が終わったら、出力先フォルダ(`Moyasuka Narration`)ごとこのプロジェクトのチャットにアップロードする(zipでまとめてもOK)。届いたら社長側で組み立てる(方式Aと同じ):

```bash
python3 -m moyasuka.manual_narration assemble \
  --script moyasuka/scripts/01-sample.md \
  --clips-dir /path/to/uploaded/clips \
  --out /tmp/moyasuka-01-narration
```

以降は方式Aと共通(下記4.最終レンダリング参照)。

### 容量管理の運用ルール(重要)

自己クリーンアップステップがあるため、**「1本収録→即アップロード→組み立て完了確認→次の1本の収録を始める」の順序を必ず守ること。** 前の動画のアップロードが済む前に次の収録(Shortcutの再実行)を始めると、自己クリーンアップが走った時点で未アップロードのクリップが消えてしまうリスクがある。1本ずつ、アップロード→組み立て完了の確認が取れてから次に進む運用で。

## 方式A: 手動アプリ経由(方式A'が使えない場合のバックアップ)

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

この方式Aは1本あたり手作業(コピペ)が20〜30回程度発生する。毎日投稿の運用に対しては手間が大きいため、**2026-08-07にこの手間を解消する方式A'(Shortcuts自動化、本ページ冒頭)を追加した**。方式A'がうまく動けば、この方式Aは動作しなかった時のバックアップとして残しておく位置づけになる。それでも自動化しきれない部分が残る場合は、以下も引き続き選択肢:
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
