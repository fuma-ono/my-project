import SwiftUI

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
    }

    var body: some Scene {
        WindowGroup {
            RootView(authService: authService, apiClient: apiClient)
        }
    }
}
