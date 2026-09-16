import SwiftUI

@main
struct FXEventAnalyzerApp: App {
    private let authService: AuthServicing
    private let apiClient: APIClient

    init() {
        let config = SupabaseConfig.loadFromInfoPlist()
        authService = SupabaseAuthService(config: config)
        apiClient = URLSessionAPIClient()
    }

    var body: some Scene {
        WindowGroup {
            RootView(authService: authService, apiClient: apiClient)
        }
    }
}
