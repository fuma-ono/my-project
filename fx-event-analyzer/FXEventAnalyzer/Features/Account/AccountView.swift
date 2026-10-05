import SwiftUI

/// SCR-015 アカウント情報のサブ画面。SCR-014のNavigationStackの上に積む。
/// アカウント削除(SCR-024)もここから開く — 削除にはサインアウト処理
/// (`AuthServicing`/`onSignOut`)が必要で、それを持っているのがこの画面のため
/// (`SettingsSubRoute.accountDeletion`の仮画面経路は使わない)。
enum AccountSubRoute: Hashable {
    case profileEdit        // プロフィール編集(名前・生年月日)
    case emailChange        // メールアドレス変更
    case passwordChange     // パスワード変更
    case accountDeletion    // SCR-024 アカウント削除
}

/// SCR-015 アカウント情報、SCR-014 設定から遷移。
///
/// HQ指示(2026-10-05): 参考画像
/// `docs/projects/fx-event-analyzer/mockups/account-screen-reference-v1.png`
/// (233×340、ヘッダー・タブバーを含まないリスト部分の切り抜き)を再現した。
/// 座標は参考画像のカード幅(210px)をV5の214に合わせた倍率(×1.019)で
/// 換算し、カード上端はSCR-014と同じタイトル中心からの距離(54.5)に揃えて
/// いる。カード・区切り線・押下時の光り方はSCR-014と同じ
/// (`SettingsCardStyle`/`SettingsRowPressStyle`)。
///
/// 表示する値はすべて実データ(架空の値は出さない):
/// - 名前・生年月日: `GET /account`の`display_name`/`birth_date`。未登録なら
///   「未設定」。
/// - メールアドレス: Supabase Authのセッション(`UserSession.email`)。
///   メール/パスワードはSupabase Auth管理で`GET /account`には無いため
///   (api-design.md §24.2)。
/// - 国・地域: `GET /settings`の`display.region`(SCR-018と同じ値)。行の
///   タップ先もSCR-018 表示・地域設定。
///
/// 参考画像との意図的な差分: アバターは写真のアップロード機能が無いため、
/// 画像と同じ人型のシルエットを常に表示している。
struct AccountView: View {
    @StateObject private var viewModel: AccountViewModel
    private let apiClient: APIClient
    private let authService: AuthServicing?
    private let onSignOut: () -> Void
    @Binding var tabSelection: Int
    @Environment(\.dismiss) private var dismiss

    init(apiClient: APIClient, authService: AuthServicing? = nil, onSignOut: @escaping () -> Void = {}, tabSelection: Binding<Int>) {
        _viewModel = StateObject(wrappedValue: AccountViewModel(apiClient: apiClient, authService: authService))
        self.apiClient = apiClient
        self.authService = authService
        self.onSignOut = onSignOut
        _tabSelection = tabSelection
    }

    /// 参考画像から換算したレイアウト(V5座標系)。
    private static let cardWidth: CGFloat = 214
    private static let profileTop: CGFloat = 54.5
    private static let profileHeight: CGFloat = 56
    private static let group1Top: CGFloat = 120.7
    /// プロフィール編集 / メールアドレス / パスワード変更
    private static let group1Rows: [CGFloat] = [30.6, 41.3, 32.6]
    private static let group2Top: CGFloat = 236.7
    /// 生年月日 / 国・地域
    private static let group2Rows: [CGFloat] = [47.1, 48.4]
    private static let deleteTop: CGFloat = 342.9
    private static let deleteHeight: CGFloat = 33.9
    /// カード左端→行の文字(参考画像11.75px)、シェブロンの右余白。
    private static let textLeading: CGFloat = 12
    private static let chevronTrailing: CGFloat = 11
    private static let titleSize: CGFloat = 9.5
    private static let subtitleSize: CGFloat = 7.5

    var body: some View {
        content
            .toolbar(.hidden, for: .navigationBar)
            .task { viewModel.load() }
            .onAppear { viewModel.refresh() }
            .navigationDestination(for: AccountSubRoute.self) { route in
                destination(route)
            }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .loading:
            loadingScaffold { LoadingView(caption: "読み込み中...") }
        case .backendNotConfigured:
            loadingScaffold { FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "アカウント情報はまだ利用できません。") }
        case .error(let message):
            loadingScaffold { ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() }) }
        case .loaded(let info):
            V5Viewport {
                V5Header(title: "アカウント情報", back: true, onBack: { dismiss() })
                profileCard(info)
                group1(info)
                group2(info)
                deleteRow
                V5BottomBar(selected: $tabSelection)
            }
        }
    }

    @ViewBuilder
    private func destination(_ route: AccountSubRoute) -> some View {
        switch route {
        case .profileEdit:
            if case .loaded(let info) = viewModel.state {
                ProfileEditView(apiClient: apiClient, account: info.account, tabSelection: $tabSelection) { viewModel.apply($0) }
            }
        case .emailChange:
            EmailChangeView(authService: authService, currentEmail: currentEmail, tabSelection: $tabSelection)
        case .passwordChange:
            PasswordChangeView(authService: authService, tabSelection: $tabSelection)
        case .accountDeletion:
            AccountDeletionView(apiClient: apiClient, authService: authService, onSignOut: onSignOut, tabSelection: $tabSelection)
        }
    }

    private var currentEmail: String? {
        if case .loaded(let info) = viewModel.state { return info.email }
        return nil
    }

    // MARK: - プロフィール(アバター・名前・メールアドレス)

    private func profileCard(_ info: AccountInfo) -> some View {
        HStack(spacing: 10) {
            avatar
            VStack(alignment: .leading, spacing: 5) {
                V5JPFont.text(info.account.displayName ?? "未設定", size: 10).foregroundStyle(.white).lineLimit(1)
                V5JPFont.text(info.email ?? "—", size: Self.subtitleSize, weight: .regular)
                    .foregroundStyle(SettingsCardStyle.subtitleColor).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.leading, 7.5)
        .frame(width: Self.cardWidth, height: Self.profileHeight)
        .background(SettingsCardStyle.card(width: Self.cardWidth, height: Self.profileHeight))
        .position(x: 117, y: Self.profileTop + Self.profileHeight / 2)
    }

    /// 参考画像の、明るい青の縁で光る丸に、紺の人型が下へはみ出して切れる
    /// アバター(直径42px→43)。
    private var avatar: some View {
        ZStack {
            Circle().fill(LinearGradient(
                colors: [Color(red: 92 / 255, green: 150 / 255, blue: 222 / 255), Color(red: 38 / 255, green: 92 / 255, blue: 168 / 255)],
                startPoint: .top, endPoint: .bottom
            ))
            Image(systemName: "person.fill")
                .resizable().scaledToFit()
                .frame(width: 30, height: 30)
                .foregroundStyle(Color(red: 14 / 255, green: 44 / 255, blue: 86 / 255))
                .offset(y: 8)
        }
        .frame(width: 43, height: 43)
        .clipShape(Circle())
        .overlay(Circle().stroke(Color(red: 96 / 255, green: 168 / 255, blue: 245 / 255), lineWidth: 1.2))
        .shadow(color: Color(red: 64 / 255, green: 150 / 255, blue: 245 / 255).opacity(0.7), radius: 3)
    }

    // MARK: - 行グループ

    @ViewBuilder
    private func group1(_ info: AccountInfo) -> some View {
        groupBackground(top: Self.group1Top, rows: Self.group1Rows)
        NavigationLink(value: AccountSubRoute.profileEdit) {
            rowLabel("プロフィール編集", height: Self.group1Rows[0])
        }
        .buttonStyle(SettingsRowPressStyle())
        .position(x: 117, y: rowCenter(top: Self.group1Top, rows: Self.group1Rows, index: 0))
        NavigationLink(value: AccountSubRoute.emailChange) {
            rowLabel("メールアドレス", value: info.email ?? "—", valueStyle: .muted, height: Self.group1Rows[1])
        }
        .buttonStyle(SettingsRowPressStyle())
        .position(x: 117, y: rowCenter(top: Self.group1Top, rows: Self.group1Rows, index: 1))
        NavigationLink(value: AccountSubRoute.passwordChange) {
            rowLabel("パスワード変更", height: Self.group1Rows[2])
        }
        .buttonStyle(SettingsRowPressStyle())
        .position(x: 117, y: rowCenter(top: Self.group1Top, rows: Self.group1Rows, index: 2))
    }

    @ViewBuilder
    private func group2(_ info: AccountInfo) -> some View {
        groupBackground(top: Self.group2Top, rows: Self.group2Rows)
        NavigationLink(value: AccountSubRoute.profileEdit) {
            rowLabel("生年月日", value: info.account.birthDate.flatMap(BirthDate.display) ?? "未設定", valueStyle: .prominent, height: Self.group2Rows[0])
        }
        .buttonStyle(SettingsRowPressStyle())
        .position(x: 117, y: rowCenter(top: Self.group2Top, rows: Self.group2Rows, index: 0))
        NavigationLink(value: SettingsSubRoute.displaySettings) {
            rowLabel("国・地域", value: regionLabel(info.regionCode), valueStyle: .prominent, height: Self.group2Rows[1])
        }
        .buttonStyle(SettingsRowPressStyle())
        .position(x: 117, y: rowCenter(top: Self.group2Top, rows: Self.group2Rows, index: 1))
    }

    /// 参考画像どおり、赤いゴミ箱アイコンと赤い文字の「アカウント削除」。
    private var deleteRow: some View {
        NavigationLink(value: AccountSubRoute.accountDeletion) {
            HStack(spacing: 0) {
                Image(systemName: "trash")
                    .resizable().scaledToFit()
                    .fontWeight(.semibold)
                    .frame(width: 10, height: 10)
                    .frame(width: 11.6)
                V5JPFont.text("アカウント削除", size: Self.titleSize)
                    .padding(.leading, 13.5)
                Spacer()
                chevron
            }
            .foregroundStyle(V5P.red)
            .padding(.leading, 11.8)
            .padding(.trailing, Self.chevronTrailing)
            .frame(width: Self.cardWidth, height: Self.deleteHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(SettingsRowPressStyle())
        .background(SettingsCardStyle.card(width: Self.cardWidth, height: Self.deleteHeight))
        .position(x: 117, y: Self.deleteTop + Self.deleteHeight / 2)
    }

    private enum ValueStyle { case muted, prominent }

    /// 参考画像の行: 左にタイトル、その下に値(メールアドレスは小さく薄い色、
    /// 生年月日・国・地域はタイトルと同じ大きさの白)、右端にシェブロン。
    private func rowLabel(_ title: String, value: String? = nil, valueStyle: ValueStyle = .muted, height: CGFloat) -> some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: valueStyle == .muted ? 4 : 3) {
                V5JPFont.text(title, size: Self.titleSize, weight: .medium).foregroundStyle(.white)
                if let value {
                    switch valueStyle {
                    case .muted:
                        V5JPFont.text(value, size: Self.subtitleSize, weight: .regular)
                            .foregroundStyle(SettingsCardStyle.subtitleColor).lineLimit(1)
                    case .prominent:
                        V5JPFont.text(value, size: Self.titleSize, weight: .medium)
                            .foregroundStyle(.white.opacity(0.92)).lineLimit(1)
                    }
                }
            }
            Spacer()
            chevron
        }
        .padding(.leading, Self.textLeading)
        .padding(.trailing, Self.chevronTrailing)
        .frame(width: Self.cardWidth, height: height)
        // 背景を持たない行でも、行全体(中央の空白を含む)をタップ可能にする。
        .contentShape(Rectangle())
    }

    private var chevron: some View {
        Image(systemName: "chevron.right").font(.system(size: 8.5, weight: .semibold)).foregroundStyle(SettingsCardStyle.chevronColor)
    }

    @ViewBuilder
    private func groupBackground(top: CGFloat, rows: [CGFloat]) -> some View {
        let height = rows.reduce(0, +)
        SettingsCardStyle.card(width: Self.cardWidth, height: height)
            .position(x: 117, y: top + height / 2)
        ForEach(1..<rows.count, id: \.self) { i in
            Rectangle()
                .fill(SettingsCardStyle.separator)
                .frame(width: Self.cardWidth, height: 0.6)
                .position(x: 117, y: top + rows[..<i].reduce(0, +))
        }
    }

    private func rowCenter(top: CGFloat, rows: [CGFloat], index: Int) -> CGFloat {
        top + rows[..<index].reduce(0, +) + rows[index] / 2
    }

    /// SCR-018と同じ候補の表示名。候補外のコードはそのまま表示する。
    private func regionLabel(_ code: String?) -> String {
        guard let code else { return "—" }
        return DisplaySettingsView.regions.first { $0.value == code }?.label ?? code
    }

    /// 読み込み中・エラー・未設定状態も`.loaded`と同じ外枠(`V5Viewport`の
    /// 背景画像・ヘッダー・タブバー)に載せる。HQ指示(2026-10-05)「背景画像と
    /// ヘッダーとタブを全画面に反映して」に合わせた、他画面と同じ形。
    @ViewBuilder private func loadingScaffold(@ViewBuilder content: @escaping () -> some View) -> some View {
        V5Viewport {
            V5Header(title: "アカウント情報", back: true, onBack: { dismiss() })
            content()
                .frame(width: V5P.W, height: V5P.H - 92, alignment: .center)
                .padding(.top, 53)
            V5BottomBar(selected: $tabSelection)
        }
    }
}
