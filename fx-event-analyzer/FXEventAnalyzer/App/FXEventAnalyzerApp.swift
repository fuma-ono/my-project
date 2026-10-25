import GoogleSignIn
import SwiftUI
import UserNotifications

@main
struct FXEventAnalyzerApp: App {
    // 過去イベント比較画面だけ横画面を許可するための`OrientationLock`連携
    // (詳細は`OrientationAppDelegate`/`OrientationLock.swift`を参照)。
    @UIApplicationDelegateAdaptor(OrientationAppDelegate.self) private var orientationAppDelegate
    private let authService: AuthServicing
    private let apiClient: APIClient

    init() {
        // HQ指示(2026-10-20)「起動診断画面」: `DiagnosticsStore`の基準点
        // (経過msの起点)を、アプリ内コードが動き始める最も早い地点で
        // 確定させる(ここより前のプロセス起動・Swiftランタイム初期化等の
        // 時間は、アプリ内計測だけでは直接測れない — 診断画面側で注記する)。
        _ = DiagnosticsStore.shared
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
                // GoogleSignInCoordinator's sign-in sheet hands control
                // back to the app via the GOOGLE_SIGNIN_REVERSED_CLIENT_ID
                // URL scheme (project.yml) once the user finishes Google's
                // consent screen; GIDSignIn needs this call to resume and
                // complete that flow's continuation.
                .onOpenURL { url in
                    GIDSignIn.sharedInstance.handle(url)
                }
        }
    }
}
