import SwiftUI

/// Shared card container — every screen's cards go through this instead of
/// each View hand-rolling its own `.padding().background().clipShape()`
/// chain (that duplication is exactly what HQ's UI rebuild instruction
/// flagged: "各画面で直接色・余白・フォントサイズをバラバラに指定しない").
///
/// Two tiers only, matching `DesignTokens.Colors`' surface hierarchy:
/// `.surface` for ordinary content, `.elevated` for the one or two most
/// important things on a screen (Home's hero panel, Surprise, a chart).
/// Reaching for `.elevated` everywhere would erase the distinction it
/// exists to make.
struct FXCardStyle: ViewModifier {
    enum Tier {
        case surface
        case elevated
    }

    var tier: Tier = .surface
    var padding: CGFloat = DesignTokens.Spacing.md

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(backgroundColor)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay {
                if tier == .surface {
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .strokeBorder(DesignTokens.Colors.borderSubtle, lineWidth: 1)
                }
            }
    }

    private var backgroundColor: Color {
        switch tier {
        case .surface: return DesignTokens.Colors.backgroundSurface
        case .elevated: return DesignTokens.Colors.backgroundElevated
        }
    }

    private var cornerRadius: CGFloat {
        switch tier {
        case .surface: return DesignTokens.CornerRadius.card
        case .elevated: return DesignTokens.CornerRadius.hero
        }
    }
}

extension View {
    func fxCard(_ tier: FXCardStyle.Tier = .surface, padding: CGFloat = DesignTokens.Spacing.md) -> some View {
        modifier(FXCardStyle(tier: tier, padding: padding))
    }
}
