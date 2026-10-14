import SwiftUI

/// SCR-009 過去イベント比較。HQ指示(2026-10-14)「ピクセル単位で参考画像を完全再現して」:
/// 上に国旗・指標名・「国旗 国 ｜ 通貨」、その下に過去の発表の表
/// (日時 ⇕ / 結果(実績) / 予想(市場予想) / 前回(前回値) / 1分・5分・15分(pips))。
/// 寸法は参考画像(幅544px)を表の幅214ptに合わせた比率(約0.393)で取っている。
/// 行を押すとその回のイベント詳細(SCR-007)へ。遷移元は指標詳細の「過去イベント比較」。
struct HistoricalComparisonView: View {
    @StateObject private var viewModel: HistoricalComparisonViewModel
    @Binding var tabSelection: Int
    private let apiClient: APIClient
    @State private var planPrompt: String?
    /// 日時の並び(参考画像の「日時 ⇕」)。既定は新しい順。
    @State private var newestFirst = true
    @Environment(\.dismiss) private var dismiss

    init(apiClient: APIClient, indicatorId: String, indicatorName: String, fxPairId: String, fxPairSymbol: String, tabSelection: Binding<Int>) {
        self.apiClient = apiClient
        _viewModel = StateObject(wrappedValue: HistoricalComparisonViewModel(
            apiClient: apiClient,
            indicatorId: indicatorId,
            indicatorName: indicatorName,
            fxPairId: fxPairId,
            fxPairSymbol: fxPairSymbol
        ))
        _tabSelection = tabSelection
    }

    var body: some View {
        content
            .toolbar(.hidden, for: .navigationBar)
            .task { viewModel.load() }
            .planLimitPrompt($planPrompt, apiClient: apiClient, tabSelection: $tabSelection)
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .loading:
            loadingScaffold { LoadingView(caption: "読み込み中...") }
        case .backendNotConfigured:
            loadingScaffold { FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "過去の比較データはまだ利用できません。") }
        case .notFound:
            loadingScaffold { FXEmptyState(icon: "questionmark.circle", title: "データが見つかりません", message: "指定された指標・通貨ペアの組み合わせが存在しません。") }
        case .notEntitled:
            loadingScaffold { FXEmptyState(icon: "lock.fill", title: "この情報はご利用いただけません", message: "現在のプランでは過去の比較データを閲覧できません。") }
        case .loaded(let response):
            V5Viewport {
                V5Header(title: "過去イベント比較", back: true, onBack: { dismiss() })
                VStack(alignment: .leading, spacing: 8) {
                    header(response)
                    table(response)
                    if let limit = response.historyLimit, limit.isLimited {
                        planLimitRow(limit)
                    }
                }
                .frame(width: 214)
                .padding(.top, 8)
                .frame(width: V5P.W, height: 398, alignment: .top)
                .position(x: V5P.W / 2, y: 54 + 398 / 2)
                V5BottomBar(selected: $tabSelection)
            }
        case .error(let message):
            loadingScaffold { ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() }) }
        }
    }

    @ViewBuilder private func loadingScaffold(@ViewBuilder content: @escaping () -> some View) -> some View {
        V5Viewport {
            V5Header(title: "過去イベント比較", back: true, onBack: { dismiss() })
            content()
                .frame(width: V5P.W, height: V5P.H - 92, alignment: .center)
                .padding(.top, 53)
            V5BottomBar(selected: $tabSelection)
        }
    }

    // MARK: - 見出し(国旗・指標名・国｜通貨)

    private func header(_ response: ComparisonResponse) -> some View {
        let indicator = response.indicator
        let country = indicator.countryCode ?? ""
        let name = CountryFlag.indicatorDisplayText(indicator.name, countryCode: country, displayName: indicator.displayName)
        return HStack(spacing: 8) {
            CountryFlagView(countryCode: country, diameter: 23)
            VStack(alignment: .leading, spacing: 3) {
                NotoText.text(name, size: 10)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                HStack(spacing: 3) {
                    CountryFlagView(countryCode: country, diameter: 7)
                    NotoText.text(CountryFlag.japaneseName(forCountry: country), size: 6.5)
                    NotoText.text("｜", size: 6.5).opacity(0.6)
                    NotoText.text(indicator.currencyCode ?? "", size: 6.5)
                }
                .foregroundStyle(SettingsCardStyle.subtitleColor)
            }
            Spacer(minLength: 4)
            // HQ指示(2026-10-14)「右上に通貨ペア名を出して」: 表のpipsがどのペアの値動きかを示す。
            // 見た目はイベント詳細の値動き表のペア(重ねた国旗+USD/JPY)と同じ。
            HStack(spacing: 3) {
                OverlappingPairFlags(symbol: viewModel.fxPairSymbol, diameter: 9)
                NotoText.text(Self.pairLabel(viewModel.fxPairSymbol), size: 7.5)
                    .foregroundStyle(.white)
                    .lineLimit(1)
            }
            .frame(maxHeight: .infinity, alignment: .top)
            .padding(.trailing, 2)
        }
        .frame(height: 26)
        .padding(.leading, 4)
    }

    /// 「USDJPY」「USD/JPY」のどちらでも「USD/JPY」にする。
    static func pairLabel(_ symbol: String) -> String {
        let compact = symbol.replacingOccurrences(of: "/", with: "")
        guard compact.count == 6 else { return symbol }
        return "\(compact.prefix(3))/\(compact.suffix(3))"
    }

    // MARK: - 表

    /// 列の幅(参考画像の比率: 日時110px・数値3列235px・pips3列199px → 43 / 30.7×3 / 26×3)。
    private enum Column {
        static let date: CGFloat = 43
        static let value: CGFloat = 30.7
        static let pips: CGFloat = 26
    }

    private static let headerFill = Color(red: 0.06, green: 0.17, blue: 0.33)
    private static let tableFill = Color(red: 0.02, green: 0.09, blue: 0.20)
    private static let timeColor = Color(red: 0.36, green: 0.63, blue: 0.95)
    // HQ指示(2026-10-14)「プラスが赤・マイナスが緑」: イベント詳細など他の画面と同じ色。
    private static let plusColor = HomeView.changeUpColor
    private static let minusColor = HomeView.changeDownColor

    private func table(_ response: ComparisonResponse) -> some View {
        let events = newestFirst
            ? response.events.sorted { $0.releaseDatetime > $1.releaseDatetime }
            : response.events.sorted { $0.releaseDatetime < $1.releaseDatetime }
        let unit = response.indicator.unit
        let shape = RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius)
        return VStack(spacing: 0) {
            tableHeader
            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    ForEach(Array(events.enumerated()), id: \.element.id) { index, event in
                        if index > 0 {
                            Rectangle().fill(SettingsCardStyle.cardBorder.opacity(0.6)).frame(height: 0.5)
                        }
                        NavigationLink(value: AppRoute.eventDetail(id: event.id)) {
                            tableRow(event, unit: unit)
                        }
                        .buttonStyle(SettingsRowPressStyle())
                        .accessibilityIdentifier("historyEventRow")
                    }
                    if events.isEmpty {
                        NotoText.text("過去の発表はまだありません。", size: 7)
                            .foregroundStyle(SettingsCardStyle.subtitleColor)
                            .frame(maxWidth: .infinity, minHeight: 36)
                    }
                }
            }
        }
        .frame(width: 214, height: Self.tableHeight(rows: events.count, limited: response.historyLimit?.isLimited == true), alignment: .top)
        .background(Self.tableFill)
        .clipShape(shape)
        .overlay(shape.stroke(SettingsCardStyle.cardBorder, lineWidth: 0.7))
    }

    /// 表の高さ。行が少なければ行の分だけ、多ければ画面に入る高さで止めて中をスクロールする。
    static func tableHeight(rows: Int, limited: Bool) -> CGFloat {
        let content = 20 + CGFloat(max(rows, 1)) * 18.5
        return min(content, limited ? 318 : 340)
    }

    private var tableHeader: some View {
        HStack(spacing: 0) {
            Button { newestFirst.toggle() } label: {
                HStack(spacing: 2) {
                    Image(systemName: "calendar").font(.system(size: 6.5, weight: .semibold))
                    NotoText.text("日時", size: 6.5)
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 4.5, weight: .bold))
                }
                .foregroundStyle(.white)
                .frame(width: Column.date, height: 20)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(newestFirst ? "日時 新しい順" : "日時 古い順")
            divider
            headerCell("結果", "(実績)", width: Column.value)
            headerCell("予想", "(市場予想)", width: Column.value)
            headerCell("前回", "(前回値)", width: Column.value)
            divider
            headerCell("1分", "(pips)", width: Column.pips)
            headerCell("5分", "(pips)", width: Column.pips)
            headerCell("15分", "(pips)", width: Column.pips)
        }
        .frame(height: 20)
        .background(Self.headerFill)
        .overlay(alignment: .bottom) {
            Rectangle().fill(SettingsCardStyle.cardBorder).frame(height: 0.5)
        }
    }

    private var divider: some View {
        Rectangle().fill(SettingsCardStyle.cardBorder).frame(width: 0.5, height: 20)
    }

    private func headerCell(_ title: String, _ subtitle: String, width: CGFloat) -> some View {
        VStack(spacing: 0) {
            NotoText.text(title, size: 6.5).foregroundStyle(.white)
            NotoText.text(subtitle, size: 4.5)
                .foregroundStyle(SettingsCardStyle.subtitleColor)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(width: width, height: 20)
    }

    private func tableRow(_ event: ComparisonEventSummary, unit: String?) -> some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                Text(Self.dateString(event.releaseDatetime))
                    .font(.system(size: 6.5, weight: .semibold))
                    .foregroundStyle(.white)
                Text(Self.timeString(event.releaseDatetime))
                    .font(.system(size: 5, weight: .medium))
                    .foregroundStyle(Self.timeColor)
            }
            .monospacedDigit()
            .padding(.leading, 5)
            .frame(width: Column.date, alignment: .leading)
            valueCell(event.actual, unit: unit)
            valueCell(event.forecast, unit: unit)
            valueCell(event.previous, unit: unit)
            pipsCell(event.pipsByTimeframe?["1m"] ?? nil)
            pipsCell(event.pipsByTimeframe?["5m"] ?? nil)
            pipsCell(event.pipsByTimeframe?["15m"] ?? nil)
        }
        .frame(height: 18)
        .contentShape(Rectangle())
    }

    private func valueCell(_ value: Double?, unit: String?) -> some View {
        Text(Self.valueText(value, unit: unit))
            .font(.system(size: 6.5, weight: .medium))
            .monospacedDigit()
            .foregroundStyle(.white)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .frame(width: Column.value)
    }

    private func pipsCell(_ pips: Double?) -> some View {
        Text(Self.pipsText(pips))
            .font(.system(size: 6.5, weight: .medium))
            .monospacedDigit()
            .foregroundStyle(pips.map { $0 >= 0 ? Self.plusColor : Self.minusColor } ?? SettingsCardStyle.subtitleColor)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .padding(.trailing, 4)
            .frame(width: Column.pips, alignment: .trailing)
    }

    private func planLimitRow(_ limit: ComparisonResponse.HistoryLimit) -> some View {
        Button {
            planPrompt = "無料プランで比べられるのは、直近\(limit.maxForPlan)回分です。プレミアムプランなら\(limit.proMax)回分(約5年)と比べられます。"
        } label: {
            HStack(spacing: 3) {
                Image(systemName: "lock.fill").font(.system(size: 5.5))
                NotoText.text("無料プランは直近\(limit.maxForPlan)回分です。プレミアムなら\(limit.proMax)回分", size: 6.5)
                Image(systemName: "chevron.right").font(.system(size: 5.5, weight: .semibold))
            }
            .foregroundStyle(V5P.cyan)
        }
        .buttonStyle(.plain)
        .padding(.leading, 4)
    }

    // MARK: - 書式

    /// 「3.1%」のように、小数は最大2桁で末尾の0を省く。単位(%)はそのまま後ろに付ける。
    static func valueText(_ value: Double?, unit: String?) -> String {
        guard let value else { return "--" }
        let number = Self.numberFormatter.string(from: NSNumber(value: value)) ?? "\(value)"
        guard let unit, unit == "%" else { return number }
        return number + unit
    }

    /// 「+2.1」「-8.2」(小数1桁、符号付き)。
    static func pipsText(_ pips: Double?) -> String {
        guard let pips else { return "--" }
        return String(format: "%+.1f", pips)
    }

    private static let numberFormatter: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.minimumFractionDigits = 1
        formatter.maximumFractionDigits = 2
        formatter.minimumIntegerDigits = 1
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter
    }()

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "MM/dd"
        return formatter
    }()

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    @MainActor private static func dateString(_ date: Date) -> String {
        dateFormatter.timeZone = AppPreferences.shared.timeZone
        return dateFormatter.string(from: date)
    }

    @MainActor private static func timeString(_ date: Date) -> String {
        timeFormatter.timeZone = AppPreferences.shared.timeZone
        return timeFormatter.string(from: date)
    }
}
