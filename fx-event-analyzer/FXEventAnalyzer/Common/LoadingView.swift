import SwiftUI

/// Generic loading indicator. On Splash this is captioned to mean "app
/// initializing", never "data fetching" (ui-screens.md SCR-000 UI仕様) —
/// callers pass their own caption rather than this view assuming one.
struct LoadingView: View {
    var caption: String?

    var body: some View {
        VStack(spacing: DesignTokens.Spacing.sm) {
            ProgressView()
                .tint(DesignTokens.Colors.accentPrimary)
            if let caption {
                Text(caption)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(DesignTokens.Spacing.xl)
    }
}
