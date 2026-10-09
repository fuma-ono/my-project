import Charts
import SwiftUI

/// SCR-008 相場反応詳細(HQ指示 2026-10-09の参考画像で作り直し)。上から、通貨ペアの
/// カード(国旗・USD/JPY・米ドル/円、発表60分後の価格と発表前からの変化)、
/// 1分足・5分足・15分足のローソク足チャート(発表の30分前〜60分後、発表時刻に縦線)、
/// 「値動きの分析」(数値から決まった型で作る文。AIの推測は使わない)。SCR-009への導線は
/// 指標詳細にある(HQ指示 2026-10-09「過去イベント比較の遷移元は指標詳細」)。
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
                    VStack(alignment: .leading, spacing: 6) {
                        priceCard(preReleasePrice: preReleasePrice, reactions: reactions)
                        analysisCard(reactions: reactions)
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
        return VStack(alignment: .leading, spacing: 5) {
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
                            .font(.system(size: 13, weight: .semibold))
                            .monospacedDigit()
                            .foregroundStyle(change >= 0 ? V5P.green : V5P.red)
                    }
                    Spacer(minLength: 0)
                    NotoText.text("発表\(MovementAnalysisText.label(latest.timeframe))後", size: 6.5)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                }
            }
            timeframeTabs
            chartSection
                .frame(height: 138)
        }
        .padding(8)
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
            LoadingView(caption: "データ取得中...")
        case .empty:
            // HQ指示(2026-10-09): データが無いときは架空の足を出さず「データなし」。
            FXEmptyState(icon: "chart.xyaxis.line", title: "データなし", message: "この時間足の価格データはまだありません。")
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
        if let text = MovementAnalysisText.build(
            reactions: reactions, actual: result?.actual, forecast: result?.forecast, unit: result?.unit,
            marketViewAbove: viewModel.indicator?.marketViewAbove, marketViewBelow: viewModel.indicator?.marketViewBelow
        ) {
            VStack(alignment: .leading, spacing: 4) {
                NotoText.text("値動きの分析", size: 11).foregroundStyle(.white)
                NotoText.text(text, size: 7.5)
                    .foregroundStyle(.white.opacity(0.85))
                    .lineSpacing(1.5)
                    .fixedSize(horizontal: false, vertical: true)
                // 1画面に収めるため、価格の説明もここにまとめた(HQ指示 2026-10-09)。
                NotoText.text("※ 一般的な見方で、今回の値動きの理由を断定するものではない。", size: 6)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(8)
            .frame(width: 214, alignment: .leading)
            .background(AccountCardBackground())
        }
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

    /// HQ指示(2026-10-09)の表示範囲: 発表時刻を基準に、1分足は前後15分(初動)、5分足は
    /// 前後60分(短期の流れ)、15分足は前後3時間(全体の流れ)。Backendの`window_from`/`window_to`
    /// を使い、無い古いBackendだけ同じ規則で計算する。データが無い部分に足は補わない。
    private var window: (from: Date, to: Date) {
        if let from = chart.windowFrom, let to = chart.windowTo { return (from, to) }
        let release = chart.releaseDatetime
        let minutes: Double = timeframe == "1m" ? 15 : timeframe == "5m" ? 60 : 180
        return (release.addingTimeInterval(-minutes * 60), release.addingTimeInterval(minutes * 60))
    }

    /// 足1本の秒数。端の足が枠にかからないよう、表示範囲の左右をこの分だけ広げる。
    private var stepSeconds: TimeInterval {
        switch timeframe {
        case "1m": return 60
        case "5m": return 300
        default: return 900
        }
    }

    /// 時刻の目盛りの間隔。1分足は5分、5分足は20分、15分足は1時間ごと(重ならない数にする)。
    private var labelMinutes: Int {
        switch timeframe {
        case "1m": return 5
        case "5m": return 20
        default: return 60
        }
    }

    /// 時刻の目盛り。表示範囲の始まりからではなく、5分・15分・30分ちょうどの時刻
    /// (05:40、05:45…)に置く。
    private var axisDates: [Date] {
        let step = TimeInterval(labelMinutes * 60)
        var date = Date(timeIntervalSince1970: (window.from.timeIntervalSince1970 / step).rounded(.up) * step)
        var dates: [Date] = []
        // 右端に近すぎる目盛りは文字が切れる(「06:…」)ので出さない。
        while date <= window.to.addingTimeInterval(-step / 2) {
            dates.append(date)
            date = date.addingTimeInterval(step)
        }
        return dates
    }

    private var points: [ChartPricePoint] {
        chart.prices.filter { $0.timestamp >= window.from && $0.timestamp <= window.to }
    }


    var body: some View {
        let points = points
        let lows = points.map(\.low)
        let highs = points.map(\.high)
        let minY = lows.min() ?? 0
        let maxY = highs.max() ?? 1
        let pad = max((maxY - minY) * 0.08, 0.0001)
        let width = candleWidth
        Chart {
            // HQ指示(2026-10-09)「縦の点線を、発表や発表時刻と分かるように」。
            RuleMark(x: .value("発表", chart.releaseDatetime))
                .foregroundStyle(V5P.cyan.opacity(0.8))
                .lineStyle(StrokeStyle(lineWidth: 0.8, dash: [3, 2]))
                .annotation(position: .top, alignment: .center, spacing: 1) {
                    Text("発表 \(AppPreferences.shared.timeString(chart.releaseDatetime))")
                        .font(.system(size: 6, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 3)
                        .padding(.vertical, 1)
                        .background(V5P.cyan.opacity(0.35), in: Capsule())
                }
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
        .chartXScale(domain: window.from.addingTimeInterval(-stepSeconds)...window.to.addingTimeInterval(stepSeconds))
        // HQ指示(2026-10-09)「数字ではなくローソク足の部分を枠で囲んで」: 目盛りの数字・時刻の
        // 外側ではなく、描画領域だけに角のない枠を付ける。
        .chartPlotStyle { plot in
            plot
                .background(Color.black.opacity(0.18))
                .overlay(Rectangle().stroke(SettingsCardStyle.cardBorder, lineWidth: 0.8))
        }
        .chartYAxis {
            AxisMarks(position: .trailing, values: .automatic(desiredCount: 4)) { value in
                // HQ指示(2026-10-09)「縦線横線がしっかり見えるように」。
                AxisGridLine(stroke: StrokeStyle(lineWidth: 0.6)).foregroundStyle(SettingsCardStyle.cardBorder.opacity(0.9))
                AxisValueLabel {
                    if let price = value.as(Double.self) {
                        // 「155」ではなく「155.00」のように小数点以下の桁をそろえる。
                        Text(String(format: "%.\(digits)f", price))
                            .font(.system(size: 6))
                            .foregroundStyle(SettingsCardStyle.subtitleColor)
                    }
                }
            }
        }
        .chartXAxis {
            AxisMarks(values: axisDates) { value in
                AxisGridLine(stroke: StrokeStyle(lineWidth: 0.6)).foregroundStyle(SettingsCardStyle.cardBorder.opacity(0.9))
                // 文字の中心を縦線に合わせる(既定では線の右に寄ってずれて見えた)。
                AxisValueLabel(centered: false, anchor: .top) {
                    if let date = value.as(Date.self) {
                        // イベント詳細の発表日時と同じく、アプリの設定の時間帯(SCR-018)で出す。
                        // 端末の時間帯で出していたため、発表14:07なのに05:55〜と出ていた。
                        Text(AppPreferences.shared.timeString(date))
                            .font(.system(size: 6))
                            .foregroundStyle(SettingsCardStyle.subtitleColor)
                    }
                }
            }
        }
        .accessibilityLabel("ローソク足チャート")
    }

    /// 本数に合わせた足の幅。描画領域(約160)を本数+2で割った6割で、すき間を詰める。
    private var candleWidth: CGFloat {
        let count = max(points.count, 1) + 2
        return max(1.5, min(9, 160 / CGFloat(count) * 0.6))
    }
}
