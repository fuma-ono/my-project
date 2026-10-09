import Charts
import SwiftUI

/// SCR-008 相場反応詳細(HQ指示 2026-10-09の参考画像で作り直し)。上から、通貨ペアの
/// カード(国旗・USD/JPY・米ドル/円、発表60分後の価格と発表前からの変化)、
/// 1分足・5分足・15分足のローソク足チャート(発表の30分前〜60分後、発表時刻に縦線)、
/// 「値動きの分析」(数値から決まった型で作る文。AIの推測は使わない)、SCR-009への導線。
struct MovementDetailView: View {
    @StateObject private var viewModel: MovementDetailViewModel
    @Binding var tabSelection: Int
    @Environment(\.dismiss) private var dismiss

    /// チャートの足の種類(参考画像のタブ)。
    static let candleTimeframes = ["1m", "5m", "15m"]

    init(apiClient: APIClient, eventId: String, indicatorId: String, fxPairId: String, symbol: String, indicatorName: String, releaseDatetime: Date, tabSelection: Binding<Int>) {
        _viewModel = StateObject(wrappedValue: MovementDetailViewModel(
            apiClient: apiClient,
            eventId: eventId,
            indicatorId: indicatorId,
            fxPairId: fxPairId,
            symbol: symbol,
            indicatorName: indicatorName,
            releaseDatetime: releaseDatetime,
            initialTimeframe: "1m"
        ))
        _tabSelection = tabSelection
    }

    var body: some View {
        content
            .toolbar(.hidden, for: .navigationBar)
            .task { viewModel.load() }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .loading:
            loadingScaffold { LoadingView(caption: "読み込み中...") }
        case .backendNotConfigured:
            loadingScaffold { FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "値動き情報はまだ利用できません。") }
        case .notFound:
            loadingScaffold { FXEmptyState(icon: "questionmark.circle", title: "データが見つかりません", message: "指定されたイベント・通貨ペアの組み合わせが存在しません。") }
        case .notEntitled:
            loadingScaffold { FXEmptyState(icon: "lock.fill", title: "この情報はご利用いただけません", message: "現在のプランでは値動き情報を閲覧できません。") }
        case .loaded(let preReleasePrice, let reactions):
            V5Viewport {
                V5Header(title: "相場反応詳細", back: true, onBack: { dismiss() })
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 8) {
                        priceCard(preReleasePrice: preReleasePrice, reactions: reactions)
                        analysisCard(reactions: reactions)
                        comparisonLink
                    }
                    .frame(width: 214)
                    .padding(.vertical, 6)
                    .frame(width: V5P.W)
                }
                .frame(width: V5P.W, height: 398)
                .position(x: V5P.W / 2, y: 54 + 398 / 2)
                V5BottomBar(selected: $tabSelection)
            }
        case .error(let message):
            loadingScaffold { ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() }) }
        }
    }

    // MARK: - 通貨ペア・価格・チャート

    private func priceCard(preReleasePrice: Double?, reactions: [ReactionTimeframeEntry]) -> some View {
        let symbol = viewModel.symbol
        let latest = reactions.last { $0.analysisStatus == .ready && $0.postReleasePrice != nil }
        let digits = symbol.hasSuffix("JPY") ? 2 : 4
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 7) {
                HStack(spacing: -4) {
                    CountryFlagView(currencyCode: String(symbol.prefix(3)), diameter: 20)
                    CountryFlagView(currencyCode: String(symbol.suffix(3)), diameter: 20)
                }
                VStack(alignment: .leading, spacing: 1) {
                    NotoText.text(FXPairSymbol.displayName(symbol), size: 11).foregroundStyle(.white)
                    NotoText.text(HomeCurrencyPairEditorViewModel.names(symbol), size: 7.5).foregroundStyle(SettingsCardStyle.subtitleColor)
                }
                Spacer()
            }
            if let latest, let price = latest.postReleasePrice {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(ValueFormat.number(price, fractionDigits: digits))
                        .font(.system(size: 17, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(.white)
                    if let pre = preReleasePrice {
                        let change = price - pre
                        let percent = pre == 0 ? 0 : change / pre * 100
                        Text("\(ValueFormat.number(change, fractionDigits: digits, signed: true)) (\(ValueFormat.number(percent, fractionDigits: 2, signed: true))%)")
                            .font(.system(size: 11, weight: .semibold))
                            .monospacedDigit()
                            .foregroundStyle(change >= 0 ? V5P.green : V5P.red)
                    }
                }
            }
            timeframeTabs
            chartSection
                .frame(height: 112)
            if let latest, latest.postReleasePrice != nil {
                // HQ指示(2026-10-09): 価格の意味の説明は価格の横ではなくチャートの下に置く。
                NotoText.text("※ 価格は発表\(MovementAnalysisText.label(latest.timeframe))後、変化は発表直前との比較です。", size: 6.5)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
            }
        }
        .padding(10)
        .frame(width: 214, alignment: .leading)
        .background(AccountCardBackground())
    }

    private var timeframeTabs: some View {
        HStack(spacing: 0) {
            ForEach(Self.candleTimeframes, id: \.self) { timeframe in
                let isSelected = viewModel.selectedTimeframe == timeframe
                Button { viewModel.selectedTimeframe = timeframe } label: {
                    NotoText.text(MovementAnalysisText.label(timeframe), size: 8.5)
                        .foregroundStyle(isSelected ? .white : SettingsCardStyle.subtitleColor)
                        .frame(maxWidth: .infinity)
                        .frame(height: 20)
                        .background(RoundedRectangle(cornerRadius: 5).fill(isSelected ? V5P.blue : .clear))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isSelected ? .isSelected : [])
            }
        }
        .padding(2)
        .background(RoundedRectangle(cornerRadius: 7).stroke(SettingsCardStyle.cardBorder, lineWidth: 0.7))
    }

    @ViewBuilder
    private var chartSection: some View {
        switch viewModel.chartState {
        case .loading:
            LoadingView(caption: "チャートを読み込み中...")
        case .empty:
            FXEmptyState(icon: "chart.xyaxis.line", title: "チャートデータがありません", message: "この時間軸のチャートデータはまだ取得されていません。")
        case .error(let message):
            ErrorView(title: "チャート取得に失敗しました", message: message, onRetry: { viewModel.retryChart() })
        case .loaded(let chart):
            CandleChart(chart: chart, digits: viewModel.symbol.hasSuffix("JPY") ? 2 : 4, timeframe: viewModel.selectedTimeframe)
        }
    }

    // MARK: - 値動きの分析

    @ViewBuilder
    private func analysisCard(reactions: [ReactionTimeframeEntry]) -> some View {
        let result = viewModel.eventSnapshot
        if let text = MovementAnalysisText.build(reactions: reactions, actual: result?.actual, forecast: result?.forecast, unit: result?.unit) {
            VStack(alignment: .leading, spacing: 5) {
                NotoText.text("値動きの分析", size: 11).foregroundStyle(.white)
                NotoText.text(text, size: 8)
                    .foregroundStyle(.white.opacity(0.85))
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
                NotoText.text("※ 実際の値動きの数値から自動で作成しています。値動きの理由の推測は含みません。", size: 6.5)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(10)
            .frame(width: 214, alignment: .leading)
            .background(AccountCardBackground())
        }
    }

    /// SCR-009 過去の比較へ(スクショのテストはこの行から進む)。
    private var comparisonLink: some View {
        NavigationLink(value: AppRoute.historicalComparison(
            indicatorId: viewModel.indicatorId,
            indicatorName: viewModel.indicatorName,
            fxPairId: viewModel.fxPairId,
            fxPairSymbol: viewModel.symbol
        )) {
            HStack {
                NotoText.text("過去の値動きと比較する", size: 9).foregroundStyle(.white)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(SettingsCardStyle.chevronColor)
            }
            .padding(.horizontal, 10)
            .frame(width: 214, height: 30)
            .background(AccountCardBackground())
            .contentShape(Rectangle())
        }
        .buttonStyle(SettingsRowPressStyle())
    }

    @ViewBuilder private func loadingScaffold(@ViewBuilder content: @escaping () -> some View) -> some View {
        V5Viewport {
            V5Header(title: "相場反応詳細", back: true, onBack: { dismiss() })
            content()
                .frame(width: V5P.W, height: V5P.H - 92, alignment: .center)
                .padding(.top, 53)
            V5BottomBar(selected: $tabSelection)
        }
    }
}

/// ローソク足(上昇は緑、下落は赤)と、発表時刻の縦線。価格は右側、時刻は下に出す。
private struct CandleChart: View {
    let chart: ChartResponse
    let digits: Int
    let timeframe: String

    /// HQ指示(2026-10-09)「時刻を5分ごとに」: 1分足は発表の10分前〜20分後を出し、
    /// 時刻は5分ごと。5分足・15分足は30分前〜60分後のままなので、5分ごとだと
    /// 文字が重なるため15分・30分ごとにする。
    private var window: (from: Date, to: Date) {
        let release = chart.releaseDatetime
        if timeframe == "1m" {
            return (release.addingTimeInterval(-10 * 60), release.addingTimeInterval(20 * 60))
        }
        return (release.addingTimeInterval(-30 * 60), release.addingTimeInterval(60 * 60))
    }

    private var labelMinutes: Int {
        switch timeframe {
        case "1m": return 5
        case "5m": return 15
        default: return 30
        }
    }

    private var points: [ChartPricePoint] {
        chart.prices.filter { $0.timestamp >= window.from && $0.timestamp <= window.to }
    }

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        formatter.timeZone = .current
        return formatter
    }()

    var body: some View {
        let points = points
        let lows = points.map(\.low)
        let highs = points.map(\.high)
        let minY = lows.min() ?? 0
        let maxY = highs.max() ?? 1
        let pad = max((maxY - minY) * 0.08, 0.0001)
        let width = candleWidth
        Chart {
            RuleMark(x: .value("発表", chart.releaseDatetime))
                .foregroundStyle(V5P.cyan.opacity(0.7))
                .lineStyle(StrokeStyle(lineWidth: 0.8, dash: [3, 2]))
            ForEach(points) { point in
                let color = point.close >= point.open ? V5P.green : V5P.red
                RuleMark(
                    x: .value("時刻", point.timestamp),
                    yStart: .value("安値", point.low),
                    yEnd: .value("高値", point.high)
                )
                .lineStyle(StrokeStyle(lineWidth: 0.7))
                .foregroundStyle(color)
                RectangleMark(
                    x: .value("時刻", point.timestamp),
                    yStart: .value("始値", min(point.open, point.close)),
                    yEnd: .value("終値", max(point.open, point.close) + (point.open == point.close ? pad * 0.05 : 0)),
                    width: .fixed(width)
                )
                .foregroundStyle(color)
            }
        }
        .chartYScale(domain: (minY - pad)...(maxY + pad))
        .chartXScale(domain: window.from...window.to)
        .chartYAxis {
            AxisMarks(position: .trailing, values: .automatic(desiredCount: 4)) { value in
                // HQ指示(2026-10-09)「縦線横線がしっかり見えるように」。
                AxisGridLine(stroke: StrokeStyle(lineWidth: 0.6)).foregroundStyle(SettingsCardStyle.cardBorder.opacity(0.9))
                AxisValueLabel {
                    if let price = value.as(Double.self) {
                        Text(ValueFormat.number(price, fractionDigits: digits))
                            .font(.system(size: 6))
                            .foregroundStyle(SettingsCardStyle.subtitleColor)
                    }
                }
            }
        }
        .chartXAxis {
            AxisMarks(values: .stride(by: .minute, count: labelMinutes)) { value in
                AxisGridLine(stroke: StrokeStyle(lineWidth: 0.6)).foregroundStyle(SettingsCardStyle.cardBorder.opacity(0.9))
                AxisValueLabel {
                    if let date = value.as(Date.self) {
                        Text(Self.timeFormatter.string(from: date))
                            .font(.system(size: 6))
                            .foregroundStyle(SettingsCardStyle.subtitleColor)
                    }
                }
            }
        }
        .accessibilityLabel("ローソク足チャート")
    }

    /// 本数に合わせた足の幅(画面幅160ほどに収める)。
    private var candleWidth: CGFloat {
        let count = max(points.count, 1)
        return max(1, min(5, 110 / CGFloat(count)))
    }
}
