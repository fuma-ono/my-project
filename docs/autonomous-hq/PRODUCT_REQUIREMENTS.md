# PRODUCT_REQUIREMENTS — 動画自動編集AI(VAE)

目的: 動画をアップロードするだけで、カット・字幕・BGM を自動で行い、編集者が仕上げたような見やすい動画を書き出す。
制約: 無料・ローカルで動く技術を優先し、有料 API に依存しない。

各受け入れ条件(AC)は、テスト名か評価手順で確かめられる形で書く。「証拠」の列は QUALITY_GATES.md に記録する。

## 動画処理
| AC | 受け入れ条件 | 確かめ方 |
|---|---|---|
| AC-V1 | MP4・MOV・M4V・MKV・WEBM(H.264 / HEVC / VP9、AAC / Opus / PCM)を受け付ける | `tests/test_media.py`(各形式を合成して probe・処理) |
| AC-V2 | 出力の解像度・縦横比・fps が元と同じ(回転メタデータを含む) | `tests/test_render.py`、実動画の評価 |
| AC-V3 | 残す区間はフレーム境界にそろい、フレームの欠落・重複がない | `tests/test_render.py`(番号埋め込み素材)、`tools/bench_render.py` |
| AC-V4 | 書き出しのメモリが動画長に依存せず 1GB 未満(5分 1080x1920 で確認) | `tools/bench_render.py` |
| AC-V5 | 元動画を変更しない。失敗しても元動画と既存の出力が残る | `tests/test_pipeline.py`(ハッシュ比較、失敗の注入) |
| AC-V6 | 壊れたファイル・音声なし・極端に短い動画・未対応形式で、分かりやすいエラーを返し、作業フォルダを片付ける | `tests/test_media.py`、`tests/test_jobs.py`、`tests/test_review_fixes.py` |

## 音声処理
| AC | 受け入れ条件 | 確かめ方 |
|---|---|---|
| AC-A1 | 日本語の文字起こし(Whisper medium、CPU) | 実動画の評価(誤り箇所の一覧)。台本があれば文字誤り率 |
| AC-A2 | VAD による無音検出で、背景音があってもカットされる | 実動画3(環境音)で出力が元より短い |
| AC-A3 | フィラーを表記ゆれと文脈で判定し、候補・判定・理由を記録する | `tests/test_fillers.py` |
| AC-A4 | 必要な発話を誤って削除しない(「うまく」の「う」など) | `tests/test_fillers.py`、評価シートの誤カット候補(高)0件 |
| AC-A5 | カット境界に短いフェードがあり、クリック音の原因になる段差がない | `tests/test_audio.py`(境界の振幅の段差) |
| AC-A6 | 声 -16 LUFS ±1、True Peak ≤ -1.0 dBTP | `tests/test_audio.py`、`vae.cli verify` |
| AC-A7 | 発話中に BGM を下げ、無音で戻す。「声−BGM」の下位5% ≥ 9 LU、BGM が声を上回る窓 ≤ 1%、下げ幅の揺れ ≤ 1 dB | `tests/test_audio.py`、実動画の評価 |

## 字幕
| AC | 受け入れ条件 | 確かめ方 |
|---|---|---|
| AC-S1 | 字幕の時刻は、元の単語の時刻をカット後の時刻に写したもの(同期) | `tests/test_subtitles.py` |
| AC-S2 | 数字・年月日・時刻・英単語の途中で改行・分割しない | `tests/test_subtitles.py` |
| AC-S3 | 0.8秒未満の表示を作らない(動画の末尾で延ばせない場合を除く) | `tests/test_subtitles.py` |
| AC-S4 | 文末記号(全角・半角)で文を区切る | `tests/test_subtitles.py` |
| AC-S5 | フォント実寸で画面内に収まる(縦・横)。1回の表示は最大2行 | `tests/test_subtitles.py`、画面キャプチャ |
| AC-S6 | UI から字幕の文言を修正し、再書き出しに反映できる | `tests/test_web.py`、UI 操作テスト |

## 書き出し
| AC | 受け入れ条件 | 確かめ方 |
|---|---|---|
| AC-E1 | 出力は ffprobe で読め、映像と音声の長さの差が1フレーム以内 | `vae.cli verify`、`tests/test_pipeline.py` |
| AC-E2 | 映像は H.264(CRF 20)・AAC 192k。元より不必要に劣化させない | 設定値の確認 |
| AC-E3 | 一時ファイルはジョブの作業フォルダに置き、完了・失敗後に片付ける。期限切れのジョブを削除できる | `tests/test_jobs.py` |

## UI・UX(ローカル Web)
| AC | 受け入れ条件 | 確かめ方 |
|---|---|---|
| AC-U1 | ブラウザで動画をアップロードし、処理を開始できる | `tests/test_web.py`、`tools/ui_smoke.mjs` |
| AC-U2 | 処理の進み具合(段階と割合)が表示される | 同上 |
| AC-U3 | 編集結果をプレビューし、字幕一覧を確認・修正できる | 同上 |
| AC-U4 | エラーの原因と対処が日本語で表示される | 同上 |
| AC-U5 | 書き出した動画をダウンロードできる | 同上 |

## ビジネス
| AC | 受け入れ条件 | 確かめ方 |
|---|---|---|
| AC-B1 | 無料プランは入力動画30秒まで。超える場合は処理前に案内して止める(料金仕様 v1 で AC-P6 に拡張) | `tests/test_jobs.py` |
| AC-B2 | プランは設定で追加できる。同時実行数はサーバー全体で1(4 vCPU を前提)。**料金仕様 v1 で AC-P1 に置き換え**(1日の回数 → 月の新規編集数) | `tests/test_jobs.py` |
| AC-B3 | 1本あたりの処理時間・最大メモリ・外部費用(0円)を記録する | ジョブ結果の JSON |
| AC-B4 | 無料枠の悪用防止の設計(同一内容の再アップロード検出、端末ごとの回数上限)を文書化し、ハッシュによる重複検出を実装する | `tests/test_jobs.py`、ARCHITECTURE |


## 料金・利用制限(仕様 v1、2026-11-21。設計は PRICING_DESIGN.md)
| AC | 受け入れ条件 | 確認方法 |
|---|---|---|
| AC-P1 | プランの価格・上限・商品 ID・編集コンセプトを `config/plans.json` で変えられる(FREE 30秒・月3本・再編集1回・720p / STANDARD 980円・3分・15本・3回・1080p・複数動画 / PRO 1,980円・10分・40本・5回・1080p・4K(条件付き)・複数動画・優先処理。透かしなし) | `tests/test_billing_quota.py::test_ac_p1*` |
| AC-P2 | 月間の新規編集数をサーバー側で数え、上限で `limit_reached`(アップグレードの案内つき、自動課金なし)。月は日本時間の暦月 | `test_ac_p2*` |
| AC-P3 | AI 再編集をプロジェクトごとに数える。同じ設定の再編集・字幕の手動変更の書き出し・相談は数えない | `test_ac_p3*`、`tests/test_web.py` |
| AC-P4 | 失敗・キャンセル・削除・サーバーの中断で利用枠を返却する。書き出しの失敗は、やり直せる間は予約のまま | `test_ac_p4*`、`test_cancel_flag_does_not_leak` |
| AC-P5 | 同時リクエスト・リトライで二重に消費しない(BEGIN IMMEDIATE、冪等キー) | `test_ac_p5*`、`tests/test_web.py` |
| AC-P6 | 元動画の合計時間・複数動画の可否をサーバー側で検証する。クライアントのプランの申告は使わない。期間終了後は FREE の上限を超えるプロジェクトの再編集を止める | `test_ac_p6*`、`tests/test_web.py::test_client_declared_plan_is_ignored_ac_p6` |
| AC-P7 | 書き出しの解像度をプランの上限(短辺)に縮小する。拡大しない。4K は設定と素材の条件がそろったときだけ | `test_ac_p7*` |
| AC-P8 | AI 再編集で元動画と修正前の完成動画を保持し、文字起こし(と変わらない音声)を再利用する。手で直した字幕は同じ場面なら引き継ぐ | `test_ac_p3_p8*`、`test_ac_p8*` |
| AC-P9 | 処理ごとの時間・CPU 時間・メモリ・API 費用(0円)・サーバー費用を記録し、プラン別・種類別・解像度別に集計する | `test_ac_p9*`、`python -m vae costs` |
| AC-P10〜P14 | App Store の購入・復元・解約・返金・二重登録の防止をサーバーで検証する(テスト用の証明書チェーン) | `tests/test_billing_appstore.py` |
| AC-P15 | マイページ(プラン・契約・残り)、長さの事前案内、アップグレード画面(価格・期間・更新条件を購入ボタンの前に)。無料の操作を妨げない | `tools/ui_smoke.mjs`、`tests/test_web.py` |
| AC-P16 | PRO のジョブを待ち行列で先に処理する | `test_ac_p16*` |
