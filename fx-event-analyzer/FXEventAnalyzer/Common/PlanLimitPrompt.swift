import SwiftUI

/// 無料プランの上限に当たったときの案内(HQ指示 2026-10-08)。「プレミアムプランの
/// 機能です」と理由を出し、「プランを見る」でSCR-017 プラン・購読管理へ移る。
/// 有料機能からSCR-017への導線(2026-10-06の積み残し)もこれで兼ねる。
///
/// 使う側は`message`に理由を入れるだけ。NavigationStackの中で使う。
struct PlanLimitPrompt: ViewModifier {
    @Binding var message: String?
    let apiClient: APIClient
    @Binding var tabSelection: Int
    @State private var showsPlans = false

    func body(content: Content) -> some View {
        content
            .alert(
                "プレミアムプランの機能です",
                isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })
            ) {
                Button("プランを見る") { showsPlans = true }
                Button("閉じる", role: .cancel) {}
            } message: {
                Text(message ?? "")
            }
            .navigationDestination(isPresented: $showsPlans) {
                SubscriptionManagementView(apiClient: apiClient, tabSelection: $tabSelection)
            }
    }
}

extension View {
    func planLimitPrompt(_ message: Binding<String?>, apiClient: APIClient, tabSelection: Binding<Int>) -> some View {
        modifier(PlanLimitPrompt(message: message, apiClient: apiClient, tabSelection: tabSelection))
    }
}

/// 一覧の行に付ける小さな「Pro」の印。
struct ProBadge: View {
    var body: some View {
        Text("Pro")
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(.white)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(Capsule().fill(V5P.blue))
            .accessibilityLabel("プレミアムプラン")
    }
}
