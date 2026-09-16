import SwiftUI

/// Central design tokens for FX Event Analyzer.
///
/// Values here are the concrete RGB/spacing choices that
/// `docs/projects/fx-event-analyzer/ui-screens.md` §9.2 deliberately left
/// undefined ("正確なRGB値は今回定義しない。実装時にDesign Tokensとして確定する").
/// They implement HQ's described direction (Deep Navy/Black background,
/// Blue/Cyan accent) without changing its meaning, and are the single place
/// to retune the whole app's look later (ui-screens.md 9.5節: "後から全画面の
/// テーマを変更できる構造にする").
///
/// Dark is the MVP baseline theme; Light is structurally supported via the
/// asset catalog's "Any Appearance" variants, but the app currently forces
/// dark presentation regardless of system setting (see
/// `FXEventAnalyzerApp.swift`), matching ui-screens.md's "MVPの既定表示は
/// Dark Theme" — reverting that single modifier is enough to let Light
/// theme follow the system setting later.
enum DesignTokens {
    enum Colors {
        static let backgroundPrimary = Color("BackgroundPrimary")
        static let backgroundSurface = Color("BackgroundSurface")
        static let accentPrimary = Color("AccentPrimary")
        static let accentSecondary = Color("AccentSecondary")
        static let textPrimary = Color("TextPrimary")
        static let textSecondary = Color("TextSecondary")
        static let borderSubtle = Color("BorderSubtle")
        static let statusError = Color("StatusError")
        static let statusSuccess = Color("StatusSuccess")

        /// Blue → Cyan gradient used for the brand mark and primary actions,
        /// matching ui-screens.md 9.2節's App Icon color direction.
        static let accentGradient = LinearGradient(
            colors: [accentPrimary, accentSecondary],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    enum Spacing {
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 16
        static let lg: CGFloat = 24
        static let xl: CGFloat = 40
    }

    enum CornerRadius {
        static let card: CGFloat = 16
        static let control: CGFloat = 12
    }

    enum Typography {
        static let title = Font.system(size: 28, weight: .bold, design: .rounded)
        static let headline = Font.system(size: 20, weight: .semibold, design: .rounded)
        static let body = Font.system(size: 16, weight: .regular)
        static let caption = Font.system(size: 13, weight: .regular)
        static let tagline = Font.system(size: 14, weight: .medium, design: .rounded)
    }
}
