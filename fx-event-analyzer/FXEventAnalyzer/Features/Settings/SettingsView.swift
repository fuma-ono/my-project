import SwiftUI

/// SCR-016 設定画面(ui-screens.md v2.0)。
///
/// 方向転換(2026-09-30): HQより実装の起点となる参考画像
/// (`docs/projects/fx-event-analyzer/mockups/settings-screen-reference-v1.jpg`)
/// が直接共有され、「画像を完全再現して」という
/// 明示指示のもと、この行内容部分を作り直した。SplashView/LoginView が
/// すでに確立している「HQが画像を直接共有する画面は、旧HQ V5 Pixel
/// Frontendパッケージの固定座標ではなく、その参考画像を実測して再現する」
/// という方針をこの画面にも適用している。
///
/// 全体の外枠(`V5Viewport`/`V5TopStatus`/`V5Header`/`V5BottomBar`)は
/// 他の全タブ画面と共有しているため変更していない(タブ切り替え時に文字
/// サイズが急に変わるような見た目の不整合を避けるため)。変更したのは
/// リスト部分のみで、参考画像から実測したフラクション座標を234×491の
/// V5座標系に変換して配置している(測定方法: 画像のピクセル明度を行方向
/// にスキャンし、行の中心・区切り線・カード境界のy座標を検出)。
///
/// 参考画像との既知の差分(意図的な妥協、完全な一致ではない箇所):
/// - タイトル「設定」の縦位置: 参考画像の実測ではy≈4.2%(V5換算y≈21)だが、
///   `V5Header`は全画面共通でy=40固定。他タブとのヘッダー位置統一を優先し、
///   ここだけ動かしていない。
/// - 各アイコンはSF Symbolsの中から最も近い形状のものを選んでいる(参考
///   画像のアイコンはSF Symbols標準セットそのものではないため、Loginの
///   パスワード欄アイコンと同じ「最も近い形状を採用する」慣例に従った)。
///
/// 行とAppRoute/SettingsSubRouteの対応(2026-09-29 HQ承認 2-b/2-cで
/// 追加済みのルートをそのまま使用— 新しいルートは追加していない):
/// アカウント情報→`.account`(SCR-017)、通知設定→`.notificationSettings`
/// (SCR-018)、プラン・購読管理→`.subscriptionManagement`(SCR-019)、
/// 表示・地域設定→`.displaySettings`(SCR-020)、チャート設定→
/// `.chartSettings`(SCR-021)、ヘルプ・お問い合わせ→`.help`(SCR-022)、
/// 利用規約→`.terms`(SCR-023)、プライバシーポリシー→`.privacyPolicy`
/// (SCR-024)、アプリ情報→`.appInfo`(SCR-025)。チャート設定・アプリ情報は
/// 2-c時点では対応する可視UIがなく未接続だったが、この画像でUIが示された
/// ため今回接続した。
///
/// 参考画像にはSCR-026(アカウント削除)の行が存在しない — 削除機能は
/// SCR-017(アカウント情報)側に配置される可能性がある。独断で追加せず、
/// 未接続のまま報告する。
///
/// 旧デザインの「データ取得設定」行(新画面仕様にSCR番号なし)は参考画像
/// に存在しないため削除した。旧デザインで"準備中"アラートを使っていた
/// 行は全て実際の遷移に置き換わったため、`pendingFeatureMessage`/`.alert`
/// はこの画面ではもう使われておらず削除した(未使用コードを残さない)。
///
/// HQ指示(2026-09-30、SCR-016最終調整): ログアウト行のアイコンを、参考
/// 画像通りの"trash"(ゴミ箱、アカウント削除と誤認されうる)から
/// "rectangle.portrait.and.arrow.right"(ログアウトを表す標準的な
/// アイコン、旧デザインで使われていたものと同じ)に変更。右端のシェブロン
/// はもともと付けていない(ナビゲーションではなくダイアログを開くボタン
/// のため)。行全体がタップ対象・確認ダイアログ確定時のみサインアウトする
/// 挙動は2-bから変更なし。
struct SettingsView: View {
    @StateObject private var viewModel: SettingsViewModel
    private let apiClient: APIClient
    private let authService: AuthServicing
    private let onSignOut: () -> Void
    /// SCR-027 ログアウト確認ダイアログ(2026-09-29 HQ承認、2-b)。
    @State private var showLogoutConfirmation = false
    @Binding var tabSelection: Int

    /// 参考画像から実測した1行あたりの高さ(V5座標系、234×491)。
    private static let rowHeight: CGFloat = 31.5
    private static let cardWidth: CGFloat = 204

    init(apiClient: APIClient, authService: AuthServicing, onSignOut: @escaping () -> Void, tabSelection: Binding<Int>) {
        self.apiClient = apiClient
        self.authService = authService
        self.onSignOut = onSignOut
        _viewModel = StateObject(wrappedValue: SettingsViewModel(authService: authService, onSignOut: onSignOut))
        _tabSelection = tabSelection
    }

    /// グループ1(アカウント情報〜チャート設定)のカード上端y。
    private let group1Top: CGFloat = 78
    /// グループ2(ヘルプ・お問い合わせ〜アプリ情報)のカード上端y。
    private let group2Top: CGFloat = 245
    /// ログアウトカードの上端y。
    private let logoutTop: CGFloat = 381.5

    var body: some View {
        NavigationStack {
            V5Viewport {
                V5TopStatus()
                V5Header(title: "設定", back: false)

                groupBackground(topY: group1Top, rowCount: 5)
                NavigationLink(value: AppRoute.account) {
                    rowLabel("person", "アカウント情報")
                }.buttonStyle(.plain).position(x: 117, y: rowY(topY: group1Top, index: 0))
                NavigationLink(value: SettingsSubRoute.notificationSettings) {
                    rowLabel("bell", "通知設定")
                }.buttonStyle(.plain).position(x: 117, y: rowY(topY: group1Top, index: 1))
                NavigationLink(value: SettingsSubRoute.subscriptionManagement) {
                    rowLabel("globe", "プラン・購読管理")
                }.buttonStyle(.plain).position(x: 117, y: rowY(topY: group1Top, index: 2))
                NavigationLink(value: SettingsSubRoute.displaySettings) {
                    rowLabel("gearshape", "表示・地域設定")
                }.buttonStyle(.plain).position(x: 117, y: rowY(topY: group1Top, index: 3))
                NavigationLink(value: SettingsSubRoute.chartSettings) {
                    rowLabel("chart.xyaxis.line", "チャート設定")
                }.buttonStyle(.plain).position(x: 117, y: rowY(topY: group1Top, index: 4))

                groupBackground(topY: group2Top, rowCount: 4)
                NavigationLink(value: SettingsSubRoute.help) {
                    rowLabel("questionmark.circle", "ヘルプ・お問い合わせ")
                }.buttonStyle(.plain).position(x: 117, y: rowY(topY: group2Top, index: 0))
                NavigationLink(value: SettingsSubRoute.terms) {
                    rowLabel("building.columns", "利用規約")
                }.buttonStyle(.plain).position(x: 117, y: rowY(topY: group2Top, index: 1))
                NavigationLink(value: SettingsSubRoute.privacyPolicy) {
                    rowLabel("doc.plaintext", "プライバシーポリシー")
                }.buttonStyle(.plain).position(x: 117, y: rowY(topY: group2Top, index: 2))
                NavigationLink(value: SettingsSubRoute.appInfo) {
                    rowLabel("info.circle", "アプリ情報")
                }.buttonStyle(.plain).position(x: 117, y: rowY(topY: group2Top, index: 3))

                logoutButton

                V5BottomBar(selected: $tabSelection)
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: AppRoute.self) { route in
                if route == .account {
                    AccountView(apiClient: apiClient, authService: authService, onSignOut: onSignOut, tabSelection: $tabSelection)
                } else {
                    AppRouteDestinationView(route: route, apiClient: apiClient, tabSelection: $tabSelection)
                }
            }
            .navigationDestination(for: SettingsSubRoute.self) { route in
                SettingsSubRouteDestinationView(route: route)
            }
        }
        // 2026-09-29 HQ承認(2-b): SCR-027 ログアウト確認ダイアログ。独立した
        // フルスクリーン画面ではなくダイアログとする(ui-screens.md v2.0 §4.2)。
        .confirmationDialog(
            "ログアウトしますか？",
            isPresented: $showLogoutConfirmation,
            titleVisibility: .visible
        ) {
            Button("ログアウト", role: .destructive) { viewModel.signOut() }
            Button("キャンセル", role: .cancel) {}
        }
    }

    /// 行グループの背景(角丸カード)と、行と行の間の区切り線。個々の行
    /// 自体は背景を持たず、この上に重ねて描画する(参考画像の「1つの
    /// カードの中に複数行、行間は細い区切り線のみ」という見た目のため)。
    @ViewBuilder private func groupBackground(topY: CGFloat, rowCount: Int) -> some View {
        let height = CGFloat(rowCount) * Self.rowHeight
        RoundedRectangle(cornerRadius: 8)
            .fill(LinearGradient(colors: [V5P.panel2, V5P.panel], startPoint: .topLeading, endPoint: .bottomTrailing))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(V5P.line.opacity(0.75), lineWidth: 0.65))
            .frame(width: Self.cardWidth, height: height)
            .position(x: 117, y: topY + height / 2)
        ForEach(1..<rowCount, id: \.self) { i in
            Rectangle()
                .fill(V5P.line.opacity(0.4))
                .frame(width: Self.cardWidth - 14, height: 0.6)
                .position(x: 117, y: topY + CGFloat(i) * Self.rowHeight)
        }
    }

    private func rowY(topY: CGFloat, index: Int) -> CGFloat {
        topY + (CGFloat(index) + 0.5) * Self.rowHeight
    }

    private func rowLabel(_ icon: String, _ title: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 10)).frame(width: 14)
            Text(title).font(.system(size: 8, weight: .medium))
            Spacer()
            Image(systemName: "chevron.right").font(.system(size: 7))
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 9)
        .frame(width: Self.cardWidth, height: Self.rowHeight)
    }

    private var logoutButton: some View {
        Button {
            showLogoutConfirmation = true
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "rectangle.portrait.and.arrow.right").font(.system(size: 10))
                if viewModel.state == .signingOut {
                    ProgressView().tint(V5P.red)
                } else {
                    Text("ログアウト").font(.system(size: 8, weight: .semibold))
                }
                Spacer()
            }
            .foregroundStyle(V5P.red)
            .padding(.horizontal, 9)
            .frame(width: Self.cardWidth, height: 34)
            .background(V5P.red.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(V5P.red.opacity(0.6), lineWidth: 0.65))
        }
        .buttonStyle(.plain)
        .disabled(viewModel.state == .signingOut)
        .overlay(alignment: .bottom) {
            if case .error(let message) = viewModel.state {
                Text(message).font(.system(size: 6)).foregroundStyle(V5P.red)
                    .multilineTextAlignment(.center).frame(width: Self.cardWidth).offset(y: 14)
            }
        }
        .position(x: 117, y: logoutTop + 17)
    }
}
