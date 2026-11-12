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

/// ②③④共通の見出しカード(参考画像の各タブ直下にある「アイコン+タイトル+サブタイトル」行)。
struct StrategySectionHeaderCard: View {
    let icon: String
    let title: String
    let subtitle: String
    var iconColor: Color = V5P.cyan

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: icon).font(.system(size: 12, weight: .semibold)).foregroundStyle(iconColor)
            VStack(alignment: .leading, spacing: 1) {
                NotoText.text(title, size: 9).foregroundStyle(.white)
                NotoText.text(subtitle, size: 6).foregroundStyle(SettingsCardStyle.subtitleColor)
            }
            Spacer(minLength: 0)
        }
        .padding(8)
        .frame(width: 214, alignment: .leading)
        .background(GradientCardBackground())
    }
}

/// ②③④共通のカード枠(タイトル行+区切り線+中身)。参考画像の各カードの構成(アイコン付き
/// タイトル→区切り線→グラフ/ゲージ/進捗バー)をそのまま再現する。実データが無い項目は、
/// 架空の値を描かず、中身(`content`)側で「データ不足」「--」を表示する(HQ指示)。
struct StrategyInfoCard<Content: View>: View {
    let icon: String
    let title: String
    let iconColor: Color
    let trailing: AnyView?
    let content: Content

    init(
        icon: String,
        title: String,
        iconColor: Color = V5P.blue,
        trailing: AnyView? = nil,
        @ViewBuilder content: () -> Content
    ) {
        self.icon = icon
        self.title = title
        self.iconColor = iconColor
        self.trailing = trailing
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 9, weight: .bold)).foregroundStyle(iconColor)
                NotoText.text(title, size: 7.5).foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.85)
                Spacer(minLength: 4)
                if let trailing { trailing }
            }
            Rectangle().fill(SettingsCardStyle.cardBorder).frame(height: 0.5)
            content
        }
        .padding(9)
        .frame(width: 214, alignment: .leading)
        .background(GradientCardBackground())
    }
}

/// 通貨分析タブ(HQ指示のデザイン画像②)。この発表の対象通貨ペアに限り、既存の`StrategyRelease`
/// (タブ①と同じ、既に取得済みの実データ)から「イベント時の反応」を集計して見せる。通貨強弱指数・
/// 現在の為替レート・ファンダメンタルズ要因は、現時点でBackendのAPIから取得できる値が無いため、
/// 同じカード構成(折れ線グラフ・進捗バー・縦棒グラフ)の枠は保ったまま「データ不足」を表示する
/// (参考画像の構成を架空の値なしで再現する — HQ指示 2026-11-11)。
struct CurrencyAnalysisTabView: View {
    let pair: StrategyFxPair
    let analysis: StrategyAnalysis

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            StrategySectionHeaderCard(
                icon: "arrow.left.arrow.right.circle.fill",
                title: "通貨分析",
                subtitle: "主要通貨ペアの反応と傾向を分析"
            )

            HStack(spacing: 8) {
                CountryFlagView(currencyCode: String(pair.symbol.prefix(3)), diameter: 20)
                CountryFlagView(currencyCode: String(pair.symbol.suffix(3)), diameter: 20)
                NotoText.text(HistoricalComparisonView.pairLabel(pair.symbol), size: 9).foregroundStyle(.white)
                Spacer()
                V5Badge(text: "この発表の対象ペア", color: V5P.cyan)
            }
            .padding(9)
            .frame(width: 214, alignment: .leading)
            .background(GradientCardBackground())

            StrategyInfoCard(icon: "chart.xyaxis.line", title: "為替レート推移", iconColor: V5P.cyan) {
                StrategyTrendChart(points: nil, height: 70)
                NotoText.text("現在の為替レートは本画面では取得していません。", size: 6)
                    .foregroundStyle(SettingsCardStyle.subtitleColor.opacity(0.85))
            }

            StrategyInfoCard(
                icon: "bolt.fill", title: "イベント時の反応（実測値）", iconColor: V5P.cyan,
                trailing: AnyView(V5Badge(text: "分析対象 \(analysis.sampleWindow)回", color: V5P.cyan))
            ) {
                VStack(spacing: 5) {
                    StrategyProgressRow(
                        label: "往復(15分)",
                        percent: analysis.releases.roundTripRate(\.roundTrip15m),
                        color: V5P.blue
                    )
                    StrategyProgressRow(
                        label: "往復(60分)",
                        percent: analysis.releases.roundTripRate(\.roundTrip60m),
                        color: V5P.yellow
                    )
                }
                NotoText.text(
                    "直近の値動き: 5分 \(ValueFormat.number(analysis.releases.averagePips(\.pips5m), fractionDigits: 1, signed: true)) pips"
                        + " / 30分 \(ValueFormat.number(analysis.releases.averagePips(\.pips30m), fractionDigits: 1, signed: true)) pips",
                    size: 6
                )
                .foregroundStyle(SettingsCardStyle.subtitleColor)
            }

            StrategyInfoCard(icon: "waveform.path.ecg", title: "通貨特性", iconColor: V5P.blue) {
                VStack(spacing: 5) {
                    StrategyProgressRow(label: "反応強度", percent: nil, color: V5P.blue)
                    StrategyProgressRow(label: "継続性", percent: nil, color: V5P.cyan)
                    StrategyProgressRow(label: "リスク", percent: nil, color: V5P.red)
                }
                NotoText.text("通貨強弱指数・ファンダメンタルズ要因は現在対応していません。", size: 6)
                    .foregroundStyle(SettingsCardStyle.subtitleColor.opacity(0.85))
            }

            StrategyInfoCard(icon: "chart.bar.fill", title: "過去の傾向（月次）", iconColor: V5P.blue) {
                StrategyBarChart(values: nil, height: 56)
            }
        }
        .accessibilityIdentifier("strategyAnalysisCurrencyTab")
    }
}

/// 価格帯分析タブ(HQ指示のデザイン画像③)。重要な価格帯(レジスタンス・サポート)は
/// 現時点でBackendのAPIから取得できる値が無いため、架空の価格帯を一切描かず、ローソク足の
/// 枠組みと「データ不足」のカード構成だけを参考画像どおりに再現する。
struct PriceRangeAnalysisTabView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            StrategySectionHeaderCard(
                icon: "chart.bar.fill",
                title: "価格帯分析",
                subtitle: "重要な価格帯とサポート・レジスタンス"
            )

            StrategyInfoCard(icon: "chart.bar.xaxis", title: "価格帯チャート", iconColor: V5P.blue) {
                StrategyCandlestickPlaceholder(height: 100)
            }

            StrategyInfoCard(icon: "arrow.up.to.line", title: "重要な価格帯", iconColor: V5P.red) {
                VStack(spacing: 5) {
                    StrategyProgressRow(label: "レジスタンス", percent: nil, color: V5P.red)
                    StrategyProgressRow(label: "サポート", percent: nil, color: V5P.cyan)
                }
                NotoText.text("レジスタンス・サポートの価格帯データは現在対応していません。", size: 6)
                    .foregroundStyle(SettingsCardStyle.subtitleColor.opacity(0.85))
            }

            StrategyInfoCard(icon: "mappin.and.ellipse", title: "現在の分析", iconColor: V5P.blue) {
                NotoText.text("データ不足", size: 7).foregroundStyle(SettingsCardStyle.subtitleColor)
            }
        }
        .accessibilityIdentifier("strategyAnalysisPriceRangeTab")
    }
}

/// AI分析タブ(HQ指示のデザイン画像④)。AIによる総合評価・シナリオ分析は未実装のため、
/// 「AIが分析済みであるかのように表示しない」(HQ指示)。信頼度ゲージ・シナリオ比較の枠組みは
/// 参考画像どおりに再現しつつ、値は一切作らず「--」「データ不足」のままにする。
struct AIAnalysisTabView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            StrategySectionHeaderCard(
                icon: "sparkles",
                title: "AI分析",
                subtitle: "複数のデータを統合した総合分析"
            )

            VStack(spacing: 6) {
                StrategyCircularGauge(percent: nil, centerText: "--", centerSubtext: "総合信頼度", color: V5P.cyan, diameter: 64)
                NotoText.text("AIによる総合評価は未実装です", size: 7).foregroundStyle(SettingsCardStyle.subtitleColor)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .padding(.horizontal, 9)
            .frame(width: 214)
            .background(GradientCardBackground())

            StrategyInfoCard(icon: "doc.text.magnifyingglass", title: "分析結果", iconColor: V5P.cyan) {
                NotoText.text(
                    "AIによる総合評価・シナリオ分析は未実装です。実装され次第、根拠データとともに提供します。",
                    size: 6.5
                )
                .foregroundStyle(SettingsCardStyle.subtitleColor)
                .fixedSize(horizontal: false, vertical: true)
            }

            StrategyInfoCard(icon: "list.bullet.clipboard", title: "根拠データ", iconColor: V5P.blue) {
                NotoText.text("データ不足", size: 7).foregroundStyle(SettingsCardStyle.subtitleColor)
            }

            HStack(spacing: 6) {
                scenarioBox(title: "強気シナリオ", icon: "arrow.up.circle.fill", color: V5P.cyan)
                scenarioBox(title: "弱気シナリオ", icon: "arrow.down.circle.fill", color: V5P.red)
            }
        }
        .accessibilityIdentifier("strategyAnalysisAITab")
    }

    private func scenarioBox(title: String, icon: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 8, weight: .bold)).foregroundStyle(color)
                NotoText.text(title, size: 6.5).foregroundStyle(.white)
            }
            NotoText.text("データ不足", size: 6.5).foregroundStyle(SettingsCardStyle.subtitleColor)
        }
        .padding(8)
        .frame(width: 103, alignment: .leading)
        .background(GradientCardBackground())
    }
}
