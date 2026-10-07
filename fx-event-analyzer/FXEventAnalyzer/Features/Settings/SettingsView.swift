import SwiftUI

/// SCR-014 設定画面。
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
/// シェブロン(特にシェブロン)を大きくした。カードの塗りは一度
/// RGB(31-36, 46-52, 69-77)の中央値#213149にしたが、「参考画像と色が
/// 違う」との再指摘を受け、参考画像のカード内部を100点実測した最頻値
/// #061A35(≈RGB 6,26,53)に全カード統一。上記の「カード#001A36」は
/// 置き換え済み。
///
/// HQ指示(2026-10-02)「タイトルの文字開始位置とカード左の枠線の縦ライン
/// をそろえて」: CI実機キャプチャで全画面のカード左端を実測すると、
/// ホーム〜指標詳細(02-08)は他画面共通の`V5Card`(x=10・幅214)で
/// `V5Header`の左余白(ptToV5(16)≈9.3)とすでに揃っており、ずれていたのは
/// 幅204のカードを使う設定系(この画面・SCR-015/016/018/019)だけだった。
/// 共通ヘッダーは変えず、設定系のカード幅を214に揃えている。
///
/// その後デスクトップ側で`V5Header`が更新され(2026-10-03〜05、タイトル
/// 44pt・中心y=34.9、戻るボタン無しの画面はタイトル先頭に8ptの余白)、
/// この画面のタイトル開始位置はptToV5(16+8)≈14.0になった。カード左端を
/// そこへ合わせるため、この画面のカード幅はその位置から逆算している
/// (戻るボタン付きのサブ画面はシェブロン位置ptToV5(16)に合う214のまま)。
///
/// 参考画像との既知の差分(意図的な妥協、完全な一致ではない箇所):
/// - タイトル「設定」の位置は全画面共通の`V5Header`のまま動かしていない
///   (他タブとのヘッダー位置統一を優先)。
/// - 各アイコンはSF Symbolsの中から最も近い形状のものを選んでいる(参考
///   画像のアイコンはSF Symbols標準セットそのものではないため、Loginの
///   パスワード欄アイコンと同じ「最も近い形状を採用する」慣例に従った)。
///
/// 行とAppRoute/SettingsSubRouteの対応(2026-09-29 HQ承認 2-b/2-cで
/// 追加済みのルートをそのまま使用。HQ指示2026-10-03の画面構成全面更新で
/// SCR番号のみ更新 — 新しいルートは追加していない):
/// アカウント情報→`.account`(SCR-015)、通知設定→`.notificationSettings`
/// (SCR-016)、プラン・購読管理→`.subscriptionManagement`(SCR-017)、
/// 表示・地域設定→`.displaySettings`(SCR-018)、チャート設定→
/// `.chartSettings`(SCR-019)、ヘルプ・お問い合わせ→`.help`(SCR-020)、
/// 利用規約→`.terms`(SCR-021)、プライバシーポリシー→`.privacyPolicy`
/// (SCR-022)、アプリ情報→`.appInfo`(SCR-023)。チャート設定・アプリ情報は
/// 2-c時点では対応する可視UIがなく未接続だったが、この画像でUIが示された
/// ため今回接続した。
///
/// 参考画像にはSCR-024(アカウント削除)の行が存在しない — 削除機能は
/// SCR-015(アカウント情報)側に配置される可能性がある。独断で追加せず、
/// 未接続のまま報告する。
///
/// HQ指示(2026-10-05、参考画像v2
/// `docs/projects/fx-event-analyzer/mockups/settings-screen-reference-v2.png`
/// 「この画像のように設定の中身を変えて」): 1つ目のカードの末尾に
/// SCR-026 ホーム通貨ペア編集(`.homeCurrencyPairEditor`、遷移先は既存の
/// 仮画面)を追加した。画像でこの行を囲むシアンの枠は選択時の表現と判断し、
/// HQ確認のうえ全行共通の「押している間だけ光る」演出にしている
/// (`SettingsRowPressStyle`)。アイコンは青い丸の中の白いアイコンに変更し、
/// 色・余白は画像v2の実測値に合わせた。画像v2にはログアウトが写って
/// いないため、指示どおりアプリ情報のカードの下に赤い文字で置き(枠は他の
/// カードと同じ青)、全行の高さを詰めてタブバーの上に収めている。上記の旧参考画像に基づく行高・色・アイコンの記述は、
/// この変更で置き換え済み。
///
/// 旧デザインの「データ取得設定」行(新画面仕様にSCR番号なし)は参考画像
/// に存在しないため削除した。旧デザインで"準備中"アラートを使っていた
/// 行は全て実際の遷移に置き換わったため、`pendingFeatureMessage`/`.alert`
/// はこの画面ではもう使われておらず削除した(未使用コードを残さない)。
///
/// HQ指示(2026-09-30、旧SCR-016=現SCR-014最終調整): ログアウト行のアイコンを、参考
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
    /// SCR-025 ログアウト確認ダイアログ(2026-09-29 HQ承認、2-b)。
    @State private var showLogoutConfirmation = false
    @Binding var tabSelection: Int

    /// 1行あたりの高さ(V5座標系、234×491)。参考画像v2の実測は約36.8だが、
    /// 画像に無いログアウト行をタブバーの上に収めるため34に詰めている。
    /// HQ指示(2026-10-06)「各項目の縦幅の間隔を少し狭めて」で34→31。
    /// ScreenshotTestsの行の座標も同じ値を使う。
    private static let rowHeight: CGFloat = 31
    /// タイトル枠の先頭ptToV5(16+8)に、CI実機キャプチャで実測した「設定」の
    /// 字形の左余白(5px@3x≈1.7pt)を足した位置にカード左端を合わせる。
    private static let cardWidth: CGFloat = V5P.W - 2 * V5P.ptToV5(16 + 8 + 1.7)

    init(apiClient: APIClient, authService: AuthServicing, onSignOut: @escaping () -> Void, tabSelection: Binding<Int>) {
        self.apiClient = apiClient
        self.authService = authService
        self.onSignOut = onSignOut
        _viewModel = StateObject(wrappedValue: SettingsViewModel(authService: authService, onSignOut: onSignOut))
        _tabSelection = tabSelection
    }

    /// グループ1(アカウント情報〜ホーム通貨ペア編集)のカード上端y。
    /// 参考画像v2のタイトル中心→カード上端の実測距離(≈19.8)を
    /// `V5Header`のタイトル中心y=34.9に足した位置。
    private static let group1Top: CGFloat = 54.5
    /// カード間の余白(参考画像v2の実測≈9.5を行高と同じ割合で詰めた値)。
    private static let groupGap: CGFloat = 8
    /// グループ2(ヘルプ・お問い合わせ〜アプリ情報)のカード上端y。
    private static let group2Top: CGFloat = group1Top + 6 * rowHeight + groupGap
    /// ログアウトカードの上端y。
    private static let logoutTop: CGFloat = group2Top + 4 * rowHeight + groupGap

    var body: some View {
        NavigationStack {
            V5Viewport {
                V5Header(title: "設定", back: false)

                let g1 = Self.group1Top
                groupBackground(topY: g1, rowCount: 6)
                NavigationLink(value: AppRoute.account) {
                    rowLabel("person.fill", "アカウント情報", nudge: CGSize(width: 0, height: -0.75))
                }.buttonStyle(SettingsRowPressStyle()).position(x: 117, y: rowY(topY: g1, index: 0))
                NavigationLink(value: SettingsSubRoute.notificationSettings) {
                    rowLabel("bell.fill", "通知設定")
                }.buttonStyle(SettingsRowPressStyle()).position(x: 117, y: rowY(topY: g1, index: 1))
                NavigationLink(value: SettingsSubRoute.subscriptionManagement) {
                    rowLabel("crown.fill", "プラン・購読管理", nudge: CGSize(width: 0, height: -0.5))
                }.buttonStyle(SettingsRowPressStyle()).position(x: 117, y: rowY(topY: g1, index: 2))
                NavigationLink(value: SettingsSubRoute.displaySettings) {
                    rowLabel("globe", "表示・地域設定")
                }.buttonStyle(SettingsRowPressStyle()).position(x: 117, y: rowY(topY: g1, index: 3))
                NavigationLink(value: SettingsSubRoute.chartSettings) {
                    rowLabel("chart.bar.fill", "チャート設定", nudge: CGSize(width: 0, height: -0.4))
                }.buttonStyle(SettingsRowPressStyle()).position(x: 117, y: rowY(topY: g1, index: 4))
                NavigationLink(value: AppRoute.homeCurrencyPairEditor) {
                    rowLabel("arrow.left.arrow.right", "ホーム通貨ペア編集")
                }.buttonStyle(SettingsRowPressStyle()).position(x: 117, y: rowY(topY: g1, index: 5))

                let g2 = Self.group2Top
                groupBackground(topY: g2, rowCount: 4)
                NavigationLink(value: SettingsSubRoute.help) {
                    rowLabel("questionmark.circle.fill", "ヘルプ・お問い合わせ")
                }.buttonStyle(SettingsRowPressStyle()).position(x: 117, y: rowY(topY: g2, index: 0))
                NavigationLink(value: SettingsSubRoute.terms) {
                    rowLabel("doc.text.fill", "利用規約", nudge: CGSize(width: 0.5, height: -0.35))
                }.buttonStyle(SettingsRowPressStyle()).position(x: 117, y: rowY(topY: g2, index: 1))
                NavigationLink(value: SettingsSubRoute.privacyPolicy) {
                    rowLabel("checkmark.shield.fill", "プライバシーポリシー", nudge: CGSize(width: 0, height: 0.25))
                }.buttonStyle(SettingsRowPressStyle()).position(x: 117, y: rowY(topY: g2, index: 2))
                NavigationLink(value: SettingsSubRoute.appInfo) {
                    rowLabel("info.circle.fill", "アプリ情報")
                }.buttonStyle(SettingsRowPressStyle()).position(x: 117, y: rowY(topY: g2, index: 3))

                logoutButton

                V5BottomBar(selected: $tabSelection)

                if showLogoutConfirmation {
                    LogoutConfirmationDialog(
                        onLogout: {
                            showLogoutConfirmation = false
                            viewModel.signOut()
                        },
                        onCancel: { showLogoutConfirmation = false }
                    )
                    .transition(.opacity)
                }
            }
            .animation(.easeInOut(duration: 0.15), value: showLogoutConfirmation)
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
        // 2026-09-29 HQ承認(2-b): SCR-025 ログアウト確認ダイアログ。独立した
        // フルスクリーン画面ではなくダイアログとする(ui-screens.md v2.0 §4.2)。
    }

    /// 参考画像v2から実測したカード・行の見た目(V5座標系)。横方向の位置は
    /// 参考画像のカード幅(385px)に対する比率で、このカード幅に換算している。
    /// カード・区切り線・シェブロンの色はSCR-015と共有(`SettingsCardStyle`)。
    private static let cardFill = SettingsCardStyle.cardFill
    private static let separator = SettingsCardStyle.separator
    /// プラン・購読管理の行(「プランを変更」など)と同じ大きさ(HQ指示 2026-10-06)。
    private static let titleSize: CGFloat = 9.5
    /// アイコンを囲む丸(参考画像の直径44px)と、その中の白いアイコン。
    private static let badgeSize: CGFloat = 22
    private static let badgeFill = Color(red: 22 / 255, green: 81 / 255, blue: 129 / 255) // #165181
    private static let badgeBorder = Color(red: 44 / 255, green: 108 / 255, blue: 168 / 255)
    /// アイコンを収める正方形の一辺。SF Symbolsは字形ごとに縦横の大きさが
    /// 違う(同じフォントサイズでも王冠・棒グラフは人型より約1.5倍横に広い)
    /// ため、HQ指示(2026-10-05)「各アイコンのサイズが異なっている」により、
    /// フォントサイズではなくこの枠に収まる大きさへ揃えている。
    private static let iconBox: CGFloat = 11
    private static let iconColor = Color(red: 233 / 255, green: 240 / 255, blue: 255 / 255) // #E9F0FF
    /// カード左端→丸の左端(参考画像26px)、丸の右端→文字(参考画像19px)。
    private static let badgeLeading: CGFloat = 8.6
    private static let badgeTitleGap: CGFloat = 10.7
    private static let chevronColor = SettingsCardStyle.chevronColor

    /// 行グループ・ログアウトで共通のカード(塗り＋縁取り)。
    private func card(height: CGFloat) -> some View {
        SettingsCardStyle.card(width: Self.cardWidth, height: height)
    }

    /// 行グループの背景(角丸カード)と、行と行の間の区切り線。個々の行
    /// 自体は背景を持たず、この上に重ねて描画する。区切り線はカードの全幅。
    @ViewBuilder private func groupBackground(topY: CGFloat, rowCount: Int) -> some View {
        let height = CGFloat(rowCount) * Self.rowHeight
        card(height: height)
            .position(x: 117, y: topY + height / 2)
        ForEach(1..<rowCount, id: \.self) { i in
            Rectangle()
                .fill(Self.separator)
                .frame(width: Self.cardWidth, height: 0.6)
                .position(x: 117, y: topY + CGFloat(i) * Self.rowHeight)
        }
    }

    private func rowY(topY: CGFloat, index: Int) -> CGFloat {
        topY + (CGFloat(index) + 0.5) * Self.rowHeight
    }

    /// 参考画像どおりの、青い丸の中に白いアイコン。ログアウトだけは紺の丸に赤。
    ///
    /// HQ指示(2026-10-05)「アイコンが中心になっていない項目がある」: CI実機
    /// キャプチャで測ると字形の外接矩形は丸の中心から0.4pt以内に収まって
    /// いたが、人型・王冠・棒グラフは下側、書類は左側に重さが偏っていて
    /// 視覚的にずれて見える。`nudge`で、実測した字形の重心のずれの約6割を
    /// 打ち消す方向へ動かしている(外接矩形の中心と重心の中間＝目で見た中心)。
    ///
    /// 同日「ログアウトのアイコンがぼやけている」(2回): 赤みを帯びた半透明の
    /// 塗り・赤い輪の上に赤い線を描いていたため輪郭のコントラストが低かった。
    /// 塗りをカードと同じ紺、輪を他の行と同じ青にし、線を太字にしている
    /// (赤は一度明るくしたが、HQ指示で元の`V5P.red`に戻した)。
    private func rowBadge(_ icon: String, tint: Color? = nil, nudge: CGSize = .zero) -> some View {
        ZStack {
            Circle()
                .fill(tint == nil ? Self.badgeFill : Self.cardFill)
                .overlay(Circle().stroke(Self.badgeBorder, lineWidth: 0.5))
            Image(systemName: icon)
                .resizable()
                .scaledToFit()
                .fontWeight(tint == nil ? .semibold : .bold)
                .frame(width: Self.iconBox, height: Self.iconBox)
                .foregroundStyle(tint ?? Self.iconColor)
                .offset(nudge)
        }
        .frame(width: Self.badgeSize, height: Self.badgeSize)
    }

    private func rowLabel(_ icon: String, _ title: String, nudge: CGSize = .zero) -> some View {
        HStack(spacing: Self.badgeTitleGap) {
            rowBadge(icon, nudge: nudge)
            // HQ指示(2026-10-05)「フォントが日本語っぽくない(編・約など)」:
            // システムフォントのままだとシミュレーター(英語環境)では漢字が
            // 中国語字形で描かれていた。英字も含めてNoto Sans JPで組む(`NotoText`、
            // HQ指示 2026-10-06「フォントの違いが目立つ」)。
            NotoText.text(title, size: Self.titleSize).foregroundStyle(.white)
            Spacer()
            // 「＞」は項目名と同じ大きさ(HQ指示 2026-10-06)。
            Image(systemName: "chevron.right").font(.system(size: Self.titleSize, weight: .semibold)).foregroundStyle(Self.chevronColor)
        }
        .padding(.leading, Self.badgeLeading)
        .padding(.trailing, 10)
        .frame(width: Self.cardWidth, height: Self.rowHeight)
        // 行は(押している間以外)背景を持たないため、これがないと`.plain`スタイルでは
        // アイコン・文字・シェブロン以外(行の中央の空白)がタップに反応しない。
        .contentShape(Rectangle())
    }

    /// 参考画像v2にログアウトは写っていないため、HQ指示どおりアプリ情報の
    /// カードの下に置いている。HQ指示(2026-10-05)「赤枠で囲まなくていい、
    /// 上と同じ枠でいい」により、カードの枠は他のグループと同じ青で、
    /// 赤いのは文字とアイコンだけ。
    private var logoutButton: some View {
        Button {
            showLogoutConfirmation = true
        } label: {
            HStack(spacing: Self.badgeTitleGap) {
                // 扉(左)側に字形の重さが寄って左にずれて見えるため、右へ寄せる。
                rowBadge("rectangle.portrait.and.arrow.right", tint: AccountPalette.destructive, nudge: CGSize(width: 0.7, height: 0))
                if viewModel.state == .signingOut {
                    ProgressView().tint(AccountPalette.destructive)
                } else {
                    NotoText.text("ログアウト", size: Self.titleSize)
                }
                Spacer()
            }
            // プラン・購読管理の「購読を解約」と同じ赤(HQ指示 2026-10-06)。
            .foregroundStyle(AccountPalette.destructive)
            .padding(.leading, Self.badgeLeading)
            .frame(width: Self.cardWidth, height: Self.rowHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(SettingsRowPressStyle())
        // カードはボタンの外側に置く(内側だと、押している間の光る背景が
        // カードの塗りの下に隠れる)。
        .background(card(height: Self.rowHeight))
        .disabled(viewModel.state == .signingOut)
        .overlay(alignment: .bottom) {
            if case .error(let message) = viewModel.state {
                NotoText.text(message, size: 6).foregroundStyle(V5P.red)
                    .multilineTextAlignment(.center).frame(width: Self.cardWidth).offset(y: 9)
            }
        }
        .position(x: 117, y: Self.logoutTop + Self.rowHeight / 2)
    }
}
