import SwiftUI

/// ランキング(HQ指示 2026-11-22「Claude Codeへの実装指示：みんなの分析画面」section 8)。
/// フィルターピルの「ランキング」を選んだときに、市場予想アンケート・投稿一覧の代わりに
/// 表示する。
///
/// HQ指示section 8「人気と分析精度を混同しないこと」「分析精度は投稿時点の予想を記録し、
/// 後から内容を変更して実績を操作できない仕組みを前提とする」への対応: 3種類を明確に
/// 分けたセグメントにした上で、具体的な順位・数値は一切出さない(架空の集計を描かない、
/// 他のタブと同じ方針)。特に「分析精度」は、投稿時点の予想を凍結して後から書き換えられ
/// ないようにするBackend側のデータ設計(改ざん防止)が先に必要なため、そのことをここで
/// 明記するにとどめる — クライアント側だけでは実現できない要件であり、独断でごまかしの
/// 実装はしない。
struct CommunityRankingView: View {
    @State private var kind: CommunityRankingKind = .popularPosts

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                ForEach(CommunityRankingKind.allCases) { segment($0) }
            }
            .frame(width: 214)

            VStack(alignment: .leading, spacing: 4) {
                NotoText.text(StrategyAnalysisText.preparing, size: 7.3).foregroundStyle(.white)
                NotoText.text(kind.message, size: 6.3)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(9)
            .frame(width: 214, alignment: .leading)
            .background(GradientCardBackground())
            .accessibilityIdentifier("communityRankingPlaceholder_\(kind.rawValue)")
        }
        .accessibilityIdentifier("communityRankingView")
    }

    private func segment(_ k: CommunityRankingKind) -> some View {
        let isSelected = k == kind
        return NotoText.text(k.title, size: 6.6)
            .foregroundStyle(isSelected ? .white : SettingsCardStyle.subtitleColor)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .padding(.horizontal, 6)
            .padding(.vertical, 5)
            .frame(maxWidth: .infinity)
            .background(Capsule().fill(isSelected ? V5P.blue : SettingsCardStyle.cardFill))
            .overlay(Capsule().stroke(isSelected ? Color.clear : SettingsCardStyle.cardBorder, lineWidth: 0.6))
            .contentShape(Capsule())
            .onTapGesture { kind = k }
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("communityRankingSegment_\(k.id)")
    }
}

enum CommunityRankingKind: Int, CaseIterable, Identifiable {
    case popularPosts
    case popularUsers
    case analysisAccuracy

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .popularPosts: return "人気投稿"
        case .popularUsers: return "人気ユーザー"
        case .analysisAccuracy: return "分析精度"
        }
    }

    var message: String {
        switch self {
        case .popularPosts:
            return "いいね数・保存数などの集計はBackend側の実装後に表示します。"
        case .popularUsers:
            return "フォロワー数・投稿への反応などの集計はBackend側の実装後に表示します。"
        case .analysisAccuracy:
            return "予想と実際の値動きの答え合わせには、投稿時点の予想を記録し後から変更できない\n仕組みがBackend側に必要です。改ざん防止の設計を固めてから実装します。"
        }
    }
}
