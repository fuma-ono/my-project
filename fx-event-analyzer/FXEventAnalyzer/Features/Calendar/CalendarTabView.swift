import SwiftUI

/// SCR-010 経済カレンダー。HQ指示(2026-10-03、画面構成全面更新)「旧『分析』
/// タブは廃止、5タブはホーム/指標/カレンダー/検索/設定」を受け、タブ3番目を
/// `AnalysisTabView`(旧SCR-011 チャート分析、削除済み)から置き換えた新設の
/// タブルート。実装本体はまだ存在しないため、タブの中身は
/// `PlaceholderScreenView`(仮画面)。構造は旧`AnalysisTabView`と同一(`V5Viewport`
/// は仮画面の位置合わせのためだけに再利用しており、ビジュアルデザインの流用では
/// ない)。
///
/// SCR-005 経済指標カレンダー画面(ui-screens.md旧番号)に相当 — 「今日・明日・
/// 今後、何が発表されるか」を時系列で確認する画面で、SCR-005 指標一覧(指標
/// そのものを探す画面)とは役割が異なる(HQ指示の区別に従う)。
struct CalendarTabView: View {
    let apiClient: APIClient
    @Binding var tabSelection: Int
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            V5Viewport {
                PlaceholderScreenView(scrNumber: "SCR-010", screenName: "経済カレンダー")
                // 他のタブルート(Home/Indicators/Search/Settings)と同じ「メインタブ
                // 扱い」のヘッダー仕様(16pt Semibold、戻るボタンなし)。
                V5Header(title: "カレンダー", back: false)
                V5BottomBar(selected: $tabSelection)
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: AppRoute.self) { route in
                AppRouteDestinationView(route: route, apiClient: apiClient, tabSelection: $tabSelection)
            }
        }
    }
}
