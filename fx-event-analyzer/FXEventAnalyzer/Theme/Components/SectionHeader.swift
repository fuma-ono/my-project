import SwiftUI

/// Shared section title — every screen's "今日の注目イベント" /
/// "市場への影響" / etc. heading, optionally with a trailing "すべて見る"
/// -style action, so headings stop being ad-hoc `Text(...).font(.headline)`
/// calls that each pick slightly different weight/spacing.
struct SectionHeader: View {
    let title: String
    var subtitle: String?
    var trailingAction: (title: String, action: () -> Void)?

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(DesignTokens.Typography.headline)
                    .foregroundStyle(DesignTokens.Colors.textPrimary)
                if let subtitle {
                    Text(subtitle)
                        .font(DesignTokens.Typography.caption)
                        .foregroundStyle(DesignTokens.Colors.textSecondary)
                }
            }
            Spacer()
            if let trailingAction {
                Button(trailingAction.title, action: trailingAction.action)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.accentCyan)
            }
        }
    }
}
