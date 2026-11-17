# R18 HomeCacheStore キャッシュ鮮度仕様設計書(第3版・最終整理)

HQ指示(2026-11-17「BoC API変更に伴うiOS互換性確認」→「R18追加確認」→「キャッシュ鮮度仕様の設計提案」
→「第2版設計指示」→「第3版(最終整理)」)への対応。

**この文書は設計書。Swiftコード・API・DB・migration・テストは、していない
(HQが設計書を確認した後に別途判断)。**

対象は`HomeCacheStore`(`FXEventAnalyzer/Common/HomeCacheStore.swift`)が保存するホーム画面の
アプリ層キャッシュ、および`HomeViewModel`(`FXEventAnalyzer/Features/Home/HomeViewModel.swift`)の
表示ロジック。BoC政策金利のような事後訂正(revision)が発生し得る指標の導入を見据え、
「古い値を最新情報と誤認させない」ことを最優先に、キャッシュの鮮度管理の仕様を整理する。

前提となる調査結果(R18/R23等の読み取り専用確認、2026-11-17実施)はこの文書の各節に統合済み。
`updated_at`・`revision_status`(Home向け)・`checked_at`・`revision_version`等のフィールドは、
本リポジトリのAPI(`docs/projects/fx-event-analyzer/api-design.md`)にも実装にも**現時点で存在しない**
(`GET /home`の`events[]`には`event_id`/`status`/`data_status`/`release_datetime`等のみで、
`updated_at`相当の項目は一切含まれない。`revision_status`はEventDetail専用、api-design.md 770-775行目)。
以下はすべて「追加するなら」という前提の設計。

---

## 0. 前提・方針

- 対象はホーム画面のアプリ層キャッシュ(`HomeCacheStore`)。HTTPレベルのキャッシュ(`URLCache`)は
  このアプリでは使われていない(別途確認済み、R23)。
- 「鮮度が切れている」ことと「情報を消す」ことは別の判断。古い情報の保持自体は否定しないが、
  最新情報と区別できることを必須とする。
- Render Freeの起動待ち対策(キャッシュの先出し表示、約20秒のコールドスタートを隠す目的)と、
  データそのものの鮮度期限は、目的が異なる別問題として扱う。前者のための先出し表示は維持する。
- 本文書は設計のみであり、数値(TTL等)は確定しない。確定はHQ判断。

---

## 1. 鮮度情報の責任分離(5項目)

第2版では`savedAt`/`updatedAt`/`revision`の3層分離を提案したが、「Backend上のデータ変更時刻
(`updated_at`)が古いこと」と「Backendが取得元を確認できていないこと」は別の問題であり、
`updated_at`だけでは区別できない。第3版ではこれを分離し、**5つの責任**に整理する。

| 項目 | 意味 | 責任 | 役割 |
|---|---|---|---|
| `savedAt` | iOSが最後に取得完了した時刻 | iOS(既存) | 「いつ端末に保存したか」の機械的な記録。TTL判定の起点。 |
| `updated_at` | Backend上で対象データ(`actual`/`forecast`/`data_status`等)が最後に変化した時刻 | Backend(新設) | 「内容が実際に変わったか」の判定に使う。**ただし、これが古いことだけでデータを無効と判断してはならない**(変化していないだけで正しく最新の場合がある)。 |
| `checked_at` | Backendが取得元(BLS/BoC等)を最後に正常確認できた時刻(値が変わらなくても更新される) | Backend(新設) | **実際の取得元確認の鮮度はこちらで判断する**。`checked_at`が古い=Backend自体の確認が止まっている/遅延している可能性があり、これはiOS側の鮮度表示に反映すべき。 |
| `revision_version`等 | 改定を識別する値(候補、§4参照) | Backend(新設・候補) | 改定が何回発生したか・最新の改定がどれかを識別する。 |
| `revision_status` | 改定の有無を示す表示用情報(`NONE`/`REVISED`、既存はEventDetail限定) | Backend(既存・拡張候補) | UI表示用の簡易フラグ。詳細は§4で限界を明記。 |

**設計原則**: `updated_at`が古い → 「変化なし」が確認できている場合は問題ない。
`checked_at`が古い → Backend自体が取得元を確認できていない可能性があり、**これを鮮度判定の
主たる根拠とする**。この2つを混同しないことが、第2版で指摘された「Backendが古い値を返し続けた
場合に`savedAt`だけ更新されて鮮度が回復したように見える」問題への直接的な対策になる。

iOS側の判定ロジック(案):
```
再取得が成功した場合:
  savedAt を now に更新(常に)
  if checked_at が前回より新しい:
      Backendは取得元を再確認できている → 「確認済み」として鮮度表示をクリア
  else (checked_at が前回と同じ、または取得できない):
      Backend確認が停滞している可能性 → 「確認が古い」旨の表示を維持・強調
```

---

## 2. TTLの階層と優先順位(数値は未確定)

| 層 | 候補(未確定) | 役割 |
|---|---|---|
| ① キャッシュ全体の最大寿命 | 15〜60分 | 外枠。全イベント共通の天井。 |
| ② DATA_PENDING / NOT_ANALYZABLE中 | 5〜15分 | ①より短く設定可能な内枠。 |
| ③ READY後 | 数時間(無期限は避ける) | ①の天井内でより長めに取れる内枠。 |
| ④ 訂正可能性のあるデータ(政策金利等) | ②・③よりさらに短い候補(例:15分) | 指標種別に応じた追加の内枠。 |
| ⑤ FX価格の既存30分ルール(`HomeCacheStore.priceMaxAge`) | 既存値を維持 | イベント本体のTTL階層とは**別軸**(通貨ペア価格専用、独立判定)。 |

判定方法(最も短い有効期限を優先):
```
effective_ttl(event) = min(① 全体TTL, ②or③ data_status別TTL, ④ 該当すれば訂正可能性TTL)
```
この`effective_ttl`を`now - savedAt`と比較する。ただし§1の`checked_at`判定が優先される場面
(Backend確認自体が古い)では、TTLが切れていなくても「確認が古い」表示を出すことがあり得る
(TTLは「iOS側が最後に取得した時刻」の制御、`checked_at`は「Backend側が最後に確認した時刻」の
制御で、両者はAND条件で働く)。⑤のFX価格TTLはイベント本体の`effective_ttl`とは独立に判定する。

---

## 3. Backendとの責任分担

| 案 | 内容 | 長所 | 短所 |
|---|---|---|---|
| A. iOSのTTLだけで管理 | 経過時間のみで鮮度判定 | Backend変更不要、既存API互換の心配なし | Backendの内容変化・確認状況を一切検知できない。「見た目だけ鮮度回復」問題を解決できない |
| B(推奨). Backendの`updated_at`/`checked_at`/`revision_version`とiOSのTTLを併用 | TTLは「再確認のタイミング制御」、実際の鮮度・健全性判定は`checked_at`等の比較で行う | Backendの実際の状態を検知可能 | Backend API拡張が必要 |

**検知できる範囲**:
- 検知できる: Backend DB上で`actual`/`forecast`/`data_status`/改定が実際に変わったケース。
- 検知できる(第3版で追加): `checked_at`があれば、Backendが取得元の確認自体を継続できているか。

**検知できない(B案でも)**:
- Backendの取得元確認プロセス自体にバグがあり、`checked_at`を誤って更新し続ける場合(値は
  変わっていないのに確認時刻だけ進む「見せかけの健全性」)。これはiOS側では検知不能であり、
  **取得元確認が停止・遅延した場合の検知と表示責任はBackend側にある**(§8のPASS条件に明記)。
- revisionが値を変えずにフラグだけ変える、あるいは逆に値を変えてもフラグを更新しない実装ミスが
  Backend側にあった場合。これもiOS側では検知不能。

**追加フィールド案(Backend API変更、未実装・案のみ)**:
- `GET /home`の`events[]`に`checked_at`(Backendが最後に取得元を正常確認した時刻、値不変でも更新)を追加
- `events[]`に`updated_at`(その行の`data_status`/`actual`等が最後に変化した時刻)を追加
- `events[]`に`revision_status`(既存のEventDetail相当)を追加
- (§4で検討)`revision_version`または最新`revision_id`/`revision.created_at`相当の値を追加

**既存APIとの互換性**: いずれも新規の**optionalフィールド**として追加する前提であれば、
JSONDecoderは未知キーを無視するため古いアプリ・古いBackendとの互換性は保たれる
(前回報告のCodable互換性確認と同じ原理)。iOS側も`resultType`/`valueDecimals`と同様、
`Optional`プロパティとして追加すれば既存モデルを壊さない。

---

## 4. 改定の識別 — revision_statusの限界

既存の`revision_status`(`NONE`/`REVISED`、api-design.md 770-775行目、`EventRevision`の存在有無から
Backendが動的算出)は、**「改定が1件以上あるか」の二値情報でしかなく、REVISED後に再度改定が
発生した場合(2回目・3回目の改定)を識別できない**。`REVISED`のまま値だけが再度変わっても、
iOS側は「前回確認した改定」と「今回の新しい改定」を区別する手段を持たない。

**複数回の改定を識別するための候補**(採用値は未確定):

| 候補 | 内容 | 長所 | 短所 |
|---|---|---|---|
| 最新`revision_id` | 最後に適用された改定行のID(`GET /events/{id}/revisions`の`revision_id`) | 既存のテーブル構造をそのまま使える | IDが連番でない場合、「新しいか古いか」の比較に使えない可能性 |
| `revision.created_at`(最新) | 最新の改定行の`created_at`(既存、api-design.md 999-1026行目) | 既存フィールドの転用で済む | 時刻比較のみで「何回改定されたか」は分からない |
| `revision_version`(新設・改定回数のカウンタ) | `event_id`ごとの改定件数、または単調増加するバージョン番号 | 「前回確認時より増えたか」で再改定を確実に検知できる | Backend側での新規実装(カウンタ管理)が必要 |

いずれを採用するにしても、Homeレベルで「前回保存したバージョン/IDと今回取得したものを比較する」
ことで初めて複数回改定を検知できる。`revision_status`単体(NONE/REVISEDの二値)のままでは、
この比較ができないことを明記する。

---

## 5. StrategyAnalysis(分析機能)への影響

`StrategyAnalysisViewModel.swift:39-46`は`HomeCacheStore`を一切参照せず、独自に
`apiClient.send(endpoint)`で`StrategyAnalysisResponse`を直接取得する設計である。
**HomeCacheStoreから独立していることは確認済みであり、この点は維持する。**

ただし、「Homeキャッシュの鮮度ロジックと無関係」であることと「鮮度の問題が一切ない」ことは
同じではない。StrategyAnalysisは都度Backendへ直接問い合わせるため、**Backendが古いデータ
(取得元確認が停止している等)を返した場合、StrategyAnalysisも同じ古い値をそのまま表示する**。
したがって第2版での「分析画面は鮮度の概念自体がない」「影響なし」という表現は不正確であり、
以下に修正する。

- **修正後の記述**: StrategyAnalysisはHomeCacheStoreのTTL・鮮度ロジックには依存しないが、
  Backendが返すデータそのものの鮮度(`checked_at`等)には同じく影響を受ける。分析結果が
  実際にはどの時点のBackendデータに基づくものかを利用者に示す手段が、現状のAPIには無い。
- **分析APIの設計拡張(案)**: `StrategyAnalysisResponse`にも、§1・§3で提案した`checked_at`/
  `updated_at`相当のフィールドを(必要な範囲で)含められるようにし、分析結果の横に
  「この分析はHH:mm時点のデータに基づきます」等の注記を表示できる設計にしておく。
  これはHome側のキャッシュ鮮度とは別個の仕組みとして、分析API側に必要なら個別に追加する。

---

## 6. 表示・分析利用の制御

| 状態 | Home画面 | StrategyAnalysis(分析画面) |
|---|---|---|
| オンラインで期限切れ | 値は維持し「情報が古くなっています・更新中」、裏で再取得 | 都度取得のため「期限切れ」の概念はないが、取得した`checked_at`が古ければ§5の注記を表示 |
| オフラインで期限切れ | 値は維持し「オフラインのため更新できません(HH:mm時点)」の強い警告 | 新規取得不可、既存のネットワークエラー表示 |
| READYだがBackend更新日時が古い(`checked_at`が古い) | 「確定済みですが確認が古い可能性があります」等の中間的注意 | 同様の注記を検討(§5) |
| revisionが変わった(複数回含む、§4) | 該当行に「改定あり」マーク、複数回改定は`revision_version`等で検知できた場合のみ区別表示 | 分析結果が改定前のデータに基づく場合は再実行を促す注記を検討 |
| 取得失敗が継続 | 既存`refreshFailed`を維持、継続時間に応じ警告を段階的に強める | 都度のエラー表示のみ(キャッシュ非依存のため「継続」という概念がない) |

---

## 7. テスト観点

- 期限境界: ①〜④各TTLの直前/直後
- Backend側の更新なし: 再取得成功で`savedAt`は進むが`updated_at`/`checked_at`が不変 →
  「鮮度回復」と誤表示しないこと
- `checked_at`のみ更新・`updated_at`は不変: 「確認済み・変化なし」として正しく区別されること
- 公式訂正: `revision_status` NONE→REVISEDの検知・表示、および複数回改定(§4の候補採用後)の検知
- 取消: `status`→CANCELLEDでの古い表示の残存がないこと
- 再取得失敗: 鮮度内/鮮度切れそれぞれでの表示分岐
- オフライン: 鮮度内/鮮度切れそれぞれでの表示分岐
- ユーザー切替: 新フィールド追加後も既存の`userID`不一致時`clear()`が壊れないこと

---

## 8. R18 PASS条件(第3版・補強)

1. `savedAt`・`updated_at`・`checked_at`・改定識別情報(§4)が概念上明確に分離管理されている
2. `updated_at`が古いことだけでデータを無効と判断しない設計になっている(§1)
3. 実際の取得元確認の鮮度は`checked_at`で判断する設計になっている(§1)
4. イベント単位のTTLが「適用候補の最小値」方式で決定される(§2)
5. **Backendが取得元を確認した時刻(`checked_at`)を提供できること**(API拡張が前提)
6. **取得元確認が停止・遅延した場合の検知と表示責任がBackend側にあること**(iOS側は
   `checked_at`を受け取って表示するのみで、確認プロセスの健全性そのものを検証する手段を持たない)
7. **iOSがBackendの確認時刻(`checked_at`)を使って古い情報を判別できること**(`savedAt`単独では
   判別しない設計になっている)
8. **改定を複数回識別できる情報の必要性が整理されていること**(`revision_status`の二値では
   不十分であることが明記され、`revision_version`等の候補が整理されている、§4)
9. StrategyAnalysis等の分析機能について、「Homeキャッシュに依存しない」ことと「Backendの
   データ鮮度問題から無関係である」ことが区別して記述されている(§5)

---

## 9. 未解決事項・HQ決定事項

- TTLの具体的な数値(①〜④)
- `checked_at`/`updated_at`/`revision_version`をBackend APIのどのエンドポイント
  (`/home`・`/calendar`・分析API)にどこまで追加するか
- `revision_version`の実装方式(連番カウンタ/最新`revision_id`/`revision.created_at`のいずれか、§4)
- Backend側の取得元確認プロセスの健全性監視(`checked_at`が更新され続けているかの監視)を
  どの仕組みで行うか(既存の`HomeSpeechesStatus.stale`と同様の仕組みを指標側にも設けるか)
- StrategyAnalysisへの`checked_at`相当フィールド追加の要否・範囲(§5)
- フォアグラウンド復帰時の自動再検証トリガーの新規実装の要否(前版から継続の未決事項)
- 手動更新UIが現状存在しない点について、新設するか既存のリトライボタンで代替するか(前版から継続)

---

以上、第3版(最終整理)。
