# BOC_RATE(カナダ銀行政策金利)イベント詳細UI設計書

HQ指示(2026-11-13「政策金利UI確認」→「政策金利UI設計」→「設計書の3点修正」)への対応。
**この文書は設計書。Swiftコード・API・DB・migration・テスト・DEV反映は、していない
(HQが設計書を確認した後に別途判断)。**

対象はBoC(Bank of Canada)先行導入。BoE(Bank of England)は後段。

前提となる調査結果(「政策金利UI確認」、2026-11-13実施)はこの文書の各節に統合済み。
`BOC_RATE`/`BOE_RATE`という指標コードは、本リポジトリのどのブランチにも現時点で存在しない
(Backend・iOSとも未着手)。以下はすべて「追加するなら」という前提の設計。

---

## 0. 前提・方針(変更なし)

- 対象画面は`EventDetailCards.swift`(イベント詳細、SCR-007)の「結果/予想/前回」カード
  (`unlockedResults`/`resultsRow`/`resultColumn`)。既存のカード構造・配色・フォントサイズは
  そのまま維持し、新しい箱やセクションは追加しない。
- BOC_RATEは**通常の指標**(forecast/actual/previous + `value_decimals=2`)として実装する
  パターンAを前提にするため、FOMC専用の`PolicyRate`/`policyRateResults`には一切手を入れない。
- 状態判定は`status`(SCHEDULED/RELEASED/CANCELLED)と`data_status`
  (READY/DATA_PENDING/DATA_UNAVAILABLE)の組み合わせで行う。
- 画面構造の変更・新しいセクション追加はしない。既存のイベント詳細画面の情報密度を維持する
  (HQ指示 2026-11-13、2回目)。

---

## 1. 発表済み・公式値確認中の表示(変更なし)

### 1.1 状態の組み合わせ表

| `status` | `data_status` | `actual` | 表示状態 | 表示文言(「結果」列) |
|---|---|---|---|---|
| SCHEDULED | (問わない) | — | 発表前 | **発表待ち** |
| RELEASED | DATA_PENDING | null | 発表済み・確認中 | **発表済み／公式値を確認中** |
| RELEASED | READY | 値あり | 確認完了 | **2.50%**(実値をそのまま表示) |
| RELEASED | DATA_UNAVAILABLE | null | 確認不能 | **公式値を確認できません** |
| RELEASED | READY | null(異常系、本来起きない組み合わせ) | 確認不能として扱う(フォールバック) | 公式値を確認できません |
| RELEASED | 欠落・未知の値(§5参照) | — | 確認不能として扱う(フォールバック) | 公式値を確認できません |
| CANCELLED | — | — | (既存のまま、今回スコープ外) | 既存の中止表示を維持 |

`NOT_ANALYZABLE`は相場反応(タイムフレーム単位)専用の値のため、政策金利そのものの確認状態
としては使わない方針。万一返ってきた場合はDATA_UNAVAILABLEと同じ「確認不能」扱いに
フォールバックする(§5の安全なデコード設計と合わせ、この表の最終行に統一)。

### 1.2 画面仕様

- 表示箇所は既存の`resultColumn("結果", ...)`の`placeholder`引数のみを拡張する。
- 文字サイズ・色は既存の`resultColumn`のまま(タイトル8.5pt・値15pt・注記7pt)。
  「発表済み／公式値を確認中」は文字数が多く、縮小されすぎる懸念があるため、実装時に
  フォントサイズ個別調整・2行許容・文言短縮のいずれかの要否を実機で確認する(§4.7参照、
  デザイン懸念は変更なし)。
- 「予想」「前回」列は既存どおり。今回の4状態分岐は「結果」列のみに適用する。

### 1.3 Backendのstatus/data_statusの組み合わせ方(設計メモ、変更なし)

- `status`は「発表予定時刻を迎えたか」のみを表す値として扱う。
- **案A(推奨)**: 発表予定時刻を迎えた時点で`status`を`RELEASED`に切り替え、公式値が未確認の
  間は`data_status = DATA_PENDING`を返す。確認が取れ次第`data_status = READY`+`actual`を設定。
- **案B(非推奨)**: 確認が取れるまで`status`を`SCHEDULED`のまま維持する。「発表待ち」の誤表示
  リスクがあるため非推奨。
- → 本設計は**案Aを前提**とする。採否はBackend側の判断としてHQに確認が必要(変更なし)。

---

## 2. 訂正済みの値の表示(1点修正: revision_kindへの統一)

### 2.1 バッジ(変更なし)

- 既存`V5Badge`(色付きカプセル)を「結果」列のタイトル(`"結果"`という8.5ptラベル)の右に
  小さく添える。文言「訂正あり」、色は`V5P.yellow`。
- バッジ自体はタップ可能な導線としてのみ機能し、訂正の詳細はバッジより下に常時表示しない。

### 2.2 現在有効な政策金利(変更なし)

- Backend v3設計(元snapshotを保持し、承認済み訂正値を有効値として返す)を前提にすると、
  iOS側は既存の`resultColumn`がそのまま`actual`を表示するだけで要件を満たす。変更不要。

### 2.3 訂正前の値・訂正理由・訂正日時・根拠の表示方法(変更なし)

- バッジをタップして詳細シート(新規、軽量な`.sheet`)を開く案を採用。
- 詳細シートには以下を表示:
  - 訂正前の値 → 訂正後の値(`event_revisions`の`old_value`→`new_value`)
  - 訂正日時(`effective_at`)
  - 出典(`source`)
  - **区分(`revision_kind`、§2.4で修正)**

### 2.4 通常の公式改定と登録ミスの訂正の区別 ―― **修正箇所**

HQ指示(2026-11-13、3回目)「Backend v3の名称に合わせ、revision_typeではなくrevision_kindを
使用する」に合わせ、以下のとおり修正する。

- フィールド名: ~~`revision_type`~~ → **`revision_kind`**
- 値:
  - **`OFFICIAL_REVISION`**(公式改定): カナダ銀行側の公式な訂正・改定。
  - **`CORRECTION`**(登録訂正): 本アプリ側の取り込み・登録ミスの訂正。
- 現在の`event_revisions`テーブル(`field_name`/`old_value`/`new_value`/`effective_at`/
  `source`/`created_at`)にはこの区分を持つ列が存在しない。`source`は自由記述の文字列
  (例:「Statistics Canada」)で区分の判定には使えないため、**新規列`revision_kind`の追加が
  必要**(§4.5で「変更不要」から修正)。
- 詳細シート内での区別方法:
  - 見出しテキストで明示(例: 「公式改定」/「登録訂正」)。
  - 色分け: `OFFICIAL_REVISION`は`V5P.cyan`(既存の「出典」リンク等と同系統、中央銀行側の
    公式情報であることを示す)、`CORRECTION`は`V5P.yellow`(アプリ側の訂正であることを示す、
    バッジの警告トーンと統一)。
  - **未知の`revision_kind`値(将来の拡張・古いAPI)への対応**: 詳細シート側も§5と同じ
    「安全側にフォールバックして表示不能にしない」設計を踏襲する。具体的には
    `revision_kind`を`String?`のraw値として保持し、`OFFICIAL_REVISION`/`CORRECTION`の
    どちらとも一致しない値(nilを含む)は「区分不明」という中立的な表示(色は
    `SettingsCardStyle.subtitleColor`)にフォールバックし、訂正前後の値・日時・出典の表示
    自体は妨げない。

---

## 3. 政策金利の表示方式(BOC_RATE、パターンA、変更なし)

- 表示例: **「2.50%」**。既存の`ValueFormat.withUnit(value, unit: "%", decimals: 2)`
  (CA_CPIの`value_decimals`調査と同じ汎用機構)でそのまま実現でき、新しいフォーマット
  ロジックは不要。
- FOMC専用の`PolicyRate`構造体・`policyRateResults`・「フェデラルファンド金利の誘導目標
  レンジ」ラベルは一切流用しない。`EventDetailEvent.policyRate`が`nil`のままであれば、
  既存の`results`の分岐が自動的に`unlockedResults`を選ぶ。この分岐自体の変更も不要。

### 3.1 訂正後のprevious値の扱い ―― **本節を新設(修正箇所3点目)**

HQ指示(2026-11-13、3回目)「訂正後のprevious値」に対応。

- 「前回」列(`resultColumn("前回", value: previous, ...)`)は、**Backendが返す`previous`を
  そのまま表示するだけ**とする。iOS側では一切再計算しない(既存の`unlockedResults`の
  `previous: snapshot?.previous`をそのまま使う、変更なし)。
- ある回の`actual`が訂正された場合、その次回イベントの`previous`にこの訂正後の値を
  反映させるかどうか(=訂正の影響範囲をどこまで伝播させるか)は、**Backend側の責任**と
  する。iOSは「APIが`previous`として返した値が、その時点でBackendが正しいと判断した値」
  という前提のみに依拠し、`event_revisions`や訂正バッジの有無を見て`previous`側を
  独自に補正するようなロジックは実装しない。
- この方針により、§2のバッジ・詳細シートは常に**「結果」列(`actual`とその訂正履歴)に
  閉じたUI**となり、「前回」列への波及表示(例:「前回も訂正の影響を受けています」等の
  二次的な注記)は今回のスコープに含めない。

---

## 4. 提出内容

### 4.1 画面ごとの表示仕様(変更なし)

対象画面は**SCR-007 イベント詳細(`EventDetailView`→`EventDetailCards`)のみ**。Home画面・
指標一覧・指標詳細の発表履歴一覧(`IndicatorReleasesView`)には今回の4状態表示を適用しない。

### 4.2 状態ごとの表示文言(変更なし)

| 状態 | 文言 |
|---|---|
| 発表前 | 発表待ち |
| 発表済み・確認中 | 発表済み／公式値を確認中 |
| 確認完了 | (実値をそのまま、例: 2.50%) |
| 確認不能(欠落・未知の値を含む) | 公式値を確認できません |
| 訂正あり(バッジ) | 訂正あり |
| 訂正の区分(詳細シート内) | 公式改定 / 登録訂正 / 区分不明(未知の値へのフォールバック) |

### 4.3 既存画面・既存コンポーネントの再利用範囲(変更なし)

- `EventDetailCards.unlockedResults` / `resultsRow` / `resultColumn`: 構造そのまま、
  `placeholder`の分岐ロジックのみ拡張。
- `V5Badge`: 訂正バッジにそのまま再利用。
- `GradientCardBackground` / `SettingsCardStyle.subtitleColor` 等の既存トークン: 変更なし。
- `GET /events/{id}/revisions`: 既存エンドポイントを初めてiOSから呼び出す形で再利用
  (レスポンスへの`revision_kind`追加は§4.5参照)。
- `ReleaseDatetimePrecision.lenient(from:forKey:)`(`EventCommonModels.swift`): 既存の
  「欠落・未知の値をnilにして応答の読み込みを失敗させない」パターンを、§5で
  `DataQualityStatus`にも同じ考え方で適用する。

### 4.4 新規変更が必要なSwiftファイル・View・Model(実装時の見込み、今回は未着手)

| ファイル | 変更内容 |
|---|---|
| `EventDetailModels.swift` | `EventDetailEvent.dataStatus`を`DataQualityStatus?`(既定nil)に変更し、`DataQualityStatus.lenient(from:forKey:)`相当のヘルパーを使う独自`init(from decoder:)`を追加(§5で詳述、**今回追加**)。`EventDetailEvent`は現状このような独自initを持たないため新規追加になる |
| `EventCommonModels.swift` | `DataQualityStatus`に`ReleaseDatetimePrecision.lenient`と同じ形の`static func lenient<K: CodingKey>(from:forKey:) -> DataQualityStatus?`を追加(**今回追加**) |
| `EventDetailCards.swift` | `resultColumn`呼び出し箇所の`placeholder`分岐を4状態化。訂正バッジ(`V5Badge`)を結果ラベル横に追加。タップで詳細シートを開く導線を追加 |
| 新規: `EventRevisionDetailSheet.swift`(仮) | 訂正の詳細(訂正前/訂正後/日時/出典/区分)を表示する新規View。`revision_kind`の未知の値への「区分不明」フォールバック表示を含む |
| 新規: `EventRevisionsModels.swift`(仮) | `GET /events/{id}/revisions`のレスポンスモデル(`revision_kind`を含む、新規デコード対象) |
| 新規: `EventRevisionsViewModel.swift`(仮) | シート表示時に`/revisions`を呼ぶ軽量ViewModel |

### 4.5 Backend APIに必要なフィールド ―― **修正箇所(revision_kind分)**

| 用途 | 現状 | 必要な対応 |
|---|---|---|
| 発表済み・確認中の判定 | `status`・`data_status`とも既存 | 変更不要(iOS側が初めて`data_status`を読むだけ。ただし安全なデコードへの対応は§5でiOS側に新規実装が要る) |
| 現在有効な政策金利 | `event_snapshot.actual` | Backend v3設計(訂正後の値を`actual`として返す)の実装が前提。Backend側の実装が必要(今回は設計段階) |
| 訂正前の値・理由・日時 | `GET /events/{id}/revisions`は既存(`field_name`/`old_value`/`new_value`/`effective_at`/`source`) | 変更不要(iOSが新規に呼び出すだけ) |
| ~~公式改定 or 登録ミスの区別~~ 公式改定 or 登録ミスの区別 | 既存の`event_revisions`に列なし | ~~Backend側に新規列(例: `revision_type`)が必要~~ **修正: `GET /events/{id}/revisions`のレスポンスに`revision_kind`(`OFFICIAL_REVISION`/`CORRECTION`)を含める必要がある。`event_revisions`テーブルへの新規列追加、またはBackend側の別の判定ロジックからのマッピングのいずれかで実現する想定(どちらを採るかはBackend側の設計判断)。「Backend API変更不要」ではなく、**この部分はBackend側のAPI応答変更が前提**である点を訂正する** |

### 4.6 テストケース(実装時に追加する想定、今回は未作成) ―― **data_status関連のケースを追加**

既存のケース(変更なし):
- `status=SCHEDULED` → 「発表待ち」表示
- `status=RELEASED, data_status=READY, actual=2.50` → 「2.50%」表示(小数2桁、末尾0も出す)
- 訂正ありのイベント → バッジ表示、タップで詳細シートが開き`old_value`/`new_value`/
  `effective_at`/`source`が正しく出ること
- 訂正なしのイベント → バッジが出ないこと
- 無料プランでロックされた過去の発表(`isLocked=true`) → 既存の`lockedResults`のまま、
  今回の4状態分岐が影響しないこと

**今回追加するケース(§5「data_statusの安全なデコード」に対応)**:
- `status=RELEASED, data_status=DATA_PENDING, actual=null` → 「発表済み／公式値を確認中」表示
- `status=RELEASED, data_status=DATA_UNAVAILABLE` → 「公式値を確認できません」表示
- `status=RELEASED, data_status=READY, actual=null`(異常系) → 「確認不能」側にフォールバック
  し、クラッシュしないこと
- **`data_status`キー自体がレスポンスに無い(古いBackend)** → デコードが失敗せず
  `EventDetailResponse`全体が正常に読み込まれ、`dataStatus`が`nil`として扱われること
  (このとき「結果」列は現行どおり`released`の二値判定にフォールバックし、「未発表」/
  実値/`"--"`のいずれかを表示する。4状態表示は`dataStatus`が取得できたときだけ有効にする)
- **`data_status`に未知の文字列値が入っている(将来Backendが追加した新しい値)** →
  デコードが失敗せず、`dataStatus`が`nil`として扱われ、同上のフォールバック表示になること
- **`revision_kind`キーが無い・未知の値(古いBackend・将来の拡張)** → 詳細シートの表示が
  失敗せず、「区分不明」にフォールバックすること
- 既存APIとの後方互換性確認: 古いBackendのレスポンス(`data_status`・`revision_kind`とも
  無い)で、イベント詳細画面全体(ヘッダー・結果カード・値動き表・次回発表予定)が
  今までどおり問題なく表示されること(回帰確認)

### 4.7 デザイン上の懸念(変更なし)

1. 「発表済み／公式値を確認中」の文字数問題(フォントサイズ個別調整・2行許容・文言短縮の
   いずれかの要否を実装時に実機で確認)。
2. 訂正バッジの導線の発見しやすさ(タップ操作に気づかれない可能性、アフォーダンス追加の
   要否)。
3. 「公式改定」と「登録ミス」の見分けをユーザーにどこまで見せるか(文言の最終確定は
   HQ判断)。
4. Backend v3設計(訂正後の値をactualとして返す)との整合性(`event_snapshot`は不変という
   既存原則との整合性確認はBackend側の設計レビューで必要)。

---

## 5. data_statusの安全なデコード(新設、修正箇所2点目)

HQ指示(2026-11-13、3回目)「EventDetailModels.swiftの実際の型とCodable実装を確認する」
「フィールド欠落、未知の値、READYなのにactualがnullの場合でもイベント詳細全体が表示不能に
ならない設計にする」「未知の値は安全側にフォールバックする」「既存APIとの後方互換性を
確認する」への対応。

### 5.1 現状の実際の型とCodable実装(確認結果)

`EventDetailModels.swift`を読み取り確認した結果:

```swift
struct EventDetailEvent: Decodable, Equatable {
    // ...
    let dataStatus: DataQualityStatus   // ← 非オプショナル、既定値なし
    // ...
    enum CodingKeys: String, CodingKey {
        // ...
        case dataStatus = "data_status"
        // ...
    }
}
```

`EventDetailEvent`には独自の`init(from decoder:)`が**無く**、Swiftの合成(synthesized)
`Decodable`実装がそのまま使われている。`DataQualityStatus`自体も次のとおり、
`String`を生の値に持つ素朴な列挙型:

```swift
enum DataQualityStatus: String, Codable, Equatable {
    case ready = "READY"
    case dataPending = "DATA_PENDING"
    case dataUnavailable = "DATA_UNAVAILABLE"
    case notAnalyzable = "NOT_ANALYZABLE"
}
```

**判明したリスク(2点)**:
1. `data_status`キーがレスポンスに無い場合、合成Decodableは`DecodingError.keyNotFound`を
   投げる。`EventDetailEvent`は他の多くの項目(`valueDecimals`・`policyRate`・
   `displayName`・`attribution`等)が「古いBackendでは無い(nil)」という前提で
   `var ... = nil`のオプショナル+既定値にしているのに対し、**`dataStatus`だけがこの
   既存の「後方互換」パターンから外れている**。
2. `data_status`キーはあっても、値が`READY`/`DATA_PENDING`/`DATA_UNAVAILABLE`/
   `NOT_ANALYZABLE`のいずれとも一致しない文字列(例: 将来Backendが追加する新しい状態値)
   の場合、合成Decodableは`DecodingError.dataCorrupted`を投げる。
3. いずれの場合も、この例外は`EventDetailEvent`の合成Decodable経由で
   `EventDetailResponse`全体のデコード失敗に伝播する(`EventDetailResponse`にも独自
   initは無い)。結果として`APIClient.send`が投げたエラーが`EventDetailViewModel`の
   エラー状態になり、**イベント詳細画面全体が「読み込みに失敗しました」的な表示になる**
   (クラッシュはしないが、政策金利の値だけでなく画面全体が見られなくなる)。

この挙動は、同じファイル内の`EventReactionSummary`(`analysisStatus`を
`decodeIfPresent`で読む独自init)や、`EventCommonModels.swift`の
`ReleaseDatetimePrecision.lenient(from:forKey:)`(キー欠落・未知の値のどちらでも
`nil`にする既存の確立されたパターン)と比べて、**`EventDetailEvent.dataStatus`だけが
最も脆弱な実装**になっていることが今回の確認で判明した。

### 5.2 設計(安全なデコードへの変更案)

1. `DataQualityStatus`に、`ReleaseDatetimePrecision.lenient`と全く同じ形の
   ヘルパーを追加する(`EventCommonModels.swift`、新規):

   ```swift
   extension DataQualityStatus {
       /// 任意の項目として読む。無い・null・知らない値はnilにし、応答の読み込みを
       /// 失敗させない(ReleaseDatetimePrecision.lenientと同じ考え方)。
       static func lenient<K: CodingKey>(from container: KeyedDecodingContainer<K>, forKey key: K) -> DataQualityStatus? {
           guard let raw = try? container.decodeIfPresent(String.self, forKey: key) else { return nil }
           return DataQualityStatus(rawValue: raw)
       }
   }
   ```

2. `EventDetailEvent.dataStatus`を`DataQualityStatus?`(既定`nil`)に変更し、
   `EventDetailEvent`に独自`init(from decoder:)`を追加して、この項目だけ上記の
   `lenient`経由で読む(他の項目は既存どおり`container.decode(...)`/
   `decodeIfPresent(...)`のまま)。これにより:
   - キー欠落 → `nil`(デコード失敗にならない)
   - 未知の値 → `nil`(デコード失敗にならない)
   - 既知の値 → 今までどおり正しく`DataQualityStatus`になる
3. 表示側(§1.1の状態表)は、`dataStatus == nil`のケースを**新たな分岐として追加**し、
   既存の二値判定(`released ? "--" : "未発表"`)にフォールバックする。つまり
   `dataStatus`が取得できたときだけ4状態表示を行い、取得できない(古いBackend・未知の値)
   ときは**今までどおりの表示に戻る**(退行させない)。
4. `READYなのにactualがnull`という組み合わせ(§1.1表の5行目)は、デコードの問題ではなく
   表示ロジックの問題として、既存設計どおり「確認不能」側にフォールバックする
   (クラッシュ・空白表示にはならない。§1.1表に明記済み)。

### 5.3 既存APIとの後方互換性(確認結果)

- 古いBackend(`data_status`キー自体を返さないバージョン)に対しては、5.2の変更により
  `dataStatus = nil`となり、**現行の`released`二値判定による表示(未発表/実値/`"--"`)が
  そのまま維持される**。退行は無い。
- 新しいBackendが将来`data_status`に第5の状態値を追加しても、iOS側は`nil`にフォールバック
  するだけでクラッシュや画面全体の表示不能にはならない(ただし新状態に対応した専用文言は
  出ず、「確認不能」側の表示相当になる。新状態に応じた文言を出したい場合は別途iOS側の
  対応が必要)。
- `revision_kind`についても同じ考え方(§2.4)を適用し、未知の値・欠落時は「区分不明」に
  フォールバックする設計とすることで、`/revisions`応答側の将来の拡張にも後方互換を持たせる。

---

## 6. 未確認・未解決(正直な一覧)

- BoCの実際の発表〜公式値確認までの運用が、§1.3の案A(status即RELEASED+data_status管理)・
  案B(status保留)のどちらになるかはBackend側未確定(変更なし)。
- Backend v3設計(訂正後の値をactualとして返す)の実装自体はこの文書のスコープ外
  (Backend側の設計・実装待ち)。
- `revision_kind`を`event_revisions`テーブルへの新規列追加で実現するか、Backend側の
  別ロジックでのマッピングで実現するかは未確定(§4.5)。
- 「発表済み／公式値を確認中」の文言の実機での収まり具合(§4.7の懸念1)は未検証。
- BoEへの展開時、BoC向けにここで決めた文言・分岐がそのまま流用できるか(BoE固有の
  公表タイミング・訂正慣行の違いの有無)は、BoE着手時に別途確認が必要。
