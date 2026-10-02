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
        case .historicalEventDetail(let id):
            HistoricalEventDetailView(apiClient: apiClient, eventId: id, tabSelection: $tabSelection)
        case .movementDetail(let eventId, let indicatorId, let fxPairId, let symbol, let indicatorName, let releaseDatetime):
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
        case .historicalComparison(let indicatorId, let indicatorName, let fxPairId, let fxPairSymbol):
            HistoricalComparisonView(
                apiClient: apiClient,
                indicatorId: indicatorId,
                indicatorName: indicatorName,
                fxPairId: fxPairId,
                fxPairSymbol: fxPairSymbol,
                tabSelection: $tabSelection
            )
        case .account:
            AccountView(apiClient: apiClient, tabSelection: $tabSelection)

        // MARK: - 2026-09-29 HQ承認(2-b): 仮画面(PlaceholderScreenView)への解決。
        // 実装本体はまだ存在せず、正式なUIは別途デザイン仕様確定後に実装する。
        case .chartAnalysis(_, let fxPairSymbol):
            PlaceholderScreenView(scrNumber: "SCR-011", screenName: "チャート分析", detail: "通貨ペア: \(fxPairSymbol)")
                .navigationTitle("チャート分析")
                .navigationBarTitleDisplayMode(.inline)
        case .calendar:
            PlaceholderScreenView(scrNumber: "SCR-012", screenName: "経済指標カレンダー")
                .navigationTitle("経済指標カレンダー")
                .navigationBarTitleDisplayMode(.inline)
        case .speechList:
            PlaceholderScreenView(scrNumber: "SCR-014", screenName: "要人発言一覧", detail: "バックエンドAPI未実装のため仮画面です。")
                .navigationTitle("要人発言一覧")
                .navigationBarTitleDisplayMode(.inline)
        case .speechDetail(let id):
            PlaceholderScreenView(scrNumber: "SCR-015", screenName: "要人発言詳細", detail: "発言ID: \(id)\nバックエンドAPI未実装のため仮画面です。")
                .navigationTitle("要人発言詳細")
                .navigationBarTitleDisplayMode(.inline)
        case .homeCurrencyPairEditor:
            PlaceholderScreenView(scrNumber: "SCR-028", screenName: "ホーム通貨ペア編集", detail: "お気に入り通貨ペアAPI未実装のため仮画面です。")
                .navigationTitle("通貨ペア編集")
                .navigationBarTitleDisplayMode(.inline)
        case .favoritesList:
            PlaceholderScreenView(scrNumber: "未採番", screenName: "お気に入り一覧", detail: "指標・イベント・通貨ペアのお気に入りを横断する一覧です。")
                .navigationTitle("お気に入り")
                .navigationBarTitleDisplayMode(.inline)
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
