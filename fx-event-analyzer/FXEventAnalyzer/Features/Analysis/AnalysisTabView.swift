import SwiftUI

/// SCR-011 チャート分析(ui-screens.md v2.0)。2026-09-29 HQ承認(2-b)でメインタブ
/// の3番目として新設。実装本体はまだ存在しないため、タブの中身は
/// `PlaceholderScreenView`(仮画面)。`V5Viewport`は仮画面の位置合わせのためだけに
/// 再利用しており(タブ切り替え用`V5BottomBar`を正しい座標に描画するための
/// スケーリング機構であって、ビジュアルデザインの流用ではない)、
/// `PlaceholderScreenView`自身が不透明な背景を持つため、V5の配色・グラデーション
/// は隠れて見えない(既存画面のデザインを流用しているように見えないための意図的な
/// 構成)。
///
/// 通貨ペアを起点に開く場合(ホーム画面の通貨ペアカードから)は、このタブとは別に
/// 遷移元タブ自身の`NavigationPath`に`AppRoute.chartAnalysis(fxPairId:
/// fxPairSymbol:)`がpushされる(このタブのpathとは独立)。
struct AnalysisTabView: View {
    let apiClient: APIClient
    @Binding var tabSelection: Int
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            V5Viewport {
                PlaceholderScreenView(scrNumber: "SCR-011", screenName: "チャート分析")
                // HQ「ヘッダーのタイトルサイズ統一」最終仕様(2026-10-01)はSCR-011
                // 分析タブもメインタブ扱い(16pt Semibold)に含めているため、
                // `V5BottomBar`と同じ要領でプレースホルダーの不透明背景の上に
                // タイトルのみのヘッダーを重ねた(仮画面自体の内容は変更しない)。
                V5Header(title: "分析", back: false, star: false)
                V5BottomBar(selected: $tabSelection)
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: AppRoute.self) { route in
                AppRouteDestinationView(route: route, apiClient: apiClient, tabSelection: $tabSelection)
            }
        }
    }
}
