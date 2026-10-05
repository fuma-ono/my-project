import SwiftUI

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
            AccountFieldCaption(text: "名前").position(x: 117, y: 66)
            AccountTextField(label: "名前", placeholder: "名前を入力", text: $viewModel.displayName)
                .position(x: 117, y: 86)

            AccountFieldCaption(text: "生年月日").position(x: 117, y: 116)
            Button { showDatePicker = true } label: {
                HStack {
                    V5JPFont.text(viewModel.birthDate.map { BirthDate.display(BirthDate.string(from: $0)) ?? "" } ?? "未設定", size: 8.5, weight: .regular)
                        .foregroundStyle(viewModel.birthDate == nil ? V5P.muted : .white)
                    Spacer()
                    Image(systemName: "calendar").font(.system(size: 9)).foregroundStyle(SettingsCardStyle.chevronColor)
                }
                .padding(.horizontal, 10)
                .frame(width: 214, height: 30)
                .contentShape(Rectangle())
            }
            .buttonStyle(SettingsRowPressStyle())
            .background(SettingsCardStyle.card(width: 214, height: 30))
            .accessibilityLabel("生年月日")
            .position(x: 117, y: 136)

            AccountPrimaryButton(title: "保存する", isLoading: viewModel.state == .submitting, isEnabled: viewModel.canSave) {
                Task {
                    if let updated = await viewModel.save() {
                        onSaved(updated)
                        dismiss()
                    }
                }
            }
            .position(x: 117, y: 180)
            AccountStatusText(state: viewModel.state).position(x: 117, y: 206)
        }
        .sheet(isPresented: $showDatePicker) {
            BirthDatePickerSheet(date: $viewModel.birthDate)
        }
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
                .foregroundStyle(V5P.red)
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
            AccountFieldCaption(text: "現在のメールアドレス").position(x: 117, y: 66)
            V5JPFont.text(viewModel.currentEmail ?? "—", size: 8.5, weight: .regular)
                .foregroundStyle(.white)
                .lineLimit(1)
                .frame(width: 206, alignment: .leading)
                .position(x: 117, y: 82)

            AccountFieldCaption(text: "新しいメールアドレス").position(x: 117, y: 106)
            AccountTextField(label: "新しいメールアドレス", placeholder: "example@mail.com", text: $viewModel.email, keyboard: .emailAddress)
                .position(x: 117, y: 126)
            AccountNote(text: "新しいメールアドレス宛てに確認メールが届きます。メール内のリンクを開くと変更が完了します。")
                .position(x: 117, y: 157)

            AccountPrimaryButton(title: "確認メールを送信", isLoading: viewModel.state == .submitting, isEnabled: viewModel.canSubmit) {
                Task { await viewModel.submit() }
            }
            .position(x: 117, y: 192)
            AccountStatusText(state: viewModel.state, validation: viewModel.validationMessage).position(x: 117, y: 222)
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
            AccountFieldCaption(text: "現在のパスワード").position(x: 117, y: 66)
            AccountTextField(label: "現在のパスワード", placeholder: "現在のパスワードを入力", text: $viewModel.currentPassword, isSecure: true)
                .position(x: 117, y: 86)

            AccountFieldCaption(text: "新しいパスワード(\(PasswordChangeViewModel.minimumLength)文字以上)").position(x: 117, y: 116)
            AccountTextField(label: "新しいパスワード", placeholder: "新しいパスワードを入力", text: $viewModel.newPassword, isSecure: true)
                .position(x: 117, y: 136)

            AccountFieldCaption(text: "新しいパスワード(確認)").position(x: 117, y: 166)
            AccountTextField(label: "新しいパスワード(確認)", placeholder: "もう一度入力", text: $viewModel.confirmation, isSecure: true)
                .position(x: 117, y: 186)

            AccountPrimaryButton(title: "変更する", isLoading: viewModel.state == .submitting, isEnabled: viewModel.canSubmit) {
                Task { await viewModel.submit() }
            }
            .position(x: 117, y: 228)
            AccountStatusText(state: viewModel.state, validation: viewModel.validationMessage).position(x: 117, y: 254)
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

    private static let notes = [
        "お気に入り・通知設定・表示設定など、アカウントに保存されたすべてのデータが削除されます。",
        "削除したアカウントとデータは元に戻せません。",
        "有料プランをご利用中の場合、App Storeのサブスクリプションは自動で解約されません。削除の前に、App Storeの設定から解約してください。",
    ]

    var body: some View {
        AccountFormScaffold(title: "アカウント削除", tabSelection: $tabSelection) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(V5P.red)
                .position(x: 117, y: 86)
            V5JPFont.text("アカウントを削除しますか？", size: 10, weight: .bold)
                .foregroundStyle(.white)
                .position(x: 117, y: 116)

            VStack(alignment: .leading, spacing: 6) {
                ForEach(Self.notes, id: \.self) { note in
                    HStack(alignment: .top, spacing: 4) {
                        V5JPFont.text("・", size: 6.5, weight: .regular).foregroundStyle(V5P.muted)
                        AccountNote(text: note, width: 180)
                    }
                }
            }
            .padding(.vertical, 10)
            .padding(.horizontal, 11)
            .frame(width: 214, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius)
                    .fill(SettingsCardStyle.cardFill)
                    .overlay(RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius).stroke(SettingsCardStyle.cardBorder, lineWidth: 0.7))
            )
            .position(x: 117, y: 182)

            AccountPrimaryButton(title: "アカウントを削除する", isLoading: viewModel.state == .submitting, destructive: true) {
                showConfirmation = true
            }
            .position(x: 117, y: 252)
            Button { dismiss() } label: {
                V5JPFont.text("キャンセル", size: 8.5, weight: .regular)
                    .foregroundStyle(SettingsCardStyle.chevronColor)
                    .frame(width: 214, height: 26)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .position(x: 117, y: 282)
            AccountStatusText(state: viewModel.state).position(x: 117, y: 306)
        }
        .confirmationDialog("本当にアカウントを削除しますか？", isPresented: $showConfirmation, titleVisibility: .visible) {
            Button("削除する", role: .destructive) { Task { await viewModel.delete() } }
            Button("キャンセル", role: .cancel) {}
        } message: {
            Text("この操作は取り消せません。")
        }
    }
}
