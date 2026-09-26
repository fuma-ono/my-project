import SwiftUI

/// Shared error state. Always offers a retry action — HQ's explicit rule
/// "Infinite Loadingは禁止" implies its converse just as strongly: no dead
/// end without a way forward.
struct ErrorView: View {
    let title: String
    let message: String
    let retryTitle: String
    let onRetry: () -> Void

    init(
        title: String,
        message: String,
        retryTitle: String = "再試行",
        onRetry: @escaping () -> Void
    ) {
        self.title = title
        self.message = message
        self.retryTitle = retryTitle
        self.onRetry = onRetry
    }

    var body: some View {
        VStack(spacing: DesignTokens.Spacing.md) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 32))
                .foregroundStyle(DesignTokens.Colors.statusError)
            Text(title)
                .font(DesignTokens.Typography.headline)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
            Text(message)
                .font(DesignTokens.Typography.body)
                .foregroundStyle(DesignTokens.Colors.textSecondary)
                .multilineTextAlignment(.center)
            Button(retryTitle, action: onRetry)
                .buttonStyle(.borderedProminent)
                .tint(DesignTokens.Colors.accentPrimary)
        }
        .frame(maxWidth: .infinity)
        .padding(DesignTokens.Spacing.xl)
    }
}
