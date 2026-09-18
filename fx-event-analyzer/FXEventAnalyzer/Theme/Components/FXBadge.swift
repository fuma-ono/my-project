import SwiftUI

/// Outlined pill badge — status ("発表済み"/"発表前"), importance, or a
/// countdown. Matches the reference mockups' badge treatment (thin colored
/// border + translucent fill of the same color, not a solid block), which
/// reads as "status metadata" rather than a tappable button.
struct FXBadge: View {
    enum Tone {
        case neutral
        case info
        case positive
        case negative
        case emphasis
    }

    let text: String
    var tone: Tone = .neutral
    var systemImage: String?

    var body: some View {
        HStack(spacing: 4) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 10, weight: .semibold))
            }
            Text(text)
        }
        .font(DesignTokens.Typography.footnote)
        .foregroundStyle(color)
        .padding(.horizontal, DesignTokens.Spacing.sm)
        .padding(.vertical, 5)
        .background(color.opacity(0.14), in: Capsule())
        .overlay(Capsule().strokeBorder(color.opacity(0.5), lineWidth: 1))
    }

    private var color: Color {
        switch tone {
        case .neutral: return DesignTokens.Colors.textSecondary
        case .info: return DesignTokens.Colors.accentCyan
        case .positive: return DesignTokens.Colors.statusSuccess
        case .negative: return DesignTokens.Colors.statusError
        case .emphasis: return DesignTokens.Colors.accentSecondary
        }
    }
}
