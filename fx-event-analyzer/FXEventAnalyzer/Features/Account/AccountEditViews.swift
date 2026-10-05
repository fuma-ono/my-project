import SwiftUI

// 4画面ともHQ指示(2026-10-05)の参考画像(SCR-025 プロフィール編集 /
// SCR-026 メールアドレス変更 / SCR-027 パスワード変更 / SCR-024 アカウント
// 削除を横に並べた1枚)の配置を、ヘッダー下〜タブバー上(V5座標の約54〜452)
// に縦横比を合わせて換算した。

// MARK: - プロフィール編集

/// SCR-015 → プロフィール編集(名前・生年月日)。「生年月日」行からも開く。
struct ProfileEditView: View {
    @StateObject private var viewModel: ProfileEditViewModel
    @Binding var tabSelection: Int
    private let onSaved: (AccountResponse) -> Void
    @State private var showDatePicker = false
    @Environment(\.dismiss) private var dismiss

    init(apiClient: APIClient, account: AccountResponse, tabSelection: Binding<Int>, onSaved: @escaping (AccountResponse) -> Void) {
        _viewModel = StateObject(wrappedValue: ProfileEditViewModel(apiClient: apiClient, account: account))
        _tabSelection = tabSelection
        self.onSaved = onSaved
    }

    var body: some View {
        AccountFormScaffold(title: "プロフィール編集", tabSelection: $tabSelection) {
            // 参考画像のカメラバッジ付きアバター。写真のアップロードは未実装の
            // ため、バッジは飾りでタップしても何も起きない。
            AccountAvatar(diameter: 50)
                .overlay(alignment: .bottomTrailing) {
                    Image(systemName: "camera.fill")
                        .font(.system(size: 6.5))
                        .foregroundStyle(.white)
                        .frame(width: 14, height: 14)
                        .background(Circle().fill(SettingsCardStyle.cardFill))
                        .overlay(Circle().stroke(SettingsCardStyle.cardBorder, lineWidth: 0.7))
                        .offset(x: 2, y: 1)
                }
                .position(x: 117, y: 88)
            V5JPFont.text("プロフィール画像は後から変更できます。", size: 7, weight: .regular)
                .foregroundStyle(SettingsCardStyle.chevronColor)
                .position(x: 117, y: 126)

            fieldCard(title: "名前", showsChevron: false) {
                AccountTextField(label: "名前", placeholder: "名前を入力", text: $viewModel.displayName, framed: false)
            }
            .position(x: 117, y: Self.nameTop + Self.cardHeight / 2)

            Button { showDatePicker = true } label: {
                fieldCard(title: "生年月日", showsChevron: true) {
                    V5JPFont.text(birthDateText ?? "未設定", size: 8.5, weight: .regular)
                        .foregroundStyle(birthDateText == nil ? V5P.muted : .white)
                        .padding(.horizontal, 10)
                        .frame(width: 214, height: 30, alignment: .leading)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(SettingsRowPressStyle())
            .accessibilityLabel("生年月日")
            .position(x: 117, y: Self.birthTop + Self.cardHeight / 2)

            AccountInfoCard(icon: "info.circle", text: "生年月日を変更する場合は、「生年月日」の項目をタップしてください。")
                .accountPinned(top: Self.birthTop + Self.cardHeight + 10)

            AccountStatusText(state: viewModel.state).accountPinned(top: 392, height: 20)
            AccountPrimaryButton(title: "保存", isLoading: viewModel.state == .submitting, isEnabled: viewModel.canSave) {
                Task {
                    if let updated = await viewModel.save() {
                        onSaved(updated)
                        dismiss()
                    }
                }
            }
            .position(x: 117, y: 422)
        }
        .sheet(isPresented: $showDatePicker) {
            BirthDatePickerSheet(date: $viewModel.birthDate)
        }
    }

    private static let nameTop: CGFloat = 142
    private static let birthTop: CGFloat = 200
    /// 見出し行22 + 値の行30。
    private static let cardHeight: CGFloat = 52

    /// 参考画像の「1990/01/01」表記。
    private var birthDateText: String? {
        viewModel.birthDate.map { BirthDate.string(from: $0).replacingOccurrences(of: "-", with: "/") }
    }

    /// 見出し行(+シェブロン)と区切り線の下に値の行を持つカード。
    private func fieldCard(title: String, showsChevron: Bool, @ViewBuilder value: () -> some View) -> some View {
        VStack(spacing: 0) {
            HStack {
                V5JPFont.text(title, size: 8, weight: .bold).foregroundStyle(.white)
                Spacer()
                if showsChevron {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 7.5, weight: .semibold))
                        .foregroundStyle(SettingsCardStyle.chevronColor)
                }
            }
            .padding(.horizontal, 10)
            .frame(width: 214, height: 22)
            Rectangle().fill(SettingsCardStyle.separator).frame(width: 214, height: 0.6)
            value()
        }
        .frame(width: 214, height: Self.cardHeight, alignment: .top)
        .background(SettingsCardStyle.card(width: 214, height: Self.cardHeight))
    }
}

/// 生年月日の選択。固定キャンバスの拡大表示に入れると標準のDatePickerが
/// 崩れるため、通常サイズのシートで選ぶ。日付はUTCのグレゴリオ暦で扱い
/// (`BirthDate`)、端末のタイムゾーンで日がずれないようにしている。
private struct BirthDatePickerSheet: View {
    @Binding var date: Date?
    @State private var draft: Date
    @Environment(\.dismiss) private var dismiss

    init(date: Binding<Date?>) {
        _date = date
        _draft = State(initialValue: date.wrappedValue ?? BirthDate.date(from: "1990-01-01")!)
    }

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Button("未設定にする") {
                    date = nil
                    dismiss()
                }
                .foregroundStyle(AccountPalette.destructive)
                Spacer()
                Text("生年月日").font(.headline).foregroundStyle(.white)
                Spacer()
                Button("完了") {
                    date = draft
                    dismiss()
                }
                .fontWeight(.semibold)
                .foregroundStyle(V5P.cyan)
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)

            DatePicker("生年月日", selection: $draft, in: ProfileEditViewModel.birthDateRange, displayedComponents: .date)
                .datePickerStyle(.wheel)
                .labelsHidden()
                .environment(\.locale, Locale(identifier: "ja_JP"))
                .environment(\.calendar, BirthDate.calendar)
                .environment(\.timeZone, BirthDate.calendar.timeZone)
                .colorScheme(.dark)
            Spacer(minLength: 0)
        }
        .presentationDetents([.height(300)])
        .presentationBackground(SettingsCardStyle.cardFill)
    }
}

/// メール・パスワード変更の、アイコン下の中央寄せの案内文。
private struct AccountLead: View {
    let text: String
    var body: some View {
        V5JPFont.text(text, size: 7.5, weight: .regular)
            .foregroundStyle(.white.opacity(0.9))
            .multilineTextAlignment(.center)
            .lineSpacing(3)
            .frame(width: 214)
            .fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: - メールアドレス変更

struct EmailChangeView: View {
    @StateObject private var viewModel: EmailChangeViewModel
    @Binding var tabSelection: Int

    init(authService: AuthServicing?, currentEmail: String?, tabSelection: Binding<Int>) {
        _viewModel = StateObject(wrappedValue: EmailChangeViewModel(authService: authService, currentEmail: currentEmail))
        _tabSelection = tabSelection
    }

    var body: some View {
        AccountFormScaffold(title: "メールアドレス変更", tabSelection: $tabSelection) {
            AccountHeroIcon(systemName: "envelope").position(x: 117, y: 82)
            AccountLead(text: "新しいメールアドレスを入力してください。\n確認メールを送信します。")
                .accountPinned(top: 108, height: 30)

            AccountFieldCaption(text: "新しいメールアドレス").position(x: 117, y: 150)
            AccountTextField(label: "新しいメールアドレス", placeholder: "例）example@domain.com", text: $viewModel.email, keyboard: .emailAddress)
                .position(x: 117, y: 171)

            AccountPrimaryButton(title: "確認メールを送信", isLoading: viewModel.state == .submitting, isEnabled: viewModel.canSubmit) {
                Task { await viewModel.submit() }
            }
            .position(x: 117, y: 210)
            AccountStatusText(state: viewModel.state, validation: viewModel.validationMessage)
                .accountPinned(top: 229, height: 20)

            AccountInfoCard(
                icon: "envelope.circle.fill",
                title: "メールの受信について",
                bullets: [
                    "入力したメールアドレス宛に確認メールを送信します。",
                    "メール内のリンクを開くと、メールアドレスの変更が完了します。",
                    "メールが届かない場合は、迷惑メールフォルダもご確認ください。",
                ]
            )
            .accountPinned(top: 252)
        }
    }
}

// MARK: - パスワード変更

struct PasswordChangeView: View {
    @StateObject private var viewModel: PasswordChangeViewModel
    @Binding var tabSelection: Int

    init(authService: AuthServicing?, tabSelection: Binding<Int>) {
        _viewModel = StateObject(wrappedValue: PasswordChangeViewModel(authService: authService))
        _tabSelection = tabSelection
    }

    var body: some View {
        AccountFormScaffold(title: "パスワード変更", tabSelection: $tabSelection) {
            AccountHeroIcon(systemName: "lock.fill").position(x: 117, y: 80)
            AccountLead(text: "現在のパスワードを入力してから、\n新しいパスワードを設定してください。")
                .accountPinned(top: 106, height: 30)

            AccountFieldCaption(text: "現在のパスワード").position(x: 117, y: 146)
            AccountTextField(label: "現在のパスワード", placeholder: "現在のパスワードを入力", text: $viewModel.currentPassword, isSecure: true)
                .position(x: 117, y: 167)

            AccountFieldCaption(text: "新しいパスワード").position(x: 117, y: 192)
            AccountTextField(label: "新しいパスワード", placeholder: "\(PasswordChangeViewModel.minimumLength)文字以上のパスワードを入力", text: $viewModel.newPassword, isSecure: true)
                .position(x: 117, y: 213)

            AccountFieldCaption(text: "新しいパスワード（再入力）").position(x: 117, y: 238)
            AccountTextField(label: "新しいパスワード（再入力）", placeholder: "新しいパスワードを再入力", text: $viewModel.confirmation, isSecure: true)
                .position(x: 117, y: 259)

            AccountInfoCard(
                icon: "info.circle.fill",
                title: "パスワードの条件",
                bullets: ["\(PasswordChangeViewModel.minimumLength)文字以上", "英字（大文字・小文字）", "数字を含む"]
            )
            .accountPinned(top: 284)

            AccountPrimaryButton(title: "変更する", isLoading: viewModel.state == .submitting, isEnabled: viewModel.canSubmit) {
                Task { await viewModel.submit() }
            }
            .position(x: 117, y: 384)
            AccountStatusText(state: viewModel.state, validation: viewModel.validationMessage)
                .accountPinned(top: 404, height: 30)
        }
    }
}

// MARK: - SCR-024 アカウント削除

/// 削除の影響を説明し、確認ダイアログを経てから`DELETE /account`する。
/// 削除後はSCR-014のログアウトと同じ`onSignOut`でログイン画面へ戻る。
struct AccountDeletionView: View {
    @StateObject private var viewModel: AccountDeletionViewModel
    @Binding var tabSelection: Int
    @State private var showConfirmation = false
    @Environment(\.dismiss) private var dismiss

    init(apiClient: APIClient, authService: AuthServicing?, onSignOut: @escaping () -> Void, tabSelection: Binding<Int>) {
        _viewModel = StateObject(wrappedValue: AccountDeletionViewModel(apiClient: apiClient, authService: authService, onSignOut: onSignOut))
        _tabSelection = tabSelection
    }

    /// 削除されるデータ。参考画像の「お気に入り情報」「取引履歴・データ」は
    /// 実際と合わないため置き換えた — お気に入りは端末内(`FavoritesStore`)
    /// でBackendに無く、取引履歴の機能も無い。`DELETE /account`で消えるのは
    /// `profiles`・`user_settings`・`subscriptions`/`entitlements`
    /// (api-design.md §24.3)。
    private static let deletedData: [DeletedItem] = [
        DeletedItem(icon: "person.fill", label: "プロフィール情報"),
        DeletedItem(icon: "gearshape.fill", label: "設定情報（通知・表示・チャート）"),
        DeletedItem(icon: "creditcard.fill", label: "購入・購読の記録"),
        DeletedItem(icon: "tray.full.fill", label: "その他すべてのデータ"),
    ]

    private struct DeletedItem {
        let icon: String
        let label: String
    }

    var body: some View {
        AccountFormScaffold(title: "アカウント削除", tabSelection: $tabSelection) {
            Image(systemName: "exclamationmark.triangle.fill")
                .symbolRenderingMode(.palette)
                .foregroundStyle(Color.white, AccountPalette.destructiveFill)
                .font(.system(size: 28))
                .position(x: 117, y: 78)
            V5JPFont.text("アカウントを削除しますか？", size: 11, weight: .bold)
                .foregroundStyle(AccountPalette.destructive)
                .position(x: 117, y: 108)
            AccountLead(text: "アカウントを削除すると、以下のデータがすべて
削除され、復元することはできません。")
                .accountPinned(top: 120, height: 30)

            VStack(alignment: .leading, spacing: 0) {
                ForEach(Self.deletedData, id: \.label) { item in
                    HStack(spacing: 8) {
                        Image(systemName: item.icon)
                            .font(.system(size: 9))
                            .foregroundStyle(SettingsCardStyle.chevronColor)
                            .frame(width: 13)
                        V5JPFont.text(item.label, size: 8, weight: .regular).foregroundStyle(.white)
                        Spacer(minLength: 0)
                    }
                    .frame(height: 20)
                }
            }
            .padding(.horizontal, 11)
            .padding(.vertical, 6)
            .frame(width: 214)
            .background(AccountCardBackground())
            .accountPinned(top: 156)

            AccountInfoCard(
                icon: "exclamationmark.circle.fill",
                text: "App Storeのサブスクリプションは自動では解約されません。サブスクリプションの解約は、App Storeの設定から行ってください。",
                tint: AccountPalette.destructive,
                textColor: AccountPalette.destructive,
                fill: AccountPalette.warningFill,
                border: AccountPalette.warningBorder
            )
            .accountPinned(top: 260)

            AccountStatusText(state: viewModel.state).accountPinned(top: 326, height: 30)
            AccountPrimaryButton(title: "アカウントを削除する", isLoading: viewModel.state == .submitting, destructive: true) {
                showConfirmation = true
            }
            .position(x: 117, y: 384)
            AccountSecondaryButton(title: "キャンセル") { dismiss() }
                .position(x: 117, y: 420)
        }
        .confirmationDialog("本当にアカウントを削除しますか？", isPresented: $showConfirmation, titleVisibility: .visible) {
            Button("削除する", role: .destructive) { Task { await viewModel.delete() } }
            Button("キャンセル", role: .cancel) {}
        } message: {
            Text("この操作は取り消せません。")
        }
    }
}
