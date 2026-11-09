import SwiftUI

/// 無料プランの上限に当たったときの案内(HQ指示 2026-10-08)。「プレミアムプランの
/// 機能です」と理由を出し、「プランを見る」でSCR-017 プラン・購読管理へ移る。
/// 有料機能からSCR-017への導線(2026-10-06の積み残し)もこれで兼ねる。
///
/// 使う側は`message`に理由を入れるだけ。NavigationStackの中で使う。
///
/// HQ指示(2026-11-09「StrategyAnalysisのFREE/PROアクセス制御」): タイトル・ボタンの文言を
/// 呼び出し側で変えられるようにした(既定値は従来どおり)。アップグレード導線(「プランを見る」
/// 相当のボタン)は常にこの同じ`SubscriptionManagementView`へつなぐ — 新しい課金処理は作らない。
struct PlanLimitPrompt: ViewModifier {
    @Binding var message: String?
    let apiClient: APIClient
    @Binding var tabSelection: Int
    var title: String = "プレミアムプランの機能です"
    var confirmButtonTitle: String = "プランを見る"
    var cancelButtonTitle: String = "閉じる"
    @State private var showsPlans = false

    func body(content: Content) -> some View {
        content
            .alert(
                title,
                isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })
            ) {
                Button(confirmButtonTitle) { showsPlans = true }
                Button(cancelButtonTitle, role: .cancel) {}
            } message: {
                Text(message ?? "")
            }
            .navigationDestination(isPresented: $showsPlans) {
                SubscriptionManagementView(apiClient: apiClient, tabSelection: $tabSelection)
            }
    }
}

extension View {
    func planLimitPrompt(
        _ message: Binding<String?>, apiClient: APIClient, tabSelection: Binding<Int>,
        title: String = "プレミアムプランの機能です", confirmButtonTitle: String = "プランを見る", cancelButtonTitle: String = "閉じる"
    ) -> some View {
        modifier(PlanLimitPrompt(
            message: message, apiClient: apiClient, tabSelection: tabSelection,
            title: title, confirmButtonTitle: confirmButtonTitle, cancelButtonTitle: cancelButtonTitle
        ))
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

/// 無料プランで隠された過去の発表(api-design v1.33 §28.2、HQ判断 2026-10-22)。
/// 値の代わりに「有料プランで見られます」を出す(「--」だとデータが無いように見えるため使わない)。
enum PastReleaseLock {
    static let label = "有料プランで見られます"
    /// 「前回」だけを隠したとき(ひとつ前の発表がロックされている)の短い表記。
    static let previousShortLabel = "有料プラン"

    /// 印を押したときの案内(`planLimitPrompt`の本文)。`maxForPlan`は`PlanLimits.pastReleasesMax`
    /// (古いBackendでnilのときは無料プランの3回)。
    static func promptMessage(maxForPlan: Int?) -> String {
        let count = maxForPlan ?? 3
        return "無料プランで結果・予想・前回を見られるのは、指標ごとに直近\(count)回の発表です。プレミアムプランならすべての発表を見られます。"
    }
}

/// 隠された値の代わりに出す小さな鍵の印と「有料プランで見られます」。
struct PastReleaseLockBadge: View {
    var size: CGFloat = 8

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "lock.fill")
                .font(.system(size: size * 0.8, weight: .semibold))
            NotoText.text(PastReleaseLock.label, size: size)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .foregroundStyle(V5P.cyan)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(PastReleaseLock.label)
    }
}
