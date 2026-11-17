# Home Prefetch / PlanStore 権限整合性 最終設計資料

**状態**: HQレビュー結果「条件付き保留」に基づく改訂版。§3・§1.3・§4.6・§5・§10はいずれもHQにより決定済み(§3: 案B採用/§1.3: 案I採用/§4.6: 案3を目標方針として採用、ただし§4.6は実装許可前に前提条件の確定が必要/§5: `save()`のユーザー整合性検証は追加しない現状維持/§10: `retryNow()`競合敗北時の非対称性を許容)。現時点でHQ判断待ちの項目は無い(§11参照)。それ以外の設計方針もHQレビュー済み。
**作業制限**: 本資料はドキュメントのみ。Swiftコード・テストコードへの反映、コミット・push・merge・TestFlight配布は未実施。

**改訂履歴**:
- **(今回・第7次改訂、基準673cd982)** A. 必須修正(P2): P2-1(Test40・41)変更直後の同期確認を`waitUntil`による通知後確認へ変更し、Test41(iv)は1回目の`load()`の完了(`loadInProgressCount`の実際の減少)を確認してから状態を見る形に訂正、Bool管理の誤実装でも偶然テストが通ってしまう問題を排除。P2-2(Test44(c))「通知順序の入れ替わり耐性を証明するテスト」ではなく「連続したPublisher更新後の最終状態を確認するスモークテスト」に位置づけを訂正し、旧実装でも通る可能性があることを明記、大規模な純粋関数化等は今回必須としない。B. HQ判断の反映: §5(`HomeCacheStore.save()`)→現状維持(ユーザー検証を追加しない)で決定、`fetch()`→`save()`の同期的連続性を固定するテストの特定を実装時の確認事項に追加。§10(`retryNow()`)→現在の競合制御(`supersededByNewerRequest`の許容、追い越し側完了まで非活性、失敗時も既存の「時間がかかっています」表示を維持し明示的な失敗表示はできないことを仕様として明記)を許容する形で決定。§11のHQ判断待ちテーブルから両項目を削除し決定事項として記録。冒頭「状態」を更新。C. P3の文書整理: `isRetryAvailable`初期値の同期計算は全保存プロパティ初期化後に実施することを明記、§11・retryNow()コメントに残っていた古いHQ判断待ち表記(`.pendingPolicyDecision`時代の「HQ判断待ちで保留」)を訂正、C指摘(要約のみ、原文未確認)のP3-1・P3-2(`@Published`化による再描画コスト)を実装時の注意事項として残し`@Published`通知範囲の最小化を実装時の確認事項に追加、P3-3(計算プロパティ化)は今回は見送り現在の設計を維持する理由と再検討条件を記載、P3-8(コンパイル・Swift 6未確認)をそのまま明記。
- **(今回・HQ最終修正指示対応、基準1d0a198d)** §4.2.1「isRetryAvailableのObservable化」のCombineパイプラインに2つの問題が残っていた。(1)構築時点で既に`planStore.loadInProgressCount > 0`の場合、`Task { @MainActor in }`経由の非同期適用のため`init()`が返った直後は既定値`true`のまま一時的に誤表示されうる。(2)`.sink`が通知時点のスナップショット値(`isAvailable`)をそのまま代入していたため、複数の通知に対応するTaskの実行順序が入れ替わると、古い値が最新の状態を上書きするおそれがあった。修正: `init()`内で構築時点の3値から同期的に初期値を直接計算して代入(問題1の解消)、`.sink`内の代入を通知時点のスナップショットではなく実行時点に`self`からライブに再取得して再計算する形へ変更(問題2の解消、冪等な再計算のため実行順序に依存しない)。§8に新規テスト44(初期値・復帰・通知順序耐性の3部構成)を追加。§9の`HomeViewModel.swift`行を更新。
- **(今回・HQ再レビュー対応、基準fa5d6d11)** P2-1〜3・P3-1〜6はHQ確認上解消と判断されたが、P2-4に「UI状態のObservable通知」の問題が残っていた: `isPlanConfirmationSlow`・`lastErrorRequiresPlanRetry`・`isRetryAvailable`(および`isRetryAvailable`が参照する`PlanStore.loadInProgressCount`・`HomeViewModel.isFetching`・`isRefreshingEntitlements`)が通常の`private(set) var`/計算プロパティのままで、SwiftUIへの変更通知(`@Published`/`objectWillChange`)が成立していなかった。修正: `isFetching`・`isRefreshingEntitlements`・`lastErrorRequiresPlanRetry`・`isPlanConfirmationSlow`・`PlanStore.loadInProgressCount`をいずれも`@Published`化し、`isRetryAvailable`を計算プロパティからストアドの`@Published private(set) var`へ変更、`init()`内に`Publishers.CombineLatest3($isFetching, $isRefreshingEntitlements, planStore.$loadInProgressCount)`の購読を追加して3つの入力の変化に確実に追従させた(§1.2・§4.2・§4.2.1)。`isPlanConfirmationSlow`・`lastErrorRequiresPlanRetry`は同一インスタンスの`@Published`化のみで`HomeView`(`@StateObject`で監視、`HomeView.swift:49`)への再描画が保証されることを説明した(HQ指摘4・5)。§8にObservable通知自体を検証する新規テスト39〜43を追加。§9の`HomeViewModel.swift`・`PlanStore.swift`行を更新。
- **(今回・C最終独立レビュー対応、基準5877f31f)** P2-1(Test31): §4.2.1の③分岐が実際には`cancelPlanConfirmationWait()`を呼ぶという実コードとの不一致を訂正し、Task#1のキャンセル・resume後に`recordPlanConfirmationTimedOut()`が記録されないことを検証する手順に修正(§8)。P2-2(HomePrefetchCoordinator移行漏れ): `start()`の`contextAtDispatch`に既定値`nil`を追加し、実呼び出し元5ファイル(`SplashViewModel.swift`・`HomePrefetchCoordinatorTests.swift`・`HomeCacheTests.swift`・`SplashViewModelTests.swift`・`PlanStoreTests.swift`)の移行表を§4.1に新設。先行取得再利用テスト2件が`contextAtDispatch`の既定nilで意図通りに検証されなくなる問題と、その修正手順を明記。P2-3(Test20・21): 案Iのgeneration収束を具体的な`CheckedContinuation`手順で検証する2ケース(Home応答保留中にentitlements再確認が完了するケース/内容が変わらない再確認のケース)に全面改稿し、generation・最終plan・表示データ・キャッシュの状態をそれぞれ明記(§8)。P2-4(再試行ボタン): `PlanStore.isLoadInProgress`をBool直接代入からカウンタ(`loadInProgressCount`)管理に変更し複数load重複完了時の誤解除を解消(§1.2)、`isRetryAvailable`を新設してUI側がボタンを非活性にできるようにし、ガード失敗時は`recordRetryIgnoredWhileEntitlementsInProgress()`で診断を残す(§4.2.1・§7)。P3-1: `PlanStore.reset()`の呼び出し元を誤って`AppState.leaveLoggedIn()`としていた記載を、実際の呼び出し元`RootView.swift:41,54`に訂正(§0・§4.2.3)。P3-2: 冒頭「状態」の表示をHQ決定済みの内容(§3案B・§1.3案I・§4.6案3)に合わせて更新。P3-3: §11「HQ決定事項の記録」冒頭の表現を実際の改訂履歴と一致させる形に修正。P3-4: `retryNow()`の失敗時に既存の`.loaded`表示を`.error`で消さないよう、`applyFetchFailure()`と同じ保護を追加(§4.2.1)。P3-5: `isPlanConfirmationSlow`の解除条件(成功・再試行失敗・ユーザー切替・reset)を`cancelPlanConfirmationWait()`への集約(成功・ユーザー切替・reset)と`retryNow()`失敗分岐内での明示的解除(再試行失敗)に整理し、§4.3.2に4条件の対応表を新設。P3-6: テスト24の「十分な時間を置いても2回目が発生しないこと」という任意の待ち時間に依存した検証を、`needsRefetch`が本テストの手順では構造的に`true`にならないことに基づく、時間経過の仮定を伴わない検証(`state == .loaded`の成立後に即時カウントを確認)へ変更(§8)。
- **(今回・HQ判断反映、基準2b985b79)** HQが§3・§1.3・§4.6の3項目を決定。§3: 案B採用(`plan=nil && limits=nil`は`.malformedResponse`として確定しない。`LoadResult.pendingPolicyDecision`を廃止し`.malformedResponse`に統合。実装・リリース前に対象Backendのバージョン・レスポンス契約の確認を必須条件として追加)。§1.3: 案I採用(現行設計維持、`isReconfirming`フラグは設けない。§8テスト20・21を必須テストとして確定)。§4.6: 案3を目標方針として採用(Backend側計算文脈エコー。Backend設計確定までは実装許可せず、案1は暫定措置と明記)。§11のHQ判断待ちテーブルから該当3項目を削除し、決定事項として記録。関連するコード例・テスト・§9/§11の記載を整合させた。P2-1〜4・P3-1〜6等、第3次改訂の既存内容はそれ以外変更していない。
- **(今回・C第3次独立レビュー対応、基準2b985b79)** P2-1: `needsRefetch`が通常起動時のレース(Combine初回通知と`.task{load()}`)でも不要な再取得を誘発していた誤作動を修正。`load(isExplicitRefresh:)`を新設し、`HomeView`からの明示的な更新要求(`.onChange(of: path.count)`)のみが`needsRefetch`を立てるよう限定(§4.3.1、テスト34・38)。P2-2: Entitlements確認中に一時的な`.error`を出さない設計に変更。タイムアウトは`isPlanConfirmationSlow`のみを立て、`state`は`.loading`を維持。`.error`は`retryNow()`自身の確認失敗が確定した場合のみ(§4.3.2、テスト37)。`PlanStore.isLoadInProgress`を新設し、`retryNow()`が進行中のEntitlements取得を不必要にsupersedeしないようにした(§1.2)。P2-3: `HomeCacheTests.swift`の「未確定状態でHome取得を待つ」既存4テストを具体的に列挙し、新仕様での前提・期待状態・確定タイミングを記載(§8.0新設)。P2-4: テスト24の呼び出し回数検証を厳格化、テスト30・31でsleep継続を実際にresumeして確認、テスト37をretryNow()とCombine経由の自動Fetchの原因を区別できる手順に再設計。
- **(今回)** P3-1: §4.3.1の残存リスクの記述を訂正(「通信順序の逆転」という誤った表現を、実際に生じる「1回目の内容が一時的に表示される」という正確なリスクに修正)。P3-2: テスト29のタイミング同期を`Task.yield()`から`waitUntil`(`HomeCacheTests.swift`既存の実際のヘルパーと同じパターン)に変更。P3-3: ユーザー切替時のFREE既定値への一時的な後退が、現行実装(旧ユーザーの値を保持し続ける)とは異なる本設計独自の挙動であることを明記(前回「既存コードと同様」としていたのは誤り)。P3-4: 「RootView.leaveLoggedIn()」という誤った呼び出し元名称を「AppState.leaveLoggedIn()」に訂正。P3-5: HomeViewの既存の更新失敗用再試行(`load()`)とプラン確認失敗用再試行(`retryNow()`)の区別を§4.3.2の表で明確化。P3-6: 既存の「未検証」事項はすべて維持。
- **(今回)** HQ判断待ち3項目(§3・§1.3・§4.6)は内容を変更していないが、HQが判断しやすいよう、それぞれの選択肢・A推奨案・推奨理由・採用しない案のデメリット・他設計項目への影響を§11に短く要約した。
- **(今回・C第2次独立レビュー対応、基準846347fc)** P2-A: `HomeView.swift:70-83`(通貨ペア編集からの復帰)で`load()`が実行中のfetchを無視していた問題を`needsRefetch`フラグで解消(§4.3.1、テスト34)。P2-B: `confirmedPlan`(無引数版)が別ユーザーのプランを返す可能性があったため、`confirmedPlan(for:)`を新設し`planConfirmed()`・`cacheContext()`を移行、`RootView`のreset()タイミングに依存しない設計に修正(§1.2・§4.2.3、テスト35)。P2-C: `scheduleWaitForPlanConfirmation()`を直接呼んでいたテスト24・29〜32を`load()`・`set()`経由に全面再設計。同関数内の①②分岐が構造的に到達不能であることを証明し、該当する旧テストを削除(§4.2.1「fetch()側の既存guardとの整合性」再訂正、§8)。P2-D: `PlanStore.load()`の`authenticatedUserProvider`に既定値が無いため既存の直接呼び出し7か所(`PlanStoreTests.swift`6か所・`HomeCacheTests.swift`1か所)がコンパイル不能になることを新規に判明させ、テスト意図を保つ具体的な修正方法を移行表に追加(§11)。P2-E: プラン確認タイムアウト後に`.loading`のまま止まる問題を、`lastErrorRequiresPlanRetry`フラグと`.error`への遷移で解消。`HomeView.swift`の`ErrorView.onRetry`に必要な(未実施の)変更を明記(§4.3.2、テスト37)。P2-F: §4.2.1の「必ず真になる・動作の変化は無い」という記載を、①②分岐の到達可能性の再検証に基づき訂正(§11該当箇所も整合)。P3(7点): `LaunchDiagnostics`のCodable後方互換性(Optionalフィールド)、`DiagnosticsStore`シングルトンのテスト間累積対策(差分検証)、`self?.sleep`の強参照問題の修正(§4.2.1)、`set()`がgenerationを進めない制約の明記、`authenticatedUserProvider`配線漏れの検出方法(統合テスト、テスト36)、`.unconfirmed(lastKnown:)`とプラン切替時の`plan`/`limits`の実際の変化の精密化、型推論・コンパイル未確認箇所の明記(§10・§11)。§3・§1.3・§4.6は変更していない。
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
- `AppState.leaveLoggedIn()`(`AppState.swift:35-40`)は`currentUserID = nil`・`homeCache.clear()`・`prefetchCoordinator.reset()`を同じ関数内で同期的に実行する。**`PlanStore.reset()`はこの関数には含まれない**(今回・P3-1対応で確認・訂正)。`PlanStore.shared.reset()`は`RootView.swift:41`(`.loggedOut`の`.onAppear`)・`RootView.swift:54`(`.loggedIn`の`onSignOut`クロージャ)の2か所で直接呼ばれる。
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
    case malformedResponse          // plan/limitsの組み合わせが仕様上の根拠を欠く(§3参照、
                                      // plan=nil && limits=nilの両方欠落ケースも含む。
                                      // ★HQ決定(案B採用)により.pendingPolicyDecisionは廃止し、
                                      // このcaseに統合した)
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
    /// **(今回・P2-2対応、新設。今回・P2-4対応でBoolからカウンタに変更)** 現在進行中の
    /// `load()`呼び出しの件数。`HomeViewModel.retryNow()`が、既に進行中の(Splash等が
    /// 開始した)Entitlements取得を不必要にsupersedeしないための判定に使う(複数の
    /// `load()`呼び出しが同時に進行することそのものは禁止しない。既存のentitlements
    /// RequestSequenceによる新旧判定が安全性を担保するため、このカウンタは「新たに
    /// 発行する価値があるか」の効率判断にのみ使う。§4.2.1「retryNow()」参照)。
    ///
    /// **(今回・P2-4対応、HQ指摘により訂正)** 前回は単純な`Bool`で実装していたが、これは
    /// 複数の`load()`呼び出しが重なった場合に誤った状態を生む: 呼び出し#1が進行中に
    /// 呼び出し#2が始まり(両方とも`true`)、呼び出し#1が先に完了すると、#1の`defer`が
    /// `false`に戻してしまい、**実際には#2がまだ進行中であるにもかかわらず**
    /// 「進行中ではない」という誤った状態になる。カウンタ(`Int`、進行中の件数を数える)に
    /// 変更し、「`0`より大きいかどうか」で`isLoadInProgress`を判定することで、複数の
    /// `load()`の完了順序に関わらず正しい状態を維持する。
    // (今回・P2-4対応、今回・HQ指摘によりObservable化) `HomeViewModel.isRetryAvailable`
    // (§4.2.1)がこの値の変化にCombineで追従するために、ストアドの`@Published`である必要が
    // ある。`isLoadInProgress`自身は計算プロパティのまま(`@Published`はストアドプロパティ
    // にのみ付けられるため)で、`HomeViewModel`側は`$loadInProgressCount`(`PlanStore`は
    // `ObservableObject`であり、`@Published`を付けた時点でこの投影が外部から購読可能になる、
    // `PlanStore.$state`(104行目)と同じ仕組み)を購読して`> 0`を再計算する。
    @Published private(set) var loadInProgressCount = 0
    var isLoadInProgress: Bool { loadInProgressCount > 0 }

    // (今回・P1-1対応) 安全性が必要な判定(ユーザー整合性・generation比較等)には、必ず
    // 以下の「strict」な3つ(isConfirmed/confirmedUserID/confirmedContext/confirmedPlan)を
    // 使うこと。`.confirmed`のときのみ値を返し、`.unconfirmed`(lastKnownの有無に関わらず)は
    // 常にnil/false。
    var isConfirmed: Bool { if case .confirmed = state { true } else { false } }
    var confirmedUserID: UUID? { if case .confirmed(let c) = state { c.userID } else { nil } }
    var confirmedContext: PlanContext? { if case .confirmed(let c) = state { c } else { nil } }
    /// 後方互換用。`.unconfirmed`の間は常にnil(lastKnownの有無に関わらず)。
    /// **(今回・P2-B対応)** このno-arg版は「今PlanStoreが確定している、何らかのユーザーの
    /// プラン」を返すだけであり、呼び出し元が意図したuserIDと一致するかは検証しない。
    /// ユーザー切替直後の競合(後述)により別ユーザーのプランを返す可能性があるため、
    /// 呼び出し元が特定のuserIDを意図している場合は、必ず下の`confirmedPlan(for:)`を使うこと。
    var confirmedPlan: String? { confirmedContext?.plan }

    /// **(今回・P2-B対応、新設)** 指定した`userID`の確定済みプランを返す。`confirmedContext`が
    /// 存在しても、そのuserIDが引数と一致しなければnilを返す(別ユーザーのプランを誤って
    /// 返さない)。安全性が必要な全呼び出し元(`HomeViewModel.planConfirmed()`・
    /// `cacheContext()`)は必ずこの形を使うこと(§4.2.3の6番を参照)。
    func confirmedPlan(for userID: UUID) -> String? {
        guard let context = confirmedContext, context.userID == userID else { return nil }
        return context.plan
    }

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
    // (今回・P3-4対応) setはgenerationを一切進めない(常に現在のgeneration値をそのまま使う)。
    // commit()の規則1〜6を経由しないため、これは意図的な制約であり、不具合ではない。
    // 複数の異なるgeneration値を必要とするテスト(ケースB「正当な追い越し」等)では、
    // このsetではなく実際のload()(モックのEntitlementsServiceで異なる応答を返す)を使うこと。
    // テスト方法: generationが実際に進まないことそのものを検証したい場合は、setを連続で
    // 呼び出し前後の`confirmedContext?.generation`(テストからは`confirmedPlan(for:)`経由では
    // 読めないため、`confirmedContext`を使う)を比較し、値が変化しないことを確認する。
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

        // (今回・P2-2対応、P2-4対応でカウンタ化) ここから先が実際に送信・応答待ちを行う区間。
        // 複数のload()呼び出しが重なっても、完了順序に関わらず正しく「進行中の件数」を
        // 維持できるよう、Boolではなくカウンタの増減で管理する。
        loadInProgressCount += 1
        defer { loadInProgressCount -= 1 }

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

            // plan/limits組み合わせの整合性チェック(§3)。統一仕様(★HQ決定・案B採用により確定):
            //   nil/nil   → malformedResponse(両方欠落。旧Backendで仕様上正当に発生しうるが、
            //               HQ決定(案B)により確定せず保留する。PROユーザーの誤FREE化を防ぐ)。
            //   plan/limits(両方存在) → 正常確定
            //   plan/nil  → malformedResponse(片方だけの欠落に仕様上の根拠が無い)
            //   nil/limits → malformedResponse(同上)
            // 3パターンすべてが同じ.malformedResponseに帰着するため、1つのcaseにまとめる。
            switch (response.plan, response.limits) {
            case (let p?, let l?):
                commit(userID: requestUserID, plan: p, limits: l)
                return .confirmed(confirmedContext!)
            case (nil, nil), (.some, nil), (nil, .some):
                // (今回・HQ決定反映) 両方欠落・片方のみ欠落のいずれも、v1.15でplan/limitsが
                // 同時に追加されたという仕様(api-design.md 1944行目)と整合しない形であるため、
                // 確定しない。両方欠落の場合は旧Backend(v1.15未満)で正当に発生しうるが、
                // HQ決定(案B)によりPROユーザーの誤FREE化を防ぐことを優先し、同じ扱いに統一する。
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

**(今回・P3-6対応)プラン切替時の`plan`/`limits`の実際の変化を正確に記述する**: 2つのケースを区別する必要がある。
- **同一ユーザーのプラン変更(例: FREE→PRO、`commit()`内の規則3/4)**: `commit()`は`state`を`.confirmed(previous)`から直接`.confirmed(new)`へ**1ステップで**書き換える(§1.2のコード参照)。`.unconfirmed`を経由しないため、`plan`/`limits`/`isPro`は**旧プランの値から新プランの値へ直接切り替わる**。途中でFREE既定値(`.free()`)へ一時的に後退する瞬間は無い。
- **異なるユーザーへの切替(`load()`冒頭、§1.2「generationの初回更新」③)**: `load()`が`state = .unconfirmed(lastKnown: nil)`を経由してから`commit()`に到達する(§1.2.1)。この間、`plan`/`limits`/`isPro`は**一時的にFREE既定値(`.free()`)を返す**(`context`が`nil`になるため)。確定が完了するまでの短い時間窓で、旧ユーザーのプランでも新ユーザーのプランでもない、既定値が観測される。

**(今回・P3-3対応、訂正)現行実装との差を正確に記載する**: 前回の記載は「既存コードでも同様の挙動であり、退行ではない」としていたが、これは**不正確**だった。実際の現行`PlanStore.swift`(本設計による刷新前のコード)は、`plan`・`limits`を`isConfirmed`・`confirmedUserID`とは**独立したストアドの`@Published`プロパティ**として持っており、`load()`がユーザー切替を検出した際に`isConfirmed`・`confirmedUserID`はリセットするが、**`plan`・`limits`自体はリセットしない**(現行コードのどこにも、ユーザー切替時に`plan`/`limits`をFREE既定値へ戻す処理は無い)。したがって、**現行実装では、ユーザー切替の過渡期にも旧ユーザーのプラン・制限値がそのまま表示され続ける**(新ユーザーの確定が完了するまで)。

本設計(`.unconfirmed(lastKnown: nil)`でクリアする)は、これと**異なる挙動**を意図的に導入するものである: 旧ユーザーのプラン情報が新ユーザーの画面にわずかでも残り続けることを避ける(§1.2のlastKnown節参照)という安全性向上の判断であり、既存挙動の単純な継承ではない。この区別は、`CalendarViewModel`等が`plan`/`limits`を直接購読して制限表示を更新する場合、**本設計の採用によって新たに**、ユーザー切替時に一時的な「FREE相当の制限」が見える可能性があることを意味する(現行実装では旧ユーザーの制限値が見え続けるため、この一時的な表示自体は現行では発生しない)。この挙動変化自体は意図的な安全性向上として妥当と判断するが、UI側(`CalendarViewModel`を使う画面)がこの一時的な表示に依存した見た目になっていないかは、実装時に各画面ごとに確認すること(§10に実装時の確認事項として追加)。

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
| `.malformedResponse`(片方のみ欠落、または★HQ決定・案B採用により両方欠落も含む) | 新たな確定(`commit()`)はされない。②のリセットによる未確定化のみ反映されうる | **変化しない**(同上。`commit()`に到達しないため) | **進む**(②で加算済み) | 同上(このリクエストのsequence番号が最新になる) | 同上(新たな確定が無いため影響しない) |
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

### 1.3 同一ユーザーのEntitlements再取得(★HQ決定済み: 案I採用)

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
| **I(★採用、現行設計)** | 対応する仕組みを追加しない。Entitlements再確認中かどうかに関わらず、受信時点の確定済みcontextで判定する | 確認中の瞬間に古い内容が一時的にコミットされる可能性がある。ただし既存のgeneration追い越し機構により、再確認完了後に自動的に1回だけ追従する(危険なデータ漏洩ではなく、一時的な表示の古さ) | 最小(確認完了後に1回の追い越し取得で収束) |
| II | `PlanStore`に`isReconfirming`相当のフラグを追加し、Home側の`fetch()`は再確認中はコミットを保留する | Iと実質同じ最終結果(既存のgeneration比較で最終的には正しい値に収束するため)。フラグのセット・クリアのタイミングに新たな競合状態を持ち込むリスクがある | フラグの立つタイミングとHome取得のタイミングによっては、待機から再開のための追加のラウンドトリップが発生しうる |

**(今回・HQ決定)** HQ判断により**案I(現行設計維持)**を採用する。`isReconfirming`相当の追加フラグは設けない。`generation`による追い越し取得で自動的に収束させる現行設計を維持する。①②③④の許容範囲については、選択肢Iの採用そのものが「③の論点(確認中の値の先取り待ちをしない)を許容する」という判断を含む。

**(★HQ指示により追加)実装時の確認事項**: 実装時に、この収束動作(③の状況で一旦古い内容がコミットされ、再確認完了後に自動的に1回の追い越し取得で最新の内容に収束すること)を**必ずテストで確認する**こと。§8テスト20・21が既にこの収束動作を検証するテストとして存在する(前回までは「選択肢I採用時」という条件付きの記載だったが、今回の決定によりこれらは**必須のテスト**として位置づけが確定した)。

---

## §2 FREE / PROのプラン状態管理

- `PlanStore.plan: EntitlementsResponse.Plan`(`.free`/`.pro`)は、`PlanContext.plan`(String)から計算されるプロパティ。
- `PlanLimits`(`calendarEarliestFrom`・`calendarLatestTo`・`favoritesMax`・`notificationImportances`・`notificationFxPairsMax`・`historyEventsMax`・`pastReleasesMax`)は`.free()`/`.pro()`の既定値をクライアント側に持つ(`PlanLimits.swift`相当、`PlanStore.swift`内に定義済み)。
- `CalendarViewModel`・`IndicatorDetailView`・`EventDetailView`等、既存の`PlanStore.shared`参照箇所(`@ObservedObject private var plan = PlanStore.shared`)は、計算プロパティとしての後方互換性により変更不要。

---

## §3 plan=nil && limits=nilの扱い(★HQ決定済み: 案B採用)

`api-design.md`§27の確認により、`plan`・`limits`が**両方とも**欠落するのは、v1.15未満の旧Backendで仕様上正当に発生しうることが分かった。一方、**現行Backendの不具合によって両方欠落するケースとの区別はクライアント側では不可能**(APIバージョン信号が存在しない)。

| 選択肢 | 内容 | PROユーザーへの誤制限リスク | 旧Backend互換性への影響 |
|---|---|---|---|
| A | 両方欠落→FREEとして確定、Home取得・キャッシュ保存を通常どおり行う | **あり**: 現行Backendの不具合で両方欠落した場合、PROユーザーが一時的にFREE扱いになり、Home・キャッシュに「FREE」が書き込まれる | 旧Backendでは正常動作 |
| **B(★採用)** | 両方欠落→`.malformedResponse`として確定せず保留(片方だけ欠落のケースと同じ扱いに統一) | **なし** | 旧Backendのユーザーが**永久に未確定のまま**になる可能性(旧Backendが実際にまだ稼働していれば重大な回帰) |
| C | Aと同じ挙動を維持しつつ、この経路でのFREE確定を通常の確定と区別できる診断ログを残す | Aと同じ(リスクは解消しない) | Aと同じ(互換性は維持) |

**(今回・HQ決定)** HQ判断により**案B**を採用する。両方欠落の場合は`.malformedResponse`として扱い、プランを確定しない。採用理由: PROユーザーが通信・応答の不具合によって誤ってFREE扱いされる実害(案Aのリスク)を防ぐことを優先する。

**残存リスクの明記(★HQ指示により明記)**: 旧Backend(v1.15未満)が実際にまだ稼働している場合、そのBackendを使うユーザーは`plan`・`limits`が両方欠落する応答を**仕様上正当に**返し続けるため、**本設計のもとでは永久に未確定のままになる**(Home・キャッシュへのプラン確定が完了せず、§4.2の`fetch()`が`scheduleWaitForPlanConfirmation()`で待機し続ける)。旧Backendが現在実際にまだ稼働しているかどうかは、本資料の範囲では確認できていない(§11「未検証」参照)。

**実装・リリース前の必須条件(★HQ指示により追加)**: 本設計(案B)の実装・リリースに着手する前に、**対象Backendのバージョンと`/entitlements`レスポンス契約を確認すること**を必須条件とする。具体的には、(1) 本番で稼働している全Backendインスタンスがv1.15以上であること、または(2) v1.15未満のBackendが稼働している場合、そのユーザーへの影響(永久未確定化)を許容するか、別途の移行措置(Backendのアップグレード等)を講じることを、実装着手前にHQ・運用側で確認すること。この確認が完了するまで、案Bの実装には着手しない。

「`(plan?, nil)`」(planのみ存在)と「`(nil, limits?)`」(limitsのみ存在)はいずれも仕様上の根拠が無いため、**両方とも`.malformedResponse`として確定しない**ことは決定済み(案Bにより、両方欠落のケースも同じ`.malformedResponse`に統一されたため、§1.2の実装上は3パターンとも単一の分岐にまとめられる。§1.2のコード参照)。

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

// (今回・P2-2対応) contextAtDispatchに既定値nilを追加した。実コード(HomePrefetchCoordinator.swift
// 39-63行目、2026-11-16確認)の既存呼び出し元はいずれもPlanStoreへの参照を持たず、この引数を
// 渡していない。nilは「送信時点でPlanStoreが未確定だった」ことを表す正当な値であり、
// 典型的なコールドスタート(§4.1本文)ではこれが実際の状態と一致するため、既定値による
// 意味の変化は無い(authenticatedUserProviderのケースとは異なり、nilを安全性チェックの
// 無効化に使っているわけではない)。
func start(userID: UUID, apiClient: APIClient, contextAtDispatch: PlanStore.PlanContext? = nil, now: () -> Date = Date.init) -> Task<HomeResponse, Error> { ... }

func consumeHome(for userID: UUID, date: String, timezone: String) -> (task: Task<HomeResponse, Error>, contextAtDispatch: PlanStore.PlanContext?)? {
    guard var current = prefetch, current.userID == userID, !current.homeConsumed else { return nil }
    current.homeConsumed = true
    prefetch = current
    guard current.homeDate == date, current.homeTimezone == timezone else { return nil }
    return (current.homeTask, current.contextAtDispatch)
}
```

**既存呼び出し元・テストへの移行(今回・P2-2対応、HQ指摘により新規に網羅)**: `start()`に`contextAtDispatch`の既定値`nil`を追加したことで、既存の呼び出し元の**大半はコンパイル・挙動ともに無変更**で済む。一方、`consumeHome()`の戻り値がタプルに変わったため、戻り値を直接扱う箇所は個別に確認が必要。また、`contextAtDispatch`が常に`nil`になることで**先行取得の再利用が成立しなくなるテスト**が2件ある。

| 呼び出し元・テストファイル | 現状の呼び出し | 本設計での影響 | 必要な変更 |
|---|---|---|---|
| **`SplashViewModel.swift:149`**(本番コード) | `prefetchCoordinator.start(userID: session.userID, apiClient: apiClient)`。`SplashViewModel`は`PlanStore`への参照を持たない | `contextAtDispatch`が既定の`nil`になる。§4.1本文の「典型的なコールドスタートでは`contextAtDispatch`はほぼ常にnil」という前提と一致するため、**実害は無い** | **変更不要**。ただし§4.6案2(Prefetch開始タイミングをPlanStore確定後に変更)を将来採用する場合は、`SplashViewModel`に`planStore: PlanStore`の新規依存を追加し、`contextAtDispatch: planStore.confirmedContext`を明示的に渡す変更が必要になる(§11に実装時の確認事項として追加) |
| **`HomePrefetchCoordinatorTests.swift`**(191-195行目のテスト専用`extension`) | `consumeHome(for: userID)`(`date`/`timezone`省略版)が`consumeHome(for:date:timezone:)`を呼び、戻り値をそのまま`Task<HomeResponse, Error>?`として返す | `consumeHome(for:date:timezone:)`の戻り値型変更により、この`extension`の宣言した戻り値型と**型が一致せずコンパイル不能** | **変更必要**: `extension`の実装を`consumeHome(for: userID, date:, timezone:)?.task`(タプルから`.task`だけを取り出す)に変更する。戻り値の型(`Task<HomeResponse, Error>?`)自体は変えない。この`extension`を使う個別テスト(`testHomeCanBeConsumedOnlyOnce`等、12件)は`XCTAssertNotNil`/`XCTAssertNil`等、Taskの有無のみを見ているため、**個別テスト本体の変更は不要** |
| **`HomeCacheTests.swift`: `testFetchReusesThePrefetchedHomeAndDoesNotRequestAgain`**(277-290行目) | `coordinator.start(userID: userA, apiClient: api, now: {...})`(`contextAtDispatch`を渡していない)。テストの主張は「先行取得を再利用し、新規の`/home`送信をしない」こと | `contextAtDispatch`が既定の`nil`になるため、§4.2の`fetch()`の再利用判定(`dispatchContext.userID == ... && dispatchContext.generation == ...`)が**常に失敗**し、**先行取得が再利用されなくなる**(常に新規`apiClient.send`にフォールバックする)。このテストは`api.requestedPaths.filter { $0 == "home" }.count == 1`を検証しているが、新規送信も1回で終わるため**偶然成立してしまい、再利用そのものは検証できなくなる**(テスト意図の黙示的な劣化) | **変更必要**: テストを次のように再構成する。(1) `PlanStore`を明示的に作成し`set(plan:, limits:, confirmed: true, userID: userA)`で確定、(2) `coordinator.start(userID: userA, apiClient: api, contextAtDispatch: plan.confirmedContext, now: {...})`で、確定済みcontextを明示的に渡す、(3) `makeViewModel(..., plan: plan, ...)`で**同じ`plan`インスタンス**を`HomeViewModel`に渡す(`fetch()`が読む`confirmedContext`と、先行取得時の`contextAtDispatch`のuserID・generationを一致させるため)。これにより、実際に先行取得が再利用されたことを`api.requestedPaths.filter { $0 == "home" }.count == 1`**かつ**先行取得用`api`以外からの送信が無いこと、で正しく検証できる |
| **`HomeCacheTests.swift`: `testReloadAfterConsumingThePrefetchStillRefetches`**(327-340行目) | 同様に`contextAtDispatch`を渡していない。1回目の`load()`で先行取得を消費し、2回目は新規取得することを検証する意図 | 同様に、1回目の`load()`も(`contextAtDispatch`がnilのため)先行取得を再利用せず新規送信になる。最終的な合計回数(2回)の表層的な数値は変わらないが、「1回目は先行取得を消費する」という検証意図が成立しなくなる | **変更必要**: 上記と同じ方法(`PlanStore`を明示的に確定し、そのconfirmedContextを`contextAtDispatch`として渡す)で、1回目が実際に先行取得を再利用することを保証してから検証する |
| **`SplashViewModelTests.swift`**(複数行、`viewModel.start()`経由で`SplashViewModel`内部から`start()`が呼ばれる) | `SplashViewModel`は本番コードと同じく`contextAtDispatch`を渡さない | 既定の`nil`になるのみで、このテスト群が検証している内容(`SplashViewModel`自身の起動シーケンス・先行取得の開始タイミング等)には影響しない | **変更不要** |
| **`PlanStoreTests.swift`**(28・45・58・75行目) | `coordinator.start(userID: userA, apiClient: api)`を`PlanStore.load()`のEntitlements先行取得テストのために呼ぶ(`consumeEntitlements`のみを使い、`consumeHome`・`contextAtDispatch`は無関係) | `contextAtDispatch`は`consumeEntitlements`に一切関わらないため、**影響なし** | **変更不要** |

**まとめ**: `contextAtDispatch`に既定値`nil`を追加したことで、5ファイルのうち実際に変更が必要なのは`HomePrefetchCoordinatorTests.swift`の1箇所(test拡張の戻り値の型合わせ)と、`HomeCacheTests.swift`の2テスト(先行取得再利用の意図を保つための明示的なcontext一致)のみである。

呼び出し元(`SplashViewModel`)は`planStore.confirmedContext`(未確定ならnil)を`contextAtDispatch`として渡す。実際の起動フローでは、`HomePrefetchCoordinator.start()`は`PlanStore.load()`より前に呼ばれるため、**典型的なコールドスタートでは`contextAtDispatch`はほぼ常にnil**になる。この場合、先行取得は再利用されず、`PlanStore`確定後に通常Fetchへフォールバックする(§4.4のケースB/Cと同じ判定ロジックで処理される)。

### 4.2 `HomeViewModel.fetch()`のgeneration管理

**今回(P1-1・P2-4・P3)の位置づけ**: 以下のコードは、現行の実コード(`HomeViewModel.swift`269-330行目、2026-11-16確認)の既存の副作用(診断記録・`recentSpeeches`/`speechesStatus`/`freshDataVersion`/`lastFreshAt`/`displayedCacheSavedAt`/`refreshNotice`/`lastFetchFailed`の更新、`.backendNotConfigured`分岐、`userID`不明時のプリフェッチ・キャッシュ省略)を**すべて引き継いだうえで**、新しいgeneration安全性機構を追加したものである。前回提示したコード例は要点のみの省略形で、これらの既存副作用を明示していなかった(§4.2.2で指摘されたP3の正確性確認により判明)。今回は省略せず全文を示す。

```swift
private var pendingGeneration: Int?
private var lastFetchedGeneration: Int?
// (今回・P2-4対応、今回・HQ指摘によりObservable化) `isRetryAvailable`(§4.2.1)の再計算が
// この値の変化にCombineで追従する必要があるため、ストアドの`@Published`にする
// (外部への公開範囲は変えない。`private`のままであり、`$isFetching`も型の外からは
// 読めない。`init()`内の同じ型のコードからのみ購読できれば十分なため、§4.2.1参照)。
@Published private var isFetching = false
/// **(今回・P2-A対応、新設)** 実行中のfetch()がある間に`startFetchIfNeeded()`が呼ばれた
/// (例: 通貨ペア編集から`HomeView.swift:79-83`の`onChange(of: path.count)`経由で`load()`が
/// 再度呼ばれた)場合に立てる。現在のfetch完了後、改めてFetchを1回だけ起動するために使う。
/// `pendingGeneration`(generation起因の追い越し検知)とは別の、より汎用的な「実行中に
/// 来た再取得要求」を表すフラグ。詳細は§4.2.4。
private var needsRefetch = false
// isRefreshingEntitlementsは§4.2.1で宣言(retryNow()専用。fetch()自体は使わない)

private func fetch() async {
    var shouldChainNext = false
    // (今回修正) isFetchingの更新はstartFetchIfNeeded()に一元化した(§4.2.1・P1-1対応)。
    // fetch()自身はisFetchingをセットしない。resetとチェイン起動のみここで行う。
    defer {
        isFetching = false
        // (今回・P2-A対応) 実行中に来た再取得要求を、このfetch完了のタイミングで消費する。
        // ここで1回だけshouldChainNextに反映することで、複数回の要求が来ても追加のFetchは
        // 1回だけに収束する(§4.2.4参照)。
        if needsRefetch { needsRefetch = false; shouldChainNext = true }
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
    lastErrorRequiresPlanRetry = false   // (今回・P2-2対応) 成功したので以前のretryNow()失敗起因のフラグを消費する
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
    lastErrorRequiresPlanRetry = false   // (今回・P2-2対応) 通常のFetch失敗であり、プラン再確認は不要
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
// (今回・P2-4対応、今回・HQ指摘によりObservable化) isRetryAvailableの再計算がこの値の
// 変化にCombineで追従する必要があるため@Publishedにする(公開範囲はprivateのまま。
// §4.2の`isFetching`と同じ理由)。
@Published private var isRefreshingEntitlements = false   // §4.2.2参照
/// **(今回・P2-2対応、意味を再定義)** `state`が`.error`になった原因が「`retryNow()`自身が
/// 実行したEntitlements再確認が実際に失敗した」ことである場合だけ`true`。前回の設計では
/// 10秒のタイムアウト時点で立てていたが、今回の修正でタイムアウト自体はこのフラグを
/// 立てない(§4.3.2参照)。`HomeView`側がこの値を見て、再試行操作を`load()`ではなく
/// `retryNow()`へ振り分けるために使う(§4.3.2・§9参照。`HomeView.swift`は未変更)。
/// `read-only`な公開プロパティとして公開する(`HomeState`自体にケースを追加する変更は
/// 本設計では行わない。影響範囲を`HomeViewModel`内に限定するため)。
///
/// **(今回・HQ指摘により@Published化)** 前回版は単純な`private(set) var`だった。これは
/// 外部から読めるが、変化をSwiftUIに通知する仕組みを持たない。`HomeView`は
/// `@StateObject private var viewModel: HomeViewModel`(`HomeView.swift:49`)で
/// `HomeViewModel`を監視しているため、`HomeViewModel`自身の`@Published`プロパティが
/// 変化したときだけ`objectWillChange`経由で再描画される。`@Published`を付けることで、
/// この値が変わった瞬間に(他の`@Published`プロパティと同様に)再描画が保証される
/// (HQ指摘5に対応。詳細は本節末尾「isRetryAvailableのObservable化」参照)。
@Published private(set) var lastErrorRequiresPlanRetry = false
/// **(今回・P2-2対応、新設)** プラン確認の待機(§4.2.1のタイムアウトTask)が10秒を超えて
/// まだ続いている(タイムアウトした)ことを示す。`.error`への遷移は伴わない
/// (`state`は`.loading`のまま)。`HomeView`側が「時間がかかっています」という案内と、
/// `retryNow()`を呼ぶボタンを`.loading`表示に重ねて出すために使う(§4.3.2・§9参照、
/// `HomeView.swift`は未変更)。確認が完了する(`handlePlanStateChanged()`が検知する)か、
/// `retryNow()`が呼ばれるまで`true`のまま残る。
///
/// **(今回・HQ指摘により@Published化)** `lastErrorRequiresPlanRetry`と同じ理由で
/// `@Published`にする。これにより`false`→`true`への変化(タイムアウト発生時)が
/// 確実に`HomeView`の再描画を引き起こす(HQ指摘4に対応)。
@Published private(set) var isPlanConfirmationSlow = false

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
        // (今回・P3-3対応) `try? await self?.sleep(...)`のように、オプショナルチェインの中に
        // そのままawaitを置くと、Swiftの評価規則上「selfを一度strongにunwrapしてから
        // チェイン全体(awaitを含む)を評価する」経路をとる場合があり、結果的に[weak self]の
        // 目的(selfを早期解放可能にすること)に反して、10秒間selfを強参照し続けてしまう
        // おそれがある。これを避けるため、`self?.sleep`のプロパティ読み取りを**別の文として
        // 先に行い**、await自体はselfを経由しないローカル変数に対して行う。
        let sleepFn = self?.sleep   // selfへの参照はこの1行の評価中だけ(無ければ即nil)
        try? await sleepFn?(.seconds(10))   // sleepFn自体はselfを捕捉していない
                                             // (既定クロージャ`{ try await Task.sleep(for: $0) }`は
                                             // HomeViewModelの何も参照しない)ため、
                                             // ここから下ではselfへの強参照は一切発生しない。
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
        // (今回・P2-2対応、再修正) タイムアウト(10秒)は「確認がまだ終わっていない」ことしか
        // 意味しない。確認が実際に失敗したわけではなく、Splash側の/entitlementsが単に遅い
        // だけの可能性がある。したがって`.error`へは遷移しない(前回の設計から変更。
        // §4.3.2参照)。ユーザーに一時的な不安を与えないよう、待機表示(.loading)をそのまま
        // 維持し、`isPlanConfirmationSlow`だけを立てて「時間がかかっている」ことを
        // HomeView側が案内できるようにする。
        self.isPlanConfirmationSlow = true
    }
}

private func cancelPlanConfirmationWait() {
    isWaitingForPlanConfirmation = false
    planConfirmationTimeoutTask?.cancel()
    planConfirmationTimeoutTask = nil
    // (今回・P3-5対応) 待機を片付けるタイミングでは、「時間がかかっている」表示も
    // 一緒に消費する。これにより、確定成功(handlePlanStateChanged経由)・ユーザー
    // 不一致検知(fetch()・handlePlanStateChanged()・scheduleWaitForPlanConfirmation()・
    // retryNow()のいずれの不一致guardも、片付けの一環としてこの関数を呼ぶ)のいずれでも
    // isPlanConfirmationSlowが正しく解除される(§4.3.2「isPlanConfirmationSlowの解除条件」参照)。
    isPlanConfirmationSlow = false
}

/// **(今回・P2-4対応、新設。今回・HQ指摘によりObservableな設計に修正)** `HomeView`が
/// 「再試行」ボタンを**押せる状態として見せてよいか**を判定する公開プロパティ。
/// `retryNow()`実行中(`isRefreshingEntitlements`)・Home取得中(`isFetching`)・既に他経路
/// からの同一ユーザーのEntitlements取得が進行中(`planStore.isLoadInProgress`)のいずれかが
/// 真の間は`false`を返す。`HomeView`側(将来の実装、§9参照)はこれを見て、ボタンを非活性に
/// し「確認中です」等の状態を明示する。これにより、ユーザーが押せるボタンを押したのに
/// 何も起きない、という体験(HQ指摘の core issue)を避ける。
///
/// **(今回・HQ指摘による訂正)** 前回版は単純な計算プロパティ(`var isRetryAvailable: Bool { ... }`)
/// だった。計算プロパティ自体は読むたびに正しい最新値を返すが、**値が変わったことをSwiftUIに
/// 知らせる仕組みを持たない**(`@Published`はストアドプロパティにのみ付けられ、計算プロパティ
/// には付けられない)。そのため前回版では、3つの入力(`isFetching`・`isRefreshingEntitlements`・
/// `planStore.isLoadInProgress`)のいずれが変化しても`HomeView`は再描画されず、ボタンの
/// 活性・非活性が更新されない可能性があった(HQ指摘1〜3)。今回、`isRetryAvailable`自身を
/// ストアドの`@Published`プロパティに変更し、下記「isRetryAvailableのObservable化」の
/// Combineパイプラインで3つの入力の変化に追従して書き戻す設計にする。
@Published private(set) var isRetryAvailable = true

**isRetryAvailableのObservable化(今回・HQ指摘「必須修正：UI状態のObservable通知」対応)**: `isRetryAvailable`の3つの入力のうち、`isFetching`・`isRefreshingEntitlements`は`HomeViewModel`**自身**の`@Published`値であるため、`$isFetching`・`$isRefreshingEntitlements`がそのまま使える。しかし`planStore.isLoadInProgress`は**別のObservableObject(`PlanStore`)の値**であり、`PlanStore`側で`@Published`にしても(§1.2のとおり`loadInProgressCount`を`@Published`化済み)、それが発行する`objectWillChange`は`PlanStore`自身のものであって`HomeViewModel`のものではない。`HomeView`は`HomeViewModel`だけを`@StateObject`で監視している(`HomeView.swift:49`)ため、`PlanStore`側の`@Published`の発行だけでは`HomeView`は再描画されない。したがって、`HomeViewModel`の`init()`内で明示的にこの3つを合成し、結果を`HomeViewModel`自身の`@Published`プロパティ(`isRetryAvailable`)へ書き戻す橋渡しが必須である(HQ指摘1〜3に対応)。

**(今回・HQ再指摘により2点を修正)** 前回のコード(`.sink`から`Task { @MainActor in self?.isRetryAvailable = isAvailable }`で、通知時点に計算した`isAvailable`をそのまま代入する形)には、次の2つの問題があった。

1. **構築時点の初期値のずれ**: `Publishers.CombineLatest3`は購読開始時点で3つの`@Published`の現在値を即座に1回emitする(既存の`@Published`の仕様、§4.2.3「5.」参照)。しかし前回のコードはそのemitを受けて`Task { @MainActor in ... }`を生成するだけであり、**この代入自体は`init()`が返った後の、別のMainActorの実行ターンで初めて行われる**。そのため、`HomeViewModel`の構築時点で既に`planStore.loadInProgressCount > 0`(他経路からの`load()`が進行中)であっても、`init()`が返った直後から実際にこのTaskが実行されるまでの間は、`isRetryAvailable`は既定値`true`のままになり、一時的に「再試行可能」と誤って表示されうる。
2. **通知順序の入れ替わりによる上書き**: 複数回の通知(例: `loadInProgressCount`が2→1→0と短時間に連続して変化する)それぞれが個別の`Task { @MainActor in ... }`を生成するため、生成された複数のTaskが実行される順序は、Swift Concurrencyの標準的な保証の範囲では**厳密なFIFOとは限らない**(優先度や実行環境により入れ替わりうる)。前回のコードは各Taskが「自分が生成された時点の通知値(`isAvailable`、スナップショット)」をそのまま代入していたため、後から生成されたTaskが先に実行され、その後で先に生成されたTask(古いスナップショットを持つ)が実行されると、**最新の状態が古い値で上書きされてしまう**おそれがあった。

**修正方針**: (1)構築時点の初期値は、Combineの購読に委ねず`init()`内で**同期的に**直接計算して代入する。(2)各Taskは、通知時点のスナップショット値を使わず、**実行される時点で3つの入力をselfから直接再取得して計算し直す**。これにより、Taskの実行順序が入れ替わっても、どのTaskが最後に実行されようと、その実行時点の実際の値から再計算するため、古い値による上書きは構造的に発生しない(同じ入力の組み合わせからは常に同じ結果になる、冪等な再計算)。

```swift
// init()内、既存のplanStore.$stateの購読(§4.2.3)と同じ場所に追加する。
//
// (今回・第7次改訂・C指摘P3対応)この同期的な初期計算は、initが受け取る全てのストアド
// プロパティ(apiClient・favoritesStore・userID・cacheStore・planStore・
// prefetchCoordinator・authenticatedUserProvider・sleep・isFetching・
// isRefreshingEntitlements等)への代入が完了した**後**に実行すること。Swiftの2段階初期化
// (すべてのストアドプロパティが初期化されるまでself経由のメソッド・プロパティ読み取りが
// できない)により、これはコンパイラが強制する順序でもあるが、init()の本文を将来書き換える
// 際に「どこに置けば安全か」を明示するため、ここに明記する。既存のplanStore.$state購読
// (§4.2.3)より後、かつinit()の末尾付近に置くのが安全(そこまでに全プロパティの代入が
// 完了していることが構造上保証されているため)。

// (今回・HQ指摘対応・問題1の修正) Combineの購読が実際に最初の値を適用するのは
// init()が返った後になる(Task{@MainActor in}を経由するため)。この隙間を無くすため、
// 構築時点の3つの値から同期的に直接計算し、購読を設定する前にisRetryAvailableへ
// 代入する。これにより、既に他経路からのload()が進行中の状態でHomeViewModelが
// 構築された場合でも、初期値がtrueのまま一時的に「再試行可能」と誤表示されない。
self.isRetryAvailable = !isFetching && !isRefreshingEntitlements && !planStore.isLoadInProgress

// (今回・HQ指摘対応) isFetching・isRefreshingEntitlementsはHomeViewModel自身の@Publishedなので
// そのまま使えるが、planStore.loadInProgressCountは別のObservableObjectの値であり、
// 明示的に合成してこのインスタンス自身の@Publishedへ書き戻さない限りHomeViewの再描画に
// つながらない(本節の説明文参照)。
Publishers.CombineLatest3($isFetching, $isRefreshingEntitlements, planStore.$loadInProgressCount)
    .dropFirst()   // 初回のemitは上記の同期的な初期計算と重複するため不要(問題1の修正の一部)
    .map { isFetching, isRefreshingEntitlements, loadInProgressCount in
        !isFetching && !isRefreshingEntitlements && loadInProgressCount == 0
    }
    .removeDuplicates()
    .sink { [weak self] _ in
        // (今回・HQ指摘対応・問題2の修正) mapで計算した値(通知時点のスナップショット)は
        // 「何か変化があった」というトリガー、および.removeDuplicates()で重複発行を
        // 減らす目的にのみ使い、実際の代入には使わない。Taskが実行される時点でselfから
        // 3つの値を改めて直接読み直し、その場で再計算する。これにより、複数のTaskの
        // 実行順序が入れ替わっても、最後に実行されたTaskが常にその時点の実際の値を反映する
        // (古い通知値による上書きが構造的に発生しない)。
        Task { @MainActor in
            guard let self else { return }
            self.isRetryAvailable = !self.isFetching && !self.isRefreshingEntitlements && !self.planStore.isLoadInProgress
        }
    }
    .store(in: &cancellables)
```

`.map`での計算結果に対する`.removeDuplicates()`は、3つの入力それぞれの発行タイミングがずれても(例: `loadInProgressCount`が2→1→0と変化する途中、`isFetching`は変化していない場合)、合成結果(`Bool`)自体が変化していないときに不要なTaskの生成(と、それに伴う`HomeView`の再描画)を繰り返さないための効率目的の最適化であり、正しさには依存しない(`.sink`内の代入が常にselfからの再計算であるため、`.removeDuplicates()`を外しても、Taskの生成回数が増えるだけで最終的な値は変わらない)。

**HQ指摘4(`isPlanConfirmationSlow`が`false`→`true`になったときの再描画保証)への回答**: `isPlanConfirmationSlow`自身を`@Published`にしたことで(本節冒頭参照)、`self.isPlanConfirmationSlow = true`という代入(§4.2.1「scheduleWaitForPlanConfirmation()」のタイムアウトTask内、既存コードのまま変更なし)が`HomeViewModel`の`objectWillChange`を発行し、`HomeView`(`@StateObject`で監視)が次の描画サイクルで`body`を再評価する。これは`Combine`/`SwiftUI`の標準的な仕組み(`ObservableObject`の`@Published`プロパティへの代入は常に`objectWillChange`を発行する)であり、追加の橋渡しコードは不要である(`isFetching`等とは異なり、同一インスタンス内の値であるため)。

**HQ指摘5(`.loaded`を維持した再試行失敗でも`lastErrorRequiresPlanRetry`の変更がUIに反映される保証)への回答**: 同様に`lastErrorRequiresPlanRetry`を`@Published`にしたことで十分である。`retryNow()`の失敗分岐(§4.2.1のコード、`lastErrorRequiresPlanRetry = true`への代入)は`state`を変更しない経路(`.loaded`維持、P3-4対応)でも必ず実行されるため、`state`が変化しない場合でも`lastErrorRequiresPlanRetry`への代入自体が独立して`objectWillChange`を発行し、`HomeView`を再描画させる。`HomeView`側(§9、未実施のコード変更)は、`.loaded`表示に重ねて`lastErrorRequiresPlanRetry`を見た案内(小さな失敗通知等)を出す設計にすることで、この再描画を実際の表示更新に結び付ける。

**C指摘(P3)への対応(今回・第7次改訂)**: HQから伝えられたCの指摘は、具体的な指摘文そのものではなく要約(「再描画コスト」「計算プロパティ化」「コンパイル・Swift 6未確認」)として渡されており、原文との一致確認はできていない(§11「未検証」に同種の制約を既に記載している前例に合わせ、ここでも明記する)。渡された要約に基づき、以下のとおり対応する。

- **P3-1・P3-2(再描画コスト)**: `isFetching`・`isRefreshingEntitlements`・`lastErrorRequiresPlanRetry`・`isPlanConfirmationSlow`・`PlanStore.loadInProgressCount`を`@Published`化したことで、これらの値が変化するたびに(たとえ`HomeView`がその値を直接表示に使っていない場合でも)`objectWillChange`が発行され、`HomeView.body`全体が再評価される。`@Published`は値単位ではなくオブジェクト単位の粗い通知であるため、例えば`isFetching`が`fetch()`の開始・終了ごとに`true`/`false`を切り替えるだけで、`HomeView`全体の再描画が毎回発生する。これは今回の修正で新たに増えたコストであり(修正前はこれらが`private`な非`@Published`var・計算プロパティだったため、この種の再描画は発生しなかった)、今回は設計変更を行わず**実装時の注意事項として残す**。実装時にInstrumentsの「SwiftUI」テンプレート等で実際の再描画頻度を確認し、ユーザー体感上の問題(カクつき等)が見られる場合に対策(後述の通知範囲の最小化、または`HomeState`の構造見直し)を検討すること。
- **@Publishedの通知範囲の最小化(実装時の確認事項)**: 上記の再描画コストを抑えるため、実装時に次の点を確認すること: (a) `isFetching`・`isRefreshingEntitlements`は内部の進行管理にのみ使われ、`HomeView`が直接読むのは`isRetryAvailable`・`isPlanConfirmationSlow`・`lastErrorRequiresPlanRetry`の3つのみであるため、将来的に`HomeView`が参照する`@Published`プロパティと内部管理用の`@Published`プロパティを分離する(例: 内部用は`@Published`を外し、別の軽量な変更通知機構に置き換える)余地があるかどうか。(b) SwiftUIが`@Published`の変更を検知して実際に再描画が必要と判断するのは`body`が依存する値が変わった場合のみであり、`body`の構造自体が`isFetching`等を直接参照していなければ、再描画自体は発生しても見た目の差分は無い(実害が無い)ことが多い。過度な最適化(各プロパティを個別の`ObservableObject`に分離する等)は今回は行わない。
- **P3-3(計算プロパティ化は今回は必須にしない)**: `isRetryAvailable`を計算プロパティに戻す(例: `var isRetryAvailable: Bool { !isFetching && !isRefreshingEntitlements && !planStore.isLoadInProgress }`としたうえで、`HomeView`側で`onReceive`等により手動で再描画をトリガーする設計)という選択肢も検討したが、**今回は採用せず、ストアドの`@Published private(set) var`という現在の設計を維持する**。維持する理由: (1)計算プロパティ化すると、3つの入力の変化を`HomeView`に伝える手段を別途用意する必要があり(計算プロパティ自身は`@Published`の`$`投影を持てないため)、結局本節の`Publishers.CombineLatest3`相当の橋渡しが必要になり、複雑さが変わらない。(2)現在の設計はテスト39〜44で既に検証済みであり、再設計すると再検証が必要になる。**実装時に再検討する条件**: 実際にInstrumentsで計測した結果、`isFetching`・`isRefreshingEntitlements`の切り替わり頻度(例: Home取得が数秒おきに発生する画面等)が原因で視認できる再描画コストが生じると判明した場合、そのときに計算プロパティ化(またはプロパティレベルの通知機構)への切り替えを再検討すること。
- **P3-8(コンパイル・Swift 6未確認)**: 本節のコード例(`Publishers.CombineLatest3`・`.removeDuplicates()`・`Task { @MainActor in }`を含む`.sink`)が、実際のSwiftコンパイラ、特にSwift 6の厳格な並行性チェック(`StrictConcurrency`)のもとでエラー・警告無くコンパイルされることは**未確認のまま明記する**(§11「未検証」に既存の`P3-7対応`と同様の形で追加。`@MainActor`クラスの`@Published`プロパティをCombineの`.sink`クロージャ内で読み書きする際のactor-isolation検査が、使用するSwiftツールチェーンのバージョンによって挙動が異なる可能性があるため)。実装着手時に、対象プロジェクトの実際のSwiftバージョン・並行性チェックモードで最初に確認すること。

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
    // (今回・P2-2対応、新設。今回・P2-4対応でHQ指摘に基づき無反応をやめる)
    // 既にSplash等から開始された同一ユーザーのEntitlements取得が進行中であれば、
    // 新たに発行しない(不必要にsupersedeすると、進行中だった(成功する可能性があった)
    // リクエストを無駄に破棄してしまう。§1.2「isLoadInProgress」参照)。確認の完了は
    // $state経由でhandlePlanStateChangedが検知するため、安全性には問題が無い。
    // ただし、通常は`isRetryAvailable == false`の間にUI側がボタンを非活性にするため、
    // この分岐に到達するのは稀(ボタンの非活性化がまだ反映されていない一瞬、または
    // 将来UI側が非活性化を実装し忘れた場合の防御的経路)である。到達した場合も
    // ユーザーに「何も起きなかった」と無言で返すのではなく、診断記録を残す。
    guard !planStore.isLoadInProgress else {
        DiagnosticsStore.shared.recordRetryIgnoredWhileEntitlementsInProgress()
        return
    }
    cancelPlanConfirmationWait()
    isRefreshingEntitlements = true
    Task {
        defer { self.isRefreshingEntitlements = false }
        let result = await self.planStore.load(
            apiClient: self.apiClient, userID: userID, authenticatedUserProvider: self.authenticatedUserProvider
        )
        switch result {
        case .confirmed:
            // Home取得は§4.3のhandlePlanStateChangedが自動的にトリガーする
            // (そちらがisPlanConfirmationSlowも消費する)。
            break
        case .supersededByNewerRequest, .userMismatchOrUnknown, .authenticationUnverifiable:
            // (今回・P2-2対応) これらは「確認が失敗した」とは言えない: 別の正当なリクエストに
            // 追い越された、またはそもそも検証不能だった、というこの呼び出し自体の事情であり、
            // Entitlements自体が取得できないと確定したわけではない。.errorへは遷移しない。
            DiagnosticsStore.shared.recordRetryEntitlementsNotConfirmed(result: result)
        case .malformedResponse, .requestFailed:
            // (今回・P2-2対応、今回・第7次改訂で訂正) 実際に確認が失敗した(通信失敗・応答不正)。
            // §3のHQ決定(案B採用)により、plan/limits両方欠落のケースもこの.malformedResponseに
            // 統合済みであり、もはや「HQ判断待ちで保留」ではない。
            // (今回・P3-4対応、HQ指摘により追加) 既に.loadedで何らかの表示(キャッシュまたは
            // 直近の正常取得)がある場合は、それを.errorで消してしまわない。applyFetchFailure()
            // と同じ「既存の.loaded表示は保護する」方針をここでも適用する。
            DiagnosticsStore.shared.recordRetryEntitlementsNotConfirmed(result: result)
            lastErrorRequiresPlanRetry = true
            // (今回・P3-5対応) 確認が実際に失敗したと確定したため、「時間がかかっている」
            // 表示は既に意味を持たない(失敗が確定した、という異なる状態になったため)。
            isPlanConfirmationSlow = false
            if case .loaded = state {
                // 表示は変更しない。失敗した事実と再試行可能であることはlastErrorRequiresPlanRetry
                // 経由でHomeView側が(例えば小さな案内として)伝えられるようにする(§9参照)。
            } else {
                state = .error("プランの確認に失敗しました。もう一度お試しください。")
            }
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
    // (今回・HQ指摘対応) 既存のplanStore.$state購読(§4.2.3)に加えて、isRetryAvailableを
    // 合成するPublishers.CombineLatest3の購読もここで行う(§4.2.1「isRetryAvailableの
    // Observable化」参照)。
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

**fetch()側の既存guardとの整合性(今回・P2-F対応、再訂正)**: `scheduleWaitForPlanConfirmation()`は`fetch()`の`guard let context = planStore.confirmedContext, context.userID == userID else { scheduleWaitForPlanConfirmation(); return }`というELSE節からのみ呼ばれる。この呼び出しと、`scheduleWaitForPlanConfirmation()`内部で`planStore.confirmedContext`を**再度読む**処理との間には、`await`も状態変更も一切無い(完全に同期的)。したがって、`scheduleWaitForPlanConfirmation()`内部で読み直した`confirmedContext`の値は、`fetch()`側のguardが読んだ値と**論理的に必ず同一**になる。これを踏まえ、`scheduleWaitForPlanConfirmation()`内部の分岐の到達可能性を再整理する(前回の記載は不正確だった。2回の訂正を経て、以下が最終的な整理)。

- **① `authenticatedUserProvider`不一致の分岐**: `fetch()`側の対応するguard(①、`scheduleWaitForPlanConfirmation()`呼び出しより前)を既に通過済みであるため、呼び出しの間に`authenticatedUserProvider`の返り値が変化しない限り、`scheduleWaitForPlanConfirmation()`内部の①は**常に真**になる。現在の唯一の呼び出し元(`fetch()`)から呼ばれる限り**到達不能**。
- **②「確定済み・一致」の分岐(`cancelPlanConfirmationWait()` + `startFetchIfNeeded()`)**: `fetch()`側の呼び出し条件自体が「`confirmedContext`が`nil`、または`confirmedContext.userID != userID`」であり、これは②の条件(`confirmedContext`が存在し`userID`も一致)の**論理的な否定**である。したがって、`scheduleWaitForPlanConfirmation()`が`fetch()`から呼ばれる限り、②の条件は**構造的に成立し得ない**(こちらも①と同様に完全に到達不能。前回の記載「②は到達可能」は誤りだったため訂正する)。
- **③「確定済みだが不一致」の分岐(診断記録 + `cancelPlanConfirmationWait()`)**: `fetch()`側の呼び出し条件の一方(`confirmedContext.userID != userID`)と完全に一致するため、**到達可能**(別ユーザーでPlanStoreが確定した後に`load()`が再度呼ばれるケース。§8テスト31で検証)。
- **④「本当に未確定」の分岐(重複防止 + 新規待機)**: `fetch()`側の呼び出し条件のもう一方(`confirmedContext == nil`)と完全に一致するため、**到達可能**(§8テスト23・29で検証)。

**結論**: `scheduleWaitForPlanConfirmation()`内部の4分岐のうち、①②は現在の唯一の呼び出し元から呼ばれる限り構造的に到達不能、③④のみが到達可能である。①②は、`scheduleWaitForPlanConfirmation()`を将来`fetch()`以外から呼ぶ場合や`fetch()`側のguard順序が変わった場合に備えた防御的分岐として残す(`commit()`の規則6・§1.2.1と同じ扱い。アクセスレベル変更等は行わない)。「動作の変化は無い」という記載は①にのみ該当し、②は元々到達しない分岐である以上「動作の変化」という表現自体が適切でなかった。

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

**(今回・P2-1対応)`load()`に`isExplicitRefresh`パラメータを追加**: `HomeView.swift`は`load()`を2つの異なる意図で呼ぶ(§4.3.1参照) — `.task`による**通常起動**(自動)と、`.onChange(of: path.count)`による**画面復帰時の明示的な再取得**(通貨ペア編集から戻った場合等)。前回の設計は両者を区別せず、`startFetchIfNeeded()`が busy 中に呼ばれた場合は常に`needsRefetch`を立てていたが、これは通常起動時のCombine初回通知と`.task`のレースでも不要な2回目のFetchを誘発してしまう(§4.3.1で詳述)。`isExplicitRefresh`(既定`false`)を追加し、`true`の場合のみ`needsRefetch`を立てる対象にする。

```swift
/// `isExplicitRefresh`: `true`は「HomeViewからの明示的な再取得要求」(今はHomeView.swift:79-83の
/// `.onChange(of: path.count)`のみ)を意味する。`.task { load() }`(既定`false`)や、
/// Combine購読からの間接的な呼び出しとは区別する(§4.3.1参照)。
func load(isExplicitRefresh: Bool = false) {
    if case .loaded = state {
        // 表示を残したまま更新する。
    } else if let snapshot = cacheStore.load(for: cacheContext()) {
        applyCache(snapshot)
    } else {
        state = .loading
    }
    startFetchIfNeeded(isExplicitRefresh: isExplicitRefresh)   // (変更) Task { await fetch() } の直接呼び出しを廃止
}

private func planConfirmed() {
    // (今回・P2-B対応、今回・P3-1対応で呼び出し元を再訂正) confirmedPlan(無引数版)ではなく、
    // 必ずconfirmedPlan(for:)を使う。PlanStore.reset()は`AppState.leaveLoggedIn()`からは
    // 呼ばれていない(`AppState.leaveLoggedIn()`はcurrentUserID/homeCache.clear()/
    // prefetchCoordinator.reset()のみを行う、AppState.swift:35-40)。実際には
    // `RootView.swift`が`.onAppear`(41行目、ログイン画面表示時)と`MainTabView`の
    // onSignOutクロージャ(54行目、明示的なログアウト時)の2か所で`PlanStore.shared.reset()`を
    // 直接呼ぶ。このタイミングに依存せず、「PlanStoreが今確定しているプランが、本当に
    // このインスタンスのuserIDのものか」をこの場でも直接検証する。
    guard let userID, let plan = planStore.confirmedPlan(for: userID) else { return }
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

**6. `confirmedPlan`と`set(plan:limits:confirmed:)`の既存API互換性(今回・P2-B対応により訂正)**: §1.2で`confirmedPlan`(strict、`.confirmed`のときのみ非nil)と`set(plan:limits:confirmed:userID:)`(テスト・プレビュー専用ヘルパー、既存のシグネチャに`userID`パラメータを追加しただけで既存の呼び出し(`userID`省略)もそのままコンパイルが通る)を再設計・復元済み。**訂正**: 前回の記載「`HomeViewModel.planConfirmed()`・`cacheContext()`はいずれも変更なしでそのまま動作する」は不正確だった。

`confirmedPlan`(無引数版)は「PlanStoreが今確定している、何らかのユーザーのプラン」を返すだけで、呼び出し元が意図する`userID`との一致を検証しない。`planConfirmed()`・`cacheContext()`はいずれも`self.userID`という具体的な対象を持っているため、**`confirmedPlan(for:)`(§1.2で新設)に差し替える必要がある**。

```swift
private func cacheContext() -> HomeCacheContext {
    HomeCacheContext(
        userID: userID,
        date: Self.isoDateFormatter.string(from: now()),
        timezone: TimeZone.current.identifier,
        // (今回・P2-B対応) confirmedPlanではなくconfirmedPlan(for:)を使う。userIDがnilの場合は
        // そもそも対象ユーザーが無いため、Optional.flatMapでそのままnilに落とす。
        confirmedPlan: userID.flatMap { planStore.confirmedPlan(for: $0) }
    )
}
```

`planConfirmed()`の修正は本節冒頭の既存コードブロック(`guard let userID, let plan = planStore.confirmedPlan(for: userID) else { return }`)に反映済み。`HomeCacheStore`(`HomeCacheContext.confirmedPlan`・`discardIfPlanDiffers(confirmedPlan:)`)自体は変更不要(`HomeViewModel`側が渡す値が、呼び出し元で既に`userID`検証済みになったため)。

**なぜRootViewのreset()タイミングだけに依存しないのか(P2-B対応、今回・P3-1対応で呼び出し元を訂正)**: `PlanStore.reset()`は`RootView.swift:41`(`.loggedOut`ケースの`.onAppear`、セッション切れ・未ログインでログイン画面に出た時)と`RootView.swift:54`(`.loggedIn`ケースの`MainTabView`に渡す`onSignOut`クロージャ、明示的なログアウト時)の2か所で呼ばれる(`AppState.leaveLoggedIn()`からは呼ばれていない。前回までの記載は誤りだったため訂正)。いずれも、ログアウトという「分かっている」イベントでのみ呼ばれる。しかし、`PlanStore`は`.shared`シングルトンであり、**ユーザー切替の過渡期**(`RootView.swift`のこれらの呼び出しと新規ログインの間の短い時間窓、または実装上の呼び出し順序次第)に、`planConfirmed()`・`cacheContext()`が「`reset()`はまだ呼ばれていないが、`confirmedContext`は既に別ユーザーのものに変わっている」という状態を読む可能性を**実装の詳細(呼び出し順序)に依存せず**排除する必要がある。`confirmedPlan(for: userID)`は、`reset()`が呼ばれたかどうかに関わらず、**`confirmedContext.userID`を直接比較する**ため、タイミングに依存しない恒久的な安全性を提供する。

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
    // (今回・P3-5対応、新設) PlanStore.reset()(ログアウト)によりstateが.unconfirmed(lastKnown: nil)
    // へ戻った通知も、ここで検知して待機・「時間がかかっている」表示を片付ける。このインスタンスの
    // userIDが変わるわけではないが、ログアウトによりEntitlements確認自体が意味を失うため。
    guard case .confirmed(let context) = state, context.userID == userID else {
        if case .unconfirmed = state { cancelPlanConfirmationWait() }
        return
    }
    guard context.generation > (lastFetchedGeneration ?? Int.min) else { return }
    pendingGeneration = max(pendingGeneration ?? Int.min, context.generation)   // 後退させない
    cancelPlanConfirmationWait()   // (今回・P3-5対応) isPlanConfirmationSlowの解除もここで行う(§4.3.2参照)
    startFetchIfNeeded()
}

/// (今回・P2-1対応) `isExplicitRefresh`の既定は`false`。`planConfirmed()`・
/// `handlePlanStateChanged()`・`scheduleWaitForPlanConfirmation()`はいずれも既定値のまま
/// (`isExplicitRefresh`を渡さない)で呼ぶ — これらはPlanStoreの内部状態変化に対する
/// 反応であり、「HomeViewからの明示的な更新要求」ではないため、busy中に来ても
/// `needsRefetch`を立てない(§4.3.1参照)。
private func startFetchIfNeeded(isExplicitRefresh: Bool = false) {
    guard !isFetching else {
        // (今回・P2-1対応で絞り込み) 実行中のfetchがある間に呼ばれた場合、
        // isExplicitRefreshがtrueのときだけ「完了後にもう1回」を予約する。
        // falseの場合は単に無視する(前回設計に戻す。§4.3.1参照)。
        if isExplicitRefresh { needsRefetch = true }
        return
    }
    isFetching = true
    Task { await fetch() }   // fetch()には何も渡さない
}
```

**明記事項①**: `handlePlanStateChanged`の引数`state`は、`pendingGeneration`を更新するかどうかの判断にのみ使用し、**`fetch()`に渡すことは一切しない**。`startFetchIfNeeded()`は引数を取らず、単なる起動トリガーである。`fetch()`は常に**実行時点でライブに`planStore.confirmedContext`を読み直す**ため、どの通知Task(新しいgenerationのものでも古いgenerationのものでも)が実際に`startFetchIfNeeded()`を呼び出すに至っても、実際にネットワーク取得に使われる文脈は常に最新のものになる。この構造により、Combineの`.sink`→`Task { @MainActor in }`という既存パターン(`HomeViewModel.swift:190-194`)が持つ配信順序の不確実性(gen6とgen7の通知Taskが逆順に実行される可能性)があっても、古いgenerationでfetchが実際に開始される経路は構造的に存在しない。

`pendingGeneration`の更新を`max()`で後退させないようにしているのは、gen7の通知Task→gen6の通知Taskという逆順実行があった場合に、`pendingGeneration`がgen7からgen6へ後退し、`lastFetchedGeneration`が最終的にgen7になった後も`pendingGeneration(6)`が永久に古いまま残って不要な再取得を無限に繰り返す、という不具合を防ぐためである。

**(今回・P3-1対応)`.userChanged`診断が記録される経路の正確な整理**: `.userChanged`(§4.5のC-1)が記録されるのは、**§4.2の`fetch()`のdo節内、レスポンス受信後の判定(`if liveUserID != requestSnapshot.userID { DiagnosticsStore.shared.recordHomeFetchDiscarded(reason: .userChanged) }`)1か所のみ**である。これより前にある2つの送信前guard — `fetch()`冒頭の`authenticatedUserProvider`一致確認、`handlePlanStateChanged()`冒頭の同じ確認 — のいずれも、診断を記録せずに`return`する(各ガードのコード中コメント参照)。これらは「取得済みのレスポンスを破棄した」イベントではなく「そもそも取得を試みなかった/通知を処理しなかった」イベントであるため、`.userChanged`という「破棄」を意味する診断と意味合いが異なり、意図的に記録していない。以前の記載(§4.2.1「不一致時の動作の整理」表の脚注)にあった「`.userChanged`としての記録はfetch()側に委ねる」という表現は、どちらの経路を指すか曖昧だったため、上記のとおり1か所に限定して明確化した。

**(今回・P3-2対応)残存する待機・タイムアウトTaskの整理**: `fetch()`冒頭・`handlePlanStateChanged()`冒頭のいずれの一致確認guardも、不一致の場合に`cancelPlanConfirmationWait()`を呼ぶように修正した(§4.2・本節のコード参照。修正前はいずれも単に`return`するだけで、待機状態を片付けていなかった)。これにより、ユーザー切替・ログアウト後に取り残された古いインスタンスに待機中のタイムアウトTaskが残っていた場合でも、これらのguardのいずれかを一度でも通過すれば片付く。**残存リスクとして明記する点**: 古いインスタンスがこれらのguardを一度も通過しないまま放置される経路(例: Combine購読が解放され`handlePlanStateChanged`が一切呼ばれなくなり、かつ`fetch()`も二度と呼ばれない場合)では、タイムアウトTask自体は`Task.sleep`の経過後に自然に完了し`recordPlanConfirmationTimedOut()`を1回記録して終わるため、**無限に残り続けることは無い**(タイムアウトTaskは`self`を弱参照で捕捉しているため、インスタンス自体の解放も妨げない)。この1回分の「古いインスタンスによるタイムアウト診断」が診断ログに混入する可能性は残るが、実害(誤ったデータの採用・無限リソース保持)は無いため、これ以上の対策(例: `deinit`での明示的キャンセル)は本設計の範囲では追加しない(§11に残存事項として記載)。

### 4.3.1 通貨ペア編集後の再取得(P2-A対応、今回・P2-1対応で再修正)

**問題の再現条件**: `HomeView.swift:70-83`(既存コード、変更なし)は次の2つの経路で`viewModel.load()`を呼ぶ。

```swift
.task { viewModel.load() }
.onChange(of: path.count) { _, newCount in
    if newCount == 0 {
        viewModel.load()
    }
}
```

通貨ペア編集画面(SCR-026)はこの`NavigationStack`に積まれるため、編集後に戻ると`path.count`が0に戻り、`load()`が**再度**呼ばれる。修正前の設計(P2-A時点)では、`startFetchIfNeeded()`が`isFetching == true`の間に呼ばれた場合、単に無視して`return`していた。したがって、1回目のFetch(編集前に開始)がまだ進行中のうちに編集から戻ってきて2回目の`load()`が呼ばれると、その2回目は**完全に無視**され、1回目の(編集前の設定を反映した)古いレスポンスがそのまま最終状態として採用されてしまう。

**(今回・P2-1対応)過剰な再取得(誤作動)の修正**: P2-A時点の修正は、`startFetchIfNeeded()`がbusy中に呼ばれた場合に**常に**`needsRefetch`を立てていた。これは`startFetchIfNeeded()`のすべての呼び出し元(`load()`・`planConfirmed()`・`handlePlanStateChanged()`・`scheduleWaitForPlanConfirmation()`)を区別しないため、次のような**不要な**再取得を誘発する:

- `init`内の`$state`購読の初回通知(§4.2.3の5番)が`handlePlanStateChanged()`経由で`startFetchIfNeeded()`を呼び、その直後に`.task { load() }`も`startFetchIfNeeded()`を呼ぶ、という通常起動時の既知のレースにおいて、片方がbusy中に他方を呼ぶと、修正前の設計では`needsRefetch`が立ち、**1回目のFetch完了後に全く不要な2回目のFetchが走ってしまう**(通貨ペア編集等、状態変化の実体が無いにもかかわらず)。

これを避けるため、`load()`に`isExplicitRefresh: Bool = false`を追加し(§4.2.3の3番のコード参照)、`startFetchIfNeeded(isExplicitRefresh:)`が**`isExplicitRefresh == true`の場合のみ**busy中に`needsRefetch`を立てるようにした(§4.3のコード参照)。`isExplicitRefresh: true`を渡すのは`HomeView.swift`の`.onChange(of: path.count)`(**今回・未実施のSwiftコード変更**、§9参照)のみであり、`.task { load() }`(既定`false`)・`planConfirmed()`・`handlePlanStateChanged()`・`scheduleWaitForPlanConfirmation()`(いずれも既定値のまま呼ぶ)はbusy中に何もしない(修正前と同じ、単純に無視する挙動に戻す)。

**`startFetchIfNeeded()`のすべての呼び出しの分類(P2-1対応)**:

| 呼び出し元 | `isExplicitRefresh` | busy中の挙動 | 理由 |
|---|---|---|---|
| `load()`(`.task { load() }`経由、`HomeView.swift:70`) | `false`(既定) | 無視 | 通常起動。状態変化は無い |
| `load(isExplicitRefresh: true)`(`.onChange(of: path.count)`経由、`HomeView.swift:79-83`) | `true` | `needsRefetch`を立てる | **HomeViewからの明示的な更新要求**。通貨ペア編集等、外部状態が変わった可能性がある |
| `planConfirmed()` | `false`(既定) | 無視 | PlanStoreの状態変化への反応(内部トリガー) |
| `handlePlanStateChanged()` | `false`(既定) | 無視 | 同上。generationに基づく正規の追い越し判定(`pendingGeneration`)は別途`shouldChainNext`で処理されており、`needsRefetch`は不要 |
| `scheduleWaitForPlanConfirmation()`(確定済みの場合) | `false`(既定) | 無視 | 同上(内部トリガー) |

**連続した再取得要求・重複fetch・無限ループの考慮(P2-1対応で再確認)**:
- **連続した要求**: `needsRefetch`は真偽値(カウンタではない)なので、`isExplicitRefresh: true`での呼び出しが進行中に何度来ても1回の`true`に収束する。完了後に起動される追加のFetchは常に最大1回。
- **重複fetch**: `isFetching`ガード自体は変更していない。「busyなら新規Taskを起動しない」という既存の排他制御はそのまま維持される。
- **無限ループ**: `needsRefetch`を立てるのは`isExplicitRefresh: true`での外部呼び出し(`HomeView`からの明示的要求)のみであり、`fetch()`自身が自分で`needsRefetch`を立てることは無い。したがって、新たな明示的トリガー(編集画面への再訪問等)が来ない限り、2回目のFetchの後にさらに3回目が続くことは無い(自己増殖しない)。

**fetchが最大1回である条件(今回・明確化)**: 任意の時点で実際に実行中のFetch(`fetch()`のTask)は`isFetching`により常に**最大1つ**。これに加えて、「`isExplicitRefresh: true`での呼び出しが実行中のFetchの間に来た回数」は、実際に追加されるFetchの回数には変換されず、**完了後に最大1回だけ**追従する(集約されるため)。したがって、同時に走るFetchは常に1つ、かつ1回の実行中Fetchに対して明示的要求が何回来ても追従するFetchは1回を超えない。

**この修正が古い通貨ペア設定のレスポンスを最終状態にしないことの説明**: 2回目のFetch(`isExplicitRefresh: true`での`load()`呼び出し後に起動される)は、起動時点で`endpoint`・`today`・`timezone`等を**その時点の状態から再構築**する(§4.2のコード冒頭)。通貨ペア編集はサーバー側の設定を変更するものであり、2回目のFetchが実際にサーバーへ送信される時点では、既に編集後の設定が反映されている(編集画面からの復帰後に送信されるため)。

**(今回・P3-1対応、訂正)1回目(編集前)の応答が一時的に反映されるリスクの正確な記述**: 前回の記載は「2回目のFetchが1回目より先に完了する競合」という表現を使っていたが、これは不正確だった。`needsRefetch`による2回目のFetchは、1回目のFetchの`Task`が**完全に完了してから**(`fetch()`の`defer`内で`startFetchIfNeeded()`を呼ぶため)起動される、**厳密に直列(シリアライズ)**な処理であり、1回目と2回目が同時に実行されて順序が入れ替わる、という意味での「競合」は構造的に発生しない。正確なリスクは次のとおりである: 1回目のFetch(編集前の設定を反映した応答)は、2回目が始まる**前に**必ず一度`state`/キャッシュへ適用される(ケースAとして確定済みgenerationと一致するため)。したがって、編集画面から戻った直後、2回目のFetchが完了するまでの**短い時間窓**では、**編集前の(古い)内容が画面に一度表示される**ことが構造的に確実に起こる。これは競合ではなく、`needsRefetch`の設計上必然的に生じる、一瞬だけ古い内容が見える既知の特性であり、2回目のFetchの完了により正しい内容に更新される。実害(誤ったデータの永続的な採用)は無いが、UXとして「一瞬ちらつく」可能性がある残存特性として記載する(§10参照)。

### 4.3.2 タイムアウト時のUXと復旧経路(P2-E対応、今回・P2-2対応で再設計)

**前回(P2-E)の設計とその問題点**: 前回は、10秒のタイムアウトで`state`が`.loading`のままであれば自動的に`.error(...)`へ遷移させていた。これは「C第3回レビューP2-2」で問題視された: **タイムアウトは「確認がまだ終わっていない」ことしか意味せず、「確認が失敗した」ことを意味しない**。Splash側の`/entitlements`が単に遅いだけ(低速回線・Render Freeのコールドスタート等)で、10秒経過後も普通に成功するケースは十分にありうる。このようなケースでも機械的に`.error`を出すと、実際には何も失敗していないのに失敗したかのような画面を一時的に見せてしまう。

**今回の修正方針**: 「タイムアウトと実際の通信失敗を区別する。タイムアウト時は待機表示を維持し、確認失敗が確定した場合にのみエラー表示へ遷移する」という方針を採用する。

1. **タイムアウト(10秒)時**: `state`は変更しない(`.loading`のまま)。代わりに`isPlanConfirmationSlow = true`をセットする(§4.2.1のコード末尾)。これは「エラーではないが、時間がかかっている」という情報であり、`.error`への遷移を伴わない。
2. **確認が実際に完了した場合**: `handlePlanStateChanged()`が検知し、`isPlanConfirmationSlow = false`にリセットしてFetchを開始する(§4.3のコード参照)。何も特別なことは起きない(通常の確定フローに合流する)。
3. **確認が実際に失敗したと確定する場合**: これは「`retryNow()`自身がEntitlements再確認を試み、その結果が`.confirmed`以外の実際の失敗系`LoadResult`(`.malformedResponse`/`.requestFailed`。★HQ決定(案B採用)により`.pendingPolicyDecision`は廃止され`.malformedResponse`に統合された)だった」場合のみに限定する(§4.2.1「retryNow()」参照)。この場合のみ`lastErrorRequiresPlanRetry = true`をセットし、`state = .error(...)`へ遷移する。`.supersededByNewerRequest`・`.userMismatchOrUnknown`・`.authenticationUnverifiable`は「このリクエスト自体の事情」であり「確認が失敗した」とは言えないため、`.error`にはしない(§4.2.1参照)。

**HomeViewの状態表示と再試行経路(今回・P3-5対応で明確化)**: `HomeView`には**2種類の異なる再試行**が必要になる。既存の`.error`(Home取得自体が失敗した、プランとは無関係な通常の更新失敗)と、今回新設する「プラン確認失敗」の`.error`を区別する。

| 状況 | `state` | `isPlanConfirmationSlow` | `lastErrorRequiresPlanRetry` | 適切な再試行 |
|---|---|---|---|---|
| 通常のHome取得失敗(既存、プランは無関係) | `.error` | `false` | `false` | `load()`(既存のまま) |
| プラン確認がタイムアウトしただけ(まだ失敗確定ではない) | `.loading` | `true` | `false` | `retryNow()`(待機表示に重ねて出す案内・ボタンから) |
| プラン確認が実際に失敗した(`retryNow()`自身の結果) | `.error` | `false`(前の`retryNow()`呼び出しで消費済み) | `true` | `retryNow()` |

**`isPlanConfirmationSlow`の解除条件(今回・P3-5対応、4条件を明記)**: 以前は「成功時に`handlePlanStateChanged()`内で解除する」という1条件しか明記されておらず、他の経路での解除が実装・文書の両面で漏れていた。今回、解除が必要な状況を次の4条件に分け、それぞれどこで・どう解除するかを明記する。

| # | 状況 | 解除のタイミング・実装箇所 | 備考 |
|---|---|---|---|
| ① 成功 | Entitlements再確認が完了し、`confirmedContext`が確定した | `cancelPlanConfirmationWait()`(§4.2.1で新設、タイムアウト監視Taskのキャンセルと同時に`isPlanConfirmationSlow = false`を設定)を`handlePlanStateChanged()`の確定イベント受信時に呼ぶ | 待機対象だったTaskのキャンセルと解除を1箇所に集約し、片方だけ行われる状態を防ぐ |
| ② 再試行失敗 | `retryNow()`自身がEntitlements再確認を試み、実際の失敗系`LoadResult`が確定した | `retryNow()`の失敗分岐内で明示的に`isPlanConfirmationSlow = false`を設定する(§4.2.1「retryNow()」参照) | この経路は`cancelPlanConfirmationWait()`を再度呼ばない(呼ぶべきタイムアウト監視Taskは既に無い、または既にキャンセル済みのため)、別途の明示的な解除が必要 |
| ③ ユーザー切替 | `authenticatedUserProvider`が返す`userID`が、待機開始時点のものと異なると判明した(`fetch()`・`handlePlanStateChanged()`・`scheduleWaitForPlanConfirmation()`内の各ユーザー不一致ガード) | いずれのガードも`cancelPlanConfirmationWait()`を呼ぶため、①と同じ経路で解除される | 「ユーザーが変わった」という事象そのものに専用の解除コードは無く、既存の`cancelPlanConfirmationWait()`呼び出しに相乗りする形で解除される |
| ④ reset | `PlanStore.reset()`が呼ばれ、`state`が`.unconfirmed(lastKnown: nil)`に変化した(呼び出し元: `RootView.swift:41,54`、§0・P3-1参照) | `handlePlanStateChanged()`に今回追加した`.unconfirmed`ケース分岐が`cancelPlanConfirmationWait()`を呼ぶ(①と同じ経路) | `@Published`の再発行保証(値が変わらなくても`state`への代入は常に`$state`を発行する)により、`reset()`後に同じ`.unconfirmed`へ再度`reset()`されても確実に発行・解除される |

4条件のうち①③④は`cancelPlanConfirmationWait()`への集約により同じコードパスで解除され、②のみ`retryNow()`の失敗分岐内に専用の解除コードを持つ。これにより「どこかの経路だけ解除し忘れる」という漏れを構造的に防ぐ。

**HomeViewの変更範囲(§9・§10に転記、今回・未実施のSwiftコード変更)**:

```swift
// (将来の実装、§9参照。今回はコード変更しない)
// 1. .loading表示に、isPlanConfirmationSlowがtrueの間だけ「時間がかかっています」の
//    案内とretryNow()を呼ぶボタンを重ねる(既存のLoadingViewへの追加)。
// 2. .error表示のonRetryを、lastErrorRequiresPlanRetryに応じて振り分ける。
ErrorView(title: "読み込みに失敗しました", message: message, onRetry: {
    if viewModel.lastErrorRequiresPlanRetry {
        viewModel.retryNow()
    } else {
        viewModel.load()
    }
})
```

`lastErrorRequiresPlanRetry`・`isPlanConfirmationSlow`(いずれも§4.2.1で新設、`private(set)`で公開)を`HomeViewModel`側に置くことで、`HomeState`自体のケース追加(既存の`switch viewModel.state`への影響が大きい変更)を避け、影響範囲を`HomeView.swift`の2箇所(`.loading`表示・`ErrorView`の`onRetry`)に限定できる。

**§4.6のタイムアウト判断との整合性(今回・P2-2対応で確認)**: §4.6はHome Prefetchの開始タイミング(案1/2/3)に関する議論であり、本節の10秒タイムアウトとは別の仕組み(Entitlements確認自体の遅延許容)を扱っている。§4.6のいずれの案を採用しても、本節の「タイムアウトでは`.error`にしない」という方針とは矛盾しない(§4.6案2・案3はPrefetch開始タイミングを変えるだけで、確認が遅れた場合の`HomeViewModel`側の待機・UX方針には影響しない)。

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

### 4.6 Home Prefetchの実効性の再検討(★HQ決定済み: 案3を目標方針として採用)

典型的なコールドスタートでは`contextAtDispatch`がほぼ常にnilとなり(§4.1)、先行取得した`/home`レスポンスがほとんど再利用されないという構造的な制約がある。これを踏まえ、3つの方向性を比較する。**いずれの案でも、安全性を犠牲にして先行取得を再利用する設計(未確定時点のcontextAtDispatchを無条件に信頼する等)は採用しない。**

| 案 | 内容 | 安全性 | 通信回数 | 起動時間への影響 |
|---|---|---|---|---|
| 1. 現行方式を維持 | `HomePrefetchCoordinator.start()`を認証復元直後(PlanStore確定前)に呼ぶまま | 高い(未確定時点のcontextAtDispatch=nilは既存の仕組みで常に破棄される) | 無駄になる先行取得の通信が1回発生する(破棄されても通信自体は行われる) | 典型的なコールドスタートでは実質的な高速化効果が無い(PlanStore確定後に通常のHome取得が改めて走り、Render Freeのコールドスタート待ち(実測約20秒)を再び待つ) |
| 2. Prefetchの開始タイミングをPlanStore確定後に変更 | `HomePrefetchCoordinator.start()`の呼び出し位置を、`PlanStore.load()`の完了後に移す | 送信時点で既にPlanStoreが確定済みのため、「未確定のまま送信される」という現在の主要な破棄理由自体が構造的に発生しなくなる | 無駄な先行取得が無くなる分、減る可能性がある。Splashの起動シーケンス全体の見直し(既存の`DiagnosticsStore`計測ポイントへの影響含む)が必要 | PlanStore確定(`/entitlements`の通信時間)だけHome取得の開始が遅れ、「先行」取得としての本来の目的(Render Freeのコールドスタート待ちを他の処理と並行させる)を一部損なう可能性がある。`/entitlements`・`/home`それぞれの実測時間は本資料作成時点で未測定(§11「未検証」参照) |
| **3. Home Prefetch自体を見直す(★採用、Backend側に計算文脈を返させる)** | `/home`レスポンス自体に計算文脈(例: `computed_for_plan`)を含めるようBackend側APIを変更し、送信タイミングに関わらず受信後にその場で検証する | 最も高い(受信後に実際の計算文脈を直接確認できるため、タイミングに依存しない) | 先行取得の恩恵を活かしつつ安全性も確保できる可能性が高い | 案1の「遅い」という欠点を解消できる唯一の案。ただしBackend側のAPI変更が必要(今回のスコープ外、別途の設計・承認が必要) |

**(今回・HQ決定)** HQ判断により**案3**を目標方針として採用する。Backendから`computed_for_plan`等の計算文脈を返す方式を目指す。

**実装の前提条件(★HQ指示により追加、必須)**: 案3の実装には、以下がすべて確定していることを前提条件とする。
1. Backend API設計(`/home`レスポンスに計算文脈を含める具体的なフィールド名・型・意味)。
2. 旧バージョン(計算文脈を返さないBackend)との互換性方針。
3. 計算文脈が無い場合のクライアント側フォールバック仕様。

**実装許可の制限(★HQ指示により追加)**: **Backend側の設計が確定するまで、案3の実装は許可しない。** 本設計書の範囲では、Backend API設計・旧バージョン互換性・フォールバック仕様のいずれも未確定である(§11「未検証」参照)。これらが確定し、別途の設計・承認プロセスを経るまで、`HomeViewModel`・`HomePrefetchCoordinator`側の実装(§9)には着手しないこと。

**案1の位置づけ(★HQ指示により明記)**: **案1(現行方式維持)は恒久的な解決策として扱わない。** 案3の前提条件が整うまでの**暫定的な現状維持**としてのみ位置づける。案1の構造的な制約(典型的なコールドスタートで実質的な高速化効果が無いこと)は、案3が実装されるまで解消されない残存課題として認識すること。

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

**(★HQ決定・第7次改訂対応)`save()`自体にユーザー整合性検証を追加するかどうか → 現状維持(検証を追加しない)**
- `save()`に新たなユーザー検証コードは追加しない。安全性は、呼び出し元である`fetch()`(§4.2・`applyFetchSuccess()`)が、`confirmedPlan(for: userID)`等で既に検証済みの`userID`を渡すことに完全に依存する、という既存の責任分担を維持する。
- 根拠: `fetch()`が`confirmedPlan(for:)`で検証してから`cacheStore.save(...)`を呼ぶまでの間に`await`を一切挟まない(`applyFetchSuccess()`、§4.2のコード参照)。この同期的な連続性が保たれている限り、呼び出し時点の`userID`の正しさは`fetch()`側で既に保証されており、`save()`側で改めて検証する実益が薄い。
- **固定すること**: この「確認してから同期的に保存する」責任分担が将来の変更で崩れないよう、`fetch()`の確認(`confirmedPlan(for:)`等)と`cacheStore.save()`の呼び出しが連続して(間に`await`を挟まず)実行されることを検証するテストを固定する。本資料の範囲では、これに相当する既存テストを`HomeCacheTests.swift`の実コードで直接確認できていないため、実装時に該当テストを特定し(無ければ追加し)、この同期的連続性が今後の変更で崩れないことを明示的に固定すること(§11「実装時の確認事項」に追加)。
- **将来の再検討条件**: `fetch()`から`save()`呼び出しまでの間に将来何らかの非同期処理(`await`)が挟まる変更が入る場合、この責任分担の前提(同期的な連続性)が崩れるため、その時点で`save()`側のユーザー整合性検証の追加を再検討すること。

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
| `recordRetryIgnoredWhileEntitlementsInProgress()` | **(今回・P2-4対応、新設)** `retryNow()`が`planStore.isLoadInProgress`のため何もせず返った時(通常は`isRetryAvailable == false`でUI側がボタンを非活性にするため稀。到達した場合もユーザーへの無反応を診断上の記録無しにしない) |

**(今回・追加確認1対応)実装方法とテスト読み取り手段について**: `DiagnosticsStore.swift`(2026-11-16確認)を実際に読んだ結果、現行の`DiagnosticsStore`には上記の新規メソッドに対応する汎用カウンタ機構は**存在しない**(`LaunchDiagnostics`は起動シーケンス計測専用の個別フィールドのみを持ち、`beginHomeRequest()`等の既存メソッドもすべて専用フィールドへの個別代入である)。したがって上記4メソッドを実装する際は、既存パターンと同じ要領で**`LaunchDiagnostics`に対応する専用フィールド(カウンタ)を追加し、各メソッド内でそのフィールドを更新する**こと。`current`プロパティは`@Published private(set)`として既に外部から読み取り可能(起動診断画面が読むため)なので、テストは`DiagnosticsStore.shared.current.<新設フィールド>`を直接読むだけで検証でき、**テストのためだけの新規APIを追加する必要は無い**(§8テスト29〜32の間接検証はこの前提で成立する)。新設フィールドの命名・型は実装時に`LaunchDiagnostics`の既存命名規則に合わせて決定すること。

---

## §8 テストケース一覧

### 8.0 `HomeCacheTests.swift`の既存「未確定状態でHome取得を待つ」テストの新仕様への移行(P2-3対応)

**(今回・P2-3対応)** 「実装時に個別確認」では済ませず、該当する既存テストを具体的に列挙し、新しい仕様(§4.2の`fetch()`がPlanStore未確定の間は`apiClient.send`自体を呼ばない設計)のもとでの前提・期待状態・プラン確定タイミングを記載する。

**背景(今回判明した設計上の緊張関係)**: 実コード(`HomeViewModel.swift`269-330行目、2026-11-16確認済み)の`fetch()`は、プランの確定状態に関わらず`/home`を無条件に送信する(プラン確定はキャッシュの表示可否にのみ関わる、`HomeCacheStore.load()`・`discardIfPlanDiffers()`参照)。一方、本設計の`fetch()`(§4.2)は、`generation`に基づく安全な先行取得の再利用を実現するために、`planStore.confirmedContext`が確定するまで`scheduleWaitForPlanConfirmation()`で**待機し、`apiClient.send`自体を呼ばない**よう変更した。この変更により、「PlanStoreが未確定のまま`viewModel.load()`を呼び、Home取得自体(とその成功・失敗)を前提とする」既存テストが、新しい設計のもとでは**Home取得が一切発生しないまま待機し続ける**という、異なる挙動になる。

**該当する既存テスト(`HomeCacheTests.swift`369-440行目、「プランの確認」グループ)**:

| テスト名 | 現状の前提(行) | 現状の期待結果 | 新仕様での前提・期待状態・確定タイミング |
|---|---|---|---|
| `testUnconfirmedPlanDoesNotShowTheCache`(371-386) | `plan: PlanStore()`(未確定のまま、以後も確定させない)。`/home`は失敗するようモック | `state`が最終的に`.error`になる(`/home`送信→失敗) | **変更**: `/home`は送信されない(`scheduleWaitForPlanConfirmation()`で待機するのみ)。`state`は`.loading`のまま変化しない(本設計のP2-2方針どおり、タイムアウトでも`.error`にはしない)。検証は「`state == .loading`のまま」「`isShowingCache == false`」「`cache.stored()`が消えずに残る(未確認のため)」に変更する。`waitUntil { state != .loading }`は**使えない**(永久に真にならない)ため削除し、`waitUntil { recordPlanConfirmationWaitStarted()相当の呼び出しが発生した }`等、待機開始を直接確認する形に変更する |
| `testSamePlanConfirmedLaterShowsTheCache`(388-404) | 同上(未確定)。中盤で`await waitUntil { state != .loading }`を挟んでから`plan.set(plan: .pro, ...)`で確定 | `/home`が先に失敗→後から確定でキャッシュが`.refreshFailed`付きで表示される | **変更**: 中盤の`await waitUntil { state != .loading }`を削除する(`/home`がまだ送信されていないため成立しない)。`plan.set(plan: .pro, limits: .pro(), userID: userA)`(**`userID`を明示的に渡す**、§11のテスト移行表参照)を呼ぶと、`$state`経由で`planConfirmed()`(キャッシュ一致→`.loading`/`.error`中ならキャッシュ表示)と`handlePlanStateChanged()`(`startFetchIfNeeded()`でFetch開始)が**ほぼ同時に**走る。`planConfirmed()`は`state`がまだ`.loading`かつ`lastFetchFailed == false`であることから、まず`.showingCache`としてキャッシュを楽観的に表示し、その後`handlePlanStateChanged()`が開始したFetchが(モック設定どおり)失敗して`refreshNotice = .refreshFailed(savedAt: now)`が追加で付く。**最終的な観測結果(`isShowingCache == true`・`state == .loaded`・`refreshNotice == .refreshFailed(savedAt: now)`)は現状の期待値と一致する**が、到達する内部経路(キャッシュが先に表示され、Fetch失敗が後から追記される)が異なるため、中間アサーションを削除し、最終状態への`waitUntil`のみに変更する |
| `testMismatchedPlanConfirmedLaterIsNotShownAndDiscarded`(406-421) | 同上。中盤で`await waitUntil { state != .loading }`を挟んでから`plan.set(plan: .free, ...)`(カメに保存済みのPROと不一致) | `/home`が先に失敗→後から不一致確定でキャッシュ破棄、`.error`のまま | **変更**: 同様に中盤の`waitUntil`を削除。`plan.set(plan: .free, limits: .free(), userID: userA)`を呼ぶと、`planConfirmed()`が`discardIfPlanDiffers`で不一致を検知しキャッシュを`clear()`するが、`isShowingCache`はまだ`false`(表示前)のため`planConfirmed()`自身はそれ以上何もしない。`handlePlanStateChanged()`が別途Fetchを開始し、(モック設定どおり)失敗して`state = .error(...)`になる。**最終的な観測結果(`cache.stored() == nil`・`isShowingCache == false`・`state == .error`)は現状の期待値と一致する**が、中間の`waitUntil { state != .loading }`は削除すること |
| `testPlanConfirmationFailureDoesNotShowTheOldPlansData`(423-440) | `plan.load(apiClient: failing)`で**確認そのものを失敗させ**(以後確定しない)、`viewModel.load()`→`waitUntil { state != .loading }`→`.error`を期待 | `/home`が(プラン未確定のまま)失敗して`.error` | **変更が必要(確認が永久に失敗したまま、という前提自体の扱い)**: 本設計では、確認が実際に失敗したことを`HomeViewModel`自身が知る唯一の経路は`retryNow()`である(§4.3.2「今回・P2-2対応」参照)。このテストはPlanStoreの`load()`を直接呼んで失敗させているだけで、`HomeViewModel`はまだ何も知らない(`scheduleWaitForPlanConfirmation()`で待機するのみ、`state`は`.loading`のまま)。テストの意図(「確認が失敗した場合に古いプランのキャッシュを見せない」)を保ったまま新仕様で検証するには、`viewModel.load()`の後に明示的に`viewModel.retryNow()`を呼び(`retryNow()`は`planStore.isLoadInProgress`が`false`であることを確認した上で新たな`planStore.load()`を実行し、`failing`モックによりまた失敗する)、その結果として`lastErrorRequiresPlanRetry == true`・`state == .error`になることを検証する形に**テストの手順自体を変更する**必要がある |

**全体の方針**: 4テストすべてにおいて、「`/home`がプラン未確定のまま送信され、後から確定・不一致・失敗が判明する」という**旧来の前提そのもの**が、本設計では成立しない(Home取得は確定後にしか送信されないため)。各テストの**最終的に検証したい安全性(未確定中はキャッシュを見せない・プラン不一致ならキャッシュを破棄する・確認失敗時は古いプランのデータを見せない)は本設計でも成立する**が、その経路と中間アサーションの組み立て直しが必要である。これは「個別確認」で済ませられる軽微な差分ではなく、各テストの本文(特に中間の`waitUntil`呼び出しと、最後のテストでは`retryNow()`呼び出しの追加)を実装時に書き直す必要がある、という結論を明記する。

---

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
15. **(★HQ決定・案B採用を反映)** `plan=nil, limits=nil`(両方欠落)→`.malformedResponse`を返し、PlanContext・generation・Home state/cacheのいずれも変更しない。片方のみ欠落のケース(テスト13・14)と同じ扱いに統一されたことを確認する。
16. `retryNow()`実行中に通常loadが先に確定→Home取得は1回だけ発生し、`retryNow()`側は重複して取得しない。
17. 同一ユーザーの古いEntitlementsレスポンスが新しいレスポンスより後に到着→`entitlementsRequestSequence`により古い方が破棄される。
18. ログアウト・アカウント切替によって進行中の`load()`/`fetch()`が無効化される。
19. **(P0-2対応・副作用も検証)** `userID=nil`で`load()`が呼ばれる→戻り値が`.userMismatchOrUnknown`であることに加え、次の副作用が**すべて発生しないこと**を検証する: (a) 呼び出し前に既存の確定済み`PlanContext`があった場合、それが`.unconfirmed`に変化しない、(b) `generation`が変化しない、(c) `entitlementsRequestSequence`が増加しない、(d) この呼び出しと同時に進行中の別の正当な`load()`呼び出し(有効なuserIDを持つもの)が、この呼び出しによって`supersededByNewerRequest`として無効化されない。
19-2. **(P0-2対応・追加)** `authenticatedUserProvider=nil`で`load()`が呼ばれる→戻り値が`.authenticationUnverifiable`であることに加え、テスト19と同じ(a)〜(d)の副作用が発生しないことを検証する。
19-3. **(P0-2対応・追加)** 有効な`userID`・`authenticatedUserProvider`を指定したが、`userID`が`authenticatedUserProvider.currentUserID`と一致しない→`.userMismatchOrUnknown`を返し、同様に(a)〜(d)の副作用が発生しないことを検証する。
20. **(★HQ決定・案I採用により必須テストに確定、今回・P2-3対応で具体的手順を記載、ケース1)** `userID = A`。まず`planStore.load()`(モックEntitlementsServiceがFREEを返す)でgeneration=Nとして確定させる。`viewModel.load()`を呼び、`fetch()`が`requestSnapshot = (A, N)`を捕捉した直後、Home用`apiClient`モックの応答を`CheckedContinuation`で保留する(テスト28・32と同じ手法)。この状態で、保留中のまま`planStore.load()`を**別のモック(PROを返す)で再度呼ぶ**(購入後の再確認を模す。`await`しないTaskとして開始)。この再確認を完了させ(`commit()`の規則3によりgeneration=N+1へ進むことを確認)、その**後に**保留していたHome応答(FREE時点のデータ)を`resume`する。検証する項目:
    - **generation**: 再確認完了時点で`planStore.confirmedContext?.generation == N+1`であること。
    - **最終plan**: `planStore.confirmedPlan(for: A) == "PRO"`(再確認後の値)であること。
    - **表示データ**: Home応答(FREE時点の古いデータ)を`resume`した直後は、§4.2のケースB(`liveContext!.generation(N+1) > requestSnapshot.generation(N)`)に入り、この古いデータは`state`/キャッシュに**反映されない**こと。続けて、§4.3「明記事項①」の`pendingGeneration`連鎖(`shouldChainNext`、`needsRefetch`とは別の既存機構)により自動的に2回目のFetchが起動され、その応答(PRO時点の新しいデータ)が最終的に`state`に反映されること(`viewModel.state`がPRO時点のデータと一致することを`waitUntil`で確認)。
    - **キャッシュの状態**: 1回目(FREE時点)の応答はキャッシュに保存されない(ケースBでは`cacheStore.save()`を呼ばない、§4.2参照)。2回目(PRO時点)の応答だけが`cacheStore`に保存され、`plan: "PRO"`で保存されていることを確認する。
21. **(★HQ決定・案I採用により必須テストに確定、今回・P2-3対応で具体的手順を記載、ケース2)** `userID = A`。`planStore.load()`でPROとして確定(generation=N)。`viewModel.load()`を呼び、`fetch()`が`requestSnapshot = (A, N)`を捕捉した直後、Home応答を`CheckedContinuation`で保留する。保留中に、`planStore.load()`を**同じ内容(PRO、同じlimits)を返すモックで再度呼ぶ**(内容が変わらない通常の再確認)。`commit()`の規則2により**generationが進まないこと**(`confirmedContext?.generation == N`のまま)を確認してから、保留していたHome応答を`resume`する。検証する項目:
    - **generation**: 再確認前後で`N`のまま変化しないこと。
    - **最終plan**: `planStore.confirmedPlan(for: A) == "PRO"`(変化なし)。
    - **表示データ**: `liveContext!.generation(N) == requestSnapshot.generation(N)`のため§4.2のケースA(一致)に入り、Home応答が`state`へ正常に反映されること。
    - **キャッシュの状態**: ケースAとして`cacheStore.save()`が**1回だけ**呼ばれること(`api.requestedPaths.filter { $0 == "home" }.count == 1`、§4.3「明記事項①」の連鎖(`shouldChainNext`)が発生しないこと=余分な2回目のFetchが起きないことを合わせて確認する)。
22. (§4.6関連・案2採用時)Prefetch開始タイミングをPlanStore確定後に変更した場合、`contextAtDispatch`が常に非nilになり、先行取得が正しく再利用される。
23. **(P1-1対応)** コールドスタートを模した典型的なケース(`contextAtDispatch == nil`、ただし`fetch()`実行時点では`planStore.confirmedContext`は既に確定済み)で、`fetch()`が待機状態に入らず、直ちに通常Fetch(`apiClient.send(endpoint)`)へフォールバックし、Home取得が停止しないことを検証する。
24. **(P1-1対応、P2-C対応で`load()`経由に修正、今回・P2-4対応で検証を厳格化、今回・P3-6対応で任意の待ち時間への依存を排除)** `planStore.set(plan:, limits:, confirmed: true, userID: userID)`で事前に確定させてから(`scheduleWaitForPlanConfirmation()`を直接呼ばず)、`viewModel.load()`を呼ぶ(**`isExplicitRefresh`は既定の`false`のまま、本テストはこの1回しか`load()`を呼ばない**)。検証: `fetch()`が冒頭の2段のguardを両方通過し、`scheduleWaitForPlanConfirmation()`に到達しない(=`recordPlanConfirmationWaitStarted()`が記録されない)こと、かつ`APIClient`モックへの呼び出しが**ちょうど1回**発生すること(`await waitUntil { api.requestedPaths.filter { $0 == "home" }.count >= 1 }`で待つ)。続けて、公開APIで観測できる完了シグナルとして`await waitUntil { viewModel.state == .loaded(...) }`(応答が成功するようモックするため、Home取得の成功確定を意味する)を確認する。**(今回・P3-6対応)** 「2回目が発生しないこと」は、ここから**任意の待ち時間を置く形では確認しない**。代わりに、§4.3「(今回・P2-1対応)過剰な再取得(誤作動)の修正」のコードが示すとおり、`needsRefetch`が`true`になるのは`startFetchIfNeeded(isExplicitRefresh: true)`が呼ばれた場合のみであり(484-489行目の`defer`内の連鎖チェックが読むのは、この`needsRefetch`から1回だけ反映される`shouldChainNext`のみ)、本テストの手順では`load()`を`isExplicitRefresh: true`で呼ぶ箇所が一度も無い。したがって`needsRefetch`はこのテストの実行中、常に`false`のままであり、`shouldChainNext`が`true`になることも、2回目の`startFetchIfNeeded()`呼び出しが発生することも**構造的にありえない**(時間が経過しても新たに発生しうる余地が無い、タイミングに依存しない結論)。この構造的な保証に基づき、`state == .loaded(...)`が成立した直後(追加の待機を挟まず)に`api.requestedPaths.filter { $0 == "home" }.count`が**ちょうど1のまま**であることを確認すれば、2回目が発生しないことの検証として十分である。P2-1対応により`startFetchIfNeeded()`の`isExplicitRefresh`既定が`false`になったため、この`load()`呼び出し自体が追加のFetchを連鎖させないことも合わせて確認する。**証明しないこと**: `scheduleWaitForPlanConfirmation()`内部の①②の分岐自体(これは`private`であり直接呼べないため、このテストは`fetch()`側のguardが先に通過することの検証にとどまる)。`isFetching`・`needsRefetch`・`shouldChainNext`はいずれも`private`であり、本テストはこれらを直接読まない(§8「private状態の検証方法の選択」(c)の方針に従い、`APIClient`モックの呼び出し回数と`state`のみで間接的に検証する)。
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

**(今回・P2-C対応)すべて`private`関数を直接呼ばず、`load()`・`set()`・`retryNow()`等の公開APIのみで再現する。** `scheduleWaitForPlanConfirmation()`は`private`であり、`@testable import`でも直接呼べない(`commit()`と同じ制約)。また、上記「fetch()側の既存guardとの整合性」の再整理により、同関数内の①②分岐は現在**到達不能**であることが判明したため、これらを再現しようとするテストは記載しない(到達不能な分岐をテスト対象として残さない)。

以上の方針に基づき、テスト29〜33を次のように再設計する(各テストの末尾に「証明する/証明しない」を明記する)。

29. **(今回・再設計、P3-2対応で`Task.yield()`を`waitUntil`に変更)** 前提: `userID = A`の`HomeViewModel`、`PlanStore`は未確定。`viewModel.load()`を呼び、`await waitUntil { <診断カウンタ>recordPlanConfirmationWaitStartedの呼び出し回数 == 1 }`で1回目の`fetch()`(未確定分岐)が実際に待機を開始するまで待つ(`Task.yield()`は1回のスケジューリングのみを保証し、`fetch()`の完了そのものを保証しないため、`HomeCacheTests.swift`に既存の`waitUntil`ヘルパーと同じ「条件が満たされるまでポーリングする」パターンに統一する。以下のテストも同様)。続けてまだ未確定のまま`viewModel.load()`をもう一度呼ぶ(2回目の`fetch()`も未確定分岐に入り、`scheduleWaitForPlanConfirmation()`を再度呼ぶ)。検証: `recordPlanConfirmationWaitStarted()`の呼び出し回数が、2回の`load()`を経ても**1回のまま**であること。**証明すること**: §4.2.1④の重複待機防止guardが、`fetch()`からの間接的な再呼び出しに対して機能すること。**証明しないこと**: `scheduleWaitForPlanConfirmation()`の①②の分岐(到達不能なため対象外)。
30. **(今回・再設計、`handlePlanStateChanged()`経由に修正、P2-4対応でsleep継続を実際にresumeして確認、P3-2対応で`waitUntil`化)** 前提: `userID = A`、未確定状態で`load()`を呼び待機を開始させる(`await waitUntil { 待機開始の診断カウンタ == 1 }`で確定させる。この時点でタイムアウトTaskは、テストコードが明示的に`resume`するまで完了しない`CheckedContinuation`で実装した`sleep`により保留されている)。この状態で`planStore.set(plan: .pro, limits: .pro(), confirmed: true, userID: A)`を呼ぶ(`$state`のCombine発火により`handlePlanStateChanged()`が走り、`cancelPlanConfirmationWait()`(タイムアウトTaskに`.cancel()`)+ `startFetchIfNeeded()`が実行される、§4.3参照)。検証の手順: (a) `APIClient`モックへの呼び出しが1回発生すること(`await waitUntil { ... }`で確認、`startFetchIfNeeded()`が実際にFetchを起動したことの間接証拠)、(b) **その後、保留していたタイムアウトTaskのsleep継続を実際に`resume`する**(P2-4対応: 前回はこのresumeを実際には行わず「十分な時間が経過しても」という曖昧な表現に留めていた)。`resume`後、`guard !Task.isCancelled else { return }`(Task#1は`cancelPlanConfirmationWait()`で`.cancel()`済み)で即座にreturnすることを、`recordPlanConfirmationTimedOut()`が**記録されないこと**で確認する。**証明すること**: `handlePlanStateChanged()`が確定を検知して待機を解除しFetchを開始すること、かつキャンセル済みのタイムアウトTaskが実際にresumeされても何もしないこと。**証明しないこと**: `scheduleWaitForPlanConfirmation()`自身の②分岐(到達不能、上記のとおり対象外)。
31. **(今回・再設計、到達可能な③分岐のみを対象に限定。今回・HQ指摘(P2-1)によりTask#1の扱いを訂正)** 前提: `userID = A`、未確定状態で`load()`を呼び待機を開始させる(`await waitUntil { 待機開始の診断カウンタ == 1 }`で確定させ、この時点でタイムアウトTask#1がsleepで保留されていることを確認する)。続けて`planStore.set(plan: .pro, limits: .pro(), confirmed: true, userID: B)`(**Aとは異なるB**)を呼ぶ。`handlePlanStateChanged()`は`context.userID == userID`のguardで何もしない(Bであり、Aではないため、ここではTask#1に影響しない)。その後、まだ未確定(Aにとって)のまま`viewModel.load()`をもう一度呼ぶ(2回目の`fetch()`が`guard let context = ..., context.userID == userID`に失敗し`scheduleWaitForPlanConfirmation()`を呼び、その内部で③分岐(`confirmedContext`はBで存在するがuserIDがAと不一致)に到達する)。**訂正(HQ指摘・P2-1対応)**: §4.2.1のコードを確認すると、③分岐は`recordHomeFetchDiscarded(reason: .unexpectedState)`の記録に続けて**`cancelPlanConfirmationWait()`を呼ぶ**(§4.2.1のコード参照)。したがって、この2回目の`load()`によってTask#1は**この時点で`.cancel()`される**(前回の記載「Task#1はキャンセルされない」は誤りだったため訂正)。検証: (a) `recordHomeFetchDiscarded(reason: .unexpectedState)`が記録されること、(b) `APIClient`モックへの呼び出しが発生しない(誤ったFetchが開始されない)こと、(c) **Task#1のsleep継続を実際に`resume`し**、Task#1が`.cancel()`済みであるため`guard !Task.isCancelled else { return }`で即座にreturnし、`recordPlanConfirmationTimedOut()`が**記録されないこと**を確認する(`try?`がキャンセルのエラーを握り潰しても、`Task.isCancelled`の明示確認がこれを正しく捕捉することの実証)。**証明すること**: ③分岐(到達可能)が正しく機能し、診断記録と待機キャンセルの両方を行うこと。キャンセル済みのタイムアウトTaskを実際にresumeしても、タイムアウト診断が記録されないこと。**証明しないこと**: ①②分岐(到達不能、対象外)。

**P2-3対応・タイムアウトTaskのキャンセル競合テスト(32番、`load()`経由に修正)**:

32. **(今回・P2-3対応、`load()`経由に修正)** 注入した`sleep`を、テストコードが明示的に`resume`するまで完了しない`CheckedContinuation`で実装する(テスト28と同じ手法)。(i) `userID = A`、未確定状態で`load()`を呼ぶ(待機#1開始、タイムアウトTask#1がsleep#1で保留)、(ii) `planStore.set(plan:, limits:, confirmed: true, userID: A)`を呼ぶ(`handlePlanStateChanged()`経由で`cancelPlanConfirmationWait()`がTask#1に`.cancel()`を呼ぶが、`try?`がこれを握り潰すため、sleep#1が**まだresumeされていない**時点ではTask#1はまだ`guard !Task.isCancelled`の行に到達していない)、(iii) `startFetchIfNeeded()`経由のFetchが1回開始されたことを確認後、`planStore.reset()`で未確定に戻し、`viewModel.load()`をもう一度呼ぶ(待機#2開始、タイムアウトTask#2がsleep#2で保留)、(iv) ここでsleep#1を`resume`する(Task#1が`guard !Task.isCancelled`の行に到達する)。検証: Task#1は`.cancel()`済みのため`Task.isCancelled`が`true`になっており、**即座にreturnし、待機#2の状態を一切変更しない**ことを、`recordPlanConfirmationTimedOut()`が**記録されない**ことで確認し、(v) その後sleep#2も`resume`し、待機#2のタイムアウト処理が正常に完了して`recordPlanConfirmationTimedOut()`が記録されることを確認する。**証明すること**: 古いタイムアウトTaskが新しい待機の状態を変更しないこと(P2-3の核心)。**証明しないこと**: `Task.isCancelled`確認と状態変更の間の競合が無いこと自体(これはコードレビューによる静的な確認対象であり、§4.2.1「追加確認2」の説明に委ねる。タイミング依存のテストでは再現できないため)。

**P2-4対応・`userID == nil`のテスト(33番)**:

33. **(今回・P2-4対応)** `HomeViewModel(apiClient:)`(`userID`省略、既存の`HomeViewModelTests`・`HomeSpeechesStatusTests`と同じ構成)で`load()`を呼ぶ。検証: (a) `planStore`の確定状態に関わらず(未確定のままでも)`fetch()`が`scheduleWaitForPlanConfirmation()`を呼ばずに直ちに`apiClient.send(endpoint)`を実行し、`state`が`.loaded(...)`になること(既存コードと同じ挙動が維持されていることの確認。§4.2.3参照)、(b) `cacheStore.save()`が呼ばれない(`userID`が無いため)こと、(c) 既存の`HomeViewModelTests`・`HomeSpeechesStatusTests`がこの変更後も無修正で成立すること(§11のテスト移行表参照)。**証明すること**: userID==nil早期分岐の既存挙動維持。**証明しないこと**: userIDが有る場合の安全性機構(他のテストの対象)。

**P2-A対応・通貨ペア編集後の再取得テスト(新規、34番)**:

34. **(今回・P2-A対応、今回・P2-1対応で`isExplicitRefresh: true`を使用するよう修正)** `userID = A`、確定済み。`apiClient`モックを、1回目の`/home`応答は`CheckedContinuation`で保留する実装にする。(i) `viewModel.load()`(**既定`isExplicitRefresh: false`**、`.task`相当)を呼ぶ(fetch A開始、応答保留中、`isFetching == true`)、(ii) まだ保留中のうちに`viewModel.load(isExplicitRefresh: true)`(**`.onChange(of: path.count)`相当**)を呼ぶ(`startFetchIfNeeded(isExplicitRefresh: true)`が`needsRefetch = true`を立てるのみで新規Taskは起動しない。この時点でAPIClientモックへの呼び出しはまだ1回のまま)、(iii) fetch Aの継続を、1回目の(古い)通貨ペア設定を反映した応答で`resume`し、fetch Aの完了を待つ。検証: (a) fetch A完了直後に`needsRefetch`が消費され、`APIClient`モックへの呼び出しが**2回目**発生すること(fetch Bが自動的に開始されたことの間接証拠)、(b) fetch Bの応答(2回目の、新しい通貨ペア設定を反映した応答)を`resume`して完了させた後、`viewModel.state`の`majorFx`がfetch Bの内容と一致し、fetch Aの(古い)内容が最終状態として残っていないこと、(c) 複数回(ii)を連続して呼んでも、fetch A完了後に開始される追加のFetchは1回だけであること(`needsRefetch`が真偽値であることの間接証拠)。**証明すること**: `isExplicitRefresh: true`での実行中の再呼び出しが無視されず、完了後に1回だけ反映されること。**証明しないこと**: fetch Bがfetch Aより先に完了する場合の挙動(§4.3.1に残存リスクとして明記、対象外。P3-1対応によりこの表現自体を訂正済み)。

**P2-1対応・`isExplicitRefresh: false`の呼び出しが不要な再取得を発生させないことの回帰テスト(新規、38番)**:

38. **(今回・P2-1対応、新規)** テスト34と同じ`CheckedContinuation`保留の設定。(i) `viewModel.load()`(既定`false`)を呼ぶ(fetch A開始、応答保留中)、(ii) まだ保留中のうちに、`.task { load() }`や`init`のCombine初回通知を模して`viewModel.load()`(既定`false`)を**複数回**呼ぶ、(iii) fetch Aの継続を`resume`し、完了を待つ。検証: fetch A完了後、`APIClient`モックへの呼び出しが**増えない**(2回目が発生しない)こと。**証明すること**: `isExplicitRefresh`が既定(`false`)の呼び出しは、busy中に来ても`needsRefetch`を立てず、不要な再取得を発生させないこと(P2-1の核心、テスト34との対比)。**証明しないこと**: `isExplicitRefresh: true`での挙動(テスト34の対象)。

**P2-B対応・confirmedPlanのユーザー整合性テスト(新規、35番)**:

35. **(今回・P2-B対応、新規)** `userID = A`の`HomeViewModel`・`PlanStore`(共有インスタンス)。`planStore.set(plan: .pro, limits: .pro(), confirmed: true, userID: B)`(**Aとは異なるB**)を呼び、`PlanStore`がBで確定した状態を作る。この状態で`viewModel`の(privateな)`cacheContext()`を直接呼ばず、`viewModel.load()`経由で間接的に検証する: `HomeCacheStore`に**事前に**A向けの有効なキャッシュ(`plan: "PRO"`)を保存しておき、`load()`を呼んだ際にそのキャッシュが**出ないこと**(`confirmedPlan(for: A)`がnilを返すため、`cacheContext().confirmedPlan`もnilになり、`HomeCacheStore.load()`自身のguardで出さない判定になる)を検証する。**証明すること**: `confirmedPlan`(無引数版)が別ユーザー(B)の値を返しても、`confirmedPlan(for:)`経由の`cacheContext()`がAのキャッシュを誤って出さないこと。**証明しないこと**: `PlanStore.reset()`のタイミング自体(P2-Bの修正はreset()のタイミングに依存しないことが目的であり、このテストはreset()を一切呼ばずに安全性が成立することを示す)。

**P3-5対応・authenticatedUserProvider配線漏れ検出テスト(新規、36番)**:

36. **(今回・追加確認(P3)5番対応、新規)** 実際の本番初期化経路に近い形(`AppState`の実インスタンス、または`AuthenticatedUserProviding`に準拠した最小限のテスト用実装)を使い、`authenticatedUserProvider`を**明示的に**渡して`HomeViewModel`を構築する。`authenticatedUserProvider`が返す`currentUserID`を`viewModel.userID`と異なる値に変更したうえで`viewModel.load()`を呼ぶ。検証: `APIClient`モックへの呼び出しが発生しない(安全性チェックが実際に機能している)こと。**この テストの意図**: `authenticatedUserProvider`を明示的に渡さない構成(既定の`nil`)ではこの安全性チェックが無効化される(§4.2.1末尾の説明参照)ため、本番の実際の配線(`MainTabView`→`HomeView`→`HomeViewModel`)が`authenticatedUserProvider`を実際に渡していることを、実装時に**この経路に相当する統合テスト**で確認すること。本資料の範囲では`HomeView.swift`等への配線自体は未実装のため、このテストは「配線されていればこう振る舞う」という仕様の確認に留まり、実装後に本物の配線を通したテストへ差し替える必要がある(§11に記載)。**証明すること**: 配線されている場合の安全性チェック自体の正しさ。**証明しないこと**: 本番コードが実際に配線を忘れていないこと(これは実装後の統合テストでのみ確認できる)。

**P2-E対応・タイムアウト後の復旧テスト(新規、37番)**:

37. **(今回・P2-2対応で全面再設計、P2-4対応で`retryNow()`とCombine経由の自動Fetchの原因を区別できる手順に修正)** 本テストを2部に分ける。両方とも`planStore`の`EntitlementsService`呼び出し先は`PlanStoreTests`等と同じ形の専用モック(`apiClient`とは別、Entitlements用)とし、`HomeViewModel`が使う`apiClient`(Home用)と混同しないようにする。

    **(A) タイムアウトは`.error`にせず、`retryNow()`自身の失敗だけが`.error`にすること**: `userID = A`、未確定状態で`load()`を呼び待機を開始させる(`state`は`.loading`)。注入した`sleep`をテストが制御できる`CheckedContinuation`にし、`resume`してタイムアウトTaskの本体を完了させる。検証: (a) `state`は`.loading`のまま変化しないこと(**今回・P2-2対応による変更点**。前回は`.error`になることを期待していた)、(b) `viewModel.isPlanConfirmationSlow == true`になること、(c) `viewModel.lastErrorRequiresPlanRetry`は`false`のままであること(まだ`retryNow()`を呼んでいないため)。続けて、Entitlements用モックを**失敗する**よう設定したうえで`viewModel.retryNow()`を呼ぶ。検証: (d) `state`が`.error(...)`に変化すること、(e) `lastErrorRequiresPlanRetry == true`になること。この(d)(e)は`retryNow()`自身が呼んだ`planStore.load()`の失敗のみが原因であり、`planStore.set()`のような他の経路は一度も使っていないため、原因は一意に特定できる。

    **(B) `retryNow()`経由の確定成功による復旧**: (A)とは別のテストケースとして、Entitlements用モックを**成功する**よう設定したうえで、同じ未確定→タイムアウト→`isPlanConfirmationSlow == true`の状態から`viewModel.retryNow()`を呼ぶ。検証: (f) `retryNow()`自身が呼んだ`planStore.load()`が`.confirmed`を返すこと、(g) それを`handlePlanStateChanged()`(`$state`経由、Combine)が検知して`startFetchIfNeeded()`を呼び、`state`が最終的に`.loaded(...)`に復旧すること、(h) `isPlanConfirmationSlow`が`false`に戻ること(`handlePlanStateChanged()`での消費)。この(f)〜(h)の流れでは`planStore.set()`を一度も呼んでおらず、`retryNow()`自身の`planStore.load()`呼び出しが確定の唯一の原因であるため、「`retryNow()`とは独立した`set()`が偶然同時に確定させた」という原因の混在が排除されている。

    **証明すること**: タイムアウト自体は`.error`を引き起こさないこと(A)、`retryNow()`自身の失敗/成功が、他の経路と混ざらずに`.error`/復旧を引き起こすこと(A・B)。**証明しないこと**: `HomeView.swift`の実際の`.loading`表示への案内・`onRetry`分岐自体(Swiftコード変更を伴うため、本資料の範囲では未実装。§4.3.2・§9参照)。

**P2-4対応・UI状態のObservable通知テスト(今回・HQ指摘「必須修正：UI状態のObservable通知」対応、新規、39〜43番)**: 以下のテストは、テスト37等が確認する「最終的な値が正しいこと」とは別に、**その値の変化が実際にCombineの`@Published`経由で発行されること**自体を検証する(39番は仮に`isPlanConfirmationSlow`が将来`@Published`でない`private(set) var`に戻された場合、`$isPlanConfirmationSlow`という参照自体がコンパイルエラーになるため、この回帰を構造的に検出できる)。

39. **(今回・新規)** タイムアウト後に遅延案内が表示されること。`userID = A`、未確定状態で`load()`を呼び待機を開始させる。`viewModel.$isPlanConfirmationSlow`を(`cancellables`等に)購読し、発行された値を記録する配列を用意しておく。注入した`sleep`の`CheckedContinuation`を`resume`してタイムアウトTaskの本体を完了させる。検証: (a) 記録した配列に`true`が実際に発行されていること(`await waitUntil { recorded.contains(true) }`、初期値`false`は購読開始時点で1回emitされるため、2回目以降の値を見る)。これは「最終的に`viewModel.isPlanConfirmationSlow == true`である」という値の確認(テスト37(A)で既に実施済み)とは別の観点であり、`@Published`の発行が実際に起きていることそのものを証明する。**証明すること**: `isPlanConfirmationSlow`への代入が`$isPlanConfirmationSlow`経由で実際に観測可能なイベントとして発行されること。**証明しないこと**: `HomeView`側の実際の案内UI(未実装、§9参照)。
40. **(今回・新規、今回・第7次改訂・P2-1対応で訂正)** Entitlements取得中は再試行ボタンが非活性になること。`userID = A`、確定済み。Entitlements用モックを`CheckedContinuation`で保留する実装にし、`viewModel.retryNow()`を呼ぶ(`isRefreshingEntitlements`が`true`になり、Entitlements用モックの応答はまだ保留中)。検証: (a) **(今回・P2-1対応、訂正)** `retryNow()`呼び出し直後に`viewModel.isRetryAvailable`を同期的に読むのではなく、`await waitUntil { viewModel.isRetryAvailable == false }`で確認する。`isRetryAvailable`はストアドの`@Published`であり、その更新は`retryNow()`呼び出しと同じ同期的なコールスタック内では完結せず、Combineの`.sink`→別の`Task { @MainActor in }`での再計算という、必ず1回以上の非同期の切れ目を挟む(§4.2.1「isRetryAvailableのObservable化」参照)。変更直後に同期的に読むと、実装が正しくても一時的に古い値(`true`)のままになるタイミングがあり得るため、本来成立するはずの検証が偶然失敗する(flaky)おそれがある。`waitUntil`によるポーリングに変えることで、タイミングに依存しない確実な検証にする。(b) `viewModel.$isRetryAvailable`を購読していた場合、`retryNow()`呼び出し後に`false`が実際に発行されていること(§4.2.1「isRetryAvailableのObservable化」の`Publishers.CombineLatest3`が`isRefreshingEntitlements`の変化に実際に追従していることの確認)。**証明すること**: `isRefreshingEntitlements`の変化が`isRetryAvailable`の再計算・再発行に正しく反映されること。**証明しないこと**: `HomeView`側の実際のボタンの非活性化描画(未実装、§9参照)。
41. **(今回・新規、今回・第7次改訂・P2-1対応で訂正)** 複数の`load()`が重なっても、最後の`load()`が終わるまで非活性が維持されること(`PlanStore.loadInProgressCount`のカウンタ化、P2-4対応の中核をObservable通知の観点で検証)。`userID = A`。`PlanStore`の`EntitlementsService`呼び出し先を、呼び出しごとに**別々の**`CheckedContinuation`で保留できるモックにする(2本の継続を保持できるようにする)。(i) `planStore.load(...)`を1回目として開始(`await`しないTaskとして、継続#1を保留)、(ii) 継続#1が保留されたことを確認した時点で、**(今回・P2-1対応、訂正)** `await waitUntil { viewModel.isRetryAvailable == false }`で確認する(直前のTest40と同じ理由により、同期的な直読みは使わない)、(iii) `planStore.load(...)`を2回目として開始(継続#2を保留。この時点で`loadInProgressCount == 2`)、(iv) **(今回・P2-1対応、訂正)** 継続#1を`resume`するだけでなく、1回目の`planStore.load(...)`呼び出しに対応する`Task`(またはその戻り値)自体の完了を明示的に`await`する(例: 1回目を開始したときに保持しておいた`Task`を`await task1.value`で完了まで待つ、あるいは`await waitUntil { planStore.loadInProgressCount == 1 }`で、カウンタが実際に2→1へ下がったことを直接確認する)。継続を`resume`しただけでは、`load()`本体の残りの処理(`defer { loadInProgressCount -= 1 }`を含む)が実際に完了したとは限らないため、ここを素通りしない。検証: その後`await waitUntil { viewModel.isRetryAvailable == false }`で、依然として非活性のままであることを確認する(1回目の完了だけでは再試行可能にならないこと)。**証明すること**: `loadInProgressCount`が2→1(まだ0ではない)の、1回目完了直後かつ2回目が進行中という具体的な過渡状態において、`isRetryAvailable`が正しく`false`のままであること。これは「どちらか一方の`load()`が完了すると`isLoadInProgress`が(誤って)`false`に戻ってしまう」という回帰(P2-4で修正したBoolベースの誤実装)を直接検出できる、最も厳格な検証ポイントである。`loadInProgressCount`自体が具体的に`1`になったことを`waitUntil`で確認してから`isRetryAvailable`を見ることで、単に`Task.yield()`を数回呼んで「もう十分だろう」と仮定するような、タイミングに依存した不確実な検証を避け、Bool管理の誤実装でも偶然テストが通ってしまう問題を構造的に排除する。**証明しないこと**: `isRetryAvailable == true`への復帰自体(テスト42の対象)。
42. **(今回・新規)** すべての`load()`が終了したら再試行可能になること。テスト41の続き(継続#2も保留中、`loadInProgressCount == 1`)から、(v) 継続#2を`resume`する(`loadInProgressCount`が1→0になる)。検証: (a) `await waitUntil { viewModel.isRetryAvailable == true }`が成立すること、(b) `viewModel.$isRetryAvailable`を購読していた場合、`false`から`true`への変化が実際に発行されていること(39番と同じ観点)。**証明すること**: `loadInProgressCount`が0に戻った時点で`isRetryAvailable`が確実に`true`へ復帰し、かつその変化が`HomeView`から観測可能な形で発行されること。**証明しないこと**: `isFetching`・`isRefreshingEntitlements`経由での復帰(別の入力であり、この2テストの対象外)。
43. **(今回・新規)** `.loaded`を維持した再試行失敗でも、失敗案内が更新されること(P3-4とP2-4のObservable化を組み合わせた検証)。`userID = A`、`state`が既に`.loaded(...)`である状態を作る(例: 通常の`load()`を1回成功させる)。`viewModel.$lastErrorRequiresPlanRetry`を購読し、発行された値を記録する。Entitlements用モックを**失敗する**よう設定したうえで`viewModel.retryNow()`を呼ぶ。検証: (a) `state`は`.loaded(...)`のまま変化しないこと(P3-4対応、既存表示を保護)、(b) `lastErrorRequiresPlanRetry`が最終的に`true`になること、(c) 記録した配列に`true`が実際に発行されていること(`state`が変化しない経路でも、`lastErrorRequiresPlanRetry`への代入自体が独立して`objectWillChange`を発行することの確認)。**証明すること**: `state`を経由しない(`HomeState`にケースを増やさない)設計(§4.3.2参照)でも、`.loaded`を維持したままの失敗案内の更新が確実にUIへ伝わること。**証明しないこと**: `HomeView`側の実際の失敗案内の描画内容(未実装、§9参照)。

**P2-4対応・isRetryAvailableの初期値・最終状態確認テスト(今回・HQ再指摘「isRetryAvailableのObservable化」対応、新規、44番。今回・第7次改訂・P2-2対応で(c)の位置づけを訂正)**:

44. **(今回・新規)** `isRetryAvailable`の初期値のずれへの対応、および連続した変化の後の最終状態を検証する。3つの部分からなる((c)は「通知順序の入れ替わり耐性の証明」ではなく「スモークテスト」という位置づけであることに注意。詳細は(c)内の説明を参照)。

    **(a) 構築時点の初期値**: `userID = A`の`PlanStore`に対し、`EntitlementsService`呼び出しを`CheckedContinuation`で保留するモックを使って`planStore.load(apiClient:, userID: A, authenticatedUserProvider:)`を**先に**(`await`せずTaskとして)開始する(継続#1が保留されたことを確認した時点で`planStore.loadInProgressCount == 1`)。この**既に`load()`が進行中のPlanStoreインスタンス**を渡して、新たに`HomeViewModel`を構築する。検証: 構築直後(`init()`の呼び出しから返った直後、追加の`await`やTaskの実行を待たずに)`viewModel.isRetryAvailable == false`であること。**証明すること**: 構築時点で既に`planStore.loadInProgressCount > 0`の場合、Combineの初回通知が非同期(`Task { @MainActor in }`経由)で適用されるのを待たず、`init()`内の同期的な初期計算により、`isRetryAvailable`が既定値`true`のまま一時的に誤表示される隙間が無いこと。
    **(b) load()完了後の復帰**: (a)の続きから、継続#1を`resume`し`planStore.load(...)`を完了させる(`loadInProgressCount`が1→0)。検証: `await waitUntil { viewModel.isRetryAvailable == true }`が成立すること。**証明すること**: 初期値の補正が、その後の正常な復帰を妨げないこと。
    **(c) 連続したPublisher更新後の最終状態確認(今回・第7次改訂・P2-2対応で位置づけを変更)** `userID = A`、確定済みの`HomeViewModel`。次の3つの変化を短時間に連続して起こす: (i) Entitlements用モックを`CheckedContinuation`で保留し`viewModel.retryNow()`を呼ぶ(`isRefreshingEntitlements`が`true`になる)、(ii) 直後に、別途保留していた`planStore`の他の`load()`呼び出し(`retryNow()`とは別経路、例えばSplashの先行取得を模したもの)の継続を`resume`する(`loadInProgressCount`が変化する)、(iii) さらに直後に(i)のEntitlements用モックの継続も`resume`する(`isRefreshingEntitlements`が`false`に戻る)。これらを`await`を挟まず連続して呼ぶことで、対応する複数の`Task { @MainActor in }`が短時間にまとめて生成される状況を作る。検証: 十分な時間(`await waitUntil`等)を置いた後、`viewModel.isRetryAvailable`の値が、**その時点の`viewModel`の実際の`isFetching`・`isRefreshingEntitlements`・`planStore.isLoadInProgress`から直接計算した期待値と一致する**こと。

    **(今回・HQ指摘(P2-2)により位置づけを訂正)** 本テスト(c)は、**「連続したPublisher更新後の最終状態を確認するスモークテスト」**として位置づける。前回の記載は「通知順序の入れ替わり耐性を証明するテスト」としていたが、これは正確ではなかったため訂正する。理由: テストコードから複数のTaskの実行順序を強制的に入れ替えることはできない(「証明しないこと」として前回も明記していたとおり)。したがって、本テストが実際に検証しているのは「3つの変化を連続して起こした後、`waitUntil`で十分な時間を置いた最終状態が、その時点のライブな3入力と一致する」という**結果の一致**のみであり、実行順序が実際に入れ替わったことそのものを再現・観測してはいない。**この旧実装(通知時点のスナップショット値をそのまま代入する実装)でも、本テストは通る可能性がある**: 3つの変化がこの程度の間隔で連続する場合、生成される複数のTaskが偶然ほぼ意図した順序で実行されれば、スナップショット方式でも最終的に正しい値へ収束することがあるため、本テストの合否だけでは旧実装の再計算方式(スナップショット代入 vs ライブ再計算)の違いを判別できない。したがって本テストは「Taskの実行順序が入れ替わっても古い値による上書きが起きない」という設計上の保証(§4.2.1「isRetryAvailableのObservable化」の「修正方針」で論理的に説明している内容)を直接証明するものではなく、**基本的な動作が壊れていないことを確認する最低限のスモークテスト**という位置づけにする。**この区別のために、`isRetryAvailable`を純粋関数として切り出す・実行順序を人為的に固定するテストフックを追加する、といった大規模な設計変更は今回は必須としない**(§11「実装時の確認事項」参照。将来、実際に順序入れ替わりによる不整合が疑われる不具合報告があった場合に再検討する)。**証明すること**: 3つの変化を連続して起こした後の最終状態が、通知の経由方法に関わらずライブな3入力と一致すること(基本的な結果の正しさ)。**証明しないこと**: Taskの実行順序が実際に入れ替わること自体、および旧実装(スナップショット代入方式)との判別。

    **証明しないこと**: `HomeView`側の実際のボタンの非活性化描画(未実装、§9参照)。Swift Concurrencyのタスクスケジューラが実際にどの順序でTaskを実行するかそのもの(これはランタイムの実装詳細であり、テストから直接制御・観測できない。本テストは「順序に依存しない」という設計の結果を検証するものであり、順序の入れ替わり自体を強制的に発生させるものではない)。

---

## §9 実装対象ファイル

| ファイル | 変更内容 |
|---|---|
| `PlanStore.swift` | `State`(`.unconfirmed(lastKnown:)`への変更、P1-1対応)/`PlanContext`/`LoadResult`の追加、`load()`/`reset()`/`set()`/`confirmedPlan`/`confirmedPlan(for:)`(P2-B新設)/`isLoadInProgress`(P2-2新設)の刷新、`AuthenticatedUserProviding`の定義。**(今回・HQ指摘対応)** `loadInProgressCount`を`private var`から`@Published private(set) var`へ変更(`HomeViewModel.isRetryAvailable`がCombineで追従するため、§1.2・§4.2.1参照) |
| `HomePrefetchCoordinator.swift` | `Prefetch.contextAtDispatch`への変更、`start()`(`contextAtDispatch: PlanStore.PlanContext? = nil`、既定値あり)/`consumeHome()`(戻り値をタプルに変更)のシグネチャ更新。既存呼び出し元・テストへの影響は§4.1の移行表を参照(今回・P2-2対応) |
| `HomePrefetchCoordinatorTests.swift` | テスト専用`extension`の`consumeHome(for:)`の実装を`.task`抽出に変更(§4.1の移行表参照、今回・P2-2対応) |
| `HomeCacheTests.swift`(§4.1関連、P2-2対応で追加) | `testFetchReusesThePrefetchedHomeAndDoesNotRequestAgain`・`testReloadAfterConsumingThePrefetchStillRefetches`を、確定済み`PlanStore`の`confirmedContext`を`contextAtDispatch`として明示的に渡す形に変更(§4.1の移行表参照) |
| `HomeViewModel.swift` | `authenticatedUserProvider`(Optional)/`sleep`(P2-2・P2-3対応のDI)/`pendingGeneration`/`lastFetchedGeneration`/`isRefreshingEntitlements`/`needsRefetch`(P2-A新設、P2-1対応で`isExplicitRefresh`限定に変更)/`lastErrorRequiresPlanRetry`(今回・P2-2対応で意味を再定義)/`isPlanConfirmationSlow`(今回・P2-2新設)の追加、`init`内のCombine購読を`$isConfirmed.combineLatest($plan)`から`$state`へ変更(P1-1対応・§4.2.3)、`fetch()`(`applyFetchSuccess`/`applyFetchFailure`への分割含む)/`load(isExplicitRefresh:)`(P2-1対応でパラメータ追加)/`planConfirmed()`(`confirmedPlan(for:)`へ変更、P2-B対応)/`cacheContext()`(同)/`handlePlanStateChanged()`/`startFetchIfNeeded(isExplicitRefresh:)`(P2-1対応)/`retryNow()`(今回・P2-2対応で`isLoadInProgress`チェック・`LoadResult`別の分岐を追加)/`scheduleWaitForPlanConfirmation()`(P3-3対応、`sleep`読み取りの分離)の刷新。**(今回・HQ指摘対応)** `isFetching`・`isRefreshingEntitlements`・`lastErrorRequiresPlanRetry`・`isPlanConfirmationSlow`をいずれも`@Published`化(内部用の`isFetching`・`isRefreshingEntitlements`は`private`のまま)、`isRetryAvailable`を計算プロパティからストアドの`@Published private(set) var`へ変更し、`init()`内に`Publishers.CombineLatest3($isFetching, $isRefreshingEntitlements, planStore.$loadInProgressCount)`の購読を追加(§4.2.1「isRetryAvailableのObservable化」参照)。**(今回・HQ再指摘対応)** 構築時点の初期値を`init()`内で同期的に直接計算する処理を追加(Combineの初回emitが非同期で適用される隙間を無くす)、`.sink`内の代入を通知時点のスナップショットではなく実行時点の`self`からのライブな再計算に変更(Taskの実行順序入れ替わりによる古い値での上書きを防止) |
| `HomeView.swift` | **(今回・P2-1/P2-2/P2-4対応、更新)** 4箇所の変更: (1) `.onChange(of: path.count)`から呼ぶ`viewModel.load()`を`viewModel.load(isExplicitRefresh: true)`に変更(§4.3.1)。(2) `.loading`表示に、`viewModel.isPlanConfirmationSlow`がtrueの間だけ案内+`retryNow()`ボタンを重ねる。(3) `ErrorView`生成箇所の`onRetry`クロージャを、`viewModel.lastErrorRequiresPlanRetry`に応じて`retryNow()`/`load()`を振り分けるよう変更(§4.3.2参照)。(4) **(今回・P2-4対応で追加)** (2)で重ねる再試行ボタンを`viewModel.isRetryAvailable`が`false`の間は非活性(`disabled`)表示にし、押せない理由(Entitlements確認がまだ進行中であること)をボタン近傍に案内する(§4.2.1「retryNow()」参照) |
| `SubscriptionManagementViewModel.swift` | `authenticatedUserProvider`の受け取り、`sync()`内のuserID取得・診断分離(`try?`での握り潰しを廃止) |
| `AppState.swift` | `extension AppState: AuthenticatedUserProviding {}`の追加のみ |
| `RootView.swift` | `PlanStore.shared.load(...)`・`MainTabView`生成に`authenticatedUserProvider: appState`を追加 |
| `MainTabView.swift`・`HomeView.swift` | `authenticatedUserProvider`の配線(`HomeViewModel`まで伝搬) |
| `PlaceholderScreenView.swift`・`PlanLimitPrompt.swift`・`SubscriptionManagementView.swift` | `authenticatedUserProvider`配線(`SubscriptionManagementView`の生成箇所2か所) |
| `DiagnosticsStore.swift` | §7の記録メソッド追加。P2-2対応のテスト用カウンタ読み取り手段の有無を実装時に確認(無ければ既存方針に沿って追加、§11参照) |
| `PlanStoreTests.swift` | `testLoadWithoutAUserIDBehavesAsBefore()`の期待値反転(`.userMismatchOrUnknown`を返し確定しない。§8テスト19の副作用検証を追加)。`limits: nil`を使う既存モック4件(前回確認済み)の見直し。§1.2.3の副作用テスト(§8テスト19/19-2/19-3)の新規追加。79-85行目の`set(plan:, limits:, confirmed: false)`呼び出しは`State.unconfirmed(lastKnown:)`化後もシグネチャ変更無しでそのまま動作することを確認(§1.2・P2-4対応)。**(今回・P2-D対応、新規判明)** `load(apiClient:)`の`authenticatedUserProvider`パラメータに既定値が無いため、既存の直接呼び出し**6か所すべて**(20・34・51・52・67・82行目)が**コンパイル不能になる**。§11の移行表に行ごとの具体的な修正方法を記載した |
| `HomeCacheTests.swift` | `makeViewModel`ヘルパー(549-558行目)が`plan`省略時に生成する`PlanStore()`への`set(plan:, limits:)`呼び出しに、ヘルパー自身の`userID`パラメータをそのまま渡すよう変更(P1-1・P2-4対応、§11のテスト移行表参照。現状は`userID`を渡していないため、本設計の`fetch()`の新しいuserID一致guardにより`.confirmed`と判定されず、既存テストが新たに失敗する)。**(今回・P2-D対応、新規判明)** 428行目`await plan.load(apiClient: failing)`も`authenticatedUserProvider`未指定のため**コンパイル不能**。§11の移行表に修正方法を記載した |
| `HomeViewModelTests.swift`・`HomeSpeechesStatusTests.swift` | （P2-4対応）`userID`を渡さない既存の構成(`HomeViewModel(apiClient:)`)は、§4.2.3の`userID == nil`早期分岐によりコード変更不要で成立する見込み。テスト33(§8)で回帰を確認すること |
| `CalendarViewModelTests.swift`・`EventDetailViewTests.swift` | (P2-4調査・変更不要の見込み)`PlanStore()`/`PlanStore.shared`を`HomeViewModel`と組み合わせずに直接読む構成のため、`set()`のシグネチャ・既定値変更の影響を受けない(§11のテスト移行表参照) |

---

## §10 実装時の注意点・残存リスク

- **(★HQ決定・案B採用により更新)** §3(plan/limits両方欠落時の扱い)はHQにより案Bの採用が決定された。ただし、**対象Backendのバージョンと`/entitlements`レスポンス契約の確認が完了するまでは実装に着手しないこと**(§3「実装・リリース前の必須条件」参照)。
- **(今回・§4.6対応)** §4.6(Home Prefetchの方向性)はHQにより案3が目標方針として決定されたが、Backend API設計・旧バージョン互換性・フォールバック仕様が確定するまで、`HomeViewModel`・`HomePrefetchCoordinator`側の実装には着手しないこと(§4.6参照)。
- `AuthenticatedUserProviding`プロトコルに`@MainActor`を付与することは、本設計の**必須条件**である(§1.2参照。推奨ではない)。実装時は必ずこの宣言で行うこと。
- `authenticatedUserProvider`の配線は、`MainTabView`→`HomeView`/`PlaceholderScreenView`/`PlanLimitPrompt`→`SubscriptionManagementView`という複数ファイルにわたる変更であり、各ファイルの既存init構造(メンバーワイズ初期化か明示initか)を実装時に個別に確認すること。
- `HomeCacheStore.save()`自体にユーザー整合性検証を追加しない方針とした(§5)。`fetch()`側のケース判定ロジックに将来バグが入った場合、`HomeCacheStore`はそれを検知できないという残存リスクを明記する。
- `HomeViewModel`のインスタンスは、ログイン・ログアウト・アカウント切替では確実に再生成されることを確認済み(タブ切替・画面回転・カレンダータブ初回訪問では再生成されない)。ただし`HomeView.swift`は1728行中、ライフサイクルに関わる先頭84行のみを確認しており、残り約900行(カード・バッジ等の見た目実装)は未読のため、他の再生成経路が無いことの完全な保証ではない。
- `Task { await fetch() }`は`self`を強参照で捕捉するため、View階層破棄後も進行中のTaskが完了するまで古い`HomeViewModel`インスタンスはメモリ上に残る。データの安全性には影響しないが、`[weak self]`化による早期解放の余地は残る。
- `.task { viewModel.load() }`(`HomeView.swift:70`)は`await`を伴わない同期呼び出しであり、SwiftUIの`.task`の自動キャンセルは`fetch()`の実際のTaskには及ばない(§0・§6参照)。
- `retryNow()`が`entitlementsRequestSequence`の競合で敗れた場合、ユーザーの明示操作の直接的な結果としては何も起きないことがある(勝った側の確定を`handlePlanStateChanged`が検知してHome取得につながるため、データの正しさは保たれるが、即時性に非対称なタイミングが生じうる)。

**(★HQ決定・第7次改訂対応)`retryNow()`競合敗北時の即時性の非対称性を許容するか → 現在の競合制御を許容する(仕様として受け入れる)**
- `.supersededByNewerRequest`を許容する。`retryNow()`自身が発行した`planStore.load()`が、他の正当な`load()`呼び出し(より新しい`entitlementsRequestSequence`を持つもの)に追い越された場合、`retryNow()`はそれを「確認が失敗した」とは扱わない(§4.2.1「retryNow()」の`.supersededByNewerRequest`分岐、既存のまま変更なし)。
- 追い越した側(より新しい`load()`)の完了までは、`isRetryAvailable`(§4.2.1「isRetryAvailableのObservable化」、`planStore.isLoadInProgress`が`true`の間)により再試行ボタンは非活性のままにする。これは既存の設計(§1.2「isLoadInProgress」、P2-4対応)がそのまま満たしている要件であり、追加の実装は不要。
- 追い越した側(より新しい`load()`)が失敗した場合でも、既存の「時間がかかっています」の案内(`isPlanConfirmationSlow`)、または単に`.loading`が維持されている表示を変えない。**これにより、この特定の競合敗北の経路では、ユーザーに失敗を明示的に表示できない**ことを仕様として明記する(`retryNow()`自身が`.supersededByNewerRequest`を受け取った時点では、追い越した側の結果はまだ分からないため)。
- `isLoadInProgress`が解消され再試行ボタンが再び有効になった時点で、ユーザーは改めて`retryNow()`を押して再試行できる。この「明示的な失敗表示が出ないまま、ボタンが再度押せるようになる」という体験は、HQが許容する仕様上の既知の挙動である。
- (§1.3)同一ユーザーのEntitlements再確認(特に購入・復元直後)が進行中にHome取得が完了すると、再確認完了までの短い時間窓で古いプランの内容が一瞬表示・キャッシュされる可能性がある(選択肢I採用時の既知の残存特性。選択肢IIを採用する場合はこのリスクは軽減されるが、新たな競合状態の検証コストが増える)。
- (§4.6)案2(Prefetch開始タイミング変更)・案3(Backend側の計算文脈エコー)はいずれも、本資料の範囲では具体的な実測・Backend設計を行っていない。採用判断後、別途の実測・設計作業が必要になる。
- **(今回・P3対応)** §4.2の`fetch()`は、既存コード(`HomeViewModel.swift`269-330行目)の副作用(診断記録・`recentSpeeches`/`speechesStatus`/`freshDataVersion`/`lastFreshAt`/`displayedCacheSavedAt`/`refreshNotice`/`lastFetchFailed`の更新、`.backendNotConfigured`分岐)を**すべて引き継いでいる**ことを§4.2で確認済み(`applyFetchSuccess`/`applyFetchFailure`への切り出しとして明示)。実装時は、この資料のコード例ではなく実際の`HomeViewModel.swift`の該当範囲を直接見比べ、見落としが無いことを再確認すること。
- **(今回・P3対応)** `retryNow()`に、このインスタンス自身の`userID`と`authenticatedUserProvider`のライブな値との一致確認を追加した(§4.2.1)。修正前は`authenticatedUserProvider.currentUserID`を直接使っており、取り残された古いインスタンスの「再試行」が別ユーザーのEntitlementsを取得しうる経路があった。
- **(今回・P1-1対応)** `init`内のCombine購読を`$isConfirmed.combineLatest($plan)`から`$state`に変更し、`planConfirmed()`・`handlePlanStateChanged()`を同じ購読から呼ぶ(§4.2.3)。この2つの呼び出し順序(`planConfirmed()`→`handlePlanStateChanged()`)に実際の依存関係が無いことは設計上の意図だが、実装時に単体テストで両方の呼び出し順を入れ替えても結果が変わらないことを明示的に確認すること(§11に追加)。
- **(今回・P2-2/P2-3対応)** `sleep: (Duration) async throws -> Void`のDIを追加した。本番の既定値(`{ try await Task.sleep(for: $0) }`)がキャンセル伝播を含めて実際の`Task.sleep`と同じ挙動であることを実装時に確認すること。
- **(今回・P2-1/P3-1対応、訂正)** §4.3.1の`needsRefetch`による2回目のFetchは、1回目のFetchの完了後に厳密に直列実行される(競合・順序逆転は構造的に発生しない)。残存リスクは「1回目(編集前)の内容が、2回目の完了までの短い時間窓で一度画面に表示される」という、ちらつきの可能性のみである(§4.3.1末尾の訂正済み説明参照)。
- **(今回・P3-1対応)** `LaunchDiagnostics`のCodable後方互換性: §7で新設する診断カウンタ用フィールドは、`LaunchDiagnostics`が`UserDefaults`にJSON形式で永続化され(`DiagnosticsStore.persist()`/`init()`)、次回起動時にデコードされる(`DiagnosticsStore.swift:43-48`)。新フィールドを**Optional型(既定`nil`)で追加する**こと。Swiftの`Codable`自動合成はOptionalプロパティを`decodeIfPresent`相当で扱うため、新フィールドを追加する前に保存された旧JSON(そのキーを含まない)もエラーなくデコードできる。非Optional・デフォルト値無しで追加すると、旧データのデコードに失敗し、前回の起動診断全体が失われる(`previous`が`nil`になる)。
- **(今回・P3-2対応)** `DiagnosticsStore`のシングルトンとテスト間のカウンタ累積: `DiagnosticsStore.shared`は単一インスタンスであり、`HomeViewModel`側にDIも無い(既存コードの一貫したパターンのまま、本設計では変更しない)。同一テスト実行内で複数のテストが同じカウンタを読む場合、**前のテストの値が累積して残る**ため、絶対値ではなく**差分(アクション前後のカウンタの差)**で検証すること。§8の各テスト(29〜37)はいずれも「呼び出し回数が増えるか否か」という相対的な検証として記載しており、絶対値を前提にしていない(実装時にこの方針を徹底すること)。
- **(今回・P3-3対応)** §4.2.1のタイムアウトTaskで、`self?.sleep`の読み取りを`await`を含む式から分離した(`let sleepFn = self?.sleep`を別文にする)。この分離が無い場合、`[weak self]`の意図(早期解放可能にすること)に反して、`self`が10秒間強参照されたままになる可能性がある。実装時に、この分離パターンが実際にSwiftコンパイラ・実行時挙動として意図通りに`self`を保持しないことを確認すること(§11「未検証」に追加)。
- **(今回・P3-4対応)** `PlanStore.set()`はgenerationを進めない(§1.2参照)。複数の異なるgenerationを必要とするテストでは`set()`を使わず、実際の`load()`(モックのEntitlementsServiceで異なる応答を返す)を使うこと。
- **(今回・P3-3/P3-6対応、訂正)** 同一ユーザーのプラン変更は`plan`/`limits`が直接新値に切り替わり、ユーザー切替は一時的にFREE既定値を経由する(§1.2「lastKnownの取り扱い方針のまとめ」末尾参照)。**この「ユーザー切替時に一時的にFREE既定値を経由する」挙動は、現行実装(旧ユーザーのプラン・制限値をそのまま表示し続ける)とは異なる、本設計で新たに導入する挙動である**(前回「既存コードと同様」としていたのは誤りだったため訂正)。`CalendarViewModel`等、`plan`/`limits`を直接購読するコードがこの一時的な既定値をどう扱うかは、実装時に各画面ごとに確認すること。
- **(今回・P3-5対応)** `authenticatedUserProvider`はOptionalで既定値`nil`のため、本番の配線漏れはコンパイルエラーにならず、安全性チェックが静かに無効化される形で現れる。§8テスト36のような、実際の配線経路に近い統合テストで検出することを推奨する。`authenticatedUserProvider`の既定値を削除して必須パラメータにする案(全呼び出し元へのコンパイル時強制)も検討したが、既存テストへの移行コストが更に増える(§9・§11参照)ため、今回は採用を見送り、既定値ありの設計を維持する。この判断の見直しが必要であればHQに相談すること。
- **(今回・追加確認(P3)7番対応)** 本資料のコード例には、型推論・コンパイルを実際のSwiftコンパイラで確認していない箇所が複数ある: `authenticatedUserProvider.map { $0.currentUserID == userID } ?? true`のクロージャ内型推論、`Duration`型(`sleep`のパラメータ)の実際のimport・利用可否、`let sleepFn = self?.sleep`の型(オプショナル関数値)の扱い、`.flatMap`を使った`EntitlementsResponse.Plan(rawValue:)`の呼び出し。いずれも実装時に最初に確認すること(§11に追加)。

---

## §11 未決定事項の完全な一覧

### HQ判断待ち(A独自に確定しない)

**(★HQ決定・第7次改訂対応)** 本資料に残っていたHQ判断待ち2項目(`save()`のユーザー整合性検証・`retryNow()`競合敗北時の非対称性)は、いずれもHQにより決定済みとなった(§5・§10参照)。本資料の範囲では、現時点で未決定の項目は**無い**。

**(HQ決定事項の記録、今回・P3-3対応で冒頭の「状態」と記載を統一)** §3・§1.3・§4.6の3項目は、本資料の改訂履歴(冒頭参照)にあるとおりHQにより決定済みである。「HQ判断待ち」ではなく、以下の決定事項として記録する。

**§3: `plan=nil && limits=nil`の確定方針 → ★案Bを採用(決定済み)**
- 両方欠落の場合は`.malformedResponse`として扱い、プランを確定しない(片方のみ欠落のケースと統一)。
- 決定理由: PROユーザーが誤ってFREE扱いされる実害(案Aのリスク)を防ぐことを優先。
- 残存リスク: 旧Backend(v1.15未満)が稼働している場合、そのユーザーは永久に未確定のままになる(§3に明記済み)。
- 必須条件: 実装・リリース前に対象Backendのバージョンと`/entitlements`レスポンス契約を確認すること(§3・下表参照)。

**§1.3: 同一ユーザーのEntitlements再確認 → ★案Iを採用(決定済み)**
- 現行設計(generationによる追い越し取得で収束)を維持。`isReconfirming`相当の追加フラグは設けない。
- 必須条件: 実装時に収束動作(§8テスト20・21)を必ずテストで確認すること。

**§4.6: Home Prefetchの方向性 → ★案3を目標方針として採用(決定済み、実装は未許可)**
- Backendから`computed_for_plan`等の計算文脈を返す方式を目指す。
- 前提条件: Backend API設計・旧バージョン互換性・フォールバック仕様の確定。
- **Backend側の設計が確定するまで、案3の実装は許可しない**(現時点では未確定のため着手不可)。
- 案1(現行方式維持)は恒久的な解決策としては扱わない、案3の前提が整うまでの暫定措置として位置づける。

**§5: `HomeCacheStore.save()`自体にユーザー整合性検証を追加するかどうか → ★現状維持(検証を追加しない)を採用(決定済み)**
- `save()`に新たなユーザー検証コードは追加しない。`fetch()`で確認してから同期的に保存するという既存の責任分担を維持する。
- 必須条件: `fetch()`の確認から`save()`呼び出しまでが同期的に連続していることを固定するテストを実装時に特定・維持すること(§5参照)。
- 将来の再検討条件: `fetch()`から`save()`呼び出しまでの間に非同期処理が挟まる変更が入る場合、この判断を再検討すること。

**§10: `retryNow()`競合敗北時の即時性の非対称性を許容するか → ★現在の競合制御を許容する(決定済み)**
- `.supersededByNewerRequest`を許容し、追い越した側の`load()`完了まで再試行ボタンを非活性にする(既存の`isRetryAvailable`の仕組みがそのまま満たす)。
- 追い越した側が失敗した場合、既存の「時間がかかっています」の案内を維持し、この経路では失敗を明示的に表示できないことを仕様として明記する(§10参照)。
- 再試行ボタンが再び有効になれば、ユーザーは改めて`retryNow()`で再試行できる。

### 未検証(実コードでの確認・実測がまだできていない事項)

| 項目 | 参照 |
|---|---|
| `HomeView.swift`の未読部分(約900行、見た目の実装)に追加のライフサイクル関連ロジックが無いか | §10 |
| `AuthenticatedUserProviding`を`@MainActor protocol`として宣言すること自体は設計上の必須条件として確定したが、実際にSwift 5モード(`project.yml`の`SWIFT_VERSION: "5.0"`)でコンパイルが通ることの実証確認は未検証 | §1.2 |
| 案2(Prefetch開始タイミング変更)採用時の、Splash起動シーケンス全体・既存の起動診断(`DiagnosticsStore`)への具体的な影響 | §4.6 |
| `/entitlements`・`/home`それぞれの実測時間、および両者を並行させられる余地 | §4.6 |
| **(★HQ決定・案B採用に伴う必須確認事項)** 旧Backend(v1.15未満)が現在実際にまだ稼働しているか。案Bの実装・リリース前に確認が必須(§3参照) | §3 |
| **(★HQ決定・案3目標方針に伴う未確定事項)** Backend API設計(`computed_for_plan`等のフィールド名・型・意味)・旧バージョン互換性方針・フォールバック仕様のいずれも未確定。これらが確定するまで案3の実装は許可されない(§4.6参照) | §4.6 |
| **(今回・P3対応)** HQから伝えられたC独立レビューのP3-1〜P3-5の具体的な指摘文は、今回の指示文には含まれていなかった(「起動診断、エラー分岐、キャッシュ処理、`retryNow()`のユーザー整合性も確認してください」という一般的な領域の指定のみ)。今回はこの4領域を本資料の既存コード突き合わせにより見直し、判明した差分(`.backendNotConfigured`分岐の復元・既存副作用の全量反映・`retryNow()`のユーザー整合性追加)をP3対応として§4.2・§4.2.1・§10に反映した。**C-1〜C-5の原文と一致するかどうかは確認できていない。** 原文がこの4領域以外の指摘を含む場合、今回の修正はそれを反映していない可能性がある。原文の共有、または一致確認をHQに依頼する。 | §4.2・§4.2.1・§10 |

### 実装時の確認事項

| 項目 | 参照 |
|---|---|
| `MainTabView`→`HomeView`/`PlaceholderScreenView`/`PlanLimitPrompt`→`SubscriptionManagementView`への`authenticatedUserProvider`配線の、各ファイルの既存init構造(メンバーワイズ初期化か明示initか) | §9・§10 |
| `PlanStoreTests.swift`の既存4テスト(`limits: nil`を使うモック)の期待値見直し。特に今回の修正(planのみ存在する場合も`malformedResponse`になったこと)に伴う追加の期待値変更 | §8・§9 |
| `HomeCacheTests.swift`の`authenticatedUserProvider`パラメータへの対応 | §9 |
| **(★HQ決定・案B採用により更新)** §1.2の`load()`内`case (nil, nil)`は`.malformedResponse`に統合済み。実装・リリース前に、対象Backendのバージョンと`/entitlements`レスポンス契約を確認することが必須条件(§3参照)。この確認が完了するまで本番コードへマージしないこと | §1.2・§3 |
| §4.6の案2・案3を採用する場合、`isRefreshingEntitlements`(§4.2.2)・`scheduleWaitForPlanConfirmation()`の確定済み即時フォールバック(§4.2.1)が、変更後のPrefetch開始タイミングとも整合することを再確認すること | §4.2.1・§4.2.2・§4.6 |
| **(今回・P2-2対応)** §4.6案2(Prefetch開始タイミングをPlanStore確定後に変更)を採用する場合、`SplashViewModel`は現状`PlanStore`への参照を持たないため、`planStore: PlanStore = .shared`の新規依存を追加し、`contextAtDispatch: planStore.confirmedContext`を`start()`に明示的に渡すよう変更する必要がある(§4.1参照) | §4.1・§4.6 |
| `@MainActor protocol AuthenticatedUserProviding`が実際にSwift 5モードでコンパイルされることを、実装着手時に最初に確認すること(通らない場合は設計の見直しが必要) | §1.2 |
| `commit()`の規則6は`private`のため`PlanStore.swift`外部から単体テストで直接検証する手段が無く(`@testable import`でも`private`は緩和されない)、かつ`load()`経由では到達しない。今回はこれを認識した上で、アクセスレベル変更等の設計変更は行わず、コードレビューによる目視確認に依存する限界として受け入れる(§1.2.1参照) | §1.2.1 |
| **(今回・P2-F対応、訂正)** `scheduleWaitForPlanConfirmation()`内の①②分岐は、現状`fetch()`からのみ呼ばれる限り**構造的に到達不能**(単に「動作の変化が無い」のではなく、論理的に到達し得ない。§4.2.1「fetch()側の既存guardとの整合性」参照)。実装時に`fetch()`側のguard順序を変更する、または別の呼び出し元を追加する場合は、この関数側の①②の判定もあわせて見直すこと | §4.2.1 |
| **(今回・P3-3対応)** `let sleepFn = self?.sleep; try? await sleepFn?(...)`という分離パターンが、実際に`self`を強参照しないことをSwiftコンパイラ・実機で確認すること(未検証のまま残す) | §4.2.1・§10 |
| **(今回・P3-7対応)** `Duration`型のimport元(`Foundation`か`Swift`標準ライブラリか)、`authenticatedUserProvider.map { ... } ?? true`のクロージャ内型推論、`EntitlementsResponse.Plan(rawValue:)`への`.flatMap`適用、のいずれも実際のSwiftコンパイラでの確認を行っていない | §4.2・§4.2.1・§1.2 |
| **(今回・P1-1対応)** `init`内の`$state`購読から呼ぶ`planConfirmed()`・`handlePlanStateChanged()`の呼び出し順序を入れ替えても結果が変わらないことを、実装時に単体テストで確認すること | §4.2.3・§10 |
| **(★HQ決定・第7次改訂対応)** `fetch()`の確認(`confirmedPlan(for:)`)から`cacheStore.save()`呼び出しまでが同期的に連続している(間に`await`を挟まない)ことを固定するテストを、`HomeCacheTests.swift`の既存テストから特定する。無ければ追加する(§5参照) | §5・§4.2 |
| **(今回・C指摘P3-1・P3-2対応)** `@Published`化(`isFetching`・`isRefreshingEntitlements`・`PlanStore.loadInProgressCount`等)による`HomeView`の再描画頻度の増加を、Instrumentsの「SwiftUI」テンプレート等で実測し、視認できるカクつき等が無いことを確認すること。問題が見られた場合は、`@Published`の通知範囲の最小化(内部管理用プロパティと`HomeView`が直接参照するプロパティの分離)を検討すること(§4.2.1「isRetryAvailableのObservable化」のC指摘P3対応参照) | §4.2・§4.2.1 |
| **(今回・C指摘P3-3対応)** `isRetryAvailable`を現在のストアド`@Published private(set) var`から計算プロパティへ戻すかどうかは今回は見送った。実測で再描画コストが問題になった場合にのみ再検討すること(§4.2.1参照) | §4.2.1 |
| **(今回・C指摘P3-8対応)** §4.2.1「isRetryAvailableのObservable化」の`Publishers.CombineLatest3`・`.sink`・`Task { @MainActor in }`を含むコード例が、実際のSwiftコンパイラ(特にSwift 6の厳格な並行性チェック)でエラー・警告無くコンパイルされることは未検証のまま残す。実装着手時に最初に確認すること | §4.2.1 |
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
| **(今回・P2-D対応、新規判明)** `PlanStoreTests.swift:20` | `await store.load(apiClient: api)`(`userID`・`authenticatedUserProvider`いずれも省略。テスト名`testLoadWithoutAUserIDBehavesAsBefore`、「`userID`が無い場合」の挙動を検証する意図) | `authenticatedUserProvider`に既定値が無いため**コンパイル不能**。単純に`authenticatedUserProvider: nil`を渡すと、①のguard(`guard let authenticatedUserProvider else { return .authenticationUnverifiable }`)が`userID`チェックより先に失敗し、**期待する`.userMismatchOrUnknown`ではなく`.authenticationUnverifiable`が返ってしまう**(テスト意図の変化) | **変更必要**: `authenticatedUserProvider`には**実在する値を返すモック**(例: `currentUserID: UUID()`を返すだけのダミー)を渡し、「`authenticatedUserProvider`はあるが`userID`が無い」という元のテスト意図を保ったまま`.userMismatchOrUnknown`を検証すること |
| **(今回・P2-D対応、新規判明)** `PlanStoreTests.swift:34, 51-52, 67, 82` | `await store.load(apiClient:, userID: userA/userB, prefetchCoordinator:)`(`authenticatedUserProvider`省略、計5呼び出し) | 同様に**コンパイル不能**。`authenticatedUserProvider: nil`を渡すと同様に`.authenticationUnverifiable`になり、本来期待している確定成功・失敗等のシナリオを検証できなくなる(テスト意図の変化) | **変更必要**: 各呼び出しに、`currentUserID`が渡している`userID`(`userA`/`userB`)と**一致する**モックの`authenticatedUserProvider`を明示的に渡すこと |
| **(今回・P2-D対応、新規判明)** `HomeCacheTests.swift:428` | `await plan.load(apiClient: failing)`(`userID`・`authenticatedUserProvider`いずれも省略。Entitlements取得失敗のシナリオ検証) | 同様に**コンパイル不能**。`authenticatedUserProvider`を渡さないと①のguardで即`.authenticationUnverifiable`になり、本来検証したい「通信失敗→`.requestFailed`」のシナリオに到達しない | **変更必要**: `userID`・`authenticatedUserProvider`(一致するモック)の両方を明示的に渡し、実際に通信失敗パスに到達するようにすること |
| **(今回・P2-D対応、確認済み・未変更)** `PlanStoreTests.swift`の§8テスト19/19-2/19-3(P0-2対応で新規追加したテスト) | 既に`authenticatedUserProvider`を明示的に渡す設計(§8参照) | 影響なし | **変更不要** |
| **(今回・P2-D対応、確認が必要)** `RootView.swift`・`SubscriptionManagementViewModel.swift`の`PlanStore.load()`呼び出し(本番コード) | §9に記載のとおり`authenticatedUserProvider: appState`等を追加する予定 | 本資料では該当箇所の正確な行番号までは再確認していない | **実装時に確認**: 各呼び出しが`authenticatedUserProvider`を実際に渡すよう改修されていることをコンパイルで確認すること(デフォルト値が無いため、渡し忘れは即コンパイルエラーになる。これ自体は§9・P3-5の「配線漏れがコンパイルで検出できない」問題とは別で、`PlanStore.load()`自体の呼び出しはコンパイルで強制される) |
