import Combine
import Foundation

/// SCR-015 アカウント情報のサブ画面(プロフィール編集・メールアドレス変更・
/// パスワード変更・SCR-024 アカウント削除)で共通の送信状態。
enum AccountFormState: Equatable {
    case idle
    case submitting
    /// 完了メッセージ(メール変更の確認メール送信など)。
    case done(String)
    case error(String)
}

// MARK: - プロフィール編集

/// 名前と生年月日を`PATCH /account`で保存する(api-design.md §24.2)。
@MainActor
final class ProfileEditViewModel: ObservableObject {
    @Published var displayName: String
    @Published var birthDate: Date?
    @Published private(set) var state: AccountFormState = .idle

    private let accountService: AccountService
    private let original: AccountResponse

    /// Backendの範囲チェック(1900-01-01〜今日)と同じ選択範囲。
    static var birthDateRange: ClosedRange<Date> {
        BirthDate.date(from: "1900-01-01")!...Date()
    }

    init(apiClient: APIClient, account: AccountResponse) {
        self.accountService = AccountService(apiClient: apiClient)
        self.original = account
        self.displayName = account.displayName ?? ""
        self.birthDate = account.birthDate.flatMap(BirthDate.date(from:))
    }

    /// 空欄の名前は未設定(`null`)として保存する。
    private var normalizedName: String? {
        let trimmed = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private var birthDateString: String? { birthDate.map(BirthDate.string(from:)) }

    var hasChanges: Bool {
        normalizedName != original.displayName || birthDateString != original.birthDate
    }

    var canSave: Bool { hasChanges && state != .submitting && normalizedName.map { $0.count <= 200 } ?? true }

    /// 保存に成功したら新しい内容を返す(画面側で一覧へ反映して閉じる)。
    func save() async -> AccountResponse? {
        guard canSave else { return nil }
        state = .submitting
        do {
            let updated = try await accountService.updateAccount(AccountUpdate(displayName: normalizedName, birthDate: birthDateString))
            state = .idle
            return updated
        } catch let error as APIError where error.isNotConfigured {
            state = .error("Backendが準備中のため保存できません。")
        } catch {
            state = .error("保存に失敗しました。時間をおいて再度お試しください。")
        }
        return nil
    }
}

// MARK: - メールアドレス変更

/// Supabase Authで新しいメールアドレスへの変更を依頼する。確認メールの
/// リンクを開くまで変更は反映されない(`AuthServicing.updateEmail`)。
@MainActor
final class EmailChangeViewModel: ObservableObject {
    @Published var email = ""
    @Published private(set) var state: AccountFormState = .idle

    let currentEmail: String?
    private let authService: AuthServicing?

    init(authService: AuthServicing?, currentEmail: String?) {
        self.authService = authService
        self.currentEmail = currentEmail
    }

    private var trimmedEmail: String { email.trimmingCharacters(in: .whitespacesAndNewlines) }

    static func isValidEmail(_ value: String) -> Bool {
        value.range(of: #"^[^@\s]+@[^@\s]+\.[^@\s]+$"#, options: .regularExpression) != nil
    }

    /// 入力中に出す注意(空欄のときは出さない)。
    var validationMessage: String? {
        guard !trimmedEmail.isEmpty else { return nil }
        if !Self.isValidEmail(trimmedEmail) { return "メールアドレスの形式が正しくありません。" }
        if trimmedEmail.caseInsensitiveCompare(currentEmail ?? "") == .orderedSame { return "現在のメールアドレスと同じです。" }
        return nil
    }

    var canSubmit: Bool { !trimmedEmail.isEmpty && validationMessage == nil && state != .submitting }

    func submit() async {
        guard canSubmit else { return }
        guard let authService else {
            state = .error("この環境ではメールアドレスを変更できません。")
            return
        }
        state = .submitting
        do {
            try await authService.updateEmail(trimmedEmail)
            state = .done("\(trimmedEmail) に確認メールを送信しました。メール内のリンクを開くと変更が完了します。")
        } catch AuthServiceError.notConfigured {
            state = .error("この環境ではメールアドレスを変更できません。")
        } catch {
            state = .error("確認メールの送信に失敗しました。時間をおいて再度お試しください。")
        }
    }
}

// MARK: - パスワード変更

/// 現在のパスワードで本人確認してから変更する
/// (`AuthServicing.updatePassword`)。
@MainActor
final class PasswordChangeViewModel: ObservableObject {
    @Published var currentPassword = ""
    @Published var newPassword = ""
    @Published var confirmation = ""
    @Published private(set) var state: AccountFormState = .idle

    /// Supabase Authの既定(6文字)より厳しくする。
    static let minimumLength = 8

    private let authService: AuthServicing?

    init(authService: AuthServicing?) {
        self.authService = authService
    }

    var validationMessage: String? {
        if !newPassword.isEmpty, newPassword.count < Self.minimumLength {
            return "新しいパスワードは\(Self.minimumLength)文字以上にしてください。"
        }
        if !newPassword.isEmpty, newPassword == currentPassword {
            return "現在のパスワードと異なるものにしてください。"
        }
        if !confirmation.isEmpty, confirmation != newPassword {
            return "確認用のパスワードが一致しません。"
        }
        return nil
    }

    var canSubmit: Bool {
        !currentPassword.isEmpty && !newPassword.isEmpty && !confirmation.isEmpty
            && validationMessage == nil && state != .submitting
    }

    func submit() async {
        guard canSubmit else { return }
        guard let authService else {
            state = .error("この環境ではパスワードを変更できません。")
            return
        }
        state = .submitting
        do {
            try await authService.updatePassword(currentPassword: currentPassword, newPassword: newPassword)
            currentPassword = ""
            newPassword = ""
            confirmation = ""
            state = .done("パスワードを変更しました。")
        } catch AuthServiceError.invalidCredentials {
            state = .error("現在のパスワードが正しくありません。")
        } catch AuthServiceError.notConfigured {
            state = .error("この環境ではパスワードを変更できません。")
        } catch {
            state = .error("パスワードの変更に失敗しました。時間をおいて再度お試しください。")
        }
    }
}

// MARK: - SCR-024 アカウント削除

/// `DELETE /account`(物理削除、api-design.md §24.3)のあと、端末の
/// セッションも破棄してログイン画面へ戻す。
@MainActor
final class AccountDeletionViewModel: ObservableObject {
    @Published private(set) var state: AccountFormState = .idle

    private let accountService: AccountService
    private let authService: AuthServicing?
    private let onSignOut: () -> Void

    init(apiClient: APIClient, authService: AuthServicing?, onSignOut: @escaping () -> Void) {
        self.accountService = AccountService(apiClient: apiClient)
        self.authService = authService
        self.onSignOut = onSignOut
    }

    func delete() async {
        guard state != .submitting else { return }
        state = .submitting
        do {
            try await accountService.deleteAccount()
        } catch let error as APIError where error.isNotConfigured {
            state = .error("Backendが準備中のため削除できません。")
            return
        } catch {
            state = .error("アカウントの削除に失敗しました。時間をおいて再度お試しください。")
            return
        }
        // サーバー側のユーザーは削除済みなので、サインアウトの失敗
        // (トークン失効済みなど)ではログイン画面へ戻るのを止めない。
        try? await authService?.signOut()
        state = .idle
        onSignOut()
    }
}
