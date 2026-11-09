# ナレーション音声のセットアップ手順(モヤスカ)

> 台本を新しく1本収録するだけなら、この長い経緯を読まずに**[SOP: モヤスカ ナレーション音声の収録](narration-sop.md)**(手順+トラブルシューティング早見表)を見た方が早い。このページは方式の検討経緯・詳細な設計判断の記録。

モヤスカの最後のピース。**2026-08-07、オーナーがiPhoneのみでPCを持っていないと判明**したため、まず方式Aで着手。その後「1行ずつのコピペが手間」というフィードバックを受け、**2026-08-07に方式A'(Shortcuts自動化)を追加**した。動画への同期コード(`line_chat.py --durations`)はどの方式でも共通で使える。

- **方式A': Shortcuts自動化(iPad完結・推奨)** — オーナーのiPad上のShortcutsアプリから、WEB版VOICEVOX API(tts.quest / su-shiki.com)を直接叩いて全セリフを自動ループ生成する。1行ずつのコピペ作業がなくなる。詳細は下記
- **方式A: 手動アプリ経由**(Shortcutsを組む前の暫定、または少数行だけ直したい時向け)— オーナーが持っているアプリ「ずんだボイス『ずんだもん読み上げアプリ』」で1行ずつ手動生成し、まとめてアップロードしてもらう。詳細は下記
- **方式B: VOICEVOXエンジン**(もし今後PCが使える環境が手に入った場合)— 本ページ末尾に手順を残してある

検討の経緯: VOICEVOXエンジン本体はこのクラウド環境からネットワーク到達できず(GitHubリリース/Docker/API、すべてブロック確認済み)、かつVOICEVOX自体に公式iOS版が存在しないため、オーナーがiPhoneのみの場合はそもそもエンジンを起動する手段がない。代替として提案された`voicevox.su-shiki.com`(ホスト型VOICEVOX互換API)・`ondoku3.com`(Web版TTS)・`api.tts.quest`もこのクラウド環境からは同じネットワークポリシーでブロック(効果音ラボ等と同じ理由、`curl`で403を確認済み)されており、私(このリポジトリ側の実装環境)から直接は呼び出せない。ただし**オーナーのiPad自体は通常のインターネット回線を使っているため、この制約の対象外**——iPad上のShortcutsアプリからなら同じAPIが呼べる。そこでまず方式A(オーナーが実際に持っていた読み上げアプリを使う手動方式)を採用して稼働させたあと、1行ずつのコピペの手間(1本あたり20〜30回)を減らすため、方式A'としてこのAPI呼び出し自体をiPad上で自動ループさせるShortcutを追加提案した。

## 方式A': Shortcuts自動化(iPad完結・推奨)

**2026-08-09、オーナーの実機で実際に組んで動作確認済み。** 以下は最初の設計案ではなく、実際にオーナーと1アクションずつ組みながら見つかった問題を全部直した後の、動作確認済みの手順。台本01(30行)を実際にこの手順で自動生成し、`manual_narration.py assemble`→`line_chat.py`で組み立てて実音声入りの動画が完成している。

実際に組む過程で見つかった落とし穴(先に共有しておく):
- `voicevox.su-shiki.com/simple/`は人間のブラウザ操作を想定したページで、自動化スクリプトからのアクセスはreCAPTCHAでブロックされる。**正しいAPIエンドポイントは`https://api.tts.quest/v3/voicevox/synthesis`**(下記手順3参照)
- このAPIは音声を直接返さず、まずJSONで`wavDownloadUrl`(ダウンロード用URL)を返す**2段階方式**。もう一度「URLの内容を取得」でそのURLを取りに行く必要がある
- JSONファイルをiCloud経由の「ファイル」アクションで読み込もうとすると、ファイル参照が不安定でエラーになりやすかった(「操作を完了できません」等)。**JSONはファイルではなくテキストとして直接Shortcutに貼り付ける**方式に変えたら解消した
- 30行を間隔なしで連続呼び出しすると、APIキー登録済みでも一部が失敗した(レート制限と思われる)。**ループの最後に2秒待つステップ**を入れたら解消した
- ファイル名を3桁ゼロ埋めにするための「文字を切り詰める」ような組み込みアクションが見当たらなかった。**この問題はコード側(`manual_narration.py`)で吸収**したので、iPad側はゼロ埋め不要(`5.wav`のような素の数字でよい)

### 1. APIキーを取得・登録する(初回のみ)

1. iPadのSafariで`https://voicevox.su-shiki.com/su-shikiapis/`を開く
2. Googleアカウントでログイン
3. APIキーを生成(ページの案内に従う)。無料
4. **「VOICEVOX用API利用登録」も忘れずに行う**: APIキーのSHA256ハッシュ値を計算し、[この申請フォーム](https://docs.google.com/forms/d/e/1FAIpQLSfE1oMXK2sZqoei8zFs1xHC2jb6Fhp5hY3QdU0vRbK2ZLuM0Q/viewform?usp=sf_link)に貼って送信する(審査なし、送信すれば自動的に有効化される)。これをやらないと合成が遅い/途切れがちになる
5. 発行されたAPIキーを控えておく(Shortcutの中でURLパラメータとして使う)

VOICEVOXの利用規約(キャラクターごとのクレジット表記義務など)を守ること。詳細は本ページ末尾の補足を参照。

### 2. 台本のJSONチェックリストを作る(このリポジトリ側、社長が実行)

```bash
python3 -m moyasuka.manual_narration list \
  --script moyasuka/scripts/01-sample.md \
  --out /tmp/moyasuka-01-checklist.json \
  --format json
```

`--format text`(デフォルト)の代わりに`--format json`を指定すると、Shortcutsに直接貼り付けられる配列形式で書き出される:

```json
[
  {"index": 0, "speaker_id": 2, "speaker": "義母", "text": "今日も朝から掃除"},
  {"index": 1, "speaker_id": 2, "speaker": "義母", "text": "洗濯も晩ごはんも"},
  ...
]
```

話者名→話者IDの対応は`moyasuka/voicevox_narrate.py`の`CHARACTER_SPEAKER_IDS`をそのまま使っており(二重管理を避けるため)、未対応の話者名が出た場合は警告を出しつつずんだもん(id=3)に自動フォールバックする。このJSON文字列をそのままコピーして、オーナーに渡す(次の手順でShortcutに直接貼り付ける)。

### 3. Shortcutを組む(iPad側、オーナー作業)

1本のShortcutで完結させる設計。以下の順にアクションを並べる(名前は実際に組んで確認済みのもの):

1. **テキスト**: 手順2のJSON配列をそのまま貼り付ける(ファイルではなくテキストとして埋め込む — iCloud経由の「ファイル」アクションは参照が不安定でエラーになりやすかったため、この方式に変更した)
2. **入力から辞書を取得**: 入力は①の「テキスト」("辞書"という名前の別アクション(手動で1件ずつ組み立てる空の辞書ビルダー)と間違えやすいので注意——検索結果に複数「辞書」系の候補が出るので、"取得"と付いている方を選ぶ)
3. **各項目を繰り返す**: 入力は②の結果。この中に④以降を入れる
4. (ループの中)**繰り返し項目内のtextの値を取得** / **繰り返し項目内のspeaker_idの値を取得** / **繰り返し項目内のindexの値を取得** — 「辞書の値を取得」を3つ、キーをそれぞれ`text`/`speaker_id`/`index`にして追加
5. (ループの中)**URLの内容を取得**: URL欄に、固定文字とマジック変数を組み合わせてこう入力する:
   ```
   https://api.tts.quest/v3/voicevox/synthesis?speaker=[④のspeaker_idの値]&text=[④のtextの値]&key=<取得したAPIキー>
   ```
   (`[...]`の部分はキーボード上の「変数を選択」から対応するマジック変数を挿入する。直接文字として打っても動かない)
6. (ループの中)**入力から辞書を取得**: 入力は⑤の結果(JSON文字列)
7. (ループの中)**辞書内のwavDownloadUrlの値を取得**: 入力は⑥、キーは`wavDownloadUrl`。ここで得られるのは「音声のありか(リンク)」であって音声そのものではない点に注意
8. (ループの中)**URLの内容を取得**(2回目): URLは⑦の結果そのまま。ここで初めて実際の音声データが取得できる
9. (ループの中)**テキスト**: 中身は④のindexの値(ゼロ埋め不要、そのままでよい——コード側で吸収済み)
10. (ループの中)**ファイルを保存**: 保存するデータは⑧(実際の音声、⑤の生JSONではないので注意)。保存先は出力用フォルダ(例:`Moyasuka Narration`)、サブパスは⑨の結果+`.wav`
11. (ループの中、⑩の直後)**◯秒待つ**: 2秒に設定。**これがないと30行を連続で呼んだ時にレート制限で一部失敗する**(実際に発生・解消を確認済み)
12. 「繰り返しの終了」

途中、「URLの内容」のように**同名のアクションが複数あって紛らわしい箇所**が出てくる。その変数のピルをタップ→「アクションを表示」で、実際にどのブロックを指しているか確認できるので、迷ったらそれで確認する。

出力先フォルダの自己クリーンアップ(前回分を毎回自動で消す仕組み)は今回のバージョンには入れていない。前の動画のクリップが残っていても実害はないので、手動で「1本分アップロードしたら不要になったファイルを消す」運用で十分(下記の運用ルール参照)。

### 4. 生成が終わったら、フォルダごとアップロード

Shortcutの実行が終わったら(30行で数分程度)、出力先フォルダ(`Moyasuka Narration`)ごとこのプロジェクトのチャットにアップロードする(zipでまとめてもOK、実際にzip一括アップロードで問題なく受け取れることを確認済み)。届いたら社長側で組み立てる(方式Aと同じ):

```bash
python3 -m moyasuka.manual_narration assemble \
  --script moyasuka/scripts/01-sample.md \
  --clips-dir /path/to/uploaded/clips \
  --out /tmp/moyasuka-01-narration
```

以降は方式Aと共通(下記4.最終レンダリング参照)。

### 容量管理の運用ルール

自動削除の仕組みは入れていないので、**「1本分アップロード→組み立て完了確認→そのフォルダの中身を手動で空にする→次の1本の収録を始める」**という運用にする。特別な手順は不要、iPadの「ファイル」アプリで普通に削除するだけでよい。

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
