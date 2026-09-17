import SwiftUI

/// Top-level screen switch: SCR-000 → SCR-010 / SCR-001
/// (design.md 15.1節 起動フロー).
struct RootView: View {
    @StateObject private var appState: AppState
    private let authService: AuthServicing
    private let apiClient: APIClient

    init(authService: AuthServicing, apiClient: APIClient) {
        self.authService = authService
        self.apiClient = apiClient
        _appState = StateObject(wrappedValue: AppState(authService: authService))
    }

    var body: some View {
        Group {
            switch appState.phase {
            case .launching:
                SplashView(
                    viewModel: SplashViewModel(authService: authService) { outcome in
                        appState.splashFinished(outcome: outcome)
                    }
                )
            case .loggedOut(let sessionExpired):
                LoginView(
                    viewModel: LoginViewModel(authService: authService) { session in
                        appState.handleSuccessfulLogin(session)
                    },
                    sessionExpired: sessionExpired
                )
            case .loggedIn:
                MainTabView(apiClient: apiClient)
            }
        }
        .preferredColorScheme(.dark) // MVP baseline theme (ui-screens.md 5.0節); see DesignTokens.swift
    }
}
