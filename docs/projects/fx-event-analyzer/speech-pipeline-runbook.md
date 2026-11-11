# 要人発言: 本文と要約の工程の実行手順(DEV)

HQ指示 2026-11-11「FRB要人発言パイプライン」。ブランチ `claude/fx-speech-pipeline`。**この文書の手順は、どれも承認の後に行う**。
次のものは、まだしていない:
- migration の適用
- settings への統合
- Render への反映
- ワークフローの変更と実行

## 1. 工程と処理の順

| 順 | 工程 | 対象 | 1回の上限 | 何をするか |
|---|---|---|---|---|
| 1 | `ingest:speech-bodies --all` | 発言済み(DELIVERED)で、`body_status` が PENDING または FAILED の FRB・ECB の発言(全期間) | 本文のページを20件まで(FRB のサイトには取得元ごとに2秒あける) | 古い発言から順に処理する(詳しくは下) |
| 2 | `ingest:speech-summaries --all` | `body_status = FETCHED`、本文あり、`summary` も `summary_error` も無い発言 | 200件まで | 古い発言から順に、最大3文・700字の原文の抜粋を作る(READY)。作れなければ理由を残す(FAILED) |

工程1で、発言ごとに何をするか:
- **ECB**: 本文のページは読まない。URL だけ残して `NOT_APPLICABLE / RIGHTS_UNCONFIRMED` にする。20件の上限には数えない。
- **FRB で URL が分かる**: 本文のページを読む。取れたら FETCHED、取れなかったら FAILED(理由を残す)。
  - URL は、DB にあるもの → 講演の RSS(直近の分) → 講演の一覧の JSON(2017年以降)の順に探す。
  - 結ぶのは、姓と日付がちょうど1件ずつ一致したときだけ。
- **FRB で URL が見つからない**: PENDING のまま残す。次の実行でまた探す。
- **21件目以降**: `RUN_CAP`。次の実行で読む。
- **FAILED になった発言**: 次の実行で、もう一度読みにいく。

FRB の過去の発言の処理:
1. 最初に、工程1を `--dry-run` で流す(第3節)。
2. 工程1の実行回数は、`by_action.FETCH` と `RUN_CAP` を足した件数を、20で割って切り上げた回数になる。
3. その回数だけ工程1を流す。毎回、古い発言から順に処理される。
4. 工程2を `--dry-run` で流して、件数を確かめる。
5. 工程2を1回流す(200件以内なら1回で終わる)。

## 2. 安全のしくみ

- **dry-run(`--dry-run`)**
  - DB に書かない。ingestion_logs にも書かない。
  - 書き込みの関数は、呼ばれたら失敗するストアを使う。
  - 本文の工程では、本文のページも読まない。読むのは FRB の講演の RSS と一覧の JSON だけで、それ以外の URL は失敗させる。
- **認証情報**
  - service_role の鍵は、今のワークフローと同じ GitHub Secrets の `FX_DEV_SUPABASE_SERVICE_ROLE_KEY` から渡す。
  - 接続先が DEV(`pbemckwnqmeaoveelihd`)でなければ止まる。今のワークフローの確認の手順をそのまま使う。
  - ジョブの出力は、発言の id・日時・公式ページの URL・件数・理由だけ。鍵・本文・要約の本文は出さない(要約の dry-run は文字数だけ)。
  - エラーは、メッセージの文だけを出す。
- **データの扱い**
  - 3時間ごとの発言の取り込み(upsert)は、本文と要約の列には触れない。
  - 人が書いた要約(`summary_method` が無い summary)は、工程2の対象に入らない。上書きしない。

## 3. ワークフローの target の追加案(未反映。承認の後、settings に入れる)

`.github/workflows/fx-event-analyzer-ingestion.yml` の手動の target に、次の4つを足す。今の Eurostat と同じ形で、「Use workflow from」は settings にする。

```yaml
# inputs.target の説明に追記: / speech-bodies-dry-run / speech-bodies / speech-summaries-dry-run / speech-summaries
      - name: Speech bodies (all past speeches) dry run, no DB writes, no body pages (manual only)
        if: steps.check.outputs.ready == 'true' && github.event_name == 'workflow_dispatch' && inputs.target == 'speech-bodies-dry-run'
        run: npm run -s ingest:speech-bodies -- --all --dry-run
      - name: Speech bodies (all past speeches, FRB only stored; manual only)
        if: steps.check.outputs.ready == 'true' && github.event_name == 'workflow_dispatch' && inputs.target == 'speech-bodies'
        run: npm run -s ingest:speech-bodies -- --all
      - name: Speech summaries (extractive, all past speeches) dry run, no DB writes (manual only)
        if: steps.check.outputs.ready == 'true' && github.event_name == 'workflow_dispatch' && inputs.target == 'speech-summaries-dry-run'
        run: npm run -s ingest:speech-summaries -- --all --dry-run
      - name: Speech summaries (extractive, all past speeches; manual only)
        if: steps.check.outputs.ready == 'true' && github.event_name == 'workflow_dispatch' && inputs.target == 'speech-summaries'
        run: npm run -s ingest:speech-summaries -- --all
```

concurrency は、この4つの target を `fx-ingestion-speeches` のグループに入れる(3時間ごとの発言の取り込みと順番に動かす):
- `inputs.target == 'speeches'` の条件に `|| startsWith(inputs.target, 'speech-')` を足す。

その他:
- timeout は今のまま10分で足りる(20ページ × 2秒 + 一覧の取得)。
- 定期実行(schedule)には入れない。

## 4. 確認の SQL(すべて読み取りだけ)

**migration の前**(既存の16件。新しい列はまだ無い):
```sql
select provider, status, count(*) as n, count(summary) as with_summary
from speech_events group by 1, 2 order by 1, 2;
```

**migration の後・工程の前と後**(同じ SQL を流して比べる):
```sql
-- A. 内訳
select provider, status, body_status, (summary is not null) as has_summary, summary_method, summary_error, count(*) as n
from speech_events group by 1, 2, 3, 4, 5, 6 order by 1, 2, 3, 4;

-- B. 工程1の対象(--all)
select provider, count(*) as n from speech_events
where status = 'DELIVERED' and body_status in ('PENDING', 'FAILED') and provider in ('frb_calendar', 'ecb_press_rss')
group by 1;

-- C. 工程2の対象
select count(*) as n from speech_events
where body_status = 'FETCHED' and speech_body is not null and summary is null and summary_error is null;

-- D. 1件ずつ(処理の順。本文は出さない)
select e.id, e.provider, e.statement_datetime, e.status, e.body_status, e.body_error,
       e.source_url, length(e.speech_body) as body_chars, length(e.summary) as summary_chars,
       e.summary_method, e.summary_error, s.name
from speech_events e join speakers s on s.id = e.speaker_id
order by e.statement_datetime;
```

**期待する結果**:
- migration の直後:
  - 16件すべてが `body_status = PENDING`。
  - `summary_method` と `summary_error` は null。
  - `summary` の件数は、migration の前と同じ。
- 工程1の後:
  - ECB の発言済みは NOT_APPLICABLE。
  - FRB の発言済みは、FETCHED / FAILED / PENDING(URL が見つからない)のどれか。
  - 発言前(SCHEDULED)の発言は PENDING のまま。
- 工程2の後:
  - FETCHED の発言は、すべて `summary_method = EXTRACTIVE_EN`(READY)か `summary_error` あり(FAILED)のどちらか。
  - それ以外の発言は変わらない。

**API**(FREE と PRO の両方):
- `GET /speeches/{id}` と `GET /speeches` で、次を確かめる:
  - READY = summary あり・EXTRACTIVE_EN
  - FAILED = summary null
  - NOT_AVAILABLE = 本文なし・ECB・発言前
  - FREE と PRO で同じ値になること
- 結合テスト `tests/integration/speech-summary-plans.test.ts` でも、同じことを確かめている。

## 5. DEV への反映の順番(承認の後)

1. 第4節の「migration の前」の SQL を流す。
2. migration `20261110000001_speech_body.sql` → `20261111000001_speech_summary.sql` の順に適用する。
3. 第4節の A を流す。
4. settings に統合する。統合の中身は、コードと第3節のワークフローの target。
5. Render の fx-api-dev に反映する。必ず migration の後にする(先に反映すると、発言の API が失敗する)。
6. 次の順に流す。毎回、第4節の A〜D で確かめる。
   1. `speech-bodies-dry-run`
   2. `speech-bodies`(必要な回数だけ)
   3. `speech-summaries-dry-run`
   4. `speech-summaries`
7. API を FREE と PRO で確かめる。

元に戻す手順:
- 列を消す: `20261111000001` → `20261110000001` の順に、各ファイルの冒頭の `drop column` を流す。
- 工程の結果だけ消す:
  ```sql
  update speech_events set summary = null, summary_method = null, summary_generated_at = null, summary_error = null where summary_method is not null or summary_error is not null;
  ```

## 6. 日本語の AI 要約の試作(準備だけ。ワークフローへの追加と実行は承認の後)

**目的**: FRB の講演2件(2026-11-10 の Bowman・Waller)で、Qwen2.5-7B-Instruct が CPU だけで日本語の要約を作れるか、その時間・メモリ・質を測る。**DB には書かない。**

**モデル**:
- `Qwen/Qwen2.5-7B-Instruct-GGUF` の q4_k_m(Apache-2.0)。
- 2つのファイルに分かれていて、合計約4.68GB。`llama-gguf-split --merge` でつなぐ。
- 文脈は32,768トークンまで。
- 3B 版はライセンスが qwen-research で違うため、使わない。

**実行の場所**:
- 試作専用のワークフローを1本作る(手動の実行のみ)。
- 非公開のリポジトリの ubuntu-latest(CPU 2コア・メモリ8GB・ディスク14GB)。
- 社内 PC では動かさない。
- 出力は GitHub の artifact の JSON だけにし、7日で消す。

**手順**:
1. 本文を用意する。backend の `extractFrbSpeechBody` で2件の本文を取り出す(公式のページだけを読む)。
2. モデルを取る。公式の Hugging Face から2つのファイルを取り、つなぐ。llama.cpp を CPU 用に組み立てる。
3. 要約を作る。
   - 入力: 本文の全文(約2万字、約5千トークン)。
   - 指示: 「本文に書かれていることだけで、日本語で3〜5点に要約。数値・日付・人名は本文のとおり。推測しない」。
   - 設定: temperature 0。最大512トークン。
4. 測る。
   - 1件ごとに、次を記録する: 読み込み時間・入力の処理時間・生成時間・合計の時間、メモリの最大値(`/usr/bin/time -v` の Maximum resident set size)、1秒あたりのトークン数。
5. 出力する。artifact に、本文の文字数・要約・測った値・自動の点検の結果を入れる。

**評価の基準**(試作の合否):

| 観点 | 測り方 | 合格の目安 |
|---|---|---|
| 時間 | 1件の合計の時間 | 10分以内(ジョブの上限の中で、1回に数件を処理できる) |
| メモリ | 最大の常駐メモリ | 7GB 未満(ランナーは8GB) |
| 数値の正しさ | 要約の中の数値・パーセント・年月を自動で取り出し、本文にあるかを確かめる | 本文に無い数値が0件 |
| 固有名詞 | 人名・機関名(FOMC・FRB など)が本文と合うか | 誤りが0件 |
| 誤訳 | 金融の用語の対訳表(rate cut = 利下げ、tightening = 引き締め、balance sheet = バランスシート など)と照らす。人も読む | 意味が逆・違う訳が0件 |
| 網羅 | 英語の抜粋(EXTRACTIVE_EN)の要点が、日本語の要約に入っているか | 人の評価で、3段階のうち「おおむね入っている」以上 |
| 日本語 | 読みやすさ | 人の評価で、3段階のうち「そのまま読める」以上 |

**英語の抜粋と、日本語の AI 要約を分ける**:
- 試作の結果は、DB にも API にも入れない。
- 本番に入れるとしたら、別の列にする。今の `summary`・`summary_method = EXTRACTIVE_EN` には触れない。
  - 例: `summary_ja`、`summary_ja_method = 'LLM_QWEN2_5_7B_Q4'`、`summary_ja_generated_at`、`summary_ja_error`
- API も別の項目にし、アプリでは「AI による日本語要約(参考)」と書く。英語の抜粋は「原文からの抜粋」と書く。
- この切り分けは、migration と API の変更が必要なので、試作の結果を見てから提案する。
- 権利:
  - FRB はパブリックドメインなので、要約を作ってよい。
  - ECB は照会の回答まで作らない。
  - 日本銀行は「無断で改変を行うことはできません」とあるので、要約は作らない。

## 7. 定期実行にする場合の運用の方式(案。実装・有効化はまだしない)

HQ指示 2026-11-11「本文取得・要約生成を定期実行にする場合の安全な運用方式」。

### 7.1 今の状態(2026-11-11 に確認)
- **発言の取り込み**(`ingest:speeches`)は、main のワークフローの schedule `41 */3 * * *` で動く(3時間ごと、毎時41分 UTC)。
  - コードは `ref: claude/fx-settings-screens` から取ってくる。
  - 以前は「30分ごと」と報告していたが、誤り。
- **本文と要約**(`ingest:speech-bodies` / `ingest:speech-summaries`)は、settings の手動の target だけ。定期実行には入っていない。
- **定期実行の条件**: schedule は main のワークフローでしか動かない。定期実行に入れるには main のワークフローの変更(承認)が要る。
- **GitHub の schedule**は、配信されない回がある(11/11 に3時間の空白を確認、fx-ingestion-health)。どの工程も「抜けても、次の回で取り戻せる」作りにする。

### 7.2 工程を分ける
本文と要約は、別の工程(別のステップ)のままにする。同じ回で続けて流してもよいが、本文の失敗で要約を止めない・要約の失敗で本文を巻き戻さない。

| 工程 | 頻度(案) | 1回の上限 | 対象 |
|---|---|---|---|
| 発言の取り込み | 今のまま 3時間ごと(:41) | — | — |
| 本文 | 3時間ごと。発言の取り込みと同じ回の直後に、同じジョブの別のステップとして流す | ページ20件(FRB に2秒あける) | 直近14日(`--all` は使わない)の、発言済み・PENDING / FAILED の FRB の行 |
| 要約 | 本文の直後(同じジョブの別のステップ) | 200件 | 本文が取れて、要約も理由も無い行(全期間でも、件数は小さい) |

- **頻度の考え方**:
  - FRB は、講演の原稿を講演の時刻ごろに公開する。3時間ごとなら、遅くとも次の回(3時間以内)に本文が入る。
  - それより速くしても、FRB のサイトへの読み込みが増えるだけで、利点が小さい。
- **期間を14日に限る理由**:
  - 原稿の無い発言(討論・記者会見など)は、ずっと PENDING のまま残る。全期間を対象にすると、毎回それらのために講演一覧の JSON(約450KB)を読み直すことになる。
  - 14日を過ぎた行は、自動の対象から外れる(手動の `--all` は残す)。

### 7.3 失敗のときの再試行
- **本文**:
  - 今の作りでは、FAILED の行は毎回取り直す。定期実行では、次のようにして無限に取り直さないようにする(実装は承認の後)。
    1. 14日を過ぎたら、自動の対象から外す(7.2)。
    2. 回数の上限を付ける。例: `body_attempts`(列の追加 = migration が要る)、または `ingestion_logs` を見て同じ行の失敗を数える。3回で止める案。
  - HTTP の一時的な失敗(5xx・時間切れ)は、HttpClient が1回の実行の中で2回まで取り直す(今の設定)。404 などは FAILED にして、次の回で取り直す(上の上限の中で)。
  - FAILED の理由は `body_error` に残る。API には出さない。
- **要約**:
  - 同じ本文からは同じ結果になる(原文の抜粋で、外部 API を使わない)ので、FAILED(`summary_error` あり)は自動では取り直さない。今の作りのまま。
  - 抜き出しの方法を変えたときだけ、人が SQL で対象を戻して流し直す(5節の元に戻す手順)。

### 7.4 重複の取得・書き込みを防ぐ
- **今あるしくみ**:
  - 本文は、PENDING / FAILED の行だけが対象。FETCHED は取り直さない。
  - 要約は、要約も理由も無い行だけが対象。人が書いた要約は上書きしない。
  - 3時間ごとの発言の取り込み(upsert)は、本文と要約の列に触れない。
- **定期実行で足すこと**(実装は承認の後):
  1. **同時に動かさない**:
     - 本文と要約は、発言の取り込みと同じ concurrency のグループ(`fx-ingestion-speeches`、cancel-in-progress: false)で動かす。
     - 手動の target もすでにこのグループ。2つの実行が同時に同じ行を書くことは、グループで防ぐ。
  2. **書き込みに状態の条件を付ける**(グループがすり抜けた場合の二重の守り):
     - 本文の更新は `where id = ? and body_status in ('PENDING','FAILED')`。
     - 要約の更新は `where id = ? and summary is null and summary_error is null`。
     - 今は `where id = ?` だけ。コードの小さな変更で、migration は要らない。
  3. **同じページを指す複数の行**(同じ原稿を2回話した講演)は、行ごとに本文を取る。同じページを2回読むが、20件の上限の中なので負荷は小さい。気になるなら、同じ回の中で同じ URL の HTML を使い回す変更を足す。

### 7.5 DEV と PROD を分ける
- **今のワークフローは DEV 専用**:
  - service_role の鍵の中の project ref が `pbemckwnqmeaoveelihd`(DEV)でなければ止まる。
  - Secret も DEV 用(`FX_DEV_SUPABASE_SERVICE_ROLE_KEY`)。
  - 定期実行を足すのも、この DEV 用のワークフローだけ。
- **PROD に入れるとき**(今回は対象外):
  - 別のワークフローにする。
  - GitHub の Environment(`production`、承認者付き)と、PROD 用の Secret(DEV の鍵とは別の名前)を使う。
  - 接続先が PROD の project ref であることを、同じやり方で確かめる。
  - DEV のワークフローからは PROD に書けない(鍵が別)。
  - PROD のコードは、main など決まった ref から取る(settings から取らない)。
  - 本文の権利(FRB だけ、ECB は保存しない)は、コードの `STORE_BODY_FOR` で決まる。PROD でも同じ。
  - PROD に入れる前に、FRB の出典の表示(attribution)が iOS に出ていることを確かめる。

### 7.6 見張り
- 実行の記録は `ingestion_logs` に残る:
  - 本文: provider `internal`、job `ingest:speech-bodies`
  - 要約: provider `speech_summary`
- 品質レポート(`report:fx-health`)に、次を足す案:
  - 発言から24時間を過ぎても URL のある PENDING の行
  - 3回以上 FAILED の行
  - 要約が FAILED の行の件数
- 止めるとき: schedule の行(またはステップの条件)を外すだけ。取ったデータは残る。

### 7.7 定期実行にするための承認の項目(まとめ)
1. 本文の書き込みの状態の条件と、本文の取り直しの上限の実装。上限に列を使うなら migration が要る。
2. 本文・要約のステップを、発言の取り込みの回に足す。main のワークフローの変更になる。
3. 品質レポートに見張りの項目を足す。
4. 2週間ほど DEV で動かして、`ingestion_logs` と DB の件数を確かめてから、PROD の検討に進む。
