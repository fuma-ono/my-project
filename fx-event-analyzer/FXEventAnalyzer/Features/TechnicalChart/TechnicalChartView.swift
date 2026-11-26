import Charts
import SwiftUI

/// テクニカル分析チャート(ローソク足+SMA/EMA/ボリンジャー+重要価格帯、下にRSI/MACD/ストキャス)。
/// 入口は`TechnicalAnalysisGate`(価格由来の表示とテクニカル分析の両フラグがtrueのときだけ)。
/// 指標はBackendが計算した値をそのまま描く(この画面では再計算しない)。予測・AI分析は含まない。
///
/// 横軸は足の番号(0始まり)。週末・欠損の時間の空白を詰め、指標の配列とも同じ番号で対応させる。
/// 拡大縮小は行わず、横スクロール(`chartScrollableAxes`、iOS 17)で過去の足を見る。
///
/// TODO(イベントマーカー): 経済イベントの縦線は未実装。イベントの時刻から足の番号への対応と、通貨ペアに
/// 関係するイベントの取得(既存の`/calendar`・`/events`系)の設計が必要なため、別タスクにした。
struct TechnicalChartView: View {
    @StateObject private var viewModel: TechnicalChartViewModel
    @Binding var tabSelection: Int
    @Environment(\.dismiss) private var dismiss

    init(apiClient: APIClient, fxPairId: String, symbol: String, tabSelection: Binding<Int>) {
        _viewModel = StateObject(wrappedValue: TechnicalChartViewModel(apiClient: apiClient, fxPairId: fxPairId, symbol: symbol))
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
            scaffold { LoadingView(caption: "読み込み中...") }
        case .backendNotConfigured:
            scaffold { FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "チャートはまだ利用できません。") }
        case .unavailable:
            scaffold { FXEmptyState(icon: "lock.fill", title: "ご利用いただけません", message: "このチャートは現在ご利用いただけません。") }
        case .notFound:
            scaffold { FXEmptyState(icon: "questionmark.circle", title: "データが見つかりません", message: "指定された通貨ペアが存在しません。") }
        case .rightsUnconfirmed:
            scaffold { FXEmptyState(icon: "lock.fill", title: "準備中です", message: "このチャートに使う価格データの利用条件を確認中のため、まだ表示できません。") }
        case .empty:
            scaffold { FXEmptyState(icon: "chart.xyaxis.line", title: "データなし", message: "この時間足の価格データはまだありません。") }
        case .error(let message):
            scaffold { ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() }) }
        case .loaded(let data):
            V5Viewport {
                V5Header(title: "テクニカル分析", back: true, onBack: { dismiss() })
                ScrollView(showsIndicators: false) {
                    loadedBody(data)
                        .frame(width: 214)
                        .padding(.vertical, 6)
                        .frame(width: V5P.W)
                }
                .frame(width: V5P.W, height: 398)
                .position(x: V5P.W / 2, y: 54 + 398 / 2)
                V5BottomBar(selected: $tabSelection)
            }
        }
    }

    @ViewBuilder
    private func scaffold(@ViewBuilder content: @escaping () -> some View) -> some View {
        V5Viewport {
            V5Header(title: "テクニカル分析", back: true, onBack: { dismiss() })
            content()
                .frame(width: V5P.W, height: V5P.H - 92, alignment: .center)
                .padding(.top, 53)
            V5BottomBar(selected: $tabSelection)
        }
    }

    // MARK: - 読み込み後

    private func loadedBody(_ data: TechnicalData) -> some View {
        let count: Int = data.candles.count
        let indicators: TechnicalIndicators? = data.indicators
        let sma: [TechnicalPoint] = viewModel.showSMA ? TechnicalSeries.points(indicators?.sma20, candleCount: count) : []
        let ema: [TechnicalPoint] = viewModel.showEMA ? TechnicalSeries.points(indicators?.ema50, candleCount: count) : []
        let bbUpper: [TechnicalPoint] = viewModel.showBollinger ? TechnicalSeries.points(indicators?.bollinger?.upper, candleCount: count) : []
        let bbMiddle: [TechnicalPoint] = viewModel.showBollinger ? TechnicalSeries.points(indicators?.bollinger?.middle, candleCount: count) : []
        let bbLower: [TechnicalPoint] = viewModel.showBollinger ? TechnicalSeries.points(indicators?.bollinger?.lower, candleCount: count) : []
        let extra: [[TechnicalPoint]] = [sma, ema, bbUpper, bbLower]
        let range = TechnicalSeries.priceRange(candles: data.candles, extra: extra)
        let rawLow: Double = range?.low ?? 0
        let rawHigh: Double = range?.high ?? 1
        let pad: Double = max((rawHigh - rawLow) * 0.06, 0.0001)
        let yLow: Double = rawLow - pad
        let yHigh: Double = rawHigh + pad
        let zones: [TechnicalKeyZone] = viewModel.showKeyZones ? TechnicalSeries.clampedZones(data.keyZones, low: yLow, high: yHigh) : []
        let digits: Int = viewModel.symbol.hasSuffix("JPY") ? 3 : 5
        let timeframe: TechnicalTimeframe = TechnicalTimeframe(rawValue: data.timeframe ?? "") ?? viewModel.selectedTimeframe

        return VStack(alignment: .leading, spacing: 4) {
            headerCard(data)
            VStack(alignment: .leading, spacing: 4) {
                TechnicalPriceChart(
                    candles: data.candles,
                    sma: sma,
                    ema: ema,
                    bbUpper: bbUpper,
                    bbMiddle: bbMiddle,
                    bbLower: bbLower,
                    zones: zones,
                    yLow: yLow,
                    yHigh: yHigh,
                    digits: digits,
                    isDaily: timeframe.isDaily,
                    scrollX: $viewModel.scrollX
                )
                .frame(height: 150)
                if viewModel.lowerPanel != .none {
                    TechnicalLowerChart(
                        panel: viewModel.lowerPanel,
                        indicators: indicators,
                        candleCount: count,
                        scrollX: $viewModel.scrollX
                    )
                    .frame(height: 64)
                }
            }
            .padding(6)
            .background(GradientCardBackground())
            footerCard(data)
        }
    }

    private func headerCard(_ data: TechnicalData) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            NotoText.text(FXPairSymbol.displayName(viewModel.symbol), size: 11).foregroundStyle(.white)
            timeframePicker
            chipRow
            lowerPanelRow
        }
        .padding(8)
        .frame(width: 214, alignment: .leading)
        .background(GradientCardBackground())
    }

    private var timeframePicker: some View {
        HStack(spacing: 2) {
            ForEach(TechnicalTimeframe.allCases, id: \.self) { timeframe in
                let isSelected: Bool = viewModel.selectedTimeframe == timeframe
                Button { viewModel.selectedTimeframe = timeframe } label: {
                    NotoText.text(timeframe.label, size: 7)
                        .foregroundStyle(isSelected ? Color.white : SettingsCardStyle.subtitleColor)
                        .frame(maxWidth: .infinity)
                        .frame(height: 18)
                        .background(Capsule().fill(isSelected ? V5P.blue : Color.black.opacity(0.2)))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isSelected ? .isSelected : [])
            }
        }
    }

    private var chipRow: some View {
        HStack(spacing: 3) {
            TechnicalChip(title: "SMA20", color: V5P.yellow, isOn: viewModel.showSMA) { viewModel.showSMA.toggle() }
            TechnicalChip(title: "EMA50", color: V5P.cyan, isOn: viewModel.showEMA) { viewModel.showEMA.toggle() }
            TechnicalChip(title: "ボリンジャー", color: V5P.muted, isOn: viewModel.showBollinger) { viewModel.showBollinger.toggle() }
            TechnicalChip(title: "価格帯", color: V5P.blue, isOn: viewModel.showKeyZones) { viewModel.showKeyZones.toggle() }
        }
    }

    private var lowerPanelRow: some View {
        HStack(spacing: 3) {
            ForEach(TechnicalLowerPanel.allCases, id: \.self) { panel in
                TechnicalChip(title: panel.label, color: V5P.blue, isOn: viewModel.lowerPanel == panel) { viewModel.lowerPanel = panel }
            }
        }
    }

    private func footerCard(_ data: TechnicalData) -> some View {
        let notes: [String] = TechnicalText.notes(data.meta)
        let attribution: String? = TechnicalText.attribution(data.meta)
        return VStack(alignment: .leading, spacing: 3) {
            ForEach(notes, id: \.self) { note in
                NotoText.text(note, size: 6.5)
                    .foregroundStyle(V5P.yellow)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let attribution {
                NotoText.text(attribution, size: 6)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("technicalChartAttribution")
            }
            NotoText.text(TechnicalText.disclaimer, size: 6)
                .foregroundStyle(SettingsCardStyle.subtitleColor)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("technicalChartDisclaimer")
        }
        .frame(width: 214, alignment: .leading)
    }
}

/// 表示の切り替えの小さなボタン。
private struct TechnicalChip: View {
    let title: String
    let color: Color
    let isOn: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            NotoText.text(title, size: 6.5)
                .foregroundStyle(isOn ? Color.white : SettingsCardStyle.subtitleColor)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .padding(.horizontal, 5)
                .frame(height: 16)
                .background(Capsule().fill(isOn ? color.opacity(0.55) : Color.black.opacity(0.2)))
                .overlay(Capsule().stroke(color.opacity(0.7), lineWidth: 0.5))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

/// ローソク足+オーバーレイ+重要価格帯。
private struct TechnicalPriceChart: View {
    let candles: [TechnicalCandle]
    let sma: [TechnicalPoint]
    let ema: [TechnicalPoint]
    let bbUpper: [TechnicalPoint]
    let bbMiddle: [TechnicalPoint]
    let bbLower: [TechnicalPoint]
    let zones: [TechnicalKeyZone]
    let yLow: Double
    let yHigh: Double
    let digits: Int
    let isDaily: Bool
    @Binding var scrollX: Int

    private var visibleLength: Int { min(TechnicalSeries.visibleCandles, candles.count + 1) }

    static func zoneColor(_ kind: String) -> Color {
        switch kind {
        case "support": return V5P.green
        case "resistance": return V5P.red
        default: return V5P.cyan
        }
    }

    var body: some View {
        let count: Int = candles.count
        let minBody: Double = (yHigh - yLow) * 0.002
        Chart {
            ForEach(0..<zones.count, id: \.self) { index in
                let zone: TechnicalKeyZone = zones[index]
                RectangleMark(
                    xStart: .value("開始", 0),
                    xEnd: .value("終了", count),
                    yStart: .value("下限", zone.lower),
                    yEnd: .value("上限", zone.upper)
                )
                .foregroundStyle(Self.zoneColor(zone.kind).opacity(0.18))
            }
            ForEach(0..<count, id: \.self) { index in
                let candle: TechnicalCandle = candles[index]
                let isUp: Bool = candle.close >= candle.open
                let color: Color = isUp ? V5P.green : V5P.red
                let bodyBottom: Double = min(candle.open, candle.close)
                let bodyTop: Double = max(candle.open, candle.close)
                let bodyEnd: Double = bodyTop == bodyBottom ? bodyTop + minBody : bodyTop
                RuleMark(
                    x: .value("足", index),
                    yStart: .value("安値", candle.low),
                    yEnd: .value("高値", candle.high)
                )
                .lineStyle(StrokeStyle(lineWidth: 0.6))
                .foregroundStyle(color)
                RectangleMark(
                    x: .value("足", index),
                    yStart: .value("始値", bodyBottom),
                    yEnd: .value("終値", bodyEnd),
                    width: .fixed(2.2)
                )
                .foregroundStyle(color)
            }
            ForEach(sma) { point in
                LineMark(x: .value("足", point.index), y: .value("SMA20", point.value), series: .value("系列", "SMA20"))
                    .foregroundStyle(V5P.yellow)
                    .lineStyle(StrokeStyle(lineWidth: 0.9))
            }
            ForEach(ema) { point in
                LineMark(x: .value("足", point.index), y: .value("EMA50", point.value), series: .value("系列", "EMA50"))
                    .foregroundStyle(V5P.cyan)
                    .lineStyle(StrokeStyle(lineWidth: 0.9))
            }
            ForEach(bbUpper) { point in
                LineMark(x: .value("足", point.index), y: .value("上", point.value), series: .value("系列", "BBU"))
                    .foregroundStyle(V5P.muted)
                    .lineStyle(StrokeStyle(lineWidth: 0.7))
            }
            ForEach(bbMiddle) { point in
                LineMark(x: .value("足", point.index), y: .value("中", point.value), series: .value("系列", "BBM"))
                    .foregroundStyle(V5P.muted.opacity(0.6))
                    .lineStyle(StrokeStyle(lineWidth: 0.6, dash: [2, 2]))
            }
            ForEach(bbLower) { point in
                LineMark(x: .value("足", point.index), y: .value("下", point.value), series: .value("系列", "BBL"))
                    .foregroundStyle(V5P.muted)
                    .lineStyle(StrokeStyle(lineWidth: 0.7))
            }
        }
        .chartLegend(.hidden)
        .chartXScale(domain: -1...count)
        .chartYScale(domain: yLow...yHigh)
        .chartScrollableAxes(.horizontal)
        .chartXVisibleDomain(length: visibleLength)
        .chartScrollPosition(x: $scrollX)
        .chartPlotStyle { plot in
            plot
                .background(Color.black.opacity(0.18))
                .overlay(Rectangle().stroke(SettingsCardStyle.cardBorder, lineWidth: 0.8))
        }
        .chartYAxis {
            AxisMarks(position: .trailing, values: .automatic(desiredCount: 4)) { value in
                AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5)).foregroundStyle(SettingsCardStyle.cardBorder.opacity(0.8))
                AxisValueLabel {
                    if let price = value.as(Double.self) {
                        Text(String(format: "%.\(digits)f", price))
                            .font(.system(size: 5.5))
                            .foregroundStyle(SettingsCardStyle.subtitleColor)
                            .frame(width: 32, alignment: .leading)
                    }
                }
            }
        }
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 4)) { value in
                AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5)).foregroundStyle(SettingsCardStyle.cardBorder.opacity(0.8))
                AxisValueLabel {
                    if let index = value.as(Int.self) {
                        Text(axisLabel(index))
                            .font(.system(size: 5.5))
                            .foregroundStyle(SettingsCardStyle.subtitleColor)
                    }
                }
            }
        }
    }

    @MainActor
    private func axisLabel(_ index: Int) -> String {
        guard index >= 0, index < candles.count else { return "" }
        let date: Date = candles[index].time
        if isDaily { return AppPreferences.shared.shortDateString(date) }
        let day: String = AppPreferences.shared.shortDateString(date)
        let time: String = AppPreferences.shared.timeString(date)
        return "\(day) \(time)"
    }
}

/// 下のパネル(RSI / MACD / ストキャスティクス)。横軸・スクロール位置は上のチャートと共有する。
private struct TechnicalLowerChart: View {
    let panel: TechnicalLowerPanel
    let indicators: TechnicalIndicators?
    let candleCount: Int
    @Binding var scrollX: Int

    private var visibleLength: Int { min(TechnicalSeries.visibleCandles, candleCount + 1) }

    var body: some View {
        let rsi: [TechnicalPoint] = panel == .rsi ? TechnicalSeries.points(indicators?.rsi14, candleCount: candleCount) : []
        let macdLine: [TechnicalPoint] = panel == .macd ? TechnicalSeries.points(indicators?.macd?.macd, candleCount: candleCount) : []
        let macdSignal: [TechnicalPoint] = panel == .macd ? TechnicalSeries.points(indicators?.macd?.signal, candleCount: candleCount) : []
        let macdHist: [TechnicalPoint] = panel == .macd ? TechnicalSeries.points(indicators?.macd?.histogram, candleCount: candleCount) : []
        let stochK: [TechnicalPoint] = panel == .stoch ? TechnicalSeries.points(indicators?.stoch?.k, candleCount: candleCount) : []
        let stochD: [TechnicalPoint] = panel == .stoch ? TechnicalSeries.points(indicators?.stoch?.d, candleCount: candleCount) : []
        let domain: (low: Double, high: Double) = yDomain(macd: [macdLine, macdSignal, macdHist])
        VStack(alignment: .leading, spacing: 1) {
            NotoText.text(legend, size: 6).foregroundStyle(SettingsCardStyle.subtitleColor)
            Chart {
                if panel == .rsi {
                    RuleMark(y: .value("買われすぎ", 70)).lineStyle(StrokeStyle(lineWidth: 0.5, dash: [2, 2])).foregroundStyle(V5P.red.opacity(0.6))
                    RuleMark(y: .value("売られすぎ", 30)).lineStyle(StrokeStyle(lineWidth: 0.5, dash: [2, 2])).foregroundStyle(V5P.green.opacity(0.6))
                }
                if panel == .stoch {
                    RuleMark(y: .value("上", 80)).lineStyle(StrokeStyle(lineWidth: 0.5, dash: [2, 2])).foregroundStyle(V5P.red.opacity(0.6))
                    RuleMark(y: .value("下", 20)).lineStyle(StrokeStyle(lineWidth: 0.5, dash: [2, 2])).foregroundStyle(V5P.green.opacity(0.6))
                }
                ForEach(rsi) { point in
                    LineMark(x: .value("足", point.index), y: .value("RSI", point.value), series: .value("系列", "RSI"))
                        .foregroundStyle(V5P.cyan)
                        .lineStyle(StrokeStyle(lineWidth: 0.9))
                }
                ForEach(macdHist) { point in
                    BarMark(x: .value("足", point.index), y: .value("ヒストグラム", point.value), width: .fixed(2))
                        .foregroundStyle(point.value >= 0 ? V5P.green.opacity(0.6) : V5P.red.opacity(0.6))
                }
                ForEach(macdLine) { point in
                    LineMark(x: .value("足", point.index), y: .value("MACD", point.value), series: .value("系列", "MACD"))
                        .foregroundStyle(V5P.cyan)
                        .lineStyle(StrokeStyle(lineWidth: 0.9))
                }
                ForEach(macdSignal) { point in
                    LineMark(x: .value("足", point.index), y: .value("シグナル", point.value), series: .value("系列", "SIGNAL"))
                        .foregroundStyle(V5P.yellow)
                        .lineStyle(StrokeStyle(lineWidth: 0.9))
                }
                ForEach(stochK) { point in
                    LineMark(x: .value("足", point.index), y: .value("%K", point.value), series: .value("系列", "K"))
                        .foregroundStyle(V5P.cyan)
                        .lineStyle(StrokeStyle(lineWidth: 0.9))
                }
                ForEach(stochD) { point in
                    LineMark(x: .value("足", point.index), y: .value("%D", point.value), series: .value("系列", "D"))
                        .foregroundStyle(V5P.yellow)
                        .lineStyle(StrokeStyle(lineWidth: 0.9))
                }
            }
            .chartLegend(.hidden)
            .chartXScale(domain: -1...candleCount)
            .chartYScale(domain: domain.low...domain.high)
            .chartScrollableAxes(.horizontal)
            .chartXVisibleDomain(length: visibleLength)
            .chartScrollPosition(x: $scrollX)
            .chartPlotStyle { plot in
                plot
                    .background(Color.black.opacity(0.18))
                    .overlay(Rectangle().stroke(SettingsCardStyle.cardBorder, lineWidth: 0.8))
            }
            .chartXAxis(.hidden)
            .chartYAxis {
                AxisMarks(position: .trailing, values: .automatic(desiredCount: 3)) { value in
                    AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5)).foregroundStyle(SettingsCardStyle.cardBorder.opacity(0.8))
                    AxisValueLabel {
                        if let number = value.as(Double.self) {
                            Text(String(format: "%.2f", number))
                                .font(.system(size: 5.5))
                                .foregroundStyle(SettingsCardStyle.subtitleColor)
                                .frame(width: 32, alignment: .leading)
                        }
                    }
                }
            }
        }
    }

    private var legend: String {
        switch panel {
        case .none: return ""
        case .rsi: return "RSI(14)  青: RSI / 赤線: 70 / 緑線: 30"
        case .macd: return "MACD  青: MACD / 黄: シグナル / 棒: ヒストグラム"
        case .stoch: return "ストキャスティクス  青: %K / 黄: %D"
        }
    }

    private func yDomain(macd: [[TechnicalPoint]]) -> (low: Double, high: Double) {
        switch panel {
        case .rsi, .stoch:
            return (0, 100)
        case .macd:
            let range = TechnicalSeries.valueRange(macd)
            let low: Double = range?.low ?? -1
            let high: Double = range?.high ?? 1
            return (low, high)
        case .none:
            return (0, 1)
        }
    }
}
