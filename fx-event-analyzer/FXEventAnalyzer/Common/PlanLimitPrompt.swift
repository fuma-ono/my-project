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
    /// 購入の導線を出してよいか(`purchases_enabled`)。falseのとき(1.0の既定)は、「プランを見る」を出さず、
    /// 価格・PRO・有料に触れない中立の説明と「閉じる」だけにする(呼び出し側の画面は変えない)。
    @ObservedObject private var plan = PlanStore.shared

    func body(content: Content) -> some View {
        content
            .alert(
                plan.purchasesEnabled ? title : PlanNeutralText.title,
                isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })
            ) {
                if plan.purchasesEnabled {
                    Button(confirmButtonTitle) { showsPlans = true }
                }
                Button(plan.purchasesEnabled ? cancelButtonTitle : PlanNeutralText.closeButton, role: .cancel) {}
            } message: {
                Text(plan.purchasesEnabled ? (message ?? "") : PlanNeutralText.sanitized(message))
            }
            .navigationDestination(isPresented: $showsPlans) {
                PurchaseFeatureGate { SubscriptionManagementView(apiClient: apiClient, tabSelection: $tabSelection) }
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

/// `purchases_enabled`がfalseのとき(1.0)に、価格・PRO・有料に触れずに出す中立の文言。
enum PlanNeutralText {
    static let title = "この範囲は現在ご利用いただけません"
    static let defaultMessage = "この範囲の情報は、現在準備中です。"
    static let closeButton = "閉じる"
    /// 「この範囲は現在準備中です」。鍵の印・値の代わりの表示に使う。
    static let preparing = "この範囲は現在準備中です"
    static let preparingShort = "準備中"
    /// 中立の表示に出してはいけない語(価格・購入・プランに触れる語)。
    static let forbiddenWords = ["プレミアム", "PRO", "Pro", "pro", "有料", "無料", "プラン", "アップグレード", "課金", "購入", "購読", "料金", "価格"]

    /// 呼び出し側の本文が、禁止語を含まなければそのまま、含めば既定の中立の本文にする。
    static func sanitized(_ message: String?) -> String {
        guard let message, !message.isEmpty else { return defaultMessage }
        return forbiddenWords.contains(where: { message.contains($0) }) ? defaultMessage : message
    }
}

/// 一覧の行に付ける小さな「Pro」の印。購入の導線を出さないとき(`purchases_enabled`がfalse)は表示しない。
struct ProBadge: View {
    @ObservedObject private var plan = PlanStore.shared

    var body: some View {
        if plan.purchasesEnabled {
            Text("Pro")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 7)
                .padding(.vertical, 2)
                .background(Capsule().fill(V5P.blue))
                .accessibilityLabel("プレミアムプラン")
        }
    }
}

/// 無料プランで隠された過去の発表(api-design v1.33 §28.2、HQ判断 2026-10-22)。
/// 値の代わりに「有料プランで見られます」を出す(「--」だとデータが無いように見えるため使わない)。
///
/// 2026-11-24(オーナー決定): `purchases_enabled`がfalseの間は、価格・PRO・有料に触れない中立の表示
/// (「この範囲は現在準備中です」)に差し替える。制限(ロック)自体はBackendのまま変えない。
@MainActor
enum PastReleaseLock {
    static var label: String {
        PlanStore.shared.purchasesEnabled ? "有料プランで見られます" : PlanNeutralText.preparing
    }
    /// 「前回」だけを隠したとき(ひとつ前の発表がロックされている)の短い表記。
    static var previousShortLabel: String {
        PlanStore.shared.purchasesEnabled ? "有料プラン" : PlanNeutralText.preparingShort
    }
    /// 値動き詳細で、ロックされた発表の説明。
    static var movementLockedMessage: String {
        PlanStore.shared.purchasesEnabled ? "この発表の値動きはプレミアムプランで見られます。" : "この発表の値動きは、現在準備中です。"
    }

    /// 印を押したときの案内(`planLimitPrompt`の本文)。`maxForPlan`は`PlanLimits.pastReleasesMax`
    /// (古いBackendでnilのときは無料プランの3回)。
    static func promptMessage(maxForPlan: Int?) -> String {
        let count = maxForPlan ?? 3
        guard PlanStore.shared.purchasesEnabled else {
            return "結果・予想・前回を見られるのは、指標ごとに直近\(count)回の発表です。"
        }
        return "無料プランで結果・予想・前回を見られるのは、指標ごとに直近\(count)回の発表です。プレミアムプランならすべての発表を見られます。"
    }
}

/// 隠された値の代わりに出す小さな鍵の印と「有料プランで見られます」。
struct PastReleaseLockBadge: View {
    var size: CGFloat = 8
    /// 購入の導線のフラグが変わったら文言を差し替える(表示の再描画用)。
    @ObservedObject private var plan = PlanStore.shared

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
