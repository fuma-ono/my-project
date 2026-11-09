# SOP: モヤスカ ナレーション音声の収録

**目的**: 台本1本分の実ナレーション音声を作り、動画に組み込むまでの標準手順。`docs/projects/moyasuka/voicevox-setup.md`(方式A')の実機トラブルシューティングの経緯を、**毎回参照する実務手順+早見表**として再構成したもの。背景・検討の経緯を読みたい場合は元のドキュメントを参照。

**所要時間の目安**: 初回セットアップ(手順0)は5〜10分・一度きり。収録本体(手順1〜4)は台本1本(約30行)につき5〜10分。

**適用範囲**: モヤスカの台本すべて(`moyasuka/scripts/*.md`)。

## 役割分担

| 作業 | 担当 |
|---|---|
| 台本のJSONチェックリスト作成 | 社長(Claude) |
| iPad Shortcutでの音声生成・アップロード | オーナー |
| 音声の組み立て・動画レンダリング | 社長(Claude) |

## 前提条件(初回のみ、手順0)

- [ ] iPadに「ショートカット」アプリがある(標準搭載)
- [ ] `https://voicevox.su-shiki.com/su-shikiapis/` でAPIキーを取得済み
- [ ] [利用登録フォーム](https://docs.google.com/forms/d/e/1FAIpQLSfE1oMXK2sZqoei8zFs1xHC2jb6Fhp5hY3QdU0vRbK2ZLuM0Q/viewform?usp=sf_link)にAPIキーのSHA256ハッシュを送信済み(未登録だと合成が遅く途切れがちになる)
- [ ] iPad Shortcutsの構成が`voicevox-setup.md`の方式A'手順3の通りに組んである(構成の詳細はそちらが正)

## 手順

### 1. JSONチェックリストを作る(社長)

```bash
python3 -m moyasuka.manual_narration list \
  --script moyasuka/scripts/<NN>-<name>.md \
  --out /tmp/moyasuka-<NN>-checklist.json \
  --format json
```

コンパクトな1行JSON(コピペしやすい形)にして、オーナーに渡す。

### 2. iPadで音声を生成する(オーナー)

1. Shortcutの「テキスト」ブロックの中身を、手順1のJSONに差し替える
2. Shortcutを実行する(30行で数分)
3. 出力フォルダの中に音声ファイルが並んでいることを確認する

### 3. アップロードする(オーナー)

出力フォルダを丸ごと(zip可)このチャットにアップロードする。

### 4. 組み立て・レンダリングする(社長)

```bash
python3 -m moyasuka.manual_narration assemble \
  --script moyasuka/scripts/<NN>-<name>.md \
  --clips-dir /path/to/uploaded/clips \
  --out /tmp/moyasuka-<NN>-narration

python3 -m moyasuka.line_chat \
  --script moyasuka/scripts/<NN>-<name>.md \
  --audio /tmp/moyasuka-<NN>-narration.wav \
  --durations /tmp/moyasuka-<NN>-narration.durations.json \
  --out moyasuka-<NN>-final.mp4
```

### 完了の定義(Definition of Done)

- [ ] 台本の全セリフ分の音声ファイルがアップロードされている(欠けがあれば`assemble`がエラーで教えてくれる)
- [ ] 最終mp4が生成され、波形・フレームを確認して違和感がない
- [ ] オーナーへ送付し、確認を依頼した

## トラブルシューティング早見表

実機で実際に発生した問題と対処。上から順に疑うと早い。

| 症状 | 原因 | 対処 |
|---|---|---|
| JSON読み込みで「操作を完了できません」 | iCloud経由の「ファイル」アクションは参照が不安定 | JSONをファイルではなく「テキスト」アクションに直接貼り付ける方式に変える |
| `voicevox.su-shiki.com/simple/`がreCAPTCHAページを返す | そのURLは人間のブラウザ操作専用、自動化スクリプトはボット判定される | 正しいエンドポイント`https://api.tts.quest/v3/voicevox/synthesis`を使う |
| APIから音声ではなくJSON(`wavDownloadUrl`等)が返る | このAPIは2段階方式(まずJSON、次に`wavDownloadUrl`を改めて取得) | JSONを解析して`wavDownloadUrl`を取り出し、もう一度「URLの内容を取得」で実際の音声を取りに行く |
| 30行中、数行だけ`success:false`や404で失敗する | 連続呼び出しによるレート制限、またはサーバー側の生成が音声取得のタイミングに間に合っていない | ループの最後に2秒待つ「◯秒待つ」アクションを入れる。`wavDownloadUrl`取得の直後にも1秒の待機を挟むとさらに安定する |
| 音声が「セリフ」ではなく数字だけを読み上げている | `text=`パラメータに誤って`index`の値を接続してしまっている(同名の「辞書の値」ブロックが複数あるため取り違えやすい) | 該当のマジック変数ピルをタップ→「アクションを表示」でどのブロックを参照しているか確認し、`text`キーのブロックに繋ぎ直す |
| ファイル名のゼロ埋め(`000.wav`)がShortcuts標準アクションで作れない | Shortcutsに数値を固定桁数に0埋めする組み込みアクションが無い | iPad側では対処せず、`index`の値をそのまま(`5.wav`)使う。受け取り側`manual_narration.py`の`_find_clip`がゼロ埋みの有無を問わず一致するよう対応済み |
| Google Drive/Dropboxとの連携で保存先ピッカーの「開く」が押せない/接続が不安定 | 現状の既知の制約(Google Driveは書き込みモード非対応、Dropboxは接続が不安定になることがある) | 無理に自動化を追わず、チャットへの手動アップロードにフォールバックする(それでも従来比で作業回数は激減している) |

## 改訂履歴

| 日付 | 内容 |
|---|---|
| 2026-08-09 | 初版。台本01の実機トラブルシューティング内容を反映して作成 |
