import SwiftUI

/// Resolves an `AppRoute` to its screen. Registered once per tab's
/// `NavigationStack` via `.navigationDestination(for: AppRoute.self)`, so
/// every `NavigationLink(value:)` anywhere in that tab's subtree — however
/// deep — routes through here.
struct AppRouteDestinationView: View {
    let route: AppRoute
    let apiClient: APIClient
    @Binding var tabSelection: Int

    var body: some View {
        switch route {
        case .indicatorDetail(let id):
            IndicatorDetailView(apiClient: apiClient, indicatorId: id, tabSelection: $tabSelection)
        case .eventDetail(let id):
            EventDetailView(apiClient: apiClient, eventId: id, tabSelection: $tabSelection)
        case .movementDetail(let eventId, let indicatorId, let fxPairId, let symbol, let indicatorName, let releaseDatetime):
            PriceFeatureGate {
                MovementDetailView(
                    apiClient: apiClient,
                    eventId: eventId,
                    indicatorId: indicatorId,
                    fxPairId: fxPairId,
                    symbol: symbol,
                    indicatorName: indicatorName,
                    releaseDatetime: releaseDatetime,
                    tabSelection: $tabSelection
                )
            }
        case .historicalComparison(let indicatorId, let indicatorName, let fxPairId, let fxPairSymbol):
            HistoricalComparisonView(
                apiClient: apiClient,
                indicatorId: indicatorId,
                indicatorName: indicatorName,
                fxPairId: fxPairId,
                fxPairSymbol: fxPairSymbol,
                tabSelection: $tabSelection
            )
        case .eventStrategyAnalysis(let eventId, let indicatorName, let fxPairId):
            PriceFeatureGate {
                StrategyAnalysisView(
                    apiClient: apiClient,
                    eventId: eventId,
                    indicatorName: indicatorName,
                    fxPairId: fxPairId,
                    tabSelection: $tabSelection
                )
            }
        case .account:
            AccountView(apiClient: apiClient, tabSelection: $tabSelection)
        case .notifications:
            NotificationListView(apiClient: apiClient, tabSelection: $tabSelection)
        case .notificationSettings:
            NotificationSettingsView(apiClient: apiClient, tabSelection: $tabSelection)
        case .supportHistory:
            SupportHistoryView(apiClient: apiClient, tabSelection: $tabSelection)
        case .rateAlerts:
            PriceFeatureGate { RateAlertsView(apiClient: apiClient, tabSelection: $tabSelection) }
        case .speechMovementDetail(let speechId, let fxPairId, let symbol, let title, let statementDatetime):
            PriceFeatureGate {
                MovementDetailView(
                    apiClient: apiClient,
                    eventId: speechId,
                    indicatorId: speechId,
                    fxPairId: fxPairId,
                    symbol: symbol,
                    indicatorName: title,
                    releaseDatetime: statementDatetime,
                    isSpeech: true,
                    tabSelection: $tabSelection
                )
            }
        case .speakerComparison(let speakerId, let fxPairId, let symbol):
            SpeakerComparisonView(apiClient: apiClient, speakerId: speakerId, fxPairId: fxPairId, symbol: symbol, tabSelection: $tabSelection)
        case .indicatorReleases(let id, let name):
            IndicatorReleasesView(apiClient: apiClient, indicatorId: id, indicatorName: name, tabSelection: $tabSelection)

        // MARK: - 仮画面(PlaceholderScreenView)への解決。実装本体はまだ存在せず、
        // 正式なUIは別途デザイン仕様確定後に実装する。SCR番号はHQ指示
        // (2026-10-03、画面構成全面更新)の新27画面構成に準拠。
        case .calendar:
            PlaceholderScreenView(scrNumber: "SCR-010", screenName: "経済カレンダー")
                .navigationTitle("経済カレンダー")
                .navigationBarTitleDisplayMode(.inline)
        case .speechList(let preview):
            // SCR-012 要人発言一覧(HQ指示 2026-10-14「指標一覧と同じデザインで」)。
            SpeechListView(apiClient: apiClient, preview: preview, tabSelection: $tabSelection)
        case .speechDetail(let id):
            SpeechDetailView(apiClient: apiClient, speechId: id, tabSelection: $tabSelection)
        case .homeCurrencyPairEditor:
            PriceFeatureGate { HomeCurrencyPairEditorView(apiClient: apiClient, tabSelection: $tabSelection) }
        case .launchDiagnostics:
            LaunchDiagnosticsView(tabSelection: $tabSelection)
        case .favoritesList:
            // HQ指示(2026-10-15): 仮画面から、指標一覧と同じデザインのお気に入り一覧へ。
            FavoritesListView(apiClient: apiClient, tabSelection: $tabSelection)
        case .signUp:
            PlaceholderScreenView(scrNumber: "SCR-002", screenName: "新規会員登録")
                .navigationTitle("新規会員登録")
                .navigationBarTitleDisplayMode(.inline)
        case .passwordReset:
            PlaceholderScreenView(scrNumber: "SCR-003", screenName: "パスワード再設定")
                .navigationTitle("パスワード再設定")
                .navigationBarTitleDisplayMode(.inline)
        }
    }
}

/// 購入(PRO課金)の画面(プラン・購読管理)への入口。`purchases_enabled`がfalseのとき(1.0の既定)は
/// 画面を作らず、すぐ前の画面へ戻す(画面のファイルは残してあり、サーバー側のフラグで再有効化できる)。
struct PurchaseFeatureGate<Content: View>: View {
    @ObservedObject private var plan = PlanStore.shared
    @Environment(\.dismiss) private var dismiss
    private let content: () -> Content

    init(@ViewBuilder content: @escaping () -> Content) {
        self.content = content
    }

    var body: some View {
        if plan.purchasesEnabled {
            content()
        } else {
            DesignTokens.Colors.backgroundPrimary.ignoresSafeArea().onAppear { dismiss() }
        }
    }
}

/// 価格由来の画面(値動き詳細・トレード戦略分析・価格アラート・ホーム通貨ペア編集)への入口。
/// `price_features_enabled`がfalseのとき(1.0の既定)は画面を作らず、すぐ前の画面へ戻す
/// (ディープリンク・古い通知からの到達対策)。画面のファイルは残してあり、サーバー側のフラグで再有効化できる。
struct PriceFeatureGate<Content: View>: View {
    @ObservedObject private var plan = PlanStore.shared
    @Environment(\.dismiss) private var dismiss
    private let content: () -> Content

    init(@ViewBuilder content: @escaping () -> Content) {
        self.content = content
    }

    var body: some View {
        if plan.priceFeaturesEnabled {
            content()
        } else {
            DesignTokens.Colors.backgroundPrimary.ignoresSafeArea().onAppear { dismiss() }
        }
    }
}
