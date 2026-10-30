import Combine
import Foundation

/// SCR-015 アカウント情報に表示する内容。`GET /account`(名前・生年月日)、
/// Supabase Authのセッション(メールアドレス)、`GET /settings`の
/// `display.region`(国・地域)を1つにまとめたもの。
struct AccountInfo: Equatable {
    var account: AccountResponse
    /// セッションにメールアドレスが無い(Backend未設定など)場合は`nil`。
    var email: String?
    /// ISO 3166-1 alpha-2。設定の取得に失敗した場合は`nil`(画面全体は
    /// エラーにせず、この行だけ「—」にする)。
    var regionCode: String?
}

enum AccountState: Equatable {
    case loading
    case backendNotConfigured
    case loaded(AccountInfo)
    case error(String)
}

/// SCR-015 アカウント情報(HQ参考画像 2026-10-05、
/// `docs/projects/fx-event-analyzer/mockups/account-screen-reference-v1.png`)。
///
/// 旧画面にあった「プラン」「通知設定」「サブスクリプション」「ログアウト」は、
/// 新しい参考画像に無く、それぞれSCR-016/SCR-017/SCR-014へ分かれたため
/// この画面からは外した(`GET /subscription`もここでは呼ばない)。
@MainActor
final class AccountViewModel: ObservableObject {
    @Published private(set) var state: AccountState = .loading

    private let accountService: AccountService
    private let settingsService: SettingsService
    /// Optional so `AppRouteDestinationView`'s unreachable-in-practice
    /// `.account` case (real navigation always goes through Settings' own
    /// override, which supplies one) can still construct this ViewModel
    /// without inventing an `AuthServicing` it doesn't have.
    private let authService: AuthServicing?

    init(apiClient: APIClient, authService: AuthServicing? = nil) {
        self.accountService = AccountService(apiClient: apiClient)
        self.settingsService = SettingsService(apiClient: apiClient)
        self.authService = authService
    }

    func load() {
        state = .loading
        Task { await fetch() }
    }

    /// サブ画面から戻ったときの再取得。表示中の内容は残したまま差し替える
    /// (読み込み中の表示に戻すと、戻るたびに画面がちらつくため)。
    func refresh() {
        guard case .loaded = state else { return load() }
        Task { await fetch() }
    }

    /// プロフィール編集の保存結果を、再取得を待たずに反映する。
    func apply(_ account: AccountResponse) {
        guard case .loaded(var info) = state else { return }
        info.account = account
        state = .loaded(info)
    }

    private func fetch() async {
        do {
            async let accountRequest = accountService.fetchAccount()
            async let settingsRequest = try? settingsService.fetchSettings()
            let session = try? await authService?.currentSession()
            let account = try await accountRequest
            let settings = await settingsRequest
            state = .loaded(AccountInfo(account: account, email: session?.email, regionCode: settings?.display.region))
        } catch let error as APIError where error.isNotConfigured {
            state = .backendNotConfigured
        } catch {
            // 表示中の内容がある再取得の失敗は、そのまま表示を残す。
            if case .loaded = state { return }
            state = .error("アカウント情報の取得に失敗しました。")
        }
    }
}
