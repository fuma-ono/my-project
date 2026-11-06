import SwiftUI

/// Pro イベント別トレード戦略分析(HQ指示 2026-11-06、api-design v1.48)。イベント詳細(SCR-007)から開く。
/// 同じ指標の過去5回の発表の、発表後の値動きの回数を数えて出す(売買の推奨ではない)。画面の作りは
/// 要人発言の過去比較(`SpeakerComparisonView`)と同じ(V5Viewport・ヘッダー・214pt の列・カード)。
struct StrategyAnalysisView: View {
    @StateObject private var viewModel: StrategyAnalysisViewModel
    @Binding var tabSelection: Int
    @State private var planPrompt: String?
    @Environment(\.dismiss) private var dismiss
    private let apiClient: APIClient

    init(apiClient: APIClient, eventId: String, indicatorName: String, fxPairId: String?, tabSelection: Binding<Int>) {
        self.apiClient = apiClient
        _viewModel = StateObject(wrappedValue: StrategyAnalysisViewModel(
            apiClient: apiClient, eventId: eventId, indicatorName: indicatorName, fxPairId: fxPairId
        ))
        _tabSelection = tabSelection
    }

    var body: some View {
        V5Viewport {
            V5Header(title: "トレード戦略分析", back: true, onBack: { dismiss() })
            content
            V5BottomBar(selected: $tabSelection)
        }
        .toolbar(.hidden, for: .navigationBar)
        .task { await viewModel.load() }
        .planLimitPrompt($planPrompt, apiClient: apiClient, tabSelection: $tabSelection)
    }

    @ViewBuilder private var content: some View {
        switch viewModel.state {
        case .loading:
            centered { LoadingView(caption: "読み込み中...") }
        case .backendNotConfigured, .notFound, .noPair:
            centered {
                FXEmptyState(icon: "chart.xyaxis.line", title: StrategyAnalysisText.preparing, message: "比べられる過去の値動きがありません。")
            }
        case .locked:
            column { lockedCard }
        case .error(let message):
            centered { ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { Task { await viewModel.load() } }) }
        case .loaded(let pair, let analysis):
            column {
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 8) {
                        header(pair: pair, analysis: analysis)
                        summaryCard(analysis)
                        releasesCard(analysis)
                        notes
                    }
                    .padding(.bottom, 8)
                }
                .accessibilityIdentifier("strategyAnalysisContent")
            }
        }
    }

    private func column(@ViewBuilder _ content: () -> some View) -> some View {
        content()
            .frame(width: 214)
            .padding(.top, 8)
            .frame(width: V5P.W, height: 398, alignment: .top)
            .position(x: V5P.W / 2, y: 54 + 398 / 2)
    }

    private func centered(@ViewBuilder _ content: () -> some View) -> some View {
        content()
            .frame(width: V5P.W, height: V5P.H - 92, alignment: .center)
            .padding(.top, 53)
    }

    private func header(pair: StrategyFxPair, analysis: StrategyAnalysis) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                NotoText.text(viewModel.indicatorName, size: 10).foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.8)
                Spacer(minLength: 4)
                NotoText.text(pair.symbol, size: 8.5).foregroundStyle(V5P.cyan)
            }
            NotoText.text("過去\(analysis.sampleWindow)回の発表（新しい順）の値動き", size: 7)
                .foregroundStyle(SettingsCardStyle.subtitleColor)
            if !analysis.isReady {
                NotoText.text("\(StrategyAnalysisText.preparing)（比べられる発表が\(analysis.minimumSamples)回未満）", size: 7)
                    .foregroundStyle(V5P.cyan)
                    .accessibilityIdentifier("strategyAnalysisPreparing")
            }
        }
    }

    private func summaryCard(_ analysis: StrategyAnalysis) -> some View {
        card(title: "傾向（回数）") {
            summaryRow("発表直後（1分後）", StrategyAnalysisText.directionLine(analysis.summary.direction1m))
            summaryRow("1分の高値・安値ブレイク（15分以内）", StrategyAnalysisText.breakLine(analysis.summary.breaks15m))
            summaryRow("1分の高値・安値ブレイク（60分以内）", StrategyAnalysisText.breakLine(analysis.summary.breaks60m))
            summaryRow("15分後までの反応", StrategyAnalysisText.patternLine(analysis.summary.pattern15m))
            summaryRow("Sell the Fact", StrategyAnalysisText.sellTheFactLine(analysis.summary.sellTheFact))
        }
        .accessibilityIdentifier("strategyAnalysisSummary")
    }

    private func summaryRow(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            NotoText.text(label, size: 6.5).foregroundStyle(SettingsCardStyle.subtitleColor)
            NotoText.text(value, size: 7.5).foregroundStyle(.white).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func releasesCard(_ analysis: StrategyAnalysis) -> some View {
        card(title: "発表ごと") {
            if analysis.releases.isEmpty {
                NotoText.text("過去の発表がまだありません。", size: 7).foregroundStyle(SettingsCardStyle.subtitleColor)
            }
            ForEach(analysis.releases) { release in
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 4) {
                        NotoText.text(AppPreferences.shared.dateString(release.releaseDatetime), size: 7.5).foregroundStyle(.white)
                        Spacer(minLength: 2)
                        NotoText.text(StrategyAnalysisText.surprise(release), size: 6.5).foregroundStyle(SettingsCardStyle.subtitleColor)
                    }
                    NotoText.text(
                        "1分後 \(StrategyAnalysisText.direction(release))　ブレイク(15分) \(StrategyAnalysisText.breaks(high: release.highBreak15m, low: release.lowBreak15m))",
                        size: 6.5
                    )
                    .foregroundStyle(.white)
                    NotoText.text(
                        "反応 \(StrategyAnalysisText.pattern(release))　Sell the Fact \(StrategyAnalysisText.sellTheFact(release))",
                        size: 6.5
                    )
                    .foregroundStyle(.white)
                }
                .padding(.vertical, 2)
                if release.id != analysis.releases.last?.id {
                    Rectangle().fill(SettingsCardStyle.cardBorder.opacity(0.6)).frame(height: 0.5)
                }
            }
        }
    }

    private var notes: some View {
        VStack(alignment: .leading, spacing: 3) {
            ForEach(StrategyAnalysisText.notes, id: \.self) { note in
                NotoText.text(note, size: 6).foregroundStyle(SettingsCardStyle.subtitleColor).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 4)
    }

    private var lockedCard: some View {
        Button {
            planPrompt = "トレード戦略分析はプレミアムプランの機能です。過去5回の発表の値動きの傾向(高値・安値ブレイク、反応、Sell the Fact)を確認できます。"
        } label: {
            card(title: "トレード戦略分析") {
                HStack(spacing: 6) {
                    PastReleaseLockBadge(size: 10)
                    NotoText.text("プレミアムプランで解放", size: 8).foregroundStyle(V5P.cyan)
                    Spacer()
                    Image(systemName: "chevron.right").font(.system(size: 8, weight: .semibold)).foregroundStyle(V5P.cyan)
                }
                NotoText.text("過去5回の発表の値動きの傾向を、回数で確認できます。", size: 7)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("strategyAnalysisLocked")
    }

    private func card(title: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            NotoText.text(title, size: 8.5).foregroundStyle(.white)
            Rectangle().fill(SettingsCardStyle.cardBorder).frame(height: 0.5)
            content()
        }
        .padding(8)
        .frame(width: 214, alignment: .leading)
        .background(GradientCardBackground())
    }
}
