import SwiftUI

/// Shared "nothing to show, and that's a legitimate state" view — distinct
/// from `ErrorView`. Home uses this for "Backend API is not connected yet"
/// in Phase 1 (see `HomeViewModel`), not a generic error, because it isn't
/// a failure the user caused or can retry away from.
struct EmptyStateView: View {
    let title: String
    let message: String
    var systemImage: String = "tray"

    var body: some View {
        VStack(spacing: DesignTokens.Spacing.md) {
            Image(systemName: systemImage)
                .font(.system(size: 32))
                .foregroundStyle(DesignTokens.Colors.textSecondary)
            Text(title)
                .font(DesignTokens.Typography.headline)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
            Text(message)
                .font(DesignTokens.Typography.body)
                .foregroundStyle(DesignTokens.Colors.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(DesignTokens.Spacing.lg)
    }
}
