# Home画面起動高速化: Splash先行通信の設計提案

**作成**: A(調査・設計提案のみ。コード変更は行っていない)
**対象ブランチ**: `claude/fx-settings-screens`(読み取り専用で調査。本ファイルはpushしない別ブランチに置く)
**調査日**: 2026-11-05
**ステータス**: 設計提案。実装はまだ行っていない。HQ承認後に着手。

---

## 0. 要約

現在、Splashの最小表示時間(1.6秒)の間、バックエンド通信は一切行われていない。`/home`・`/entitlements`等の通信は、Splashが完全に終わってMainTabView(Home画面)がView階層に生成された**後**に初めて始まる。この「Splashの待ち時間」と「Home自身の通信待ち時間」が完全に直列になっていることが、起動の遅さの本質的な原因である。

また、Home Cache(2026-11-02実装)が実機で期待どおり表示されない最有力の原因は、キャッシュの表示条件が「`PlanStore`が`/entitlements`でプランを確認済み」であることを要求しており、このプラン確認自体がSplash完了後にしか始まらない非同期処理だから、というのが調査の結論である。つまりキャッシュは「バックエンドが遅いときほど出ない」設計になっている。

提案: Splashの認証復元が終わった直後(ユーザーIDが分かった瞬間)に`/home`と`/entitlements`の先行通信を開始し、その結果をHome画面側が後から受け取って使う(二重リクエストにしない)。Splashの表示時間は固定2秒ではなく「最低約1.6〜2秒・先行通信が終われば早く進む・最大4秒で打ち切る」可変にする。

---

## 1. 現状の起動処理とボトルネック

### 1.1 現在のシーケンス(ファイル・処理ともに確認済み)

```
① FXEventAnalyzerApp起動
② SplashView表示、SplashViewModel.start()
   - step1: 何もしない(プロセス起動確認のみ)
   - step2+5: authService.currentSession() を呼ぶ
     (supabase-swiftのAuthClient.session — トークンが有効なら
      ローカルKeychainから即時復元、期限切れなら内部でネットワーク
      リフレッシュが走る。いずれにせよ userID はここで初めて分かる)
   - step3+4: 「バックエンドAPI接続確認」— Phase 1から現在まで
     意図的に no-op(SplashViewModel.swiftのファイル冒頭コメントに
     明記。将来の接続確認を入れる場所として最初から空けてある)
   - minimumDisplayDuration(1.6秒)に達するまで待つ
     (SplashLoadingBarの1.6秒アニメーションを最後まで見せるため)
   - onFinished(outcome) → AppState.splashFinished()
③ AppState.phase = .loggedIn → RootViewがMainTabViewに切り替え
④ MainTabView.tabContent が初めて構築される
   - HomeView(常駐。ZStack+opacityでタブ切り替えしても再生成しない
     — 2026-10-21/23のHQ指示で確定済みの設計)
   - HomeView.task { viewModel.load() } がここで初めて走る
     → HomeViewModel.fetch() → GET /home
   - 同時にRootView.task(id: scenePhase) が scenePhase==.active を
     検知して AppPreferences.load() と PlanStore.load()(=GET /entitlements)
     を並行実行開始
⑤ /home のレスポンスが返り、HomeViewModel.state = .loaded
⑥ HomeViewの実コンテンツが.onAppear(起動診断の「ホーム表示」)
```

### 1.2 ボトルネックの所在

- **②と④〜⑤が完全に直列**: Splashの1.6秒間、`/home`・`/entitlements`どちらの通信も始まっていない。認証復元(②)が終わった時点でuserIDは確定しているにもかかわらず、通信開始は③④を待つ。
- **④で3つの通信が同時に走り出す**: `/home`・`/entitlements`・(settings相当の)AppPreferences.load()。個々は並行化済み(2026-10-23 HQ指示で`/preferences`と`/entitlements`を並行化)だが、「Splashが終わってから」という制約は変わっていない。
- **Renderの無料プランのコールドスタート**(`HomeCacheStore.swift`のコメントに明記、実測約20秒)が起きると、④で始まる3つの通信すべてがこの約20秒の影響を受ける。Splashの間に先行して通信を始めていれば、この約20秒のうち1.6〜4秒分はSplash表示中に「無料で」消化できる。

### 1.3 既存の診断機能(そのまま使える)

`Common/DiagnosticsStore.swift`・`Common/LaunchDiagnostics.swift`・`Features/Diagnostics/LaunchDiagnosticsView.swift`に、HQ指示(2026-10-20「起動診断画面」・2026-10-21「通信遅延の詳細計測」)で実装済みの計測機能がある。

- 設定タブ→「起動診断」で、今回/前回の起動の以下を表示:
  - `authService.currentSession()`の所要時間
  - Splashの残り待機時間
  - Splash→メイン画面遷移
  - メイン画面表示→`/home`認証開始
  - `/home`の認証トークン取得・HTTP往復・JSONデコード・state反映・画面表示までの内訳
  - `home`・`calendar`・`speeches`の3エンドポイントについて、DNS/TCP/TLS/送信/応答待ち/受信のURLSessionTaskMetrics内訳
  - 前回の情報(キャッシュ)を表示した時刻(`homeCacheShownMs`)
- 画面下部に「診断結果をコピー」「診断結果を書き出す」ボタンがあり、**Macもコンソールも不要**で実機だけで計測値をテキスト取得できる(`ShareLink`でメール等に添付可能)。**この機能だけでWindows環境からも診断結果を受け取れる** — 今回の制約「Windows環境でも検証できる方法を優先する」は、新しい計測コードを書くのではなく、この既存機能をそのまま使うことで満たせる。
- ただし現状、`trackedAPIPaths = ["home", "calendar", "speeches"]`であり、`entitlements`(`/entitlements`、PlanStoreが呼ぶ)の通信内訳は記録されていない。Home Cacheの表示を事実上ブロックしているのがこの`/entitlements`であることを踏まえると、この欠落自体が原因調査を難しくしている一因。

---

## 2. Home Cacheが表示されない原因の候補(優先度順)

`Common/HomeCacheStore.swift`・`Features/Home/HomeViewModel.swift`のコードを読んだ結論。

### 候補1(最有力): プラン確認待ちがキャッシュ表示をブロックする

`HomeCacheStore.load(for:)`は`context.confirmedPlan`が`nil`なら**無条件に`nil`を返す**(キャッシュを出さない)。

```swift
guard let confirmedPlan = context.confirmedPlan else { return nil }
```

`confirmedPlan`は`PlanStore.isConfirmed`が`true`になって初めて埋まる値で、`isConfirmed`は`GET /entitlements`(`PlanStore.load(apiClient:)`)が成功して初めて`true`になる。この呼び出しは**Splash完了後、RootViewの`scenePhase`タスクの中で初めて始まる**(1.1節④)。

つまり:
- `HomeViewModel.load()`が呼ばれる時点(=MainTabView構築直後)では、`PlanStore.load()`はまだ始まったばかりか、始まってもいない。
- この時点で`cacheStore.load(for:)`は(confirmedPlanがnilなので)必ず`nil`を返し、キャッシュは出ない。画面は`.loading`になる。
- `/entitlements`が成功して`PlanStore.$isConfirmed`が変化すると、`HomeViewModel.planConfirmed()`が呼ばれ、**その時点で初めて**キャッシュを出すかどうかを再判定する(`state`がまだ`.loading`/`.error`のときだけ)。
- もし`/home`の方が`/entitlements`より先に終わっていれば、`state`はもう`.loaded`になっているので、`planConfirmed()`はキャッシュを出さない(`case .loaded, .backendNotConfigured: break`)— これは正しい挙動(最新データがあるのにキャッシュに戻す必要はない)。
- **問題は「`/entitlements`も`/home`も両方遅い」とき**: Renderのコールドスタート中は両方とも同程度に遅くなりやすく、キャッシュが一番役に立つはずの場面で、キャッシュの表示が`/entitlements`の完了を待ってから始まる。ユーザーの目には「ローディングのままなかなか何も出ない」→数秒後にキャッシュか最新データのどちらかが出る、という体験になり、「キャッシュが効いていない」と感じられる可能性が高い。

この挙動自体は意図的な安全策(HQ承認2026-11-02「プラン安全性修正」— プラン違いのキャッシュを絶対に見せないため)であり、**削除してはならない**。提案は後述のとおり「`/entitlements`の確認そのものを早める」。

### 候補2: プラン不一致によるキャッシュの即時破棄

`discardIfPlanDiffers`は、保存時のplanと確認後のplanが異なれば`clear()`する。プラン購入・解約の直後に再起動すると、保存されたキャッシュのplanと新plan不一致で**キャッシュそのものが消える**。次回起動以降、新しいキャッシュが保存されるまで(1回`/home`が成功するまで)は「キャッシュがない」状態になる。これは意図どおりの安全策だが、サポート対応時に「プラン変更後しばらくキャッシュが出ない」という報告として現れる可能性がある。

### 候補3: 日付・タイムゾーン不一致によるクリア

`load(for:)`は`snapshot.date != context.date`または`timezone`不一致でも`clear()`する。日付境界をまたいだ起動(深夜・早朝、または旅行でタイムゾーンが変わった場合)では毎回キャッシュがクリアされる。意図どおりだが、再現条件として記録しておく。

### 候補4: ログイン画面遷移時の無条件クリア

`RootView.swift`の`.loggedOut`ケースの`onAppear`で`HomeCacheStore.shared.clear()`を呼ぶ。セッション切れ・ログアウト経路以外でこの分岐を一瞬でも通過する実装上の競合があれば(現状のコードレビューでは確認できなかったが)、キャッシュが消える。実機ログ(起動診断の`homeCacheShownMs`が`nil`のまま)で確認できる。

### 候補5: キャッシュ読み込み自体の遅延(否定的結論)

`HomeViewModel.load()`は`cacheStore.load(for:)`を**同期的に**呼んでいる(非同期処理やI/O待ちはない、UserDefaultsの読み込みのみ)。キャッシュの読み込み自体が画面表示より遅れている、という仮説は**コード上は支持されない**。見かけ上の遅れは、候補1の「確認待ち」によるものと考えられる。

### 実機で原因を特定するための具体的な確認手順

1. 設定タブ→「起動診断」を開き、「診断結果を書き出す」でテキストファイルを取得(Mac不要、AirDrop/メール/Slack等でPCに転送可能)。
2. テキスト内の以下を確認:
   - `前回の情報(キャッシュ)の表示`行が「なし」になっていないか(`homeCacheShownMs`が記録されていない=キャッシュが出なかった)
   - `/home HTTPステータスコード`・`/home`の`通信全体`の時間(Renderコールドスタートの影響を受けたか)
   - `Supabaseセッション取得`の時間(認証復元自体が遅いケースの切り分け)
3. 同じ端末で「アプリを再起動直後」と「15分以上放置後に再起動」の2パターンで診断結果を比較する(`前回の起動との間隔`の項目がこの比較を支援する目的で既にある)。
4. (提案1-E、後述)`entitlements`を`trackedAPIPaths`に追加した版であれば、`/entitlements`単体の往復時間も同じ書き出しテキストで確認できるようになる。

---

## 3. 推奨アーキテクチャ

### 3.1 設計方針

1. **Splashの認証復元が終わった直後**(`currentSession()`が`.authenticated`を返した瞬間、userIDが確定した瞬間)に、`/home`と`/entitlements`の取得を**fire-and-forgetで開始する**。Splashの残りの待機処理(`waitForMinimumDisplayDuration`)とは並行に走らせる(どちらかを待ってから他方を始めない)。
2. 開始した通信の`Task`(Swift Concurrencyの`Task`)を、ユーザーID単位で一時的に保持する小さな調整役(以下「先行取得コーディネーター」)に渡す。
3. Home画面側(`HomeViewModel.fetch()`)は、呼ばれた時点で該当ユーザーの先行取得`Task`が存在し未消費なら、**新しいリクエストを送らずそのTaskの結果を待つだけ**にする(二重リクエスト防止の核心)。消費後はフラグを立てて二度と再利用しない(タブの出入り等での2回目以降の取得は今までどおり新規リクエスト)。
4. `PlanStore.load(apiClient:)`も同じ先行取得のタイミングで呼ぶ。既存の`RootView`の`scenePhase`タスクからの呼び出しは残してよい(`PlanStore.load()`は何度呼んでも安全な設計— 失敗時は前回値維持、成功時は上書きするだけ)。
5. FREE/PROの判定(`PlanStore.isConfirmed`)と`/home`取得の間に**処理上の依存関係はない**(`/home`はBackend側でプランに応じたロック情報を返す。クライアントが`confirmedPlan`を先に確定させる必要はない)。依存があるのは「キャッシュを表示してよいか」の判定だけで、これは引き続き`confirmedPlan`を待つ(安全策は変えない)。

### 3.2 構成図(テキスト)

```
Splash表示開始
  │
  ├─ authService.currentSession() ─→ userID確定
  │      │
  │      ├─(fire-and-forget)HomePrefetchCoordinator.start(userID, apiClient)
  │      │      ├─ Task A: GET /home       ─┐
  │      │      └─ Task B: GET /entitlements┤ 結果を保持、未消費のまま
  │      │                                   │ MainTabView構築まで待機
  │      └─ Splashの残り待機(1.6秒下限・4秒上限・
  │          先行取得が終われば早期終了可)
  │
  └─ onFinished(outcome) → MainTabView構築
         │
         ├─ HomeViewModel.fetch()
         │    └─ Task Aが未消費なら、それをawaitして使う(新規送信しない)
         │
         └─ RootView.task(scenePhase)
              └─ PlanStore.load() → Task Bが未消費なら、それをawaitして使う
```

### 3.3 二重リクエストにならない理由

- `/home`・`/entitlements`とも、先行取得コーディネーターが「ユーザーIDごとに1つのTaskだけを保持し、最初に取りに来た呼び出し元がそれを消費する」という単純な排他制御を行う。
- 消費済みフラグはメモリ上の状態(`@MainActor`な単純な辞書やactor)で十分。永続化は不要(プロセスごと・起動ごとにリセットされればよい)。
- タブ往復など、起動後2回目以降の`/home`・`/entitlements`呼び出しは、先行取得Taskが既に消費済みのため、常に新規リクエストになる(既存の挙動を変えない)。

---

## 4. Splash表示時間の推奨値と理由

比較対象3案について:

| 案 | 評価 |
|---|---|
| 現状の約2秒固定 | 今回の先行通信を生かせない(通信が終わる前に進んでしまう可能性が高い) |
| 最低2秒・最大4秒固定 | 先行通信が遅延しても最大4秒で必ず先に進める安全弁はあるが、「通信が1秒で終わっても常に2秒待つ」「4秒でも終わらない通信を切り捨てる」のどちらも非効率 |
| **通信完了に応じた可変時間(推奨)** | 「最低1.6秒(ロゴ・Loadingバーの演出を保つ)」「先行取得(`/home`・`/entitlements`のどちらか早い方で十分 — 両方を待つ必要はない。後述)が完了したら即座に進む」「どれだけ遅くても最大4秒で進む」 |

**推奨: 下限1.6秒(既存のSplashLoadingBarのアニメーション時間と一致、変更不要)・上限4秒・先行取得の完了で早期終了可能な可変時間。**

理由:
- タスクの指示「単にSplashで待たせるのではなく、Home表示時点で必要なデータが揃うことを重視する」に最も忠実。
- 下限を既存の1.6秒から変えないため、`SplashLoadingBar`(1.6秒の一発アニメーション)の見た目を崩さない(デザイン変更禁止の制約を満たす)。
- 上限4秒は「ユーザーが明らかに待たされ過ぎと感じる手前」の目安(一般的なアプリ起動のUX目安として2〜3秒を超えると離脱率が上がるという経験則があるが、現状すでに約2秒かけており、かつ「Splash中に先行通信を仕込む」という目的のためなので、+2秒程度の上積みは許容範囲とHQの背景説明にも合致する)。4秒を超えてもなお`/home`・`/entitlements`が終わらない場合は、Splashを切り上げてHome画面側の通常の`.loading`/キャッシュ処理に委ねる(先行取得Taskは消えずにバックグラウンドで走り続け、後から`HomeViewModel`が受け取る)。
- **「`/home`と`/entitlements`どちらか早い方だけを待つ」でよい**: Home画面の初期表示に絶対に必要なのは`/home`の結果(表示するイベント一覧そのもの)。`/entitlements`はキャッシュ表示の許可判定にしか使わないため、両方を待ってからSplashを終える必要はない。`/home`が先に終われば十分にSplashを切り上げてよい(`/entitlements`はバックグラウンドで続行し、後からキャッシュ判定に使われる)。この結果、実質的な上限超過は`/home`自体がよほど遅い場合に限られる。

---

## 5. 必要なコード変更箇所(実装時の参考。今回は変更していない)

| ファイル | 変更の概要 |
|---|---|
| **新規** `Common/HomePrefetchCoordinator.swift` | `@MainActor final class`。`start(userID:apiClient:)`で`/home`・`/entitlements`それぞれのTaskを開始・保持。`consumeHome(for:)`/`consumeEntitlements(for:)`で未消費なら返し、消費済みにする。ユーザーIDが変わったら(ログイン切り替わり)古いTaskは捨てる。 |
| `Features/Splash/SplashViewModel.swift` | `init`に`apiClient: APIClient`を追加。`currentSession()`が`.authenticated`を返した直後に`HomePrefetchCoordinator.shared.start(userID:apiClient:)`を呼ぶ(fire-and-forget、`await`しない)。`waitForMinimumDisplayDuration`を、固定時間待機から「下限1.6秒・上限4秒・先行Taskの完了で早期終了」ロジックに変更。 |
| `Navigation/RootView.swift` | `SplashViewModel`の生成箇所に`apiClient: apiClient`を渡す(`RootView`は既に`apiClient`を保持している)。 |
| `Features/Home/HomeViewModel.swift` | `fetch()`の先頭で`HomePrefetchCoordinator.shared.consumeHome(for: userID)`を確認。あればその結果を使い、`apiClient.send(endpoint)`を呼ばない。既存の診断フック(`DiagnosticsStore.shared.beginHomeRequest()`等)の呼び出し位置・計測対象区間は変えない(先行取得のTask自体の内部で同じ診断フックを呼ぶようにする)。 |
| `Common/PlanStore.swift` | 変更不要。`load(apiClient:)`をそのまま先行取得コーディネーターからも呼べる(複数回呼んでも安全な既存設計)。 |
| `Common/DiagnosticsStore.swift` / `LaunchDiagnostics.swift` | `trackedAPIPaths`に`"entitlements"`を追加。Splash先行通信の開始時刻を記録する新しい区間(例: `prefetchStartedMs`)を追加し、`spans`に「Splash先行通信開始→Splash完了」の区間を足す。 |
| `Features/Diagnostics/LaunchDiagnosticsView.swift` | 新しい区間・`entitlements`の通信内訳が自動的に既存の`spansCard`/`networkCard`のループに乗るため、原則コード変更不要(データが増えるだけ)。 |
| `Features/Splash/SplashView.swift` | **変更不要**(デザイン・ロゴ・色を維持する制約どおり)。`bottomContent`のswitchはそのまま、`.initializing`中はLoadingバー表示を維持。 |

---

## 6. 実装手順とテスト項目

### 6.1 実装手順(提案)

1. `HomePrefetchCoordinator`を新規作成し、単体テストを先に書く(ユーザーIDごとの保持・消費・未消費時の挙動・ユーザー切り替え時のリセット)。
2. `PlanStore.load()`・`HomeViewModel.fetch()`に影響しない形で、まず「先行取得は始めるが、Home側では使わず捨てる(常に新規リクエスト)」という最小の変更で先行取得だけを有効化し、二重リクエストが発生していないことを計測で確認する(切り分けのため、消費ロジックは次のステップで入れる)。
3. `HomeViewModel.fetch()`に消費ロジックを追加し、起動診断の`homeRequestCount`が依然として`1`のままであること(先行取得+Home側の利用の合計で2回になっていないこと)を確認する。
4. Splashの待機ロジックを可変時間に変更する。
5. `DiagnosticsStore`/`LaunchDiagnostics`に新しい計測区間を追加する。

### 6.2 テスト項目

- **単体テスト(XCTest、既存の`FXEventAnalyzerTests`構成に合わせる)**
  - `HomePrefetchCoordinator`: 同一ユーザーIDで2回`consumeHome`を呼ぶと2回目は`nil`(新規取得が必要)を返すこと。
  - `HomePrefetchCoordinator`: `start`前に`consumeHome`を呼ぶと`nil`を返すこと(先行取得がまだ無い場合は通常の取得にフォールバックする設計の確認)。
  - `HomePrefetchCoordinator`: 異なるユーザーIDでは互いのTaskを消費できないこと(ログイン切り替え時に前のユーザーの`/home`結果を新しいユーザーに渡さない)。
  - `SplashViewModel`: 先行取得が1.6秒より早く終わった場合もSplashは1.6秒未満では終わらないこと(既存の`minimumDisplayDuration`の下限保証テストを維持)。
  - `SplashViewModel`: 先行取得が4秒以内に終わらない場合、4秒でSplashが終わること。
  - `HomeViewModel`: 先行取得済みのTaskがある場合、`apiClient.send`が呼ばれないこと(モックAPIClientの呼び出し回数で確認)。
- **UIスクリーンショットCIへの影響確認**
  - `UI_SCREENSHOT_HOLD_SPLASH`環境変数下での既存の20秒ホールド処理と、新しい先行取得ロジックが competing しないこと(先行取得はこのフラグの有無に関わらず動くため、モックサーバー相手に正常終了することを確認)。
  - 既存の47枚のiPhoneスクリーンショットに見た目の差分が出ないこと(Splashのデザインは変更していないため、原則影響なしのはずだが、表示時間が変わることでCIのタイミング前提が崩れないかは確認が必要)。
- **実機確認(Windows環境から診断可能な形)**
  - 設定→起動診断の「診断結果を書き出す」で、Before/After両方のテキストを取得し、以下を比較:
    - `Splash最小表示時間待機など`の区間の長さ(先行取得がある分、認証復元後の待機が実際の通信進捗に応じて変動していること)
    - `メイン画面表示→/home認証開始`の区間(Afterでは「先行取得済みのため大幅に短縮、または0に近づく」はず)
    - `/home取得回数(今回の起動内)`が依然として`1`であること(二重リクエストの最終確認)
    - `前回の情報(キャッシュ)の表示`が、Renderコールドスタート直後の起動でも記録されるようになったか(候補1の改善確認)

---

## 7. 起動時間の改善目標と計測方法

### 7.1 目標の定義

固定の秒数目標ではなく、以下を達成条件とする(タスクの指示「Home表示時点で必要なデータが揃うことを重視する」に合わせる):

> **Splash完了時点で`/home`の先行取得が完了していれば、Home画面表示までの追加の通信待ち時間はゼロに近づく。**
> Splash完了時点でまだ完了していなければ、少なくとも「Splashの待機時間ぶん」は通信が先に進んでいるため、従来どおり完了を待つ時間が、先行取得で既に経過した分だけ短縮される。

バックエンドの応答時間(特にRenderコールドスタート時の約20秒)に依存するため、「常にX秒短縮」という固定値の目標は置かない。改善の効果が最も大きく出るのはコールドスタート直後の起動で、通常時(バックエンドが温まっている)の改善効果は小さい(数百ms程度)。

### 7.2 計測方法(追加の計測コード不要)

既存の起動診断(`LaunchDiagnostics.reportText()`)の以下の値を、実装前(Before)・実装後(After)で同一条件下(同じWi-Fi、同じRender休止状態)で比較する:

- `起動シーケンス全体の時間`(`totalUntilHomeReadyMs`、= `homeReadyToDisplayMs`)— 最終的な改善の総量。
- `メイン画面表示→/home認証開始`の区間 — Beforeでは「ゼロ秒に近い」(Splash完了直後にすぐ認証開始)、Afterでは「先行取得のおかげで`/home`の結果がもう届いている場合は、この区間自体が意味を持たなくなる(診断側の表現の調整が別途必要になる点は3.2のコード変更箇所で言及)」。
- `/home HTTP通信往復`の絶対値は変わらない(通信そのものの速さは変えない提案のため)。ただし、この往復が「Splashの待機時間と重なって見える」ようになる。
- `前回の起動との間隔`と組み合わせて、「すぐ再起動 vs 15分以上空けて再起動(コールドスタートあり)」の2パターンそれぞれでBefore/Afterを取ることで、コールドスタート時にこそ効果が大きいことを確認する。

---

## 8. リスク・注意点

1. **二重リクエストの実装ミス**: コーディネーターの消費フラグ管理を誤ると、「先行取得」と「Home側の取得」が両方走り、むしろ通信量が増える。単体テストで`consumeHome`の一度性を必ず確認すること(6.2節)。
2. **Splash上限4秒の暴走防止**: 「先行取得が完了したら即座に進む」ロジックを誤ると、常に4秒待つバグになりかねない。Taskの完了検知(`await`と`Task.sleep`の競合、例: `TaskGroup`や`select`相当の実装)の単体テストを必須とする。
3. **プラン安全性の既存ガードは変更しない**: 「キャッシュを出してよいか」の判定が`confirmedPlan`を要求する仕組み(HQ承認2026-11-02の安全策)はそのまま残す。先行取得で`/entitlements`を早めるのは「確認が終わるタイミングを早める」ことが目的で、「確認を待たずにキャッシュを出す」ようにしてはならない(プラン違いのキャッシュ露出という、2026-11-02に修正された問題の再発を防ぐ)。
4. **オフライン・バックエンド未設定時の既存エラー経路への影響**: `SplashState.apiConnectionError`は現在未使用のplaceholderだが、今回の先行取得導入時にこの状態を実際に使うようにする場合、既存のテスト(`.initializationError`との区別含む)・UIスクリーンショットCIへの影響を個別に確認する必要がある。本提案ではSplashの表示状態そのものは変更しない想定(先行取得の失敗はSplashをエラー状態にせず、Home画面側の既存のエラー処理・リトライ導線にそのまま委ねる)としており、Splashの見た目を複雑にしない。
5. **UIスクリーンショットCIのモックサーバー**: `UI_SCREENSHOT_HOLD_SPLASH`環境下で先行取得がモックサーバーに正しくアクセスできることを確認する(本物のバックエンドに向けて無条件に通信を試みるコードが万一入ると、CI環境でのハング・タイムアウトを再発させるリスクがある — `RootView.swift`の既存コメントにある「StoreKitの`Product.products(for:)`がこのテスト実行中に数分間ハングした」実障害と同じ種類のリスク)。
6. **既存のHome Cache実装自体は変更しない**(制約どおり): 本提案は「いつ`/home`・`/entitlements`を取りに行くか」「その結果をどう受け渡すか」という配線の変更のみで、`HomeCacheStore`の保存形式・判定ロジック・UserDefaultsキー等は一切変更しない。

---

## 9. まとめ

- 現状、Splashの表示時間(約1.6〜2秒)はバックエンド通信に全く使われていない。
- Home Cacheが実機で表示されない最有力の原因は、「プラン確認(`/entitlements`)が終わるまでキャッシュを出さない」安全策が、Splash完了後にしか始まらない`/entitlements`取得と組み合わさって、まさに通信が遅いとき(キャッシュが一番必要なとき)にキャッシュを隠してしまう構造にあること。
- 解決の軸は「Splash中に`/home`・`/entitlements`の先行取得を始める」「Home側はその結果を再利用し、二重リクエストにしない」「Splashの表示時間は固定ではなく、先行取得の進捗に応じた可変(下限1.6秒・上限4秒)にする」の3点。
- 既存のHome Cacheの保存・判定ロジック、Splashの見た目、既存の起動診断機能はいずれも変更不要で、配線(いつ・何を・どう渡すか)の変更のみで実現できる設計。

以上、報告後は待機します。
