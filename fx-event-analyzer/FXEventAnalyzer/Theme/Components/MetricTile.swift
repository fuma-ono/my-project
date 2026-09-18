import SwiftUI

/// A single labelled figure — Forecast/Actual/Previous, a Movement stat,
/// a Comparison stat. Always tabular-digit, so a row of these lines up.
struct MetricTile: View {
    let title: String
    let value: String
    var valueColor: Color = DesignTokens.Colors.textPrimary
    var emphasized: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(DesignTokens.Colors.textSecondary)
            Text(value)
                .font(emphasized ? DesignTokens.Typography.numericLarge : DesignTokens.Typography.numericMedium)
                .foregroundStyle(valueColor)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A compact label/value pair for a dense list (Movement Detail's Pips /
/// 変化率 / 最大上昇 / 最大下落 rows) — same content contract as
/// `MetricTile` but laid out horizontally, one line.
struct MetricRow: View {
    let title: String
    let value: String
    var valueColor: Color = DesignTokens.Colors.textPrimary

    var body: some View {
        HStack {
            Text(title)
                .font(DesignTokens.Typography.caption)
                .foregroundStyle(DesignTokens.Colors.textSecondary)
            Spacer()
            Text(value)
                .font(DesignTokens.Typography.numericBody)
                .foregroundStyle(valueColor)
        }
    }
}
