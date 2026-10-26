import SwiftUI

/// Top-level screen switch: SCR-000 → SCR-001 / SCR-004
/// (design.md 15.1節 起動フロー).
struct RootView: View {
    @StateObject private var appState: AppState
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL
    @ObservedObject private var preferences = AppPreferences.shared
    @ObservedObject private var updateStore = AppUpdateStore.shared
    private let authService: AuthServicing
    private let apiClient: APIClient

    init(authService: AuthServicing, apiClient: APIClient) {
        self.authService = authService
        self.apiClient = apiClient
        _appState = StateObject(wrappedValue: AppState(authService: authService))
    }

    var body: some View {
        Group {
            switch appState.phase {
            case .launching:
                SplashView(
                    viewModel: SplashViewModel(authService: authService) { outcome in
                        appState.splashFinished(outcome: outcome)
                    }
                )
            case .loggedOut(let sessionExpired):
                LoginView(
                    viewModel: LoginViewModel(authService: authService) { session in
                        appState.handleSuccessfulLogin(session)
                    },
                    sessionExpired: sessionExpired
                )
                .onAppear {
                    // セッション切れでログイン画面に戻った場合も、前のユーザーの
                    // 通知の予約・一覧と表示設定を残さない。
                    LocalNotificationScheduler(apiClient: apiClient).reset()
                    AppPreferences.shared.reset()
                    PlanStore.shared.reset()
                    if sessionExpired { FavoritesStore.shared.removeAll() }
                }
            case .loggedIn:
                MainTabView(apiClient: apiClient, authService: authService) {
                    // ログアウト・アカウント削除: 前のユーザーの通知・お気に入り・
                    // 表示設定を残さない。
                    LocalNotificationScheduler(apiClient: apiClient).reset()
                    FavoritesStore.shared.removeAll()
                    AppPreferences.shared.reset()
                    PlanStore.shared.reset()
                    appState.handleSignOut()
                }
                // 文字サイズを変えたら全画面を作り直して新しい大きさで表示する(HQ指示 2026-10-15)。
                // 作り直すのでホームのタブに戻る。
                .id(preferences.display.textSize)
                .task(id: scenePhase) {
                    // 起動時・フォアグラウンド復帰時にローカル通知を予約し直し、
                    // 表示中は通知時刻を過ぎた分をベルの赤バッジに反映する。
                    if scenePhase == .background {
                        NotificationBackgroundRefresh.schedule()
                    }
                    guard scenePhase == .active else { return }
                    // HQ指示(2026-10-23「iOS画面表示速度の改善」): 以前はこの2つを
                    // 直列(`await`→`await`)で取得しており、互いに依存しないにも
                    // かかわらず2回ぶんの通信時間を合計していた。`LocalNotification
                    // Scheduler.refresh()`(この後)はAppPreferences.sharedの
                    // timeZoneを読むため、AppPreferences.load()の完了は引き続き
                    // refresh()より前に保証する必要がある(そのため両方の完了を
                    // 待ってから次へ進む) — PlanStore.load()はAppPreferences/
                    // LocalNotificationSchedulerのどちらにも依存しない独立した
                    // 取得(`PlanStore.swift`参照)なので、ここだけ並行化できる。
                    // SCR-018 / SCR-019の設定(表示形式など)を読み込む。
                    async let preferencesLoad: Void = AppPreferences.shared.load(apiClient: apiClient)
                    // 無料プラン・プレミアムプランの使える範囲(カレンダー・お気に入りなど)。
                    async let planLoad: Void = PlanStore.shared.load(apiClient: apiClient)
                    _ = await (preferencesLoad, planLoad)
                    // SCR-017: 自動更新・解約などの購読の変化をBackendへ送る。
                    // UIスクリーンショットCIではApp Store Connectのサンドボックス
                    // アカウントが無く、StoreKitの`Product.products(for:)`/
                    // `Transaction.updates`が実サーバーへの到達を試みて数分間
                    // ハング — その間メインタブの画面遷移が全て止まり、設定画面
                    // 以降のキャプチャが軒並み失敗する実障害を確認したため、
                    // このテスト実行中はStoreKitに触れない。
                    if ProcessInfo.processInfo.environment["UI_SCREENSHOT_HOLD_SPLASH"] == nil {
                        SubscriptionSync.shared.start(apiClient: apiClient)
                    }
                    await LocalNotificationScheduler(apiClient: apiClient).refresh()
                    // HQ指示(2026-10-25)「アップデートしてくださいのポップを出して
                    // App Storeで更新させるようにしたい」: 他の起動時読み込みを
                    // 待たせたくないので、結果を待たずに独立して走らせる
                    // (`AppUpdateStore.swift`参照)。
                    Task { await AppUpdateStore.shared.checkForUpdate() }
                    while !Task.isCancelled {
                        try? await Task.sleep(for: .seconds(30))
                        NotificationsStore.shared.refreshUnread()
                    }
                }
            }
        }
        // SCR-018の文字サイズ(iOS標準の部品に効く)。
        .dynamicTypeSize(preferences.dynamicTypeSize)
        .preferredColorScheme(.dark) // MVP baseline theme (ui-screens.md 5.0節); see DesignTokens.swift
        // HQ指示(2026-10-25)「アップデートしてくださいのポップを出して
        // App Storeで更新させるようにしたい」。閉じられる案内(強制アップデート
        // ではない、HQ確認済み2026-10-25) — 「後で」でも「アップデート」でも
        // 同じバージョンでは次回以降案内しない(`AppUpdateStore.dismiss()`)。
        .alert(
            "新しいバージョンがあります",
            isPresented: Binding(get: { updateStore.availableUpdate != nil }, set: { if !$0 { updateStore.dismiss() } })
        ) {
            Button("後で", role: .cancel) { updateStore.dismiss() }
            Button("アップデート") {
                if let url = updateStore.availableUpdate?.storeURL { openURL(url) }
                updateStore.dismiss()
            }
        } message: {
            Text("最新の機能や修正を利用するには、App Storeでアップデートしてください。")
        }
    }
}
