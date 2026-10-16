import SwiftUI
import UserNotifications

@main
struct FXEventAnalyzerApp: App {
    private let authService: AuthServicing
    private let apiClient: APIClient

    init() {
        let config = SupabaseConfig.loadFromInfoPlist()
        let authService = SupabaseAuthService(config: config)
        self.authService = authService
        // Phase 2: every Backend request now carries the signed-in user's
        // Supabase Auth access token (api-design.md §2.2's
        // Authorization: Bearer <token>) — without this, every
        // authenticated Backend endpoint would 401 regardless of how
        // correctly it's called. `try?` because a missing/expired session
        // must degrade to an unauthenticated request (and a 401 from the
        // Backend), never crash the app.
        apiClient = URLSessionAPIClient(authTokenProvider: {
            try? await authService.currentSession()?.accessToken
        })
        // 通知設定(SCR-016)のローカル通知を、アプリ表示中もバナーで出す。
        UNUserNotificationCenter.current().delegate = NotificationPresenter.shared
        // アプリを開かない間も通知の予約を取り直す(起動処理中に登録が必要)。
        NotificationBackgroundRefresh.register(apiClient: apiClient)
    }

    var body: some Scene {
        WindowGroup {
            RootView(authService: authService, apiClient: apiClient)
        }
    }
}
