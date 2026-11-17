# Home Prefetch / PlanStore 権限整合性 最終設計資料

**状態**: HQレビュー結果「条件付き保留」に基づく改訂版。§1.3・§3・§4.6は引き続きHQ判断待ち、それ以外の設計方針はHQレビュー済み。
**作業制限**: 本資料はドキュメントのみ。Swiftコード・テストコードへの反映、コミット・push・merge・TestFlight配布は未実施。

**改訂履歴**:
- **(今回・P3-1〜P3-5の明示的解消確認)** P3-1: `.userChanged`診断が記録されるのは§4.2`fetch()`do節内の受信後判定1か所のみであることを明記し、2つの送信前guard(fetch()冒頭・handlePlanStateChanged冒頭)は診断を記録しないことを確定(§4.3)。P3-2: この2つのguard・`retryNow()`のguardが不一致時に`cancelPlanConfirmationWait()`を呼ぶよう修正(古いインスタンスの待機・タイムアウトTask残存を防止)。残存するタイムアウト診断1回分の可能性は実害無しとして許容(§4.3)。P3-3: `retryNow()`の安全性が「自身のguard」+「PlanStore.load()自身の送受信時guard」の2層で成立することを整理(§4.2.1)。P3-4: `HomeCacheStore.swift`実コードと照合し、`save()`は検証しないが`saveFavorites()`・`discardIfPlanDiffers()`は既存の`userID`一致確認を持つことを確認し§5の記載を訂正。P3-5: `fetch()`の既存副作用(`.backendNotConfigured`・`beginHomeRequest`・`recordHomeStateApplied`・`recentSpeeches`等・キャッシュ処理)が維持されていることを再確認(前回までの修正で対応済み)。追加確認: `DiagnosticsStore.swift`実コードを読み、新規提案メソッドに対応する専用フィールドを追加すればテスト用の新規APIなしで検証できることを確定(§7)。`Task.isCancelled`確認から状態変更までの間に`await`が無く、MainActor上で1つの同期ブロックとして実行されるため競合が生じないことを明記(§4.2.1)。
- **(今回・C独立レビューCONDITIONAL PASS(P0=0, P1=1, P2=4, P3=5)対応)** P1-1(7点): §1.2の`PlanStore.State`を`.unconfirmed(lastKnown: PlanContext?)`に再設計(前回の2ケースenumは既存の「未確定でも前回値を保持する」挙動からの退行だったため修正)。`confirmedPlan`・`set(plan:limits:confirmed:userID:)`を復元・再設計。§4.2.3(新設)で、既存の`$isConfirmed.combineLatest($plan)`購読を`$state`購読へ移行する方法(`planConfirmed()`を削除せず`handlePlanStateChanged()`と co-trigger する)、`load()`・`planConfirmed()`の直接Fetch呼び出しを`startFetchIfNeeded()`へ統一する方法、Combine初回通知と`.task{load()}`の競合が`isFetching`ガード1つに帰着することの説明、既存利用箇所・テストの移行表を追加。
- **(今回)** P2-1: `scheduleWaitForPlanConfirmation()`の呼び出し箇所が`fetch()`内の1か所のみであることと、到達する2条件を§4.2.1冒頭に明記。
- **(今回)** P2-2: テスト29〜31を再設計(§8)。private状態(`isWaitingForPlanConfirmation`等)を直接読む案(internal観測口)を明示的に不採用とし、`sleep`のDI(P2-3の副産物)+診断記録の呼び出し回数という外部観測可能な副作用のみで間接検証する方針を採用。`DiagnosticsStore`側の読み取り手段の有無は未検証として§11に明記。
- **(今回)** P2-3: `scheduleWaitForPlanConfirmation()`のタイムアウトTaskに`guard !Task.isCancelled`を追加(`try?`がキャンセルのエラーを握り潰すため、明示確認が無いと古いTaskが新しい待機の状態を誤って変更しうる)。トークン方式ではなく`Task.isCancelled`確認を採用した理由(MainActor直列実行下で十分)を明記。検証用テスト32を追加。
- **(今回)** P2-4: `userID == nil`の仕様を「プラン確定状態の検証を一切行わず、既存の挙動(通常Fetch・キャッシュ省略)をそのまま維持する」と決定(§4.2)。影響する既存テスト(`HomeViewModelTests`・`HomeSpeechesStatusTests`・`CalendarViewModelTests`・`EventDetailViewTests`・`PlanStoreTests`・`HomeCacheTests`)を洗い出し、§11に移行表を追加(`HomeCacheTests.swift`の`makeViewModel`ヘルパーのみ実際の変更が必要と判明)。
- **(今回)** P3: §4.2の`fetch()`コード例が既存コード(`HomeViewModel.swift`269-330行目)の副作用(`.backendNotConfigured`分岐・`recentSpeeches`等の全量更新)を省略していたため全文を復元(`applyFetchSuccess`/`applyFetchFailure`に切り出し)。`retryNow()`に`self.userID`とのライブ一致確認を追加(§4.2.1)。C独立レビューのP3-1〜P3-5の原文は今回の指示文に含まれておらず、一致確認ができていないことを§11に明記。
- (前回) §4.2.1: `scheduleWaitForPlanConfirmation()`に、認証ユーザーと対象userIDの一致確認・`confirmedContext.userID`と対象userIDの一致確認を追加。`confirmedContext != nil`だけで「確定済み」と判定しないよう修正。不一致時の動作(待機解除のみ・診断記録)を整理し、`fetch()`側の既存guardとの整合性・通常のログイン/ログアウト/アカウント切替での無害性を確認。テスト29の前提条件を明記し、テスト30/31を追加。
- **(今回)** §11「実装時の確認事項」が空欄でないことを確認(既存7項目を維持)し、今回の§4.2.1修正に対応する項目を追加。
- (前回) §8テスト28: 「通信待ち状態を確実に(タイミング依存のない形で)作ってから`.unconfirmed`を検証する」設計に再具体化(`CheckedContinuation`等でモック応答を明示的に保留する手順を明記)。
- (前回) §10: `AuthenticatedUserProviding`の`@MainActor`に関する記載を「推奨」から§1.2と同じ「必須条件」に統一。古い「推奨」の記載を削除。
- **(今回)** §1.2.1・§11: `commit()`規則6の検証可能性について、`private`のため`@testable import`でも外部から直接呼べないこと、`load()`経由では到達しないことを正直に明記。アクセスレベル変更等の設計変更は行わず、コードレビューによる目視確認に依存する限界として受け入れる方針に修正(不要な設計変更はしない)。
- **(今回)** §8テスト27/28/29を具体化: テスト27はreset前・reset直後・再確定後の3時点のgeneration比較、テスト28はユーザー切替時の合計1回の加算と一時的な`.unconfirmed`経由の確認、テスト29は待機中かつ確定済みの前提状態からの待機解除・Fetch開始の具体的な検証項目(a)(b)(c)を明記。
- (前回) §4.2.1: `scheduleWaitForPlanConfirmation()`の分岐順序を修正(確定状態の確認を、既存待機中チェックより先に行う)。説明と実装の不一致を解消。
- **(今回)** §1.2・§1.2.1: `load()`の未確定化ステップが`confirmedUserID == nil`の場合にも誤って`generation`を加算していた不具合を修正。`generation`の加算を`commit()`の規則1に一元化し、初回確定・ユーザー切替のいずれも1回だけ加算されるようにした。初回起動/再ログイン/ユーザー切替の3ケースを表で整理。規則6が`load()`経由では実質的に発火しないことを明記。§1.2.3の副作用表も整合させて修正。
- **(今回)** §1.2: `AuthenticatedUserProviding`に`@MainActor`を付与することを**必須条件**に変更(推奨から格上げ)。Swift 5モードでのコンパイル確認は未検証のまま§11に残す。
- **(今回)** §8: テスト26〜29を追加(generation初回更新の3ケース、`scheduleWaitForPlanConfirmation()`の順序修正)。
- (前回) §1.2のplan/limits確定条件の統一。§1.3(同一ユーザーのEntitlements再取得)・§4.6(Home Prefetchの実効性)の新設。§11の3区分整理。
- **(今回・P0-1)** §1.2のコード例を修正: `load()`・`commit()`・`reset()`を`LoadResult`enumの内部から`PlanStore`クラスのメンバーへ移動。`PlanStore`の型の開始から終了までを省略せず提示。
- **(今回・P0-2)** §1.2の`load()`の処理順序を修正: `userID`・`authenticatedUserProvider`の検証を、既存の`PlanContext`・`entitlementsRequestSequence`を操作する**前**に行うよう変更。不明なユーザーIDを理由に既存の確定済み文脈を不用意に未確定化したり、他の進行中リクエストを無効化したりしないようにした。§1.2.2で`.authenticationUnverifiable`と`.userMismatchOrUnknown`の使い分けを明文化。§8テスト19を副作用検証付きに修正。
- **(今回・P1-1)** §4.2の`fetch()`を修正: 先行取得が利用できない(`contextAtDispatch`がnil・不一致)場合に`scheduleWaitForPlanConfirmation()`を呼ばず、検証済みの`requestSnapshot`のまま通常Fetchへフォールバックするよう変更。§4.2.1で`scheduleWaitForPlanConfirmation()`・`retryNow()`の完全な定義を追加し、確定済み状態で呼ばれた場合に直ちに`startFetchIfNeeded()`へ進む動作を明文化。
- **(今回・P1-2)** §1.2の`(nil, nil)`ケースから`fatalError`を除去し、新設した`LoadResult.pendingPolicyDecision`を返すよう変更。PlanContext・generation・Home state/cacheのいずれも更新しない。A/B/Cの採用判断は独断で行わない。
- **(今回・P1-3)** §4.2.2(新設): `isRefreshingEntitlements`の必要性を再検討し、効率目的のガードとして維持する結論と、その用途・更新タイミング・競合時の動作を明文化。
- **(今回・P1-4)** §1.2.3(新設): 失敗系`LoadResult`それぞれについて、PlanContext・generation・entitlementsRequestSequence・他リクエストへの影響・Home取得/キャッシュへの影響を表で整理。
- **(今回)** §11を全文確認のうえ再整理(前回提出時に「実装時の確認事項」以降が欠落していたため、全文を再提示)。

## §0 範囲と前提

本資料は、`HomePrefetchCoordinator`による`/home`・`/entitlements`の先行取得と、`PlanStore`が管理する権限確定状態(FREE/PRO)との整合性を、以下のリスクから守るための設計をまとめたものである。

- 先行取得・通常取得のレスポンスが、送信時点と異なるプラン・異なるユーザーの文脈で誤って採用される。
- プラン変更が通信中に発生した場合に、古い結果が新しい文脈を上書きする。
- Home取得の失敗・多重化・取りこぼし・無限再試行。
- プラン未確定のまま確定扱いにしてしまう。

対象ファイル(現状は未変更、§9に詳細):`PlanStore.swift`・`HomePrefetchCoordinator.swift`・`HomeViewModel.swift`・`HomeCacheStore.swift`・`SubscriptionManagementViewModel.swift`・`AppState.swift`・`MainTabView.swift`・`HomeView.swift`・`RootView.swift`・`DiagnosticsStore.swift`。

既存の確認済み事実(実コード読解に基づく):
- `PlanStore`・`HomeViewModel`・`HomeCacheStore`・`AppState`はいずれも`@MainActor`隔離クラス(`PlanStore.swift`・`HomeViewModel.swift:124`・`HomeCacheStore.swift:40`・`AppState.swift:8`)。
- `EntitlementsResponse.plan`・`.limits`は型としてOptional、デフォルト`nil`(`EntitlementsModels.swift:14-15`)。`api-design.md`1944行目に「v1.15で`plan`・`limits`を追加」と明記されており、両者は常にセットで追加された。
- `APIClient.swift`(132-146行目)は`session.data(for:)`が投げるあらゆるエラー(`URLError.cancelled`含む)を`APIError.transport(String)`に変換し、元のエラー型情報を失う。
- `AppState.leaveLoggedIn()`(`AppState.swift:35-40`)は`currentUserID = nil`・`homeCache.clear()`・`prefetchCoordinator.reset()`を同じ関数内で同期的に実行する。
- `MainTabView.swift`は`HomeView`をタブ切替・画面回転の分岐の外側(`ZStack`+`opacity`)に配置しており、これらの操作では`HomeViewModel`は再生成されない。`RootView.swift`の`.loggedOut`↔`.loggedIn`遷移、および`.id(preferences.display.textSize)`の変化時のみ再生成される。
- `HomeCacheStore`(単一UserDefaultsキー、`HomeCacheStore.swift:48`)の`save()`自体は呼び出し時の`userID`を検証しない。安全性は呼び出し元(`HomeViewModel.fetch()`)の検証のみに依存する。
- `SWIFT_VERSION: "5.0"`(`project.yml:10`)。Swift 6厳格並行性チェックは有効化されていない。

---

## §1 PlanStoreのState管理と確定条件

### 1.1 単一State化

個別の`@Published`プロパティ(`generation`・`isConfirmed`・`confirmedUserID`)を別々に持つと、Combineの発火順序により購読側が中間状態(不整合なスナップショット)を読む可能性がある。これを避けるため、`PlanContext`を含む単一の`@Published` enumを公開する。

### 1.2 確定条件(`load()`)

**型・メソッドの配置(P0-1対応)**: `LoadResult`は`PlanStore`の戻り値として使う独立したトップレベルの型であり、`PlanStore`の内部に入れ子にしない。`load()`・`commit()`・`reset()`はいずれも`PlanStore`自身のメンバーである(旧版では`load()`等が誤って`LoadResult`enumの内部に配置されていた)。`PlanStore`の型の開始から終了まで、省略せずに以下に示す。

```swift
/// Entitlements確認の結果。PlanStore.load()の戻り値。PlanStoreの外側のトップレベル型。
enum LoadResult: Equatable {
    case confirmed(PlanStore.PlanContext)
    case supersededByNewerRequest   // より新しいload()呼び出しに追い越された
    case userMismatchOrUnknown      // 送信時点のuserIDが不明、または認証ユーザーと不一致(§1.2.2)
    case authenticationUnverifiable // authenticatedUserProviderが渡されず確認不能(§1.2.2)
    case malformedResponse          // plan/limitsの組み合わせが仕様上の根拠を欠く(§3参照)
    case pendingPolicyDecision      // plan=nil && limits=nil。§3のHQ判断が確定するまでの明示的な未対応結果(P1-2)
    case requestFailed
}

@MainActor
final class PlanStore: ObservableObject {
    // (今回・P1-1対応) `.unconfirmed`にlastKnownを追加した。実際のPlanStore(現行コード)は
    // plan/limitsを独立したストアドプロパティとして持ち、isConfirmedがfalseになっても値を
    // 保持する(`PlanStoreTests.swift`79-85行目・`EventDetailViewTests.swift`39行目が
    // この「未確定でも前回値を保持する」挙動に依存している)。単一stateのenumに
    // 統合する際、`.unconfirmed`に値を持たせないとこの既存挙動が失われる(前回提示した
    // 2ケースのenumは、この点で既存挙動からの退行だった)。
    enum State: Equatable {
        case unconfirmed(lastKnown: PlanContext?)
        case confirmed(PlanContext)
    }
    struct PlanContext: Equatable {
        let userID: UUID
        let plan: String          // EntitlementsResponse.Plan.rawValue
        let limits: PlanLimits     // 既にEquatable
        let generation: Int
    }

    @Published private(set) var state: State = .unconfirmed(lastKnown: nil)
    private var generation = 0            // 内部カウンタ。外部にはPlanContext経由でのみ公開
    private var entitlementsRequestSequence = 0   // Home用generationとは別管理。load()呼び出しの新旧判定専用

    // (今回・P1-1対応) 安全性が必要な判定(ユーザー整合性・generation比較等)には、必ず
    // 以下の「strict」な3つ(isConfirmed/confirmedUserID/confirmedContext/confirmedPlan)を
    // 使うこと。`.confirmed`のときのみ値を返し、`.unconfirmed`(lastKnownの有無に関わらず)は
    // 常にnil/false。
    var isConfirmed: Bool { if case .confirmed = state { true } else { false } }
    var confirmedUserID: UUID? { if case .confirmed(let c) = state { c.userID } else { nil } }
    var confirmedContext: PlanContext? { if case .confirmed(let c) = state { c } else { nil } }
    /// `HomeViewModel.planConfirmed()`・`cacheContext()`・`HomeCacheContext.confirmedPlan`が
    /// 使う、確定済みプランのString表現。`.unconfirmed`の間は常にnil(lastKnownの有無に関わらず)。
    var confirmedPlan: String? { confirmedContext?.plan }

    /// 表示用のベストエフォート値(strictではない)。未確定でも、分かっている直近の値を
    /// 返す(既存の`CalendarViewModel`等がプラン確定前にも制限値を表示できる、既存挙動の維持)。
    /// 安全性が必要な判定には使わないこと。
    private var context: PlanContext? {
        switch state {
        case .unconfirmed(let lastKnown): return lastKnown
        case .confirmed(let c): return c
        }
    }
    var plan: EntitlementsResponse.Plan {
        if let p = context.flatMap({ EntitlementsResponse.Plan(rawValue: $0.plan) }) { return p }
        return .free
    }
    var limits: PlanLimits { context?.limits ?? .free() }
    var isPro: Bool { plan == .pro }

    /// テスト・プレビュー専用のヘルパー(本番の確定経路は`load()`のみ)。既存の
    /// `PlanStoreTests`・`CalendarViewModelTests`・`HomeCacheTests`・`EventDetailViewTests`が
    /// `userID`を渡さずに呼ぶケースが多数ある(§11「実装時の確認事項」のテスト移行表参照)。
    /// `userID`省略時は、呼び出し側がuserID整合性を検証する意図がそもそも無いテストでのみ
    /// 安全に使えるよう、ダミーの乱数UUIDを補う(どの実在userIDとも一致しない)。
    /// `confirmed: true`で呼び、かつ呼び出し先が実在の`userID`を持つ`HomeViewModel`と
    /// 組み合わせる場合は、必ず`userID`を明示的に渡すこと(省略するとfetch()のuserID一致
    /// guardが失敗し、Fetchが実行されなくなる)。
    func set(plan: EntitlementsResponse.Plan, limits: PlanLimits, confirmed: Bool = true, userID: UUID? = nil) {
        let context = PlanContext(userID: userID ?? UUID(), plan: plan.rawValue, limits: limits, generation: generation)
        state = confirmed ? .confirmed(context) : .unconfirmed(lastKnown: context)
    }

    @discardableResult
    func load(
        apiClient: APIClient,
        userID: UUID? = nil,
        authenticatedUserProvider: AuthenticatedUserProviding?,
        prefetchCoordinator: HomePrefetchCoordinator = .shared
    ) async -> LoadResult {
        // ①(P0-2対応)この呼び出し自体が検証可能か、送信時点のuserIDが現在の認証ユーザーと
        //   一致するかを、既存のstate・entitlementsRequestSequenceに一切触れる前に確認する。
        //   「userIDが不明・不一致」というこの呼び出し自体の問題を理由に、既存の確定済み
        //   PlanContextを不用意に未確定へ戻したり、他の進行中のリクエストのsequence比較を
        //   無効化したりしない。
        guard let authenticatedUserProvider else { return .authenticationUnverifiable }
        guard let requestUserID = userID, requestUserID == authenticatedUserProvider.currentUserID else {
            return .userMismatchOrUnknown
        }
        // ここまでで、requestUserIDは「呼び出し時点で検証済みの、現在の認証ユーザー」である
        // ことが保証されている。これより先でのみstate・entitlementsRequestSequenceを操作する。

        // ②検証済みのrequestUserIDが確定してから、初めてentitlementsRequestSequenceを進める。
        entitlementsRequestSequence += 1
        let requestID = entitlementsRequestSequence
        // generationの初回更新(今回修正): confirmedUserIDがnil(未確定からの初回確定、または
        // reset()後の再確認)の場合はここでリセットする必要が無い(stateは既に.unconfirmed)。
        // 「確定済みの別ユーザー」からの切り替わりであることが確定している場合のみ、
        // state を .unconfirmed に戻す。generation自体はここでは進めず、commit()の規則1
        // (state==.unconfirmedからの確定は常にbump)に一元化する — 二重に加算しない。
        if let currentConfirmedUserID = confirmedUserID, currentConfirmedUserID != requestUserID {
            // (今回・P1-1対応) lastKnownはnilにする(別ユーザーへの切り替わりのため、
            // 切り替え前のユーザーのplan/limitsをベストエフォート表示にも残さない。
            // 他ユーザーのプラン情報を一瞬でも表示し続けることを避ける)。
            state = .unconfirmed(lastKnown: nil)
        }

        do {
            let response: EntitlementsResponse
            if let prefetched = prefetchCoordinator.consumeEntitlements(for: requestUserID) {
                response = try await prefetched.value
            } else {
                response = try await EntitlementsService(apiClient: apiClient).fetchEntitlements(timezone: TimeZone.current.identifier)
            }

            guard requestID == entitlementsRequestSequence else { return .supersededByNewerRequest }
            // 受信時点で、認証ユーザーが送信時点から変わっていないかを再確認する。
            guard requestUserID == authenticatedUserProvider.currentUserID else { return .userMismatchOrUnknown }

            // plan/limits組み合わせの整合性チェック(§3)。統一仕様:
            //   nil/nil   → HQ判断待ち(§3)。PlanContext・generation・Home state/cacheのいずれも
            //               更新せず.pendingPolicyDecisionを返す。A/B/Cの採用判断を独断で
            //               行わない(P1-2対応。fatalErrorは使用しない)。
            //   plan/limits(両方存在) → 正常確定
            //   plan/nil  → malformedResponse(片方だけの欠落に仕様上の根拠が無い)
            //   nil/limits → malformedResponse(同上)
            switch (response.plan, response.limits) {
            case (nil, nil):
                return .pendingPolicyDecision
            case (let p?, let l?):
                commit(userID: requestUserID, plan: p, limits: l)
                return .confirmed(confirmedContext!)
            case (.some, nil), (nil, .some):
                // planのみ存在・limitsのみ存在のいずれも、v1.15で両者が同時に追加されたという
                // 仕様(api-design.md 1944行目)と矛盾するため、確定しない。
                DiagnosticsStore.shared.recordEntitlementsDiscarded(reason: .malformedPlanLimitsCombination)
                return .malformedResponse
            }
        } catch {
            guard requestID == entitlementsRequestSequence else { return .supersededByNewerRequest }
            return .requestFailed
        }
    }

    /// 確定処理の内部実装。generationの更新規則をここに一元化する。
    private func commit(userID: UUID, plan: EntitlementsResponse.Plan, limits: PlanLimits) {
        let isNewContext: Bool
        switch state {
        case .unconfirmed:
            isNewContext = true   // 規則1: 未確定→確定は常にbump
        case .confirmed(let previous):
            isNewContext = previous.userID != userID        // 規則6: ユーザーが変わればplan/limitsの値に
                                                               // 関わらず常にbump
                        || previous.plan != plan.rawValue      // 規則3: planの変化
                        || previous.limits != limits           // 規則4: limitsの変化
                                                               // (すべて同一なら規則2、isNewContext=false)
        }
        if isNewContext { generation += 1 }
        state = .confirmed(PlanContext(userID: userID, plan: plan.rawValue, limits: limits, generation: generation))
    }

    func reset() {
        // (今回・P1-1対応) ログアウトでもlastKnownはnilにする(次にログインする別ユーザーに
        // 前のユーザーのplan/limitsをベストエフォート表示として見せないため)。
        state = .unconfirmed(lastKnown: nil)
        entitlementsRequestSequence += 1   // 進行中の取得を無効化する
        generation += 1                     // 規則5: ログアウトも文脈の変化として扱う
    }
}
```

**lastKnownの取り扱い方針のまとめ(P1-1対応)**: `lastKnown`に値が入るのは`set(confirmed: false)`のみであり、`load()`・`reset()`はいずれも`.unconfirmed`に遷移する際に`lastKnown: nil`を使う。これにより、`load()`経由の通常フロー(本番の確定経路)では`lastKnown`に実際の値が入ることは無く、`plan`/`limits`/`isPro`のベストエフォート表示は**テスト・プレビューでの明示的な`set(confirmed: false)`呼び出し時のみ**意味を持つ。本番の通常フロー(ユーザー切替・ログアウト)でこれらのベストエフォート値を見せる設計にはなっていないが、これは既存コードの挙動(別ユーザーへの切り替え中は`plan`/`limits`自体を更新しない)と同じ安全側の挙動であり、退行ではない。

### 1.2.1 generationの更新規則(明文化)

| 操作 | generationが進むか | 規則番号 |
|---|---|---|
| 未確定→確定(初回確定) | 進む | 規則1 |
| 同一ユーザー・同一plan・同一limitsで再確定 | **進まない** | 規則2 |
| planだけが変更された | 進む | 規則3 |
| limitsだけが変更された | 進む | 規則4 |
| ログアウト時の`reset()` | 進む | 規則5 |
| ユーザーが変わった(plan/limitsが偶然同じ値でも) | 進む | 規則6 |

**同一Entitlementsの再確定時にgenerationが進むのか**: **進まない**(規則2)。`commit()`内の`isNewContext`判定が`userID`・`plan`・`limits`のすべてが前回と同一であることを確認した場合のみ`false`になり、`generation`は変化しない。ただし`state`への代入(`state = .confirmed(...)`)自体は値が同一でも毎回実行されるため、`@Published`の発火(Combineへの通知)は起こる。これは意図的な挙動であり、`HomeViewModel`側の`pendingGeneration`/`lastFetchedGeneration`による重複排除(§4.2・§4.3)が、この「内容は同じだが通知は発生する」というケースを正しく吸収する設計になっている。

`reset()`は`generation`を進める(規則5)と同時に`entitlementsRequestSequence`も進める。両者は別の管理対象(§1.2の冒頭コメント参照)だが、`reset()`はログアウトという「文脈そのものの終了」を表すイベントであるため、両方を同時に進める。

**generationの初回更新(今回修正、3ケースの区別)**: 修正前は、`load()`内の`requestUserID != confirmedUserID`判定が`confirmedUserID == nil`の場合にも真になり、「ユーザー切替」としてこの判定自体が`generation`を加算していた。その後`commit()`が`state == .unconfirmed`を見て規則1でさらに加算するため、初回確定時に**二重に加算**されていた。修正後は、`load()`の判定を「確定済みの別ユーザーからの切り替わり」に限定し、`generation`の加算は`commit()`の規則1に一元化した(`load()`側では`state`のリセットのみ行い、`generation`は進めない)。

| ケース | `confirmedUserID`(呼び出し前) | `load()`内でstateをリセットするか | generationが進むタイミング | 合計の加算回数 |
|---|---|---|---|---|
| ①初回起動(unconfirmed→初回確定) | `nil` | リセットしない(既に`.unconfirmed`) | `commit()`の規則1のみ | **1回** |
| ②ログアウト後の再ログイン(`reset()`後のunconfirmedから確定) | `nil`(`reset()`が既に`.unconfirmed`にしている) | リセットしない | `commit()`の規則1のみ | **1回**(`reset()`自体の加算は別のタイミングの出来事として別途1回) |
| ③確定済みユーザーAから確定済みユーザーBへの切替 | `A`(非nil) | **リセットする**(`state = .unconfirmed`、ここではgenerationを進めない) | リセットにより`state`が`.unconfirmed`になるため、結果的に`commit()`の規則1が発火 | **1回** |

**規則6(ユーザー変更によるbump)の実質的な位置づけ**: 上記の修正により、`load()`経由の呼び出しでは、ユーザーが実際に変わるケース(③)も必ず`load()`自身のリセット処理で`state`が`.unconfirmed`を経由してから`commit()`に到達するため、`commit()`内の規則6(`state`が`.confirmed`のまま別userIDで確定しようとした場合のbump)は**`load()`経由の通常の呼び出しでは実質的に発火しない**(規則1が代わりに発火する)。**この挙動(規則1がload()経由では常に規則6を代替すること)は維持する。不要な設計変更(`commit()`のアクセスレベルの変更等)は行わない。**

**規則6を残す場合の検証可能性について(正直な整理)**: `commit()`は`private func`であり、`PlanStore.swift`の外側(例: `PlanStoreTests.swift`)からは、`@testable import`を用いても呼び出せない(`@testable import`が緩和するのは`internal`アクセスレベルであり、`private`は緩和されない)。かつ、§1.2.1で確認したとおり、`load()`を経由する限り規則6の分岐には到達しない。したがって、**規則6は現状、`PlanStore.swift`の外部から単体テストで直接検証する手段が無い**。これは「テストできる」という曖昧な記載を避け、正直に認める。規則6は、`commit()`が将来`load()`を経由しない別の呼び出し元から直接呼ばれるようになった場合に備えた、コード上の防御的な分岐としてのみ存在し、**今回はその検証方法を新設しない**(アクセスレベルの変更や`@testable`用のテストフックの追加は、いずれも不要な設計変更にあたるため行わない)。規則6の正しさは、現時点では**コードレビューによる目視確認**(`switch state`の2ケースの網羅性、規則3/4/6の論理式)に依存する、という限界を明記する。

### 1.2.2 `.authenticationUnverifiable`と`.userMismatchOrUnknown`の使い分け(P0-2対応)

| ケース | 返す値 | 意味 |
|---|---|---|
| `authenticatedUserProvider`自体が`nil` | `.authenticationUnverifiable` | 呼び出し元が認証状態を確認する手段自体を渡していない(構造的な制約。特定の値の不一致ではない) |
| `userID`パラメータが`nil`(対象ユーザーが指定されていない) | `.userMismatchOrUnknown` | 確認手段はあるが、誰についての呼び出しか自体が分からない |
| `userID`は指定されているが、`authenticatedUserProvider.currentUserID`と一致しない(送信時点・受信時点のいずれでも) | `.userMismatchOrUnknown` | 確認手段があり、対象も分かっているが、実際の認証ユーザーと食い違っている(真の不一致) |

いずれの場合も、§1.2の`load()`に示したとおり、**既存の`state`・`entitlementsRequestSequence`を変更する前に**これらの判定を行うため、呼び出し自体が無効と判定された場合に副作用が一切発生しない(§1.2.3「副作用の整理」参照)。

### 1.2.3 失敗系`LoadResult`ごとの副作用の整理(P1-4対応)

| `LoadResult` | PlanContext(state) | generation | entitlementsRequestSequence | 他の進行中リクエストへの影響 | Home取得・キャッシュへの影響 |
|---|---|---|---|---|---|
| `.authenticationUnverifiable` | 変化しない(①の時点で即return、state未参照) | 変化しない | **進まない**(②に到達しない) | 無効化しない | 無し |
| `.userMismatchOrUnknown`(送信時点、①で検出) | 変化しない | 変化しない | **進まない** | 無効化しない | 無し |
| `.userMismatchOrUnknown`(受信時点、②通過後に検出) | ②の判定(確定済みの別ユーザーからの切り替わりの場合のみ)により、送信時点で既に未確定へ戻っている可能性がある | **変化しない**(今回の修正により、②のリセット自体はgenerationを進めない。`commit()`に到達しないため規則1も発火しない) | **進む**(②で既に加算済み。このリクエスト自体は有効だったため) | このリクエストのsequence番号が「最新」になるため、さらに古い別のリクエストはこれより後に完了すれば`supersededByNewerRequest`として正しく追い越される | 新たな確定が無いため、Home側が新しい内容を取得するきっかけにはならない |
| `.malformedResponse` | 新たな確定(`commit()`)はされない。②のリセットによる未確定化のみ反映されうる | **変化しない**(同上。`commit()`に到達しないため) | **進む**(②で加算済み) | 同上(このリクエストのsequence番号が最新になる) | 同上(新たな確定が無いため影響しない) |
| `.pendingPolicyDecision` | 同上(`commit()`されない) | **変化しない**(同上) | **進む** | 同上 | 同上 |
| `.supersededByNewerRequest` | このリクエスト自身は何もコミットしない。追い越した側(より新しいリクエスト)の結果がどうなるかに依存する | **変化しない**(同上) | 進むが、より新しいリクエストにさらに追い越されている(`requestID != entitlementsRequestSequence`) | このリクエストは無力化されるだけで、他のリクエストを無効化する側にはならない | 追い越した側の結果次第 |
| `.requestFailed` | コミットされない | **変化しない**(同上) | **進む**(このリクエストが最新だったため) | 無し(むしろこのリクエストが最新として他の古いリクエストを追い越す側になる) | 新たな確定が無いため影響しない |

**今回の修正による簡素化**: すべての失敗系`LoadResult`において、**generationは`commit()`を経由しない限り一切変化しない**(修正前は②のリセット自体が加算していたため、一部の失敗系で変化する余地があった)。これにより表が単純化され、「`commit()`が呼ばれたかどうか」と「`generation`が変化したかどうか」が常に一致するようになった。

`AuthenticatedUserProviding`は`AppState.currentUserID`を既存の認証管理機構から直接参照するための最小限の抽象:

```swift
@MainActor
protocol AuthenticatedUserProviding { var currentUserID: UUID? { get } }
extension AppState: AuthenticatedUserProviding {}
```

**`@MainActor`を設計上の必須条件とする**: `AuthenticatedUserProviding`プロトコル自体に`@MainActor`を付与することを、本設計の**必須条件**として明記する(推奨ではない)。`AppState.currentUserID`は`@MainActor`隔離プロパティであり、`PlanStore`・`HomeViewModel`・`HomeCacheStore`もすべて`@MainActor`隔離クラスである(§0参照)。プロトコル自体を`@MainActor`にしないと、隔離指定の無いプロトコル要件を`@MainActor`隔離プロパティで満たす形になり、`SWIFT_VERSION: "5.0"`(警告のみで通る可能性がある)から将来Swift 6言語モードへ移行した際に、コンパイルが通らなくなるリスクがある。

**未検証のまま残す事項**: `project.yml`は`SWIFT_VERSION: "5.0"`で、Swift 6の厳格並行性チェックは現在有効ではない。`@MainActor protocol`として宣言した場合に実際にSwift 5モードでコンパイルが通るかどうかは、本資料の範囲では実際のSwiftコンパイラで確認していない(§11「未検証」に記載)。実装時に必ず確認すること。

### 1.3 同一ユーザーのEntitlements再取得(HQ判断待ち)

`commit()`(§1.2.1)は、同一ユーザーのまま`load()`が複数回呼ばれても、内容が変わらない限り既存の`PlanContext`(generation含む)を維持する設計である。これが引き起こす4つの状況を区別する。

**① 通常のEntitlements再確認**(例: `RootView.swift`のscenePhase復帰時の定期確認)。多くの場合、内容は変わらない。規則2(§1.2.1)により`generation`は進まず、Home取得への影響は実質無い。

**② 購入・復元・プラン変更後の再確認**(`SubscriptionManagementViewModel.sync()`経由の`PlanStore.load()`呼び出し)。内容が変わる可能性が高い(FREE→PRO等)。規則3/4/6のいずれかにより`generation`が進み、既存の「追い越し」機構(§4.3)により、進行中・待機中のHome取得が新しい内容へ自動的に追従する。

**③ 同一ユーザーのEntitlements取得(②等)が進行中に、Home通信(`fetch()`)が完了するケース**: `fetch()`は受信時点で`planStore.confirmedContext`をライブに読むが、これは**「既に確定済みの最新」**であり、**「確認中でまだ確定していない、将来の値」を先取りすることはできない**。したがって、②の再確認がまだ`/entitlements`からの応答を待っている間にHomeの応答が先に届いた場合、`fetch()`は(まだ古い内容のままの)現在のconfirmedContextと一致すると判定し、ケースAとして採用・コミットしてしまう。その直後に②の再確認が完了してgenerationが進めば、既存の追い越し機構により1回余分にHomeを取り直すことになる(安全性は損なわれないが、購入直後の一瞬だけ古いプランの内容が表示・キャッシュされる可能性がある)。

**④ 古いPlanContextでHome結果を採用することの可否**: 「古い」の意味を2つに分けて整理する。
- 確定済みで、かつ受信時点でもまだ最新(その後さらに新しい確定がまだ来ていない)→採用してよい(現行設計のケースA)。
- 確定済みだが、受信時点で既にさらに新しい確定に追い越されている→採用しない(現行設計のケースB、既存の仕組みで対応済み)。
- **確認中でまだ確定していない、将来変わる可能性がある値を先取りして待つかどうか**→これが③の論点であり、現行設計には対応する仕組みが無い。

**選択肢と比較**(③への対応):

| 選択肢 | 内容 | 安全性 | Homeの再取得回数 |
|---|---|---|---|
| **I(現行設計)** | 対応する仕組みを追加しない。Entitlements再確認中かどうかに関わらず、受信時点の確定済みcontextで判定する | 確認中の瞬間に古い内容が一時的にコミットされる可能性がある。ただし既存のgeneration追い越し機構により、再確認完了後に自動的に1回だけ追従する(危険なデータ漏洩ではなく、一時的な表示の古さ) | 最小(確認完了後に1回の追い越し取得で収束) |
| **II** | `PlanStore`に`isReconfirming`相当のフラグを追加し、Home側の`fetch()`は再確認中はコミットを保留する | Iと実質同じ最終結果(既存のgeneration比較で最終的には正しい値に収束するため)。フラグのセット・クリアのタイミングに新たな競合状態を持ち込むリスクがある | フラグの立つタイミングとHome取得のタイミングによっては、待機から再開のための追加のラウンドトリップが発生しうる |

**推奨(HQ最終判断を代行しない)**: 選択肢Iの現行設計維持を推奨する。理由は、選択肢IIが防ぐのは「確認中の一瞬だけ古い情報が表示・保存される」という短い時間窓であり、既存の仕組みで次の確定イベントにより自動的に収束するため、新しいフラグを追加する複雑さ・新たな競合リスクに対して得られる実害の削減が小さいと判断するためである。**ただし、この推奨の採否、および「①②③④のいずれを許容範囲とするか」の最終判断はHQに委ねる。**

---

## §2 FREE / PROのプラン状態管理

- `PlanStore.plan: EntitlementsResponse.Plan`(`.free`/`.pro`)は、`PlanContext.plan`(String)から計算されるプロパティ。
- `PlanLimits`(`calendarEarliestFrom`・`calendarLatestTo`・`favoritesMax`・`notificationImportances`・`notificationFxPairsMax`・`historyEventsMax`・`pastReleasesMax`)は`.free()`/`.pro()`の既定値をクライアント側に持つ(`PlanLimits.swift`相当、`PlanStore.swift`内に定義済み)。
- `CalendarViewModel`・`IndicatorDetailView`・`EventDetailView`等、既存の`PlanStore.shared`参照箇所(`@ObservedObject private var plan = PlanStore.shared`)は、計算プロパティとしての後方互換性により変更不要。

---

## §3 plan=nil && limits=nilの未決定事項(HQ判断待ち)

`api-design.md`§27の確認により、`plan`・`limits`が**両方とも**欠落するのは、v1.15未満の旧Backendで仕様上正当に発生しうることが分かった。一方、**現行Backendの不具合によって両方欠落するケースとの区別はクライアント側では不可能**(APIバージョン信号が存在しない)。

| 選択肢 | 内容 | PROユーザーへの誤制限リスク | 旧Backend互換性への影響 |
|---|---|---|---|
| **A** | 両方欠落→FREEとして確定、Home取得・キャッシュ保存を通常どおり行う | **あり**: 現行Backendの不具合で両方欠落した場合、PROユーザーが一時的にFREE扱いになり、Home・キャッシュに「FREE」が書き込まれる | 旧Backendでは正常動作 |
| **B** | 両方欠落→`.malformedResponse`として確定せず保留(片方だけ欠落のケースと同じ扱いに統一) | **なし** | 旧Backendのユーザーが**永久に未確定のまま**になる可能性(旧Backendが実際にまだ稼働していれば重大な回帰) |
| **C** | Aと同じ挙動を維持しつつ、この経路でのFREE確定を通常の確定と区別できる診断ログを残す | Aと同じ(リスクは解消しない) | Aと同じ(互換性は維持) |

**A独自の判断として、いずれかを確定仕様とすることはしない。** 実装着手前にHQが以下を判断すること:
1. A/B/Cのいずれを採用するか。
2. 旧Backend(v1.15未満)が現在実際にまだ稼働しているか(稼働していなければBのリスクは無関係になり、Bの採用が安全側として成立しやすくなる)。

「`(plan?, nil)`」(planのみ存在)と「`(nil, limits?)`」(limitsのみ存在)はいずれも仕様上の根拠が無いため、**両方とも`.malformedResponse`として確定しない**ことは決定済み(A/B/Cの論点は「両方欠落」のケースのみに関わる)。

---

## §4 Home Prefetchの取得・再取得条件

### 4.1 `HomePrefetchCoordinator`

```swift
private struct Prefetch {
    let userID: UUID
    let homeDate: String
    let homeTimezone: String
    let homeTask: Task<HomeResponse, Error>
    let entitlementsTask: Task<EntitlementsResponse, Error>
    let contextAtDispatch: PlanStore.PlanContext?   // 送信時点のPlanContext。コーディネーターは値を運ぶだけで、
                                                      // 採用可否の判定ロジックは持たない(PlanStoreへの直接依存なし)
    var homeConsumed = false
    var entitlementsConsumed = false
}

func start(userID: UUID, apiClient: APIClient, contextAtDispatch: PlanStore.PlanContext?, now: () -> Date = Date.init) -> Task<HomeResponse, Error> { ... }

func consumeHome(for userID: UUID, date: String, timezone: String) -> (task: Task<HomeResponse, Error>, contextAtDispatch: PlanStore.PlanContext?)? {
    guard var current = prefetch, current.userID == userID, !current.homeConsumed else { return nil }
    current.homeConsumed = true
    prefetch = current
    guard current.homeDate == date, current.homeTimezone == timezone else { return nil }
    return (current.homeTask, current.contextAtDispatch)
}
```

呼び出し元(`SplashViewModel`)は`planStore.confirmedContext`(未確定ならnil)を`contextAtDispatch`として渡す。実際の起動フローでは、`HomePrefetchCoordinator.start()`は`PlanStore.load()`より前に呼ばれるため、**典型的なコールドスタートでは`contextAtDispatch`はほぼ常にnil**になる。この場合、先行取得は再利用されず、`PlanStore`確定後に通常Fetchへフォールバックする(§4.4のケースB/Cと同じ判定ロジックで処理される)。

### 4.2 `HomeViewModel.fetch()`のgeneration管理

**今回(P1-1・P2-4・P3)の位置づけ**: 以下のコードは、現行の実コード(`HomeViewModel.swift`269-330行目、2026-11-16確認)の既存の副作用(診断記録・`recentSpeeches`/`speechesStatus`/`freshDataVersion`/`lastFreshAt`/`displayedCacheSavedAt`/`refreshNotice`/`lastFetchFailed`の更新、`.backendNotConfigured`分岐、`userID`不明時のプリフェッチ・キャッシュ省略)を**すべて引き継いだうえで**、新しいgeneration安全性機構を追加したものである。前回提示したコード例は要点のみの省略形で、これらの既存副作用を明示していなかった(§4.2.2で指摘されたP3の正確性確認により判明)。今回は省略せず全文を示す。

```swift
private var pendingGeneration: Int?
private var lastFetchedGeneration: Int?
private var isFetching = false
// isRefreshingEntitlementsは§4.2.1で宣言(retryNow()専用。fetch()自体は使わない)

private func fetch() async {
    var shouldChainNext = false
    // (今回修正) isFetchingの更新はstartFetchIfNeeded()に一元化した(§4.2.1・P1-1対応)。
    // fetch()自身はisFetchingをセットしない。resetとチェイン起動のみここで行う。
    defer {
        isFetching = false
        if shouldChainNext { startFetchIfNeeded() }   // isFetching=falseの直後、同じdeferの中で呼ぶ
    }
    let today = Self.isoDateFormatter.string(from: now())
    let timezone = TimeZone.current.identifier
    let endpoint = Endpoint(
        path: "home",
        queryItems: [URLQueryItem(name: "date", value: today), URLQueryItem(name: "timezone", value: timezone)]
    )

    // (今回・P2-4対応) userIDが不明(匿名/テスト用途)の場合は、プラン確定状態の検証を
    // 一切行わず、既存コードの挙動(通常のHome取得のみ実行し、キャッシュ保存・先行取得の
    // 利用は行わない)をそのまま維持する。詳細な理由と既存テストへの影響は
    // §4.2.3「userID==nilの仕様(P2-4)」を参照。
    guard let userID else {
        do {
            DiagnosticsStore.shared.beginHomeRequest()
            let response = try await apiClient.send(endpoint)
            applyFetchSuccess(response, today: today, timezone: timezone, userID: nil, plan: nil, fetchedAt: now())
        } catch let error as APIError where error.isNotConfigured {
            state = .backendNotConfigured
            displayedCacheSavedAt = nil
            refreshNotice = nil
        } catch {
            if Task.isCancelled { return }   // §6参照
            applyFetchFailure()
        }
        return
    }

    // 以降はuserIDが判明している通常経路。
    // (今回・P2-4対応) authenticatedUserProviderがnilの場合(本番では常に非nilを渡す設計。
    // §9参照)、このインスタンス単位のライブ一致確認は行わず常に通過させる
    // (既存テストの大半がauthenticatedUserProviderを渡していないため。§11のテスト移行表参照)。
    // authenticatedUserProviderを明示的に渡した場合のみ、実際のライブ比較を行う。
    // (今回・P3-1/P3-2対応) このguardはリクエスト送信前の判定であり、まだ何も取得していないため
    // 「破棄した」と言えるレスポンス自体が存在しない。したがってここでは診断を記録しない
    // (`.userChanged`診断は、送信後に受信時点で判明した場合のみ記録する。下のdo節、§4.5のC-1
    // 参照)。一方、このインスタンスがここで既に無関係と判明した以上、残っている待機・
    // タイムアウトTaskは片付ける(古いインスタンスのタイムアウトが後から診断に混入することを防ぐ)。
    guard (authenticatedUserProvider.map { $0.currentUserID == userID } ?? true) else {
        cancelPlanConfirmationWait()
        return
    }   // 4.5 ケースC-1相当
    guard let context = planStore.confirmedContext, context.userID == userID else {
        scheduleWaitForPlanConfirmation(); return
    }
    let requestSnapshot = (userID: userID, generation: context.generation)

    do {
        let response: HomeResponse
        // P1-1対応: 先行取得が利用できない場合(contextAtDispatchがnil・不一致。典型的な
        // コールドスタートで常に発生する)、ここでは待機し直さない。この行に到達している
        // 時点で、上のguardにより`planStore.confirmedContext`は既に確定済み
        // (`requestSnapshot`として捕捉済み)であるため、確定を待つ理由が無い。
        // 先行取得を単に諦め、検証済みのrequestSnapshotのまま通常Fetchへフォールバックする。
        if let prefetched = prefetchCoordinator.consumeHome(for: userID, date: today, timezone: timezone),
           let dispatchContext = prefetched.contextAtDispatch,
           dispatchContext.userID == requestSnapshot.userID,
           dispatchContext.generation == requestSnapshot.generation {
            response = try await prefetched.task.value
        } else {
            // 既存コードの診断記録(homeRequestCount)を維持する。先行取得を使った場合は
            // 呼ばない(既存コードのコメント参照: 呼び直すとカウントが二重になる)。
            DiagnosticsStore.shared.beginHomeRequest()
            response = try await apiClient.send(endpoint)
        }

        let liveUserID = authenticatedUserProvider.map { $0.currentUserID } ?? requestSnapshot.userID
        let liveContext = planStore.confirmedContext

        if liveUserID != requestSnapshot.userID {
            // ①ユーザーが変わった(nilへの変化=ログアウトも含む)
            DiagnosticsStore.shared.recordHomeFetchDiscarded(reason: .userChanged)
        } else if liveContext == nil {
            // ②同一userIDだがconfirmedContextがnil
            DiagnosticsStore.shared.recordHomeFetchDiscarded(reason: .planUnconfirmed)
        } else if liveContext!.userID != requestSnapshot.userID {
            // ③confirmedContext自体のuserID不一致(想定外・防御的分岐)
            DiagnosticsStore.shared.recordHomeFetchDiscarded(reason: .unexpectedState)
        } else if liveContext!.generation == requestSnapshot.generation {
            // ケースA: 採用。既存コードの副作用をすべて反映する(applyFetchSuccess参照)。
            applyFetchSuccess(response, today: today, timezone: timezone, userID: requestSnapshot.userID, plan: liveContext!.plan, fetchedAt: now())
            lastFetchedGeneration = liveContext!.generation
            if let pending = pendingGeneration, pending > (lastFetchedGeneration ?? Int.min) {
                shouldChainNext = true
            }
        } else if liveContext!.generation > requestSnapshot.generation {
            // ケースB: 正当な追い越し。state/cacheは更新しない。通信成功を活かして直ちに最新を取りに行く。
            if let pending = pendingGeneration, pending > (lastFetchedGeneration ?? Int.min) {
                shouldChainNext = true
            }
        } else {
            // liveContext!.generation < requestSnapshot.generation
            // generationは単調増加のはず(reset()を含めて減少経路が無い)であり、前提違反。
            // ケースBとはせず、.unexpectedStateとして破棄・診断記録のみ。自動連鎖しない。
            DiagnosticsStore.shared.recordHomeFetchDiscarded(reason: .unexpectedState)
        }
    } catch let error as APIError where error.isNotConfigured {
        // (今回・P3対応) 既存コードにあるbackendNotConfigured分岐がこの経路の省略形コードに
        // 欠けていたため復元した。通常の失敗(lastFetchFailed/refreshNotice更新)とは
        // 区別し、Backend未設定の専用stateにする(既存コードと同じ扱い)。
        state = .backendNotConfigured
        displayedCacheSavedAt = nil
        refreshNotice = nil
    } catch {
        if Task.isCancelled { return }   // §6参照
        applyFetchFailure()
        // shouldChainNextはfalseのまま → 自動再試行しない
    }
}

/// (今回・P3対応) 既存コード(269-330行目)の成功時の副作用を、userID不明/判明の2経路で
/// 共通化したもの。state更新・診断記録・recentSpeeches/speechesStatus・キャッシュ関連の
/// 全フィールド更新・freshDataVersionのインクリメント・キャッシュ保存(userIDが有る場合のみ)を、
/// 既存コードと同じ順序・同じ条件で行う。既存コードからの変更点は無い(関数として
/// 切り出しただけ)。
private func applyFetchSuccess(_ response: HomeResponse, today: String, timezone: String, userID: UUID?, plan: String?, fetchedAt: Date) {
    state = .loaded(events: response.events, majorFx: response.majorFx)
    DiagnosticsStore.shared.recordHomeStateApplied()
    recentSpeeches = response.speeches ?? []
    speechesStatus = response.speechesStatus
    lastFetchFailed = false
    displayedCacheSavedAt = nil
    lastFreshAt = fetchedAt
    refreshNotice = nil
    freshDataVersion += 1
    if let userID {
        cacheStore.save(response: response, date: today, timezone: timezone, userID: userID, plan: plan, savedAt: fetchedAt)
    }
}

/// (今回・P3対応) 既存コード(321-329行目)の失敗時の副作用をそのまま切り出したもの。変更点は無い。
private func applyFetchFailure() {
    lastFetchFailed = true
    if case .loaded = state {
        refreshNotice = .refreshFailed(savedAt: displayedCacheSavedAt ?? lastFreshAt)
    } else {
        state = .error("イベント情報の取得に失敗しました。")
    }
}
```

### 4.2.1 `scheduleWaitForPlanConfirmation()` / `retryNow()`の定義

**scheduleWaitForPlanConfirmation()の呼び出し箇所について(P2-1対応)**: 現行のこの設計書の範囲では、`scheduleWaitForPlanConfirmation()`を呼ぶ箇所は**§4.2の`fetch()`内、`guard let context = planStore.confirmedContext, context.userID == userID else { scheduleWaitForPlanConfirmation(); return }`の1か所のみ**である。このguardに到達するのは、`userID`が判明しており(`guard let userID`を通過済み)、かつ`authenticatedUserProvider`のライブ一致確認(省略設定時は常に通過)も通過した後である。そのため、このguardが失敗する(=`scheduleWaitForPlanConfirmation()`が呼ばれる)のは次の2つの場合のみに限定される: (i) `planStore.confirmedContext`そのものがnil(本当に未確定)、(ii) `confirmedContext`は存在するが、そのuserIDが対象userIDと食い違う(想定外・防御的、§4.5のC-3と同種で具体的な再現シナリオは無い)。先行取得が単に利用できない場合(`contextAtDispatch`がnil・不一致)は、P1-1の対応により**このguardに到達する前に**解決しており、呼び出し箇所には含まれない。以前の設計案で検討していた「プリフェッチ判定内から呼ぶ」経路は採用されておらず、呼び出し箇所は増えていない。

```swift
private var isWaitingForPlanConfirmation = false
private var planConfirmationTimeoutTask: Task<Void, Never>?
private var isRefreshingEntitlements = false   // §4.2.2参照

/// fetch()が「プラン文脈が未確定、または対象ユーザーが不明」と判定した場合にのみ呼ぶ
/// (P2-1対応、上記参照。先行取得が単に使えないだけの場合はP1-1の対応により、
/// ここは呼ばれず通常Fetchへフォールバックする)。
///
/// P1-1対応・今回修正: 「確定済みなら即Fetch」という説明と実装の順序を一致させる。
/// 修正前は「既に待機中か」のguardが「確定済みか」の確認より先にあり、既に待機中で
/// PlanStoreが確定済みの場合に即Fetchへ進む経路が実際には実行されなかった。
/// 修正後は、必ず①確定状態の確認 → ②確定済みなら待機・タイムアウトTaskを解除 →
/// ③startFetchIfNeeded()、④未確定の場合のみ重複待機防止のguard → ⑤新規待機という順序にする。
private func scheduleWaitForPlanConfirmation() {
    // ①(今回追加)認証ユーザーとこのインスタンスの対象userIDが一致するかを最初に確認する。
    //   一致しなければこのインスタンス自体が既に古い(fetch()冒頭のケースC-1と同じ考え方)。
    //   待機中であれば片付け、新たな待機・取得も起動しない。
    //   (P2-4対応・§4.2と同じ理由) authenticatedUserProviderがnilの場合はこの確認を
    //   省略し常に通過させる(既存テストの大半が渡していないため)。
    guard (authenticatedUserProvider.map { $0.currentUserID == userID } ?? true) else {
        cancelPlanConfirmationWait()
        return
    }

    if let context = planStore.confirmedContext {
        if context.userID == userID {
            // ②確定済み(対象userIDと一致): 既存の待機・タイムアウトTaskがあれば解除する
            //   (無かった場合もcancelPlanConfirmationWait()は安全に呼べる)。
            cancelPlanConfirmationWait()
            // ③直ちにstartFetchIfNeeded()を呼ぶ。
            startFetchIfNeeded()
        } else {
            // (今回追加)confirmedContext自体のuserIDが対象userIDと食い違う
            //   (想定外・防御的、§4.5のC-3と同種。通常は到達しないはずの状態)。
            //   信頼できない状態のため、待機は維持せず、新たな待機も開始しない。
            DiagnosticsStore.shared.recordHomeFetchDiscarded(reason: .unexpectedState)
            cancelPlanConfirmationWait()
        }
        return
    }

    // ④本当に未確定(confirmedContext == nil)の場合のみ、既存の待機状態を確認して重複待機を防ぐ。
    guard isWaitingForPlanConfirmation == false, planConfirmationTimeoutTask == nil else { return }
    // ⑤新しい待機が必要な場合だけタイムアウトTaskを作成する。
    isWaitingForPlanConfirmation = true
    DiagnosticsStore.shared.recordPlanConfirmationWaitStarted()
    planConfirmationTimeoutTask = Task { @MainActor [weak self] in
        try? await self?.sleep(.seconds(10))
        // (今回・P2-3対応) try?は`sleep`が投げるCancellationError(キャンセルされた場合)を
        // 握り潰すため、ここで明示的にTask.isCancelledを確認する。これが無いと、
        // このTaskが`cancelPlanConfirmationWait()`でキャンセルされた直後に新しい待機
        // (別のTask)が開始された場合でも、この古いTaskの実行自体は(エラーが握り潰されて)
        // 継続してしまい、下の`isWaitingForPlanConfirmation`の確認時点では既に新しい待機の
        // ものに変わっているため、古いTaskが新しい待機の状態を誤って解除してしまう
        // (詳細はP2-3の選択比較を参照)。
        // (今回・追加確認2) guard !Task.isCancelledから下の3行(self.isWaitingForPlanConfirmation
        // の読み取り・2つのプロパティへの代入・診断記録)までの間には`await`が1つも無い。
        // @MainActor上のTaskは次の`await`(サスペンションポイント)まで中断されずに動くため、
        // この一連の処理は他のTask(新しい待機を開始する別のscheduleWaitForPlanConfirmation()
        // 呼び出し等)から割り込まれることなく1つの同期ブロックとして実行される。したがって
        // 「isCancelledの確認」と「状態変更」の間に別のTaskが状態を書き換える競合は生じない。
        guard !Task.isCancelled else { return }
        guard let self, self.isWaitingForPlanConfirmation else { return }
        self.isWaitingForPlanConfirmation = false
        self.planConfirmationTimeoutTask = nil
        DiagnosticsStore.shared.recordPlanConfirmationTimedOut()
        // 既存表示・キャッシュは維持。通信そのものはキャンセルしない。
        // 以後の確定は§4.3のhandlePlanStateChangedが(タイムアウト後であっても)検知する。
    }
}

private func cancelPlanConfirmationWait() {
    isWaitingForPlanConfirmation = false
    planConfirmationTimeoutTask?.cancel()
    planConfirmationTimeoutTask = nil
}

/// Home画面の「再試行」操作から呼ぶ。待機中(プラン確定待ち)なら待機を解除して直ちに
/// Entitlementsを再取得し、確定した場合だけHomeを1回取得する。
func retryNow() {
    guard !isFetching, !isRefreshingEntitlements else { return }
    guard let userID else { return }
    // (今回・P3対応) 以前は`authenticatedUserProvider.currentUserID`を直接`userID`として
    // 使っており、`self.userID`(このインスタンス自身の対象ユーザー)との一致確認が無かった。
    // ログアウト・アカウント切替後に取り残された古いインスタンスの「再試行」ボタンが
    // 誤って別ユーザーのEntitlementsを取得してしまう経路を閉じるため、fetch()・
    // scheduleWaitForPlanConfirmation()と同じ一致確認を追加した。
    // (今回・P3-2/P3-3対応) fetch()・handlePlanStateChanged()と同じ理由で、このインスタンスが
    // 既に無関係と判明した場合は残存する待機・タイムアウトTaskを片付ける(対称性のため)。
    guard (authenticatedUserProvider.map { $0.currentUserID == userID } ?? true) else {
        cancelPlanConfirmationWait()
        return
    }
    cancelPlanConfirmationWait()
    isRefreshingEntitlements = true
    Task {
        defer { self.isRefreshingEntitlements = false }
        let result = await self.planStore.load(
            apiClient: self.apiClient, userID: userID, authenticatedUserProvider: self.authenticatedUserProvider
        )
        if case .confirmed = result {
            // Home取得は§4.3のhandlePlanStateChangedが自動的にトリガーする。
        } else {
            DiagnosticsStore.shared.recordRetryEntitlementsNotConfirmed(result: result)
        }
    }
}
```

**(今回・P3-3対応)`retryNow()`が別ユーザーのEntitlementsを読み込まないことの全経路整理**: 安全性は**2層**で保証される。

1. **`retryNow()`自身のguard(上記コード)**: 呼び出し時点で`self.userID`と`authenticatedUserProvider`のライブな値が不一致なら、`planStore.load()`自体を呼ばずに早期returnする(`authenticatedUserProvider`が`nil`の場合はこの層を素通りする。P2-4対応の既定、本番では必ず実在のproviderが渡る)。
2. **`PlanStore.load()`自身の内部guard(§1.2)**: `retryNow()`のguardを通過した後、`load()`の送信時点(`guard let requestUserID = userID, requestUserID == authenticatedUserProvider.currentUserID else { return .userMismatchOrUnknown }`)・受信時点(`guard requestUserID == authenticatedUserProvider.currentUserID else { return .userMismatchOrUnknown }`)の両方で再検証する。`retryNow()`の呼び出し**後**、`load()`の通信が完了するまでの間にユーザーが変わった場合でも、この層が`.userMismatchOrUnknown`を返し、`commit()`に到達しない(§1.2.3の副作用整理表のとおり、`PlanContext`・`generation`のいずれも変化しない)。

したがって、`retryNow()`単体のguardが素通りされる設定(`authenticatedUserProvider == nil`、テスト環境の既定)であっても、`PlanStore.load()`自身の検証(`authenticatedUserProvider`が`nil`の場合は`.authenticationUnverifiable`を即時返す、§1.2.2)により、誤ったEntitlementsの確定には至らない。**全経路で機能することを確認済み。**

**`authenticatedUserProvider`・`sleep`の型と既定値(P1-1・P2-2・P2-3・P2-4対応)**: `HomeViewModel`の既存コンストラクタ(`HomeViewModel.swift:166-195`)には現状これらのパラメータは存在せず、今回新設する。

```swift
private let authenticatedUserProvider: AuthenticatedUserProviding?
/// (今回・P2-2/P2-3対応) タイムアウト待機のテスト容易性のため、既存の`now: () -> Date`と
/// 同じDIパターンを`Task.sleep`にも適用する。既定値は実際のTask.sleepと同じ挙動。
private let sleep: (Duration) async throws -> Void

init(
    apiClient: APIClient,
    favoritesStore: FavoritesStore = .shared,
    userID: UUID? = nil,
    cacheStore: HomeCacheStore = .shared,
    planStore: PlanStore = .shared,
    prefetchCoordinator: HomePrefetchCoordinator = .shared,
    authenticatedUserProvider: AuthenticatedUserProviding? = nil,
    sleep: @escaping (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
    now: @escaping () -> Date = Date.init
) {
    // ...既存の代入に加え、authenticatedUserProvider・sleepも保持する。
}
```

**`authenticatedUserProvider`を`Optional`にし、nilの場合はライブ一致確認を省略する理由(P2-4対応)**: 本番コード(§9参照)では`MainTabView`→`HomeView`経由で必ず実在の`AppState`(`AuthenticatedUserProviding`)が渡される設計のため、`nil`は実質的に**テスト・プレビュー専用の設定**である。既存の`HomeViewModelTests`・`HomeSpeechesStatusTests`・`HomeCacheTests`はいずれもこのパラメータを渡していない(§11のテスト移行表参照)。`nil`の場合に「常にtrueとして扱う(=このインスタンス単位のライブ一致確認を無効化する)」という既定の挙動にすることで、これらの既存テストに**追加の変更を要求しない**。本番コードは必ず実在のproviderを渡すため、この既定値による安全性の緩和は本番には影響しない。一方、`planStore.confirmedContext`とのuserID一致確認(§4.2のもう一方のguard)はこの既定とは独立しており、`PlanStore`側のuserIDが対象userIDと一致しない限り先には進まない(これは安全性の中核であり、既定で無効化しない)。

**ユーザー整合性の確認(今回追加)**: `planStore.confirmedContext != nil`だけでは「確定済み」の判定として不十分である。`confirmedContext`が存在していても、そのユーザーが現在の認証ユーザー・このインスタンスの対象userIDと一致しているとは限らないため、以下の2点を追加で確認する。

1. **認証ユーザーと対象userIDの一致確認**(①): `authenticatedUserProvider.map { $0.currentUserID == userID } ?? true`(P2-4対応により、`authenticatedUserProvider`が`nil`の場合は常に通過させる。本番では必ず実在のproviderが渡されるため、この既定は本番の安全性に影響しない。§4.2.1末尾の説明を参照)。不一致なら、このインスタンス自体が既に古い(ログアウト・アカウント切替後に取り残された、§10で既知のTask生存期間の論点と同じ状況)。待機・取得のいずれも起動しない。
2. **confirmedContext.userIDと対象userIDの一致確認**(②③の分岐): `context.userID == userID`。一致しなければ、PlanStoreの確定内容自体が対象userIDのものではない(通常は①を通過していれば起こらないはずの、§4.5のC-3と同種の防御的ケース)。待機を維持せず、新たな待機も開始しない。

**不一致時の動作の整理**:

| 状況 | 動作 | 診断 |
|---|---|---|
| 認証ユーザーと対象userIDが不一致(①) | 待機があれば解除。待機・取得のいずれも新設しない | **記録なし**(今回訂正・P3-1対応: `scheduleWaitForPlanConfirmation()`はここでは何も「破棄」していない(送信すら行っていない)ため、ここで`.userChanged`は記録しない。`.userChanged`が記録されるのは§4.2の`fetch()`do節内の受信後判定1か所のみ。§4.3「P3-1対応」の説明を参照) |
| confirmedContext.userIDと対象userIDが不一致(②③) | 待機があれば解除。待機・取得のいずれも新設しない | `recordHomeFetchDiscarded(reason: .unexpectedState)` |
| confirmedContextがnil(本当に未確定) | 重複待機防止のうえ、新規に待機を開始 | `recordPlanConfirmationWaitStarted()` |

**fetch()側の既存guardとの整合性**: `fetch()`冒頭の2段のguard(`authenticatedUserProvider.map { $0.currentUserID == userID } ?? true`、続いて`context.userID == userID`)と、今回`scheduleWaitForPlanConfirmation()`に追加した2段の判定は**同じ2条件(同じnil許容の既定も含む)**を見ている。現在`scheduleWaitForPlanConfirmation()`は`fetch()`からのみ呼ばれるため、呼び出し時点では`fetch()`側の対応するguardを通過済みであり、今回追加した判定は**その時点では必ず真になる**(動作の変化は無い)。それでも追加する理由は、`scheduleWaitForPlanConfirmation()`を将来`fetch()`以外から呼ぶ場合や、`fetch()`自身のguard順序が将来変わった場合に備えて、この関数単体でも安全性が成立するようにするためである(§4.5のC-3同様、具体的な現行の再現シナリオは無い防御的な強化)。

**通常のログイン・ログアウト・アカウント切替での確認**:
- **通常ログイン**: `self.userID`は構築時に現在の認証ユーザーと一致している。`confirmedContext`が未確定の間は④⑤の通常の待機経路に入り、確定後は`handlePlanStateChanged`(§4.3、独立した経路)が検知してFetchを開始する。今回の追加判定はこの経路に影響しない。
- **ログアウト**: `self.userID`(古いインスタンス)はそのままだが、ログアウトにより`authenticatedUserProvider.currentUserID`が変化する。以後`scheduleWaitForPlanConfirmation()`が呼ばれても①で弾かれ、待機があれば片付けられるのみで、誤ったFetchも新たな待機も発生しない。
- **アカウント切替**(A→B、§4.5で確認済みのライフサイクルにより、通常は`HomeViewModel`インスタンスごと再生成される): 古いインスタンス(A)は上記ログアウトと同じ経路で無害化される。新しいインスタンス(B)は構築時の`self.userID`がBであり、通常ログインと同じ経路をたどる。相互に干渉しない。

**既存の待機Taskが残らないことの確認**: 確定済み分岐(②③)および不一致時の分岐(①、confirmedContext.userID不一致)のいずれも`cancelPlanConfirmationWait()`を必ず経由するため、呼び出し前に待機中だった場合でも`isWaitingForPlanConfirmation`は`false`に、`planConfirmationTimeoutTask`は`nil`に戻る。待機していなかった場合も、この呼び出しは単に無変化なので安全(冪等)。

**二重Fetchにならないことの確認**: `startFetchIfNeeded()`自体が`isFetching`の同期的なガードを持つため(§4.2・§4.2.1)、この関数が同じタイミングで複数回呼ばれても、実際にFetchが開始されるのは最大1回。

### 4.2.2 `isRefreshingEntitlements`の必要性(P1-3対応)

**再検討の結論**: 選択肢I(§1.3)を採用する前提でも、**`isRefreshingEntitlements`は維持する**。理由は以下のとおり。

- 正しさ(誤ったデータを掴まないこと)自体は、`entitlementsRequestSequence`による新旧判定だけで既に保証されている。`isRefreshingEntitlements`が無くても、`retryNow()`を連打しても誤った結果が採用されることはない。
- しかし`isRefreshingEntitlements`が無いと、連打のたびに`planStore.load()`(Entitlements通信)が多重に発行され、無駄な通信が発生する。これは安全性の問題ではなく、効率・UXの問題である。

**用途**: `retryNow()`の多重実行(連打)による無駄なEntitlements通信の発行を防ぐための、効率目的のガード。安全性には依存しない。

**更新タイミング**: `startFetchIfNeeded()`の`isFetching`と同じ、同期的なレース対策パターンに従う。`Task {}`生成**前**に同期的に`true`へ設定し、生成したTaskの`defer`で`false`に戻す。`await`を挟んでから設定すると、連打の2回目がガードをすり抜ける可能性があるため、この順序は厳守する。

**競合時の動作**: `retryNow()`実行中(`isRefreshingEntitlements == true`)に再度呼ばれた場合は、黒子的に何もせず即座に返る(`isFetching`中の`startFetchIfNeeded()`と同じ振る舞い)。`fetch()`自身の多重実行防止(`isFetching`)とは別の変数で管理するのは、`retryNow()`がEntitlements通信という`fetch()`とは異なる種類の処理を行うためである。

### 4.2.3 既存API・Combine購読・Fetch起動経路との統合(P1-1対応)

本節は、P1-1で指摘された7点すべてに個別に回答する。`HomeViewModel.swift`(166-330行目、2026-11-16確認)の既存コードを前提とする。

**1. 既存の`$isConfirmed`・`$plan`購読の扱い**: 既存コード(`HomeViewModel.swift:190-194`)は次の形。

```swift
planStore.$isConfirmed.combineLatest(planStore.$plan)
    .sink { [weak self] _ in Task { @MainActor in self?.planConfirmed() } }
    .store(in: &cancellables)
```

`isConfirmed`・`plan`は本設計で**計算プロパティ**になる(§1.2)。計算プロパティは`@Published`の`$`投影を持てない(Combineの前提上、`$`はストアドの`@Published`にのみ生成される)ため、この購読は**そのままでは成立しない**。移行先は、唯一残るストアドの`@Published`である`$state`を購読することである。

```swift
planStore.$state
    .sink { [weak self] state in
        Task { @MainActor in
            self?.planConfirmed()
            self?.handlePlanStateChanged(state)
        }
    }
    .store(in: &cancellables)
```

**2. `planConfirmed()`と`handlePlanStateChanged`のどちらを残すか**: **両方残す**。削除はしない。2つは異なる責務を持つ別個のロジックである。
- `planConfirmed()`(既存、§4.2.3末尾のコード参照): キャッシュの安全性(`cacheStore.discardIfPlanDiffers`)と、`.loading`/`.error`状態からのキャッシュ再表示を担う。generationを一切見ない。
- `handlePlanStateChanged()`(新設、§4.3): generationに基づくHome再取得のトリガーを担う。キャッシュには一切触れない。

既存コードは`$isConfirmed.combineLatest($plan)`という**1つの購読**から`planConfirmed()`だけを呼んでいた。今回`$state`という**1つの購読**に置き換え、そこから**両方**を呼ぶ(上記コード参照)。呼び出し順序は`planConfirmed()`→`handlePlanStateChanged()`で固定し、互いの戻り値・副作用に依存しない独立した処理として扱う(どちらを先に呼んでも結果は変わらないことを実装時に確認すること。§11に追加)。

**3. `load()`・`planConfirmed()`・その他すべてのFetch起動箇所の統一**: 既存コードには2か所のFetch起動がある。

- `load()`(既存210-219行目): `Task { await fetch() }` を**無条件**に実行(`isFetching`を見ない)。
- `planConfirmed()`(既存235-258行目): `if !isFetching { Task { await fetch() } }`。

いずれも`startFetchIfNeeded()`(§4.3新設)に置き換える。

```swift
func load() {
    if case .loaded = state {
        // 表示を残したまま更新する。
    } else if let snapshot = cacheStore.load(for: cacheContext()) {
        applyCache(snapshot)
    } else {
        state = .loading
    }
    startFetchIfNeeded()   // (変更) Task { await fetch() } の直接呼び出しを廃止
}

private func planConfirmed() {
    guard let userID, let plan = planStore.confirmedPlan else { return }
    let discarded = cacheStore.discardIfPlanDiffers(confirmedPlan: plan, userID: userID)
    if discarded {
        guard isShowingCache else { return }
        displayedCacheSavedAt = nil
        refreshNotice = nil
        state = .loading
        if !hasFreshFavorites { favoriteItems = [] }
        startFetchIfNeeded()   // (変更) if !isFetching { Task { await fetch() } } を廃止。
                                //        startFetchIfNeeded()自身がisFetchingを見るため、
                                //        外側のif !isFetchingは不要になった。
        return
    }
    switch state {
    case .loading, .error:
        if let snapshot = cacheStore.load(for: cacheContext()) {
            applyCache(snapshot, refreshFailed: lastFetchFailed && !isFetching)
        }
    case .loaded, .backendNotConfigured: break
    }
}
```

これにより、Fetchを起動する箇所は`load()`・`planConfirmed()`(上記)・`handlePlanStateChanged()`(§4.3)・`scheduleWaitForPlanConfirmation()`(§4.2.1、確定済みの場合)の4か所すべてが`startFetchIfNeeded()`を経由することになり、`isFetching`のガードが一元化される。

**4. `startFetchIfNeeded()`と`fetch()`の責務の明確化**: §4.3で新設する`startFetchIfNeeded()`が`isFetching`の**設定**(`Task`生成**前**に同期的に`true`にする)を担い、`fetch()`の`defer`が**解除**(`false`に戻す)と`shouldChainNext`によるチェイン起動を担う。`fetch()`自身は`isFetching`を**セットしない**(既存コード269-271行目の`isFetching = true` / `defer { isFetching = false }`はこの設計変更により`startFetchIfNeeded()`側に移動する)。この分離により、「誰が`true`にして誰が`false`に戻すか」が1か所の関数ペアに限定され、二重Fetch・誤解除のいずれも構造的に防止される(`fetch()`を直接呼ぶ経路が無くなるため)。

**5. Combine初回通知による`init`直後のFetchと、`load()`による重複Fetchの防止**: `@Published`の`$`投影は購読開始時点の**現在値を即座に1回emitする**。`init`内で`planStore.$state`を購読した瞬間、仮に`planStore`が既に`.confirmed`であれば、`planConfirmed()`・`handlePlanStateChanged()`が`init`の直後(購読設定時点)に1回実行される可能性がある。これと、`HomeView.swift:70`の`.task { viewModel.load() }`によるFetch起動が競合しないことを以下のとおり説明する。

- `handlePlanStateChanged()`が`startFetchIfNeeded()`を呼んだ場合: `isFetching`が同期的に`true`になる。その直後(または直前)に`load()`から`startFetchIfNeeded()`が呼ばれても、`isFetching == true`のguardで即座に無視される。どちらが先でも、実際に走るFetchは最大1回。
- `planConfirmed()`が(`discarded`経由で)`startFetchIfNeeded()`を呼んだ場合も同様。
- `load()`が先に`startFetchIfNeeded()`を呼んだ場合も、後から来るCombine初回通知の`startFetchIfNeeded()`呼び出しは同じ`isFetching`ガードで無視される。

`startFetchIfNeeded()`の`isFetching`ガードが**唯一の排他制御**であり、呼び出し順序(`init`の購読設定とSwiftUIの`.task`起動のどちらが先か)に依存しない。

**6. `confirmedPlan`と`set(plan:limits:confirmed:)`の既存API互換性**: §1.2で`confirmedPlan`(strict、`.confirmed`のときのみ非nil)と`set(plan:limits:confirmed:userID:)`(テスト・プレビュー専用ヘルパー、既存のシグネチャに`userID`パラメータを追加しただけで既存の呼び出し(`userID`省略)もそのままコンパイルが通る)を再設計・復元済み。`HomeViewModel.planConfirmed()`・`cacheContext()`・`HomeCacheStore`(`HomeCacheContext.confirmedPlan`・`discardIfPlanDiffers(confirmedPlan:)`)はいずれも変更なしでそのまま動作する。

**7. 既存の利用箇所とテストの移行対象の一覧化**: §11「実装時の確認事項」に移行表を追加した(P2-4の調査結果と合わせて1つの表にまとめた)。

### 4.3 遅延した古い通知Taskへの対策(★HQ指定の明記事項①)

```swift
private func handlePlanStateChanged(_ state: PlanStore.State) {
    // (今回・P2-4対応) §4.2・§4.2.1と同じ既定(authenticatedUserProviderがnilなら常に通過)。
    // (今回・P3-2対応) このguardもfetch()冒頭と同じ理由で診断は記録しない(PlanStoreの状態変化
    // 通知を受け取っただけで、何かを破棄したわけではない)。ただしこのインスタンスが既に無関係と
    // 判明した場合は、残っている待機・タイムアウトTaskを片付ける(古いインスタンスが
    // 後からタイムアウト診断を出すことを防ぐ)。
    guard (authenticatedUserProvider.map { $0.currentUserID == userID } ?? true) else {
        cancelPlanConfirmationWait()
        return
    }
    guard case .confirmed(let context) = state, context.userID == userID else { return }
    guard context.generation > (lastFetchedGeneration ?? Int.min) else { return }
    pendingGeneration = max(pendingGeneration ?? Int.min, context.generation)   // 後退させない
    cancelPlanConfirmationWait()
    startFetchIfNeeded()
}

private func startFetchIfNeeded() {
    guard !isFetching else { return }
    isFetching = true
    Task { await fetch() }   // fetch()には何も渡さない
}
```

**明記事項①**: `handlePlanStateChanged`の引数`state`は、`pendingGeneration`を更新するかどうかの判断にのみ使用し、**`fetch()`に渡すことは一切しない**。`startFetchIfNeeded()`は引数を取らず、単なる起動トリガーである。`fetch()`は常に**実行時点でライブに`planStore.confirmedContext`を読み直す**ため、どの通知Task(新しいgenerationのものでも古いgenerationのものでも)が実際に`startFetchIfNeeded()`を呼び出すに至っても、実際にネットワーク取得に使われる文脈は常に最新のものになる。この構造により、Combineの`.sink`→`Task { @MainActor in }`という既存パターン(`HomeViewModel.swift:190-194`)が持つ配信順序の不確実性(gen6とgen7の通知Taskが逆順に実行される可能性)があっても、古いgenerationでfetchが実際に開始される経路は構造的に存在しない。

`pendingGeneration`の更新を`max()`で後退させないようにしているのは、gen7の通知Task→gen6の通知Taskという逆順実行があった場合に、`pendingGeneration`がgen7からgen6へ後退し、`lastFetchedGeneration`が最終的にgen7になった後も`pendingGeneration(6)`が永久に古いまま残って不要な再取得を無限に繰り返す、という不具合を防ぐためである。

**(今回・P3-1対応)`.userChanged`診断が記録される経路の正確な整理**: `.userChanged`(§4.5のC-1)が記録されるのは、**§4.2の`fetch()`のdo節内、レスポンス受信後の判定(`if liveUserID != requestSnapshot.userID { DiagnosticsStore.shared.recordHomeFetchDiscarded(reason: .userChanged) }`)1か所のみ**である。これより前にある2つの送信前guard — `fetch()`冒頭の`authenticatedUserProvider`一致確認、`handlePlanStateChanged()`冒頭の同じ確認 — のいずれも、診断を記録せずに`return`する(各ガードのコード中コメント参照)。これらは「取得済みのレスポンスを破棄した」イベントではなく「そもそも取得を試みなかった/通知を処理しなかった」イベントであるため、`.userChanged`という「破棄」を意味する診断と意味合いが異なり、意図的に記録していない。以前の記載(§4.2.1「不一致時の動作の整理」表の脚注)にあった「`.userChanged`としての記録はfetch()側に委ねる」という表現は、どちらの経路を指すか曖昧だったため、上記のとおり1か所に限定して明確化した。

**(今回・P3-2対応)残存する待機・タイムアウトTaskの整理**: `fetch()`冒頭・`handlePlanStateChanged()`冒頭のいずれの一致確認guardも、不一致の場合に`cancelPlanConfirmationWait()`を呼ぶように修正した(§4.2・本節のコード参照。修正前はいずれも単に`return`するだけで、待機状態を片付けていなかった)。これにより、ユーザー切替・ログアウト後に取り残された古いインスタンスに待機中のタイムアウトTaskが残っていた場合でも、これらのguardのいずれかを一度でも通過すれば片付く。**残存リスクとして明記する点**: 古いインスタンスがこれらのguardを一度も通過しないまま放置される経路(例: Combine購読が解放され`handlePlanStateChanged`が一切呼ばれなくなり、かつ`fetch()`も二度と呼ばれない場合)では、タイムアウトTask自体は`Task.sleep`の経過後に自然に完了し`recordPlanConfirmationTimedOut()`を1回記録して終わるため、**無限に残り続けることは無い**(タイムアウトTaskは`self`を弱参照で捕捉しているため、インスタンス自体の解放も妨げない)。この1回分の「古いインスタンスによるタイムアウト診断」が診断ログに混入する可能性は残るが、実害(誤ったデータの採用・無限リソース保持)は無いため、これ以上の対策(例: `deinit`での明示的キャンセル)は本設計の範囲では追加しない(§11に残存事項として記載)。

### 4.4 generation逆行時の`.unexpectedState`処理(★HQ指定の明記事項②)

**明記事項②**: `liveContext.generation < requestSnapshot.generation`という状態(`generation`の単調増加という設計の大前提が崩れている状態)は、**正当な追い越し(ケースB)として扱わない**。ケースBの連鎖処理(`pendingGeneration`に基づく自動的な次取得の開始)を適用せず、`.unexpectedState`として診断ログに記録し、state/cacheは更新せず、**自動連鎖も行わない**(§4.2のコード参照)。前提が崩れた異常状態のまま自動的な動作を継続させないことが目的であり、次に動作するのは新たな正規の確定イベントか、ユーザーの明示的な再試行のみである。

### 4.5 認証ユーザー変更時の破棄条件(4区分)

| 区分 | 条件 | state/cache | 次fetch | 診断理由 |
|---|---|---|---|---|
| C-1 ユーザーが変わった | `liveUserID != requestSnapshot.userID`(nilへの変化含む) | 更新しない | 開始しない | `.userChanged` |
| C-2 同一userIDだがconfirmedContextがnil | `liveUserID == requestSnapshot.userID && liveContext == nil` | 更新しない | 開始しない | `.planUnconfirmed` |
| C-3 confirmedContextのuserID不一致(防御的、具体的な再現シナリオは無い) | `liveContext.userID != requestSnapshot.userID` | 更新しない | 開始しない | `.unexpectedState` |
| B 正当な追い越し | `liveContext.generation > requestSnapshot.generation`(かつuserID一致) | 更新しない | pendingGeneration次第 | - |
| generation逆行(§4.4) | `liveContext.generation < requestSnapshot.generation`(かつuserID一致) | 更新しない | 開始しない(自動連鎖なし) | `.unexpectedState` |

`.userChanged`はC-1のみに使用し、C-2・C-3には使用しない。

### 4.6 Home Prefetchの実効性の再検討(HQ判断待ち)

典型的なコールドスタートでは`contextAtDispatch`がほぼ常にnilとなり(§4.1)、先行取得した`/home`レスポンスがほとんど再利用されないという構造的な制約がある。これを踏まえ、3つの方向性を比較する。**いずれの案でも、安全性を犠牲にして先行取得を再利用する設計(未確定時点のcontextAtDispatchを無条件に信頼する等)は採用しない。**

| 案 | 内容 | 安全性 | 通信回数 | 起動時間への影響 |
|---|---|---|---|---|
| **1. 現行方式を維持** | `HomePrefetchCoordinator.start()`を認証復元直後(PlanStore確定前)に呼ぶまま | 高い(未確定時点のcontextAtDispatch=nilは既存の仕組みで常に破棄される) | 無駄になる先行取得の通信が1回発生する(破棄されても通信自体は行われる) | 典型的なコールドスタートでは実質的な高速化効果が無い(PlanStore確定後に通常のHome取得が改めて走り、Render Freeのコールドスタート待ち(実測約20秒)を再び待つ) |
| **2. Prefetchの開始タイミングをPlanStore確定後に変更** | `HomePrefetchCoordinator.start()`の呼び出し位置を、`PlanStore.load()`の完了後に移す | 送信時点で既にPlanStoreが確定済みのため、「未確定のまま送信される」という現在の主要な破棄理由自体が構造的に発生しなくなる | 無駄な先行取得が無くなる分、減る可能性がある。Splashの起動シーケンス全体の見直し(既存の`DiagnosticsStore`計測ポイントへの影響含む)が必要 | PlanStore確定(`/entitlements`の通信時間)だけHome取得の開始が遅れ、「先行」取得としての本来の目的(Render Freeのコールドスタート待ちを他の処理と並行させる)を一部損なう可能性がある。`/entitlements`・`/home`それぞれの実測時間は本資料作成時点で未測定(§11「未検証」参照) |
| **3. Home Prefetch自体を見直す(Backend側に計算文脈を返させる)** | `/home`レスポンス自体に計算文脈(例: `computed_for_plan`)を含めるようBackend側APIを変更し、送信タイミングに関わらず受信後にその場で検証する | 最も高い(受信後に実際の計算文脈を直接確認できるため、タイミングに依存しない) | 先行取得の恩恵を活かしつつ安全性も確保できる可能性が高い | 案1の「遅い」という欠点を解消できる唯一の案。ただしBackend側のAPI変更が必要(今回のスコープ外、別途の設計・承認が必要) |

**最終判断はHQに委ねる。** 独自に1案を確定仕様とすることはしない。

---

## §5 HomeCacheStoreの保存・破棄条件

- 単一UserDefaultsキー(`HomeCacheStore.swift:48`)に1件だけ保存。ユーザーごとに別キーを持つ設計ではない。
- `load(for:)`(61-78行目)は`context.userID`がnilなら即`nil`を返し(キャッシュを出さない)、非nilの場合は`snapshot.userID == userID`・`formatVersion`・`date`・`timezone`の一致を確認、不一致なら`clear()`して`nil`を返す。さらに`context.confirmedPlan`がnilなら(未確認)出さずに`nil`を返し(`clear()`はしない)、プランが一致しなければ`clear()`して`nil`を返す。
- **(今回・P3-4対応、実コードとの照合により訂正)** `save()`/`saveFavorites()`/`discardIfPlanDiffers()`は**それぞれ異なる**userID検証を行う。一律に「検証しない」とした以前の記載は不正確だったため訂正する。
  - **`save()`(82-98行目)**: 呼び出し時の`userID`引数を**検証せず、そのまま信じて書き込む**(渡された値が本当に現在のユーザーのものかは確認しない)。既存の`previous?.userID == userID`比較は、お気に入りを引き継ぐかどうかの判定にのみ使われ、安全性の検証ではない。安全性は、呼び出し元(`fetch()`のケースA限定、§4.2)が正しい`userID`を渡すことに完全に依存する。
  - **`saveFavorites()`(101-105行目)**: `guard var snapshot = stored(), snapshot.userID == userID else { return }` — **保存済みスナップショットのuserIDと引数のuserIDが一致する場合のみ**更新する。不一致なら何もしない(他ユーザーのキャッシュを上書きしない、という検証が既にある)。
  - **`discardIfPlanDiffers()`(109-126行目)**: `guard let userID, snapshot.userID == userID else { clear(); return true }` — **userIDがnil、またはスナップショットのuserIDと不一致なら、キャッシュ全体を`clear()`する**(破棄したことを示す`true`を返す)。これも既存の検証である。
- `AppState.leaveLoggedIn()`が`homeCache.clear()`を同期的に呼ぶため、ログアウトの瞬間にキャッシュは確実に消去される(35-40行目)。
- **残存リスク(訂正版)**: `save()`のみ、呼び出し時の`userID`引数自体の正しさを検証しない。`fetch()`側のケース判定(§4.2)にバグが入り、誤った`userID`を`save()`に渡してしまうと、`HomeCacheStore`側ではそれを検知できない。一方`saveFavorites()`・`discardIfPlanDiffers()`は既存のガードにより、他ユーザーのキャッシュを誤って書き換える・古いプランのキャッシュを誤って残す、という事態はある程度自己防御されている。

---

## §6 通信失敗・キャンセル時の扱い

- `APIClient.swift`(132-146行目)は`URLError.cancelled`等を含むあらゆるエラーを`APIError.transport(String)`に変換し、型情報を失う。したがって`catch is CancellationError`ではキャンセルを検知できない(確認済みの不具合)。
- 代わりに**`Task.isCancelled`を`catch`ブロック内で確認する**方式を採用する(§4.2のコード参照)。キャンセルの場合は失敗表示(`refreshFailed`/`.error`)を出さず、状態を変更しない。
- 自動再試行はキャンセル・通常失敗のいずれでも行わない(`shouldChainNext`を立てない)。
- **現状との関係**: 現在のコードベースのどこにも`.cancel()`の呼び出しは存在しないため、この分岐は現時点では到達しない。将来の明示的キャンセル実装に備えた設計である。

---

## §7 Diagnosticsの記録条件

| メソッド(新規提案) | 記録タイミング |
|---|---|
| `recordEntitlementsDiscarded(reason:)` | `PlanStore.load()`が`.supersededByNewerRequest`/`.userMismatchOrUnknown`/`.malformedPlanLimitsCombination`のいずれかで確定を見送った時 |
| `recordHomeFetchDiscarded(reason:)` | `HomeViewModel.fetch()`が`.userChanged`/`.planUnconfirmed`/`.unexpectedState`のいずれかで破棄した時 |
| `recordPlanConfirmationWaitStarted()` / `recordPlanConfirmationTimedOut()` | 待機(10秒タイムアウト)の開始・タイムアウト時 |
| `recordRetryEntitlementsNotConfirmed(result:)` | `retryNow()`のEntitlements取得が`.confirmed`以外で終わった時 |

**(今回・追加確認1対応)実装方法とテスト読み取り手段について**: `DiagnosticsStore.swift`(2026-11-16確認)を実際に読んだ結果、現行の`DiagnosticsStore`には上記の新規メソッドに対応する汎用カウンタ機構は**存在しない**(`LaunchDiagnostics`は起動シーケンス計測専用の個別フィールドのみを持ち、`beginHomeRequest()`等の既存メソッドもすべて専用フィールドへの個別代入である)。したがって上記4メソッドを実装する際は、既存パターンと同じ要領で**`LaunchDiagnostics`に対応する専用フィールド(カウンタ)を追加し、各メソッド内でそのフィールドを更新する**こと。`current`プロパティは`@Published private(set)`として既に外部から読み取り可能(起動診断画面が読むため)なので、テストは`DiagnosticsStore.shared.current.<新設フィールド>`を直接読むだけで検証でき、**テストのためだけの新規APIを追加する必要は無い**(§8テスト29〜32の間接検証はこの前提で成立する)。新設フィールドの命名・型は実装時に`LaunchDiagnostics`の既存命名規則に合わせて決定すること。

---

## §8 テストケース一覧

**正常系**
1. 通常Fetch(先行取得未使用)が成功し、state/cacheが更新される。
2. 先行取得が送信・利用・受信の全時点で同一generationのまま一致し、採用される。
3. gen5取得中にgen6が確定、通信成功→gen6へ直ちに追い越し取得。
4. gen5→6→7と連続確定、通信成功→最終的に7のみ取得(6は個別に取得しない)。
5. 同一Entitlementsの再確定(generationが進まない)→不要な再取得が起きない。
6. plan=.pro, limits=非nilの通常レスポンス(両方存在)→確定。

**異常系**
7. 先行取得が送信時点でプラン未確定(nil)→破棄、確定後に一度だけFetch。
8. ユーザーA→Bへの切り替え中にAの古いレスポンスが到着→破棄、Bのstate/cacheは上書きされない。
9. gen5取得中にgen6確定、通信失敗→自動再試行しない。gen6は次の正規契機で取得される。
10. gen5取得中にキャンセル(`Task.isCancelled`)→失敗表示を出さず、自動再試行しない。
11. gen6取得中に同一Entitlementsが再確定→二重取得が起きない。
12. `liveContext.generation < requestSnapshot.generation`(前提違反)→`.unexpectedState`で破棄、自動連鎖しない。
13. `plan=非nil, limits=nil`(planのみ存在)→`.malformedResponse`、確定しない。
14. `plan=nil, limits=非nil`(limitsのみ存在)→`.malformedResponse`、確定しない。
15. `plan=nil, limits=nil`(両方欠落)→`.pendingPolicyDecision`を返し、PlanContext・generation・Home state/cacheのいずれも変更しない。§3のA/B/Cいずれを採用するかHQ判断が確定するまで、実際の確定処理は実装しない。
16. `retryNow()`実行中に通常loadが先に確定→Home取得は1回だけ発生し、`retryNow()`側は重複して取得しない。
17. 同一ユーザーの古いEntitlementsレスポンスが新しいレスポンスより後に到着→`entitlementsRequestSequence`により古い方が破棄される。
18. ログアウト・アカウント切替によって進行中の`load()`/`fetch()`が無効化される。
19. **(P0-2対応・副作用も検証)** `userID=nil`で`load()`が呼ばれる→戻り値が`.userMismatchOrUnknown`であることに加え、次の副作用が**すべて発生しないこと**を検証する: (a) 呼び出し前に既存の確定済み`PlanContext`があった場合、それが`.unconfirmed`に変化しない、(b) `generation`が変化しない、(c) `entitlementsRequestSequence`が増加しない、(d) この呼び出しと同時に進行中の別の正当な`load()`呼び出し(有効なuserIDを持つもの)が、この呼び出しによって`supersededByNewerRequest`として無効化されない。
19-2. **(P0-2対応・追加)** `authenticatedUserProvider=nil`で`load()`が呼ばれる→戻り値が`.authenticationUnverifiable`であることに加え、テスト19と同じ(a)〜(d)の副作用が発生しないことを検証する。
19-3. **(P0-2対応・追加)** 有効な`userID`・`authenticatedUserProvider`を指定したが、`userID`が`authenticatedUserProvider.currentUserID`と一致しない→`.userMismatchOrUnknown`を返し、同様に(a)〜(d)の副作用が発生しないことを検証する。
20. (§1.3関連・選択肢I採用時)同一ユーザーのEntitlements再確認(購入後)が進行中にHome通信が先に完了→一旦古い内容でコミットされるが、再確認完了後に自動的に1回の追い越し取得で最新に収束する。
21. (§1.3関連)通常のEntitlements再確認(内容変化なし)が、進行中のHome取得と重なっても、generationが進まないため余分なHome取得は発生しない。
22. (§4.6関連・案2採用時)Prefetch開始タイミングをPlanStore確定後に変更した場合、`contextAtDispatch`が常に非nilになり、先行取得が正しく再利用される。
23. **(P1-1対応)** コールドスタートを模した典型的なケース(`contextAtDispatch == nil`、ただし`fetch()`実行時点では`planStore.confirmedContext`は既に確定済み)で、`fetch()`が待機状態に入らず、直ちに通常Fetch(`apiClient.send(endpoint)`)へフォールバックし、Home取得が停止しないことを検証する。
24. **(P1-1対応)** `scheduleWaitForPlanConfirmation()`が、呼ばれた時点で既に`planStore.confirmedContext`が確定済みの状態で呼ばれた場合、新たな待機状態(`isWaitingForPlanConfirmation`・タイムアウトTask)を作らず、直ちに`startFetchIfNeeded()`が呼ばれることを検証する。
25. **(P1-3対応)** `retryNow()`を短時間に連打した場合、`isRefreshingEntitlements`により2回目以降は無視され、Entitlements通信は1回だけ発行されることを検証する。
26. **(今回・generation初回更新)** 初回起動(`confirmedUserID == nil`からの初回確定)で、`load()`呼び出し**前**の`generation`の値を記録し、`load()`成功後の`generation`がその値から**ちょうど1増えている**ことを検証する(修正前は2増えていた)。
27. **(今回・generation初回更新、具体化)** 次の3時点で`generation`の値を記録し、比較する: (a) ユーザーAとして確定済みの状態での`generation`の値、(b) `reset()`呼び出し**直後**(ログアウト、`state`が`.unconfirmed`になった時点)の`generation`の値、(c) 再ログイン後の`load()`成功(再確定)時点の`generation`の値。期待する関係: `(b) == (a) + 1`(`reset()`自身の規則5による1回の加算)、`(c) == (b) + 1`(再確定の`commit()`規則1による1回の加算)。すなわち合計では(a)から(c)まで2回進むが、**それぞれ別の操作(`reset()`と再確定)による、それぞれ1回ずつの加算**であり、どちらか一方の操作だけで2回進むことはないことを検証する。
28. **(今回・再具体化)** ユーザーAとして確定済みの状態から`reset()`を呼ばずに直接ユーザーBの`userID`で`load()`を呼ぶ。「通信完了前にstateが`.unconfirmed`になっている」ことを**確実に(タイミング依存のない形で)**検証するため、次の手順で通信待ち状態を明示的に作る: (i) `EntitlementsService`/`APIClient`のモックを、応答を即座に返さず`CheckedContinuation`(または同等の、テストコードが明示的に`resume`するまで`await`が完了しない仕組み)で保留する実装にする、(ii) `load()`をTaskとして開始する(`await`しない)、(iii) モックが実際に呼ばれ`await`で保留された時点(継続が保持されたことをテスト側で確認できた時点)で、`planStore.state`が`.unconfirmed`であることを検証する — この時点では通信はまだ完了していないことが、モックの継続が未解決であることによって**構造的に保証**されている(実行タイミングの偶然に依存しない)、(iv) `load()`呼び出し**前**に記録しておいた`generation`の値を保持しておく、(v) 継続を`resume`してモック応答を返し、`load()`の完了を`await`する、(vi) 完了後の`generation`が(iv)の値から**ちょうど1増えている**ことを検証する(修正前は2増えていた)。
29〜31(P2-2・P2-3対応により全面再設計)。

**private状態の検証方法の選択(P2-2対応)**: `isWaitingForPlanConfirmation`・`planConfirmationTimeoutTask`はいずれも`private`であり、`commit()`の規則6(§1.2.1)と同じ理由で、`@testable import`でも外部から直接読めない。3つの方法を比較する。

| 方法 | 内容 | 採否 | 理由 |
|---|---|---|---|
| (a) internal観測口 | `private`を`private(set)`付きの`internal`等に緩和し、テストから直接読む | **不採用** | HQ指示「テストのためだけに不必要な本番APIを公開しない」に反する。これら2つのプロパティを外部に見せる実用上の理由(本番コードの他の場所からの参照)が無い |
| (b) テスト用依存注入 | 待機・タイムアウトの仕組みそのものを差し替え可能にする | **部分的に採用** | §4.2.1で追加した`sleep: (Duration) async throws -> Void`の注入(P2-3のタイムアウト競合対策のために必要となったDI)を、ここでも**決定性の確保のためだけに**流用する。新たな抽象(待機機構そのものの差し替え)を追加するのは過剰(不要な設計変更)と判断し、既存のDIパターン(`now: () -> Date`と同列)の自然な拡張にとどめる |
| (c) モックによる間接検証 | `private`な内部状態を一切読まず、外部から観測可能な副作用(`startFetchIfNeeded()`が実際にFetchを起動したかどうか=`APIClient`モックへの呼び出し回数、および診断記録)だけで判定する | **主採用** | 本番APIを一切追加・緩和しない。「待機が既にあるかどうか」は`recordPlanConfirmationWaitStarted()`の呼び出し回数(1回のまま増えない=重複防止が効いている)、「Fetchが開始されたか」は`APIClient`モックの呼び出し回数、で代替できる |

**前提として確認が必要な事項(未検証、§11に追加)**: 上記(c)が成立するには、`DiagnosticsStore`側がテストから呼び出し回数を検証できる手段(内部カウンタの直接参照、またはテスト用のリセット・読み取りメソッド)を既に持っているか、少なくとも`internal`アクセスレベルで公開されている必要がある。本資料の範囲では`DiagnosticsStore.swift`の該当箇所を未読のため、これを前提として断定することはできない。**実装時に`DiagnosticsStore`の既存の読み取り手段を確認し、無ければ「このテストのためだけの新規API」を追加するのではなく、既存の診断カウンタ公開方針(起動診断画面が読む仕組みと同じもの)に沿って対応すること。**

以上の方針に基づき、テスト29〜31を次のように再設計する。

29. **(今回・再設計)** 前提: `planStore.confirmedContext`が未確定(nil)の状態から`scheduleWaitForPlanConfirmation()`を1回呼ぶ(待機開始)。続けて、まだ確定しないまま`scheduleWaitForPlanConfirmation()`を**再度**呼ぶ(重複呼び出し)。検証: `recordPlanConfirmationWaitStarted()`の呼び出し回数が**1回のまま**であること(2回目の呼び出しで新たな待機が作られていないことを、呼び出し回数という外部から観測可能な副作用で確認する。§4.2.1④のguardが正しく機能していることの間接証拠)。
30. **(今回・再設計、旧テスト29相当)** 前提: `scheduleWaitForPlanConfirmation()`を呼んで待機を開始させた後、`planStore.set(plan:, limits:, confirmed: true, userID: userID)`で確定させる(`PlanStore.confirmedContext`が対象`userID`と一致する状態になる)。この状態で`scheduleWaitForPlanConfirmation()`を再度呼ぶ。検証: (a) `recordPlanConfirmationTimedOut()`が記録**されない**こと(= 元のタイムアウトTaskが正しくキャンセルされ、無駄なタイムアウト処理が走らなかったことの間接証拠。検証のため、注入した`sleep`は実時間より十分長く設定し、テスト自体はタイムアウトを待たずに完了させる)、(b) `APIClient`モック(または`HomePrefetchCoordinator`経由)への`/home`相当の呼び出しが1回発生すること(`startFetchIfNeeded()`が呼ばれ、実際にFetchが開始されたことの間接証拠)。
31. **(今回・再設計、旧テスト30+31相当)** 前提: `scheduleWaitForPlanConfirmation()`を呼んで待機を開始させた状態で、(i) 対象ユーザーが変わった場合(`authenticatedUserProvider`に対象と異なる`currentUserID`を返すモックを明示的に渡す)、(ii) `planStore.confirmedContext`のuserIDが対象userIDと食い違う場合、の2パターンそれぞれで`scheduleWaitForPlanConfirmation()`を再度呼ぶ。検証: いずれのパターンでも、(a) `APIClient`モックへの呼び出しが発生しない(誤ったFetchが開始されない)こと、(b) (ii)のパターンでは`recordHomeFetchDiscarded(reason: .unexpectedState)`が記録されること。

**P2-3対応・タイムアウトTaskのキャンセル競合テスト(新規、32番として追加)**:

32. **(今回・P2-3対応、新規)** 注入した`sleep`を、テストコードが明示的に`resume`するまで完了しない`CheckedContinuation`で実装し(テスト28と同じ手法)、次の手順でキャンセル競合を再現する: (i) 1回目の`scheduleWaitForPlanConfirmation()`を呼ぶ(待機#1開始、タイムアウトTask#1がsleep#1で保留される)、(ii) `planStore`を対象userIDで確定させ、`scheduleWaitForPlanConfirmation()`を再度呼ぶ(§4.2.1②の経路、`cancelPlanConfirmationWait()`によりTask#1に`.cancel()`が呼ばれるが、`try?`がこれを握り潰すため、sleep#1が**まだresumeされていない**時点ではTask#1はまだ`guard !Task.isCancelled`の行に到達していない)、(iii) `startFetchIfNeeded()`経由のFetchが1回開始されたことを確認後、ただちにもう一度未確定状態に戻し`scheduleWaitForPlanConfirmation()`を呼ぶ(待機#2開始、タイムアウトTask#2がsleep#2で保留される)、(iv) ここでsleep#1を`resume`する(Task#1の`try? await self?.sleep(...)`が完了し、`guard !Task.isCancelled`の行に到達する)。検証: Task#1は`.cancel()`されているため`Task.isCancelled`が`true`になっており、`guard !Task.isCancelled else { return }`で**即座にreturnし、待機#2の状態(`isWaitingForPlanConfirmation`・`planConfirmationTimeoutTask`)を一切変更しない**ことを、`recordPlanConfirmationTimedOut()`が**記録されない**こと(Task#1は`isWaitingForPlanConfirmation = false`等の副作用に到達しないため)、かつ(v) その後sleep#2も`resume`し、待機#2のタイムアウト処理が正常に完了し`recordPlanConfirmationTimedOut()`が記録されることを確認し、待機#2自体は正しく機能していることを示す。

**P2-4対応・`userID == nil`のテスト(新規、33番として追加)**:

33. **(今回・P2-4対応、新規)** `HomeViewModel(apiClient:)`(`userID`省略、既存の`HomeViewModelTests`・`HomeSpeechesStatusTests`と同じ構成)で`load()`を呼ぶ。検証: (a) `planStore`の確定状態に関わらず(未確定のままでも)`fetch()`が`scheduleWaitForPlanConfirmation()`を呼ばずに直ちに`apiClient.send(endpoint)`を実行し、`state`が`.loaded(...)`になること(既存コードと同じ挙動が維持されていることの確認。§4.2.3参照)、(b) `cacheStore.save()`が呼ばれない(`userID`が無いため)こと、(c) 既存の`HomeViewModelTests`・`HomeSpeechesStatusTests`がこの変更後も無修正で成立すること(§11のテスト移行表参照)。

---

## §9 実装対象ファイル

| ファイル | 変更内容 |
|---|---|
| `PlanStore.swift` | `State`(`.unconfirmed(lastKnown:)`への変更、P1-1対応)/`PlanContext`/`LoadResult`の追加、`load()`/`reset()`/`set()`/`confirmedPlan`の刷新、`AuthenticatedUserProviding`の定義 |
| `HomePrefetchCoordinator.swift` | `Prefetch.contextAtDispatch`への変更、`start()`/`consumeHome()`のシグネチャ更新 |
| `HomeViewModel.swift` | `authenticatedUserProvider`(Optional)/`sleep`(P2-2・P2-3対応のDI)/`pendingGeneration`/`lastFetchedGeneration`/`isRefreshingEntitlements`の追加、`init`内のCombine購読を`$isConfirmed.combineLatest($plan)`から`$state`へ変更(P1-1対応・§4.2.3)、`fetch()`(`applyFetchSuccess`/`applyFetchFailure`への分割含む)/`load()`/`planConfirmed()`/`handlePlanStateChanged()`/`startFetchIfNeeded()`/`retryNow()`/`scheduleWaitForPlanConfirmation()`の刷新 |
| `SubscriptionManagementViewModel.swift` | `authenticatedUserProvider`の受け取り、`sync()`内のuserID取得・診断分離(`try?`での握り潰しを廃止) |
| `AppState.swift` | `extension AppState: AuthenticatedUserProviding {}`の追加のみ |
| `RootView.swift` | `PlanStore.shared.load(...)`・`MainTabView`生成に`authenticatedUserProvider: appState`を追加 |
| `MainTabView.swift`・`HomeView.swift` | `authenticatedUserProvider`の配線(`HomeViewModel`まで伝搬) |
| `PlaceholderScreenView.swift`・`PlanLimitPrompt.swift`・`SubscriptionManagementView.swift` | `authenticatedUserProvider`配線(`SubscriptionManagementView`の生成箇所2か所) |
| `DiagnosticsStore.swift` | §7の記録メソッド追加。P2-2対応のテスト用カウンタ読み取り手段の有無を実装時に確認(無ければ既存方針に沿って追加、§11参照) |
| `PlanStoreTests.swift` | `testLoadWithoutAUserIDBehavesAsBefore()`の期待値反転(`.userMismatchOrUnknown`を返し確定しない。§8テスト19の副作用検証を追加)。`limits: nil`を使う既存モック4件(前回確認済み)の見直し。§1.2.3の副作用テスト(§8テスト19/19-2/19-3)の新規追加。79-85行目の`set(plan:, limits:, confirmed: false)`呼び出しは`State.unconfirmed(lastKnown:)`化後もシグネチャ変更無しでそのまま動作することを確認(§1.2・P2-4対応) |
| `HomeCacheTests.swift` | `makeViewModel`ヘルパー(549-558行目)が`plan`省略時に生成する`PlanStore()`への`set(plan:, limits:)`呼び出しに、ヘルパー自身の`userID`パラメータをそのまま渡すよう変更(P1-1・P2-4対応、§11のテスト移行表参照。現状は`userID`を渡していないため、本設計の`fetch()`の新しいuserID一致guardにより`.confirmed`と判定されず、既存テストが新たに失敗する) |
| `HomeViewModelTests.swift`・`HomeSpeechesStatusTests.swift` | （P2-4対応）`userID`を渡さない既存の構成(`HomeViewModel(apiClient:)`)は、§4.2.3の`userID == nil`早期分岐によりコード変更不要で成立する見込み。テスト33(§8)で回帰を確認すること |
| `CalendarViewModelTests.swift`・`EventDetailViewTests.swift` | (P2-4調査・変更不要の見込み)`PlanStore()`/`PlanStore.shared`を`HomeViewModel`と組み合わせずに直接読む構成のため、`set()`のシグネチャ・既定値変更の影響を受けない(§11のテスト移行表参照) |

---

## §10 実装時の注意点・残存リスク

- **§3(plan/limits両方欠落時の扱い)はHQ判断が確定するまで実装に着手しないこと。**
- `AuthenticatedUserProviding`プロトコルに`@MainActor`を付与することは、本設計の**必須条件**である(§1.2参照。推奨ではない)。実装時は必ずこの宣言で行うこと。
- `authenticatedUserProvider`の配線は、`MainTabView`→`HomeView`/`PlaceholderScreenView`/`PlanLimitPrompt`→`SubscriptionManagementView`という複数ファイルにわたる変更であり、各ファイルの既存init構造(メンバーワイズ初期化か明示initか)を実装時に個別に確認すること。
- `HomeCacheStore.save()`自体にユーザー整合性検証を追加しない方針とした(§5)。`fetch()`側のケース判定ロジックに将来バグが入った場合、`HomeCacheStore`はそれを検知できないという残存リスクを明記する。
- `HomeViewModel`のインスタンスは、ログイン・ログアウト・アカウント切替では確実に再生成されることを確認済み(タブ切替・画面回転・カレンダータブ初回訪問では再生成されない)。ただし`HomeView.swift`は1728行中、ライフサイクルに関わる先頭84行のみを確認しており、残り約900行(カード・バッジ等の見た目実装)は未読のため、他の再生成経路が無いことの完全な保証ではない。
- `Task { await fetch() }`は`self`を強参照で捕捉するため、View階層破棄後も進行中のTaskが完了するまで古い`HomeViewModel`インスタンスはメモリ上に残る。データの安全性には影響しないが、`[weak self]`化による早期解放の余地は残る。
- `.task { viewModel.load() }`(`HomeView.swift:70`)は`await`を伴わない同期呼び出しであり、SwiftUIの`.task`の自動キャンセルは`fetch()`の実際のTaskには及ばない(§0・§6参照)。
- `retryNow()`が`entitlementsRequestSequence`の競合で敗れた場合、ユーザーの明示操作の直接的な結果としては何も起きないことがある(勝った側の確定を`handlePlanStateChanged`が検知してHome取得につながるため、データの正しさは保たれるが、即時性に非対称なタイミングが生じうる)。
- (§1.3)同一ユーザーのEntitlements再確認(特に購入・復元直後)が進行中にHome取得が完了すると、再確認完了までの短い時間窓で古いプランの内容が一瞬表示・キャッシュされる可能性がある(選択肢I採用時の既知の残存特性。選択肢IIを採用する場合はこのリスクは軽減されるが、新たな競合状態の検証コストが増える)。
- (§4.6)案2(Prefetch開始タイミング変更)・案3(Backend側の計算文脈エコー)はいずれも、本資料の範囲では具体的な実測・Backend設計を行っていない。採用判断後、別途の実測・設計作業が必要になる。
- **(今回・P3対応)** §4.2の`fetch()`は、既存コード(`HomeViewModel.swift`269-330行目)の副作用(診断記録・`recentSpeeches`/`speechesStatus`/`freshDataVersion`/`lastFreshAt`/`displayedCacheSavedAt`/`refreshNotice`/`lastFetchFailed`の更新、`.backendNotConfigured`分岐)を**すべて引き継いでいる**ことを§4.2で確認済み(`applyFetchSuccess`/`applyFetchFailure`への切り出しとして明示)。実装時は、この資料のコード例ではなく実際の`HomeViewModel.swift`の該当範囲を直接見比べ、見落としが無いことを再確認すること。
- **(今回・P3対応)** `retryNow()`に、このインスタンス自身の`userID`と`authenticatedUserProvider`のライブな値との一致確認を追加した(§4.2.1)。修正前は`authenticatedUserProvider.currentUserID`を直接使っており、取り残された古いインスタンスの「再試行」が別ユーザーのEntitlementsを取得しうる経路があった。
- **(今回・P1-1対応)** `init`内のCombine購読を`$isConfirmed.combineLatest($plan)`から`$state`に変更し、`planConfirmed()`・`handlePlanStateChanged()`を同じ購読から呼ぶ(§4.2.3)。この2つの呼び出し順序(`planConfirmed()`→`handlePlanStateChanged()`)に実際の依存関係が無いことは設計上の意図だが、実装時に単体テストで両方の呼び出し順を入れ替えても結果が変わらないことを明示的に確認すること(§11に追加)。
- **(今回・P2-2/P2-3対応)** `sleep: (Duration) async throws -> Void`のDIを追加した。本番の既定値(`{ try await Task.sleep(for: $0) }`)がキャンセル伝播を含めて実際の`Task.sleep`と同じ挙動であることを実装時に確認すること。

---

## §11 未決定事項の完全な一覧

### HQ判断待ち(A独自に確定しない)

| 項目 | 参照 |
|---|---|
| plan=nil && limits=nilの確定方針(選択肢A/B/C) | §3 |
| 旧Backend(v1.15未満)が現在も稼働しているか | §3 |
| 同一ユーザーのEntitlements再確認とHome取得の競合への対応(選択肢I/II)、および①②③④のどこまでを許容範囲とするか | §1.3 |
| Home Prefetchの方向性(案1/2/3のいずれを採用するか) | §4.6 |
| `HomeCacheStore.save()`自体にユーザー整合性検証を追加するかどうか | §5・§10 |
| `retryNow()`競合敗北時の即時性の非対称性を許容するか | §10 |

### 未検証(実コードでの確認・実測がまだできていない事項)

| 項目 | 参照 |
|---|---|
| `HomeView.swift`の未読部分(約900行、見た目の実装)に追加のライフサイクル関連ロジックが無いか | §10 |
| `AuthenticatedUserProviding`を`@MainActor protocol`として宣言すること自体は設計上の必須条件として確定したが、実際にSwift 5モード(`project.yml`の`SWIFT_VERSION: "5.0"`)でコンパイルが通ることの実証確認は未検証 | §1.2 |
| 案2(Prefetch開始タイミング変更)採用時の、Splash起動シーケンス全体・既存の起動診断(`DiagnosticsStore`)への具体的な影響 | §4.6 |
| `/entitlements`・`/home`それぞれの実測時間、および両者を並行させられる余地 | §4.6 |
| **(今回・P3対応)** HQから伝えられたC独立レビューのP3-1〜P3-5の具体的な指摘文は、今回の指示文には含まれていなかった(「起動診断、エラー分岐、キャッシュ処理、`retryNow()`のユーザー整合性も確認してください」という一般的な領域の指定のみ)。今回はこの4領域を本資料の既存コード突き合わせにより見直し、判明した差分(`.backendNotConfigured`分岐の復元・既存副作用の全量反映・`retryNow()`のユーザー整合性追加)をP3対応として§4.2・§4.2.1・§10に反映した。**C-1〜C-5の原文と一致するかどうかは確認できていない。** 原文がこの4領域以外の指摘を含む場合、今回の修正はそれを反映していない可能性がある。原文の共有、または一致確認をHQに依頼する。 | §4.2・§4.2.1・§10 |

### 実装時の確認事項

| 項目 | 参照 |
|---|---|
| `MainTabView`→`HomeView`/`PlaceholderScreenView`/`PlanLimitPrompt`→`SubscriptionManagementView`への`authenticatedUserProvider`配線の、各ファイルの既存init構造(メンバーワイズ初期化か明示initか) | §9・§10 |
| `PlanStoreTests.swift`の既存4テスト(`limits: nil`を使うモック)の期待値見直し。特に今回の修正(planのみ存在する場合も`malformedResponse`になったこと)に伴う追加の期待値変更 | §8・§9 |
| `HomeCacheTests.swift`の`authenticatedUserProvider`パラメータへの対応 | §9 |
| §1.2の`load()`内`case (nil, nil): return .pendingPolicyDecision`は、§3のHQ判断が確定した時点で、選択された選択肢(A/B/C)の実装に置き換えること。確定前に本番コードへマージしないこと(P1-2対応により`fatalError`は使用しない) | §1.2・§3 |
| §4.6の案2・案3を採用する場合、`isRefreshingEntitlements`(§4.2.2)・`scheduleWaitForPlanConfirmation()`の確定済み即時フォールバック(§4.2.1)が、変更後のPrefetch開始タイミングとも整合することを再確認すること | §4.2.1・§4.2.2・§4.6 |
| `@MainActor protocol AuthenticatedUserProviding`が実際にSwift 5モードでコンパイルされることを、実装着手時に最初に確認すること(通らない場合は設計の見直しが必要) | §1.2 |
| `commit()`の規則6は`private`のため`PlanStore.swift`外部から単体テストで直接検証する手段が無く(`@testable import`でも`private`は緩和されない)、かつ`load()`経由では到達しない。今回はこれを認識した上で、アクセスレベル変更等の設計変更は行わず、コードレビューによる目視確認に依存する限界として受け入れる(§1.2.1参照) | §1.2.1 |
| `scheduleWaitForPlanConfirmation()`に追加したユーザー整合性チェック(§4.2.1)は、現状`fetch()`からのみ呼ばれるため動作上の変化は無いが、実装時に`fetch()`側のguard順序を変更する場合は、この関数側の判定もあわせて見直すこと | §4.2.1 |
| **(今回・P1-1対応)** `init`内の`$state`購読から呼ぶ`planConfirmed()`・`handlePlanStateChanged()`の呼び出し順序を入れ替えても結果が変わらないことを、実装時に単体テストで確認すること | §4.2.3・§10 |
| **(今回・P1-1/P2-4対応、テスト移行の一覧)** 既存の利用箇所・テストのうち、本設計の変更により**実際に手を入れる必要があるもの**を一覧化する。詳細は各セルの参照先。 | 下表 |

**テスト・利用箇所の移行対象一覧(P1-1 7.・P2-4対応)**

| ファイル・箇所 | 現状の呼び出し | 本設計での影響 | 必要な変更 |
|---|---|---|---|
| `HomeViewModelTests.swift:67` | `HomeViewModel(apiClient: apiClient)`(`userID`省略) | §4.2.3の`userID == nil`早期分岐により、プラン確定状態を見ずに既存同様Fetchする | **変更不要の見込み**(テスト33で回帰確認) |
| `HomeSpeechesStatusTests.swift:97` | 同上 | 同上 | **変更不要の見込み** |
| `CalendarViewModelTests.swift`(12-14, 76-77, 86-87, 95-96行目) | `PlanStore()` + `.set(plan:, limits:)`(`userID`省略、`HomeViewModel`と組み合わせない) | `set()`のシグネチャに`userID: UUID? = nil`を追加しただけで、既存の呼び出し(位置引数・省略)はそのままコンパイルが通る。`CalendarViewModel`は`.limits`/`.isPro`等のベストエフォート値のみを読むため、ダミーUUIDの影響を受けない | **変更不要の見込み** |
| `EventDetailViewTests.swift`(setUp・6, 11-13, 21-22, 27, 32, 39行目) | `PlanStore.shared.reset()` / `.set(plan:, limits:, confirmed: false)`(`userID`省略) | `EventDetailView`は`confirmedUserID`を見ないため、ダミーUUIDの影響を受けない。`reset()`の`lastKnown: nil`化もこのテストの想定(未確定化)と整合する | **変更不要の見込み** |
| `PlanStoreTests.swift`(79-85行目) | `PlanStore()` + `.set(plan: .pro, limits: .pro(), confirmed: false)` → `load()`失敗 → `isConfirmed == false`・`isPro == true`を検証 | この「未確定でも前回値を保持する」挙動こそが`lastKnown`導入の動機そのものであり、`load()`の失敗パスが`state`に触れない(§1.2)ため、`set()`で設定した`lastKnown`がそのまま保持される | **変更不要の見込み**(むしろ本設計により正しさが裏付けられる) |
| `HomeCacheTests.swift`の`makeViewModel`ヘルパー(549-558行目) | `plan`省略時、`PlanStore()` + `.set(plan: .pro, limits: .pro())`(`userID`省略、`confirmed`既定true)を生成し、同じヘルパーの`userID`引数を**別に**`HomeViewModel`へ渡す | `set()`が`userID`省略時にダミーのランダムUUIDを使うため、`PlanStore.confirmedContext.userID`(ダミー)と`HomeViewModel.userID`(ヘルパー引数の実値)が一致せず、§4.2の`guard let context = planStore.confirmedContext, context.userID == userID`に失敗し、**`fetch()`が待機状態に入ってしまう(既存テストが新たに失敗する)** | **変更必要**: ヘルパー内の`set(plan: .pro, limits: .pro())`呼び出しに`userID: userID`(ヘルパー自身の引数)を明示的に渡すよう修正すること |
| `HomeCacheTests.swift`(65, 84-102, 247, 257-267, 371-429行目) | `PlanStore()`/`.set()`/`.confirmedPlan`/`.isConfirmed`個別呼び出し | 上記ヘルパー経由でない直接呼び出しは、各テストの意図(`userID`を実際に検証する意図があるか)に応じて個別確認が必要 | **実装時に個別確認**(ヘルパー以外の直接呼び出し箇所ごとに、`userID`が検証対象かどうかを確認すること) |
