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
/// 全体の外枠(`V5Viewport`/`V5Header`/`V5BottomBar`)は
/// 他の全タブ画面と共有しているため変更していない(タブ切り替え時に文字
/// サイズが急に変わるような見た目の不整合を避けるため)。変更したのは
/// リスト部分のみで、参考画像から実測した座標をV5座標系に変換して配置
/// している(測定方法: 画像のピクセル明度を行・列方向にスキャンし、行の
/// 中心・区切り線・カード境界を検出)。
///
/// HQ指示(2026-10-02「画像を完璧に再現して」、リスト部分の切り抜き画像
/// を再共有): 以前は縦方向を画面高さの比率で変換していたため、参考画像
/// (縦横比1.90)より縦長のV5キャンバス(2.10)では行が約12%縦に伸びていた。
/// カード幅(参考画像477px→V5の204)を基準に縦横同じ倍率で変換し直し、
/// 行高・文字/アイコンの大きさ・余白・色(カード#001A36、区切り線は
/// カード全幅)を実測値に合わせた。カード上端はタイトル中心からの実測
/// 距離(19.5)で決めているため、ログアウトカードの下には参考画像より
/// 広い余白が残る(キャンバスの縦横比の違いによるもの)。
///
/// HQ指示(2026-10-02、実機スクリーンショット確認後): 文字・アイコン・
/// シェブロン(特にシェブロン)を大きく、カードの塗りは参考画像の実測
/// RGB(31-36, 46-52, 69-77)の中央値#213149に全カード統一。上記の
/// 「カード#001A36」は置き換え済み。
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
    private static let rowHeight: CGFloat = 28.2
    private static let cardWidth: CGFloat = 204

    init(apiClient: APIClient, authService: AuthServicing, onSignOut: @escaping () -> Void, tabSelection: Binding<Int>) {
        self.apiClient = apiClient
        self.authService = authService
        self.onSignOut = onSignOut
        _viewModel = StateObject(wrappedValue: SettingsViewModel(authService: authService, onSignOut: onSignOut))
        _tabSelection = tabSelection
    }

    /// グループ1(アカウント情報〜チャート設定)のカード上端y。
    private let group1Top: CGFloat = 59.5
    /// グループ2(ヘルプ・お問い合わせ〜アプリ情報)のカード上端y。
    private let group2Top: CGFloat = 211.1
    /// ログアウトカードの上端y。
    private let logoutTop: CGFloat = 333.5

    var body: some View {
        NavigationStack {
            V5Viewport {
                V5Header(title: "設定", back: false)

                groupBackground(topY: group1Top, rowCount: 5)
                NavigationLink(value: AppRoute.account) {
                    rowLabel("person", "アカウント情報")
                }.buttonStyle(.plain).position(x: 117, y: rowY(topY: group1Top, index: 0))
                NavigationLink(value: SettingsSubRoute.notificationSettings) {
                    rowLabel("bell.fill", "通知設定")
                }.buttonStyle(.plain).position(x: 117, y: rowY(topY: group1Top, index: 1))
                NavigationLink(value: SettingsSubRoute.subscriptionManagement) {
                    rowLabel("globe.asia.australia.fill", "プラン・購読管理")
                }.buttonStyle(.plain).position(x: 117, y: rowY(topY: group1Top, index: 2))
                NavigationLink(value: SettingsSubRoute.displaySettings) {
                    rowLabel("camera.aperture", "表示・地域設定")
                }.buttonStyle(.plain).position(x: 117, y: rowY(topY: group1Top, index: 3))
                NavigationLink(value: SettingsSubRoute.chartSettings) {
                    rowLabel("chart.xyaxis.line", "チャート設定")
                }.buttonStyle(.plain).position(x: 117, y: rowY(topY: group1Top, index: 4))

                groupBackground(topY: group2Top, rowCount: 4)
                NavigationLink(value: SettingsSubRoute.help) {
                    rowLabel("questionmark.circle", "ヘルプ・お問い合わせ")
                }.buttonStyle(.plain).position(x: 117, y: rowY(topY: group2Top, index: 0))
                NavigationLink(value: SettingsSubRoute.terms) {
                    rowLabel("list.bullet.rectangle.portrait", "利用規約")
                }.buttonStyle(.plain).position(x: 117, y: rowY(topY: group2Top, index: 1))
                NavigationLink(value: SettingsSubRoute.privacyPolicy) {
                    rowLabel("doc.richtext", "プライバシーポリシー")
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
                SettingsSubRouteDestinationView(route: route, apiClient: apiClient, tabSelection: $tabSelection)
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

    /// 参考画像から実測したカード・行の見た目(V5座標系)。
    private static let cornerRadius: CGFloat = 6.5
    private static let cardFill = Color(red: 33 / 255, green: 49 / 255, blue: 73 / 255) // #213149
    private static let logoutHeight: CGFloat = 31.5
    private static let titleSize: CGFloat = 10.5
    private static let iconSize: CGFloat = 13.5
    private static let iconWidth: CGFloat = 18
    /// アイコン列の右端から文字の左端まで(カード左端から文字まで39.3の実測値を保つ)。
    private static let iconTitleGap: CGFloat = 13.3
    private static let iconColor = Color(red: 0.80, green: 0.89, blue: 1.0)
    private static let chevronColor = Color(red: 0.62, green: 0.76, blue: 0.93)

    /// 行グループ・ログアウトで共通のカード(塗り＋青い縁取り)。
    private func card(height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: Self.cornerRadius)
            .fill(Self.cardFill)
            .overlay(
                RoundedRectangle(cornerRadius: Self.cornerRadius)
                    .stroke(V5P.line.opacity(0.6), lineWidth: 0.65)
                    .shadow(color: V5P.blue.opacity(0.35), radius: 1.5)
            )
            .frame(width: Self.cardWidth, height: height)
    }

    /// 行グループの背景(角丸カード)と、行と行の間の区切り線。個々の行
    /// 自体は背景を持たず、この上に重ねて描画する(参考画像の「1つの
    /// カードの中に複数行、行間は細い区切り線のみ」という見た目のため)。
    /// 区切り線は参考画像の実測どおりカードの全幅。
    @ViewBuilder private func groupBackground(topY: CGFloat, rowCount: Int) -> some View {
        let height = CGFloat(rowCount) * Self.rowHeight
        card(height: height)
            .position(x: 117, y: topY + height / 2)
        ForEach(1..<rowCount, id: \.self) { i in
            Rectangle()
                .fill(V5P.line.opacity(0.35))
                .frame(width: Self.cardWidth, height: 0.6)
                .position(x: 117, y: topY + CGFloat(i) * Self.rowHeight)
        }
    }

    private func rowY(topY: CGFloat, index: Int) -> CGFloat {
        topY + (CGFloat(index) + 0.5) * Self.rowHeight
    }

    private func rowIcon(_ icon: String, glow: Color = V5P.blue) -> some View {
        Image(systemName: icon)
            .font(.system(size: Self.iconSize))
            .frame(width: Self.iconWidth)
            .shadow(color: glow.opacity(0.6), radius: 1.5)
    }

    private func rowLabel(_ icon: String, _ title: String) -> some View {
        HStack(spacing: Self.iconTitleGap) {
            rowIcon(icon).foregroundStyle(Self.iconColor)
            Text(title).font(.system(size: Self.titleSize, weight: .medium)).foregroundStyle(.white)
            Spacer()
            Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(Self.chevronColor)
        }
        .padding(.leading, 8)
        .padding(.trailing, 10)
        .frame(width: Self.cardWidth, height: Self.rowHeight)
        // 行は背景を持たないため、これがないと`.plain`スタイルでは
        // アイコン・文字・シェブロン以外(行の中央の空白)がタップに反応しない。
        .contentShape(Rectangle())
    }

    /// 参考画像どおり、カードは行グループと同じ青い縁取りで、赤いのは
    /// アイコンと文字だけ(以前は赤い縁取り・赤みの背景だった)。
    private var logoutButton: some View {
        Button {
            showLogoutConfirmation = true
        } label: {
            HStack(spacing: Self.iconTitleGap) {
                rowIcon("rectangle.portrait.and.arrow.right", glow: V5P.red)
                if viewModel.state == .signingOut {
                    ProgressView().tint(V5P.red)
                } else {
                    Text("ログアウト").font(.system(size: Self.titleSize, weight: .semibold))
                }
                Spacer()
            }
            .foregroundStyle(V5P.red)
            .padding(.leading, 8)
            .frame(width: Self.cardWidth, height: Self.logoutHeight)
            .background(card(height: Self.logoutHeight))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(viewModel.state == .signingOut)
        .overlay(alignment: .bottom) {
            if case .error(let message) = viewModel.state {
                Text(message).font(.system(size: 6)).foregroundStyle(V5P.red)
                    .multilineTextAlignment(.center).frame(width: Self.cardWidth).offset(y: 14)
            }
        }
        .position(x: 117, y: logoutTop + Self.logoutHeight / 2)
    }
}
