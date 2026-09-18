import SwiftUI

/// Central design tokens for FX Event Analyzer.
///
/// HQ's "UI全面再構築" instruction (2026-09-18) replaces the earlier ad-hoc
/// per-screen styling with a single shared system: every screen pulls
/// color/type/spacing/radius from here and from `Theme/Components/`, never
/// from a literal value inlined in a View. This file expands (does not
/// discard) the original tokens from `docs/projects/fx-event-analyzer/
/// ui-screens.md` §9.2 — the same Deep Navy background / Blue-Cyan brand
/// direction, now with the three-tier surface hierarchy and the distinct
/// Pink/Magenta emphasis accent HQ's new reference calls for.
///
/// Dark is the MVP baseline theme; Light is structurally supported via the
/// asset catalog's "Any Appearance" variants, but the app currently forces
/// dark presentation regardless of system setting (see
/// `FXEventAnalyzerApp.swift`).
enum DesignTokens {
    enum Colors {
        // MARK: Surface hierarchy (Background < Surface < Elevated)

        /// The screen's own background — darkest layer.
        static let backgroundPrimary = Color("BackgroundPrimary")
        /// A standard card/row sitting on `backgroundPrimary`.
        static let backgroundSurface = Color("BackgroundSurface")
        /// A card that should visibly stand out from ordinary surfaces —
        /// Home's "今日の注目イベント" hero panel, Surprise, primary
        /// figures. Reserved for the one or two most important things on a
        /// screen, never the default card style (HQ: "同じ重要度の情報を
        /// 同じ見た目で表示する"のは禁止 — this tier exists precisely so
        /// that doesn't happen).
        static let backgroundElevated = Color("BackgroundElevated")

        // MARK: Accents — each has one job, not interchangeable

        /// Brand / informational blue. Primary navigation, links, the
        /// gradient's first stop, importance stars. NOT the default for
        /// every button — HQ: "青いボタンを大量に使用する"のは禁止.
        static let accentPrimary = Color("AccentPrimary")
        /// The gradient's second stop and a quieter secondary-interactive
        /// tone (e.g. a countdown label). Distinct from `accentSecondary`
        /// (pink) — this is still "blue family", not an emphasis color.
        static let accentCyan = Color("AccentCyan")
        /// Pink/Magenta — reserved for the one primary call-to-action per
        /// screen (e.g. "値動きの詳細を見る") and other genuinely
        /// high-priority emphasis. Using it for everything would defeat
        /// its purpose; it works because it's rare.
        static let accentSecondary = Color("AccentSecondary")

        // MARK: Financial semantics — never used for branding/decoration

        static let statusSuccess = Color("StatusSuccess")
        static let statusError = Color("StatusError")

        // MARK: Text

        static let textPrimary = Color("TextPrimary")
        static let textSecondary = Color("TextSecondary")

        // MARK: Structure

        static let borderSubtle = Color("BorderSubtle")

        /// Blue → Cyan gradient used for the brand mark and the rare
        /// full-bleed hero treatment (ui-screens.md 9.2節's App Icon color
        /// direction).
        static let accentGradient = LinearGradient(
            colors: [accentPrimary, accentCyan],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )

        /// Directional color for a signed financial value (Surprise, pips,
        /// change%, movement) — the one place `statusSuccess`/`statusError`
        /// are chosen dynamically rather than hardcoded per call site.
        static func directional(_ value: Double?) -> Color {
            guard let value else { return textSecondary }
            if value > 0 { return statusSuccess }
            if value < 0 { return statusError }
            return textSecondary
        }

        static func directional(_ direction: SurpriseDirection) -> Color {
            switch direction {
            case .positive: return statusSuccess
            case .negative: return statusError
            case .neutral: return textSecondary
            }
        }

        /// A muted deep blue, distinct from `accentCyan` — the reference's
        /// "scheduled event" countdown badge outline (sampled ~#0C4F9C),
        /// noticeably darker/less saturated than the brand cyan. Its own
        /// token rather than reusing `accentCyan` because the two read as
        /// different colors in the Reference, not two uses of one color.
        static let accentDeepBlue = Color("AccentDeepBlue")

        /// SCR-001 Home-only tokens (HQ's Reference-fidelity instruction,
        /// 2026-09-18): Home may redefine its own semantic palette without
        /// touching the shared tokens above, which every other screen
        /// (Indicators/Event Detail/Movement Detail/Search/Settings — all
        /// out of scope this round) still renders with. Where the Reference
        /// matches an existing shared value, the alias below just forwards
        /// to it; where pixel-sampling the Reference found a different
        /// value (accent/positive/rating/time text/divider), a dedicated
        /// colorset backs it instead of a literal in HomeView.
        enum Home {
            static let background = backgroundPrimary
            static let surface = backgroundSurface
            static let elevated = backgroundElevated
            static let primaryText = textPrimary
            static let secondaryText = textSecondary
            /// Header wordmark + bell — reference sampled ~#04D3FF/#40CCFF,
            /// both brighter/more saturated than the shared `accentCyan`.
            static let accent = Color("HomeAccentCyan")
            static let accentSecondary = DesignTokens.Colors.accentSecondary
            /// FX pair change% / positive values — sampled ~#1EB179,
            /// noticeably more teal than the shared `statusSuccess`.
            static let positive = Color("HomePositive")
            static let negative = statusError
            static let border = borderSubtle
            static let selected = accent
            /// Filled star — sampled ~#FFB026 (gold/amber), not the shared
            /// `accentPrimary` blue the pre-Reference Home used.
            static let ratingGold = Color("RatingGold")
            static let ratingEmpty = textSecondary
            /// Release time (or currency code, when the release datetime
            /// isn't exact) — sampled ~#F5CEB1, a warm peach/cream with no
            /// existing equivalent token.
            static let timeText = Color("HomeTimeText")
            /// Divider between event rows inside the hero card — sampled
            /// ~#071828, much darker than the shared `borderSubtle`
            /// (#233049), because it sits on the darker elevated surface.
            static let divider = Color("HomeDivider")
        }
    }

    enum Spacing {
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 16
        static let lg: CGFloat = 24
        static let xl: CGFloat = 40
    }

    enum CornerRadius {
        static let control: CGFloat = 12
        static let card: CGFloat = 16
        static let hero: CGFloat = 20
        static let pill: CGFloat = 999
    }

    enum Typography {
        // Display / brand — rounded design carries the brand's personality
        // (used sparingly: app title, hero numbers).
        static let largeTitle = Font.system(size: 32, weight: .bold, design: .rounded)
        static let title = Font.system(size: 24, weight: .bold, design: .rounded)
        static let headline = Font.system(size: 18, weight: .semibold, design: .rounded)

        // Body / data — default (San Francisco) design reads as more
        // "serious financial app", per HQ's "専門的だが難しくない".
        static let body = Font.system(size: 16, weight: .regular)
        static let bodyEmphasized = Font.system(size: 16, weight: .semibold)
        static let caption = Font.system(size: 13, weight: .regular)
        static let captionEmphasized = Font.system(size: 13, weight: .semibold)
        static let footnote = Font.system(size: 11, weight: .medium)
        static let tagline = Font.system(size: 14, weight: .medium, design: .rounded)

        // Numeric — tabular figures so columns of prices/percentages align,
        // a standard financial-UI convention this app didn't have yet.
        static let numericLarge = Font.system(size: 28, weight: .bold, design: .rounded).monospacedDigit()
        static let numericMedium = Font.system(size: 20, weight: .semibold).monospacedDigit()
        static let numericBody = Font.system(size: 16, weight: .semibold).monospacedDigit()
        static let numericCaption = Font.system(size: 13, weight: .medium).monospacedDigit()
    }
}
