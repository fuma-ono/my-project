import SwiftUI

/// A secondary navigation row ("過去の発表と比較する", "過去の値動きと
/// 比較する") — quiet, card-styled, trailing chevron. Distinct from
/// `FXPrimaryCTAButton`: this is "also available", not "do this next".
struct FXActionRow: View {
    let title: String
    var systemImage: String?

    var body: some View {
        HStack {
            if let systemImage {
                Image(systemName: systemImage)
                    .foregroundStyle(DesignTokens.Colors.accentCyan)
            }
            Text(title)
                .font(DesignTokens.Typography.body)
                .foregroundStyle(DesignTokens.Colors.textPrimary)
            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption2)
                .foregroundStyle(DesignTokens.Colors.textSecondary)
        }
        .fxCard(.surface)
    }
}

/// The one prominent call-to-action per screen ("値動きの詳細を見る") —
/// solid Pink/Magenta fill, per HQ's "重要情報にはpink/magenta系アクセント
/// を適切に使用" and "青いボタンを大量に使用する"の禁止. Reserved for a
/// single primary action; a screen with more than one of these has lost
/// the hierarchy it's meant to create.
struct FXPrimaryCTAButton: View {
    let title: String
    var systemImage: String = "arrow.right"

    var body: some View {
        HStack {
            Text(title)
                .font(DesignTokens.Typography.bodyEmphasized)
            Spacer()
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .semibold))
        }
        .foregroundStyle(.white)
        .padding(.horizontal, DesignTokens.Spacing.md)
        .padding(.vertical, DesignTokens.Spacing.md - 2)
        .background(DesignTokens.Colors.accentSecondary, in: RoundedRectangle(cornerRadius: DesignTokens.CornerRadius.control, style: .continuous))
    }
}
