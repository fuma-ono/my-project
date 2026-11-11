import SwiftUI

/// HQ指示(2026-11-11「StrategyAnalysis 4タブUI実装」、デザイン画像準拠)。
/// 「トレード戦略分析」画面を、既存の内容(①イベント戦略 = 従来の過去5回分析)に加えて
/// 通貨分析・価格帯分析・AI分析の4タブ構成にする。
///
/// 重要: ②③④はバックエンドにまだ対応するデータが無い(通貨強弱・価格帯のレジスタンス/
/// サポート・AIによる総合評価のいずれも、現時点でAPIから取得できる値が存在しない)。
/// 画像内の数値はデザイン用のサンプルであり、架空の為替レート・価格帯・勝率・信頼度を
/// 実データであるかのように表示することは指示で明確に禁止されているため、この3タブは
/// 「データ不足」「分析対象外」を明示するプレースホルダーとして実装し、将来バックエンドが
/// 対応した際にそのまま実データへ差し替えられる構造(ヘッダー・タブ・カードは共通コンポーネント)
/// にとどめる。
enum StrategyAnalysisTab: Int, CaseIterable, Identifiable {
    case eventStrategy
    case currencyAnalysis
    case priceRangeAnalysis
    case aiAnalysis

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .eventStrategy: return "イベント戦略"
        case .currencyAnalysis: return "通貨分析"
        case .priceRangeAnalysis: return "価格帯分析"
        case .aiAnalysis: return "AI分析"
        }
    }

    var icon: String {
        switch self {
        case .eventStrategy: return "bolt.fill"
        case .currencyAnalysis: return "arrow.left.arrow.right.circle.fill"
        case .priceRangeAnalysis: return "chart.bar.fill"
        case .aiAnalysis: return "sparkles"
        }
    }

    /// UIテスト用の`accessibilityIdentifier`。CIで原因調査した結果、このアプリの既存の
    /// `accessibilityIdentifier`は(表示文言が日本語の画面でも)すべてASCIIのみで付けられており、
    /// 日本語の`title`をそのまま識別子に使うと、XCUITestの`matching(identifier:)`がボタンを
    /// 一度も見つけられず「タップ可能な要素が見つからない」という決定的な失敗になることが判明した
    /// (同じ構成のまま識別子だけASCIIに変えたところ再現しなくなった)。既存の慣習どおりASCIIのみにする。
    var testIdentifier: String {
        switch self {
        case .eventStrategy: return "eventStrategy"
        case .currencyAnalysis: return "currencyAnalysis"
        case .priceRangeAnalysis: return "priceRangeAnalysis"
        case .aiAnalysis: return "aiAnalysis"
        }
    }
}

/// 4タブの切り替え(214pt幅、HQ指示のデザイン画像のピル型セグメントを、既存の暗い配色・
/// 極小フォントのデザイン言語に合わせて再現)。
struct StrategyAnalysisTabBar: View {
    @Binding var selection: StrategyAnalysisTab

    var body: some View {
        HStack(spacing: 2) {
            ForEach(StrategyAnalysisTab.allCases) { tab in
                Button {
                    selection = tab
                } label: {
                    NotoText.text(tab.title, size: 6)
                        .foregroundStyle(selection == tab ? .white : SettingsCardStyle.subtitleColor)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 5)
                        .background(
                            Group {
                                if selection == tab {
                                    RoundedRectangle(cornerRadius: 9).fill(V5P.blue)
                                } else {
                                    Color.clear
                                }
                            }
                        )
                        // UIテストで断続的に「ボタンが見つからない/タップできない」が発生したため、
                        // 条件分岐の背景(Group)に依存せず、フレーム全体を明示的にタップ可能にする。
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("strategyAnalysisTab_\(tab.testIdentifier)")
            }
        }
        .padding(2)
        .frame(width: 214)
        .background(RoundedRectangle(cornerRadius: 11).fill(SettingsCardStyle.cardFill))
        .overlay(RoundedRectangle(cornerRadius: 11).stroke(SettingsCardStyle.cardBorder, lineWidth: 0.7))
    }
}

/// ヘッダー行の「PRO」表示(デザイン画像の王冠バッジ)。V5Header自体(共通コンポーネント、他の
/// 全画面で使われる)は変更せず、この画面のコンテンツ側に小さく添える。
struct StrategyAnalysisProBadge: View {
    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "crown.fill").font(.system(size: 7, weight: .bold))
            NotoText.text("PRO", size: 6.5).fontWeight(.bold)
        }
        .foregroundStyle(.black)
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(Capsule().fill(SubscriptionPalette.gold))
    }
}

/// ②③④共通の「まだ実データに対応していない」プレースホルダー。架空の数値を一切出さず、
/// どのデータが無いために分析できないかをそのまま文章で示す(HQ指示の「データに関する禁止事項」)。
struct StrategyAnalysisComingSoonCard: View {
    let icon: String
    let title: String
    let subtitle: String
    let missingDataDescription: String

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 11, weight: .semibold)).foregroundStyle(V5P.cyan)
                VStack(alignment: .leading, spacing: 1) {
                    NotoText.text(title, size: 9).foregroundStyle(.white)
                    NotoText.text(subtitle, size: 6.5).foregroundStyle(SettingsCardStyle.subtitleColor)
                }
            }
            Rectangle().fill(SettingsCardStyle.cardBorder).frame(height: 0.5)
            VStack(spacing: 6) {
                Image(systemName: "tray").font(.system(size: 18, weight: .regular)).foregroundStyle(SettingsCardStyle.subtitleColor)
                NotoText.text("分析対象外（データ不足）", size: 7.5).foregroundStyle(SettingsCardStyle.subtitleColor)
                NotoText.text(missingDataDescription, size: 6)
                    .foregroundStyle(SettingsCardStyle.subtitleColor.opacity(0.85))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
        }
        .padding(9)
        .frame(width: 214, alignment: .leading)
        .background(GradientCardBackground())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title)。分析対象外、データ不足。\(missingDataDescription)")
    }
}

/// 通貨分析タブ(HQ指示のデザイン画像②)。通貨強弱・為替チャート・イベント時の反応・
/// ファンダメンタルズ要因は、いずれも現時点でBackendのAPIから取得できる値が無い。
struct CurrencyAnalysisTabView: View {
    let pair: StrategyFxPair

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 8) {
                CountryFlagView(currencyCode: String(pair.symbol.prefix(3)), diameter: 18)
                CountryFlagView(currencyCode: String(pair.symbol.suffix(3)), diameter: 18)
                NotoText.text(HistoricalComparisonView.pairLabel(pair.symbol), size: 8.5).foregroundStyle(.white)
                Spacer()
            }
            .padding(9)
            .frame(width: 214, alignment: .leading)
            .background(GradientCardBackground())

            StrategyAnalysisComingSoonCard(
                icon: "arrow.left.arrow.right.circle.fill",
                title: "通貨分析",
                subtitle: "主要通貨ペアの反応と傾向を分析",
                missingDataDescription: "通貨強弱・為替チャート・ファンダメンタルズ要因は現在対応していません。"
            )
        }
        .accessibilityIdentifier("strategyAnalysisCurrencyTab")
    }
}

/// 価格帯分析タブ(HQ指示のデザイン画像③)。重要な価格帯(レジスタンス・サポート)は
/// 現時点でBackendのAPIから取得できる値が無いため、架空の価格帯を表示しない。
struct PriceRangeAnalysisTabView: View {
    var body: some View {
        StrategyAnalysisComingSoonCard(
            icon: "chart.bar.fill",
            title: "価格帯分析",
            subtitle: "重要な価格帯とサポート・レジスタンス",
            missingDataDescription: "レジスタンス・サポートの価格帯データは現在対応していません。"
        )
        .accessibilityIdentifier("strategyAnalysisPriceRangeTab")
    }
}

/// AI分析タブ(HQ指示のデザイン画像④)。AIによる総合評価・シナリオ分析は未実装のため、
/// 「AIが分析済みであるかのように表示しない」(HQ指示)。信頼度・勝率・シナリオは一切出さない。
struct AIAnalysisTabView: View {
    var body: some View {
        StrategyAnalysisComingSoonCard(
            icon: "sparkles",
            title: "AI分析",
            subtitle: "複数のデータを統合した総合分析",
            missingDataDescription: "AIによる総合評価・シナリオ分析は未実装です。実装され次第、根拠データとともに提供します。"
        )
        .accessibilityIdentifier("strategyAnalysisAITab")
    }
}
