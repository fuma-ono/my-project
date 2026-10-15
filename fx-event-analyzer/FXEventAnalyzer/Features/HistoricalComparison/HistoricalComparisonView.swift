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
                // HQ指示(2026-10-14)「表の背景色のデザインを参考画像と同じに」: 参考画像(幅940px)
                // どおり、見出し(国旗・指標名)と表を1枚の角丸カードに入れ、表の見出しはカードの中の
                // 角丸の枠、行は枠なしで区切り線だけ、行の右端に＞。
                VStack(alignment: .leading, spacing: 6) {
                    VStack(alignment: .leading, spacing: 7) {
                        header(response)
                            .padding(.horizontal, 6)
                            .padding(.top, 8)
                        table(response)
                            .padding(.horizontal, 4)
                            .padding(.bottom, 4)
                    }
                    .frame(width: Self.cardWidth)
                    .background(Self.cardGradient)
                    .clipShape(RoundedRectangle(cornerRadius: Self.cardRadius))
                    .overlay(RoundedRectangle(cornerRadius: Self.cardRadius).stroke(Self.cardStroke, lineWidth: 0.7))
                    if let limit = response.historyLimit, limit.isLimited {
                        planLimitRow(limit)
                    }
                }
                .frame(width: Self.cardWidth)
                .padding(.top, 6)
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
        // 2026-10-14: 文字を大きくしたら指標名が通貨ペアに押されて「消費者物価指数（C…」と切れたので、
        // 通貨ペアは2行目(国｜通貨)の右端に置き、指標名は1行目を全部使う。
        return HStack(spacing: 8) {
            // 2026-10-14「指標名と国旗はイベント詳細と同じ大きさに」: 国旗34・名前11。
            CountryFlagView(countryCode: country, diameter: 34)
            VStack(alignment: .leading, spacing: 3) {
                NotoText.text(name, size: 11)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                HStack(spacing: 3) {
                    // 「米国の横の小さい国旗は消して」(2026-10-14)。
                    NotoText.text(CountryFlag.japaneseName(forCountry: country), size: 8.5)
                    NotoText.text("｜", size: 8.5).opacity(0.6)
                    NotoText.text(indicator.currencyCode ?? "", size: 8.5)
                    Spacer(minLength: 4)
                    // HQ指示(2026-10-14)「通貨ペア名を出して」: 表のpipsがどのペアの値動きかを示す。
                    // 見た目はイベント詳細の値動き表のペア(重ねた国旗+USD/JPY)と同じ。
                    OverlappingPairFlags(symbol: viewModel.fxPairSymbol, diameter: 10)
                    NotoText.text(Self.pairLabel(viewModel.fxPairSymbol), size: 9)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                }
                .foregroundStyle(SettingsCardStyle.subtitleColor)
            }
        }
        .frame(height: 36)
        .padding(.horizontal, 2)
    }

    /// 「USDJPY」「USD/JPY」のどちらでも「USD/JPY」にする。
    static func pairLabel(_ symbol: String) -> String {
        let compact = symbol.replacingOccurrences(of: "/", with: "")
        guard compact.count == 6 else { return symbol }
        return "\(compact.prefix(3))/\(compact.suffix(3))"
    }

    // MARK: - 表

    /// 列の幅(参考画像940px→0.249倍: 日時172px・結果113・予想118・前回120・1分113・5分104・15分103 →
    /// 42 / 29×3 / 28・26・29。15分の列は右端の＞を含む)。表の幅は212(カード220の内側4ずつ)。
    private enum Column {
        static let date: CGFloat = 42
        static let value: CGFloat = 29
        static let pips: [CGFloat] = [28, 26, 29]
        static let chevron: CGFloat = 7
    }

    static let cardWidth: CGFloat = 220
    private static let cardRadius: CGFloat = 6
    /// カード: 参考画像の濃紺(上が少し明るい)。
    private static let cardGradient = LinearGradient(
        colors: [Color(red: 0.05, green: 0.13, blue: 0.27), Color(red: 0.03, green: 0.09, blue: 0.20)],
        startPoint: .top, endPoint: .bottom
    )
    private static let cardStroke = Color(red: 0.13, green: 0.27, blue: 0.48)
    /// 表の見出しの枠: カードより一段明るい紺と、明るめの青の線。
    private static let headerFill = Color(red: 0.06, green: 0.16, blue: 0.32)
    private static let headerStroke = Color(red: 0.20, green: 0.37, blue: 0.62)
    private static let columnDivider = Color(red: 0.16, green: 0.30, blue: 0.52)
    private static let rowDivider = Color(red: 0.12, green: 0.24, blue: 0.42)
    private static let timeColor = Color(red: 0.36, green: 0.63, blue: 0.95)
    // HQ指示(2026-10-14)「プラスが赤・マイナスが緑」: イベント詳細など他の画面と同じ色。
    private static let plusColor = HomeView.changeUpColor
    private static let minusColor = HomeView.changeDownColor

    private func table(_ response: ComparisonResponse) -> some View {
        let events = newestFirst
            ? response.events.sorted { $0.releaseDatetime > $1.releaseDatetime }
            : response.events.sorted { $0.releaseDatetime < $1.releaseDatetime }
        let unit = response.indicator.unit
        return VStack(spacing: 0) {
            tableHeader
            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    ForEach(Array(events.enumerated()), id: \.element.id) { index, event in
                        if index > 0 {
                            Rectangle().fill(Self.rowDivider).frame(height: 0.5)
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
        .frame(width: Self.cardWidth - 8, height: Self.tableHeight(rows: events.count, limited: response.historyLimit?.isLimited == true), alignment: .top)
    }

    /// 表の高さ。行が少なければ行の分だけ、多ければ画面に入る高さで止めて中をスクロールする。
    static func tableHeight(rows: Int, limited: Bool) -> CGFloat {
        let content = headerHeight + CGFloat(max(rows, 1)) * (rowHeight + 0.5)
        return min(content, limited ? 280 : 302)
    }

    /// HQ指示(2026-10-14)「参考画像と比べて文字が小さすぎる。枠も小さい。見やすく」:
    /// 見出し20→26・行18→24、文字は表の見出し6.5→8.5・数字6.5→8.5・時刻5→6.5に上げた。
    /// 2026-10-14(2回目)の指定: 見出し・日付・数値・pips 7、見出しの下の小さな字 5、見出しの帯24・行22。
    static let headerHeight: CGFloat = 24
    static let rowHeight: CGFloat = 22

    private var tableHeader: some View {
        HStack(spacing: 0) {
            Button { newestFirst.toggle() } label: {
                HStack(spacing: 2) {
                    Image(systemName: "calendar").font(.system(size: 6.5, weight: .semibold))
                    NotoText.text("日時", size: 7)
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 5, weight: .bold))
                }
                .foregroundStyle(.white)
                .frame(width: Column.date, height: Self.headerHeight)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(newestFirst ? "日時 新しい順" : "日時 古い順")
            divider
            headerCell("結果", "(実績)", width: Column.value)
            divider
            headerCell("予想", "(市場予想)", width: Column.value)
            divider
            headerCell("前回", "(前回値)", width: Column.value)
            divider
            headerCell("1分", "(pips)", width: Column.pips[0])
            divider
            headerCell("5分", "(pips)", width: Column.pips[1])
            divider
            headerCell("15分", "(pips)", width: Column.pips[2])
        }
        .frame(height: Self.headerHeight)
        .background(Self.headerFill, in: RoundedRectangle(cornerRadius: 5))
        .overlay(RoundedRectangle(cornerRadius: 5).stroke(Self.headerStroke, lineWidth: 0.7))
    }

    /// 参考画像は見出しの列の間すべてに縦線がある(上下は少し空ける)。線の分だけ列の幅を詰める。
    private var divider: some View {
        Rectangle().fill(Self.columnDivider).frame(width: 0.5, height: Self.headerHeight - 8)
            .frame(width: 0)
    }

    private func headerCell(_ title: String, _ subtitle: String, width: CGFloat) -> some View {
        VStack(spacing: 0) {
            NotoText.text(title, size: 7).foregroundStyle(.white)
            NotoText.text(subtitle, size: 5)
                .foregroundStyle(SettingsCardStyle.subtitleColor)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(width: width, height: Self.headerHeight)
    }

    private func tableRow(_ event: ComparisonEventSummary, unit: String?) -> some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                Text(Self.dateString(event.releaseDatetime))
                    .font(.system(size: 7, weight: .semibold))
                    .foregroundStyle(.white)
                Text(Self.timeString(event.releaseDatetime))
                    .font(.system(size: 5.5, weight: .medium))
                    .foregroundStyle(Self.timeColor)
            }
            .monospacedDigit()
            .padding(.leading, 5)
            .frame(width: Column.date, alignment: .leading)
            valueCell(event.actual, unit: unit)
            valueCell(event.forecast, unit: unit)
            valueCell(event.previous, unit: unit)
            pipsCell(event.pipsByTimeframe?["1m"] ?? nil, width: Column.pips[0])
            pipsCell(event.pipsByTimeframe?["5m"] ?? nil, width: Column.pips[1])
            pipsCell(event.pipsByTimeframe?["15m"] ?? nil, width: Column.pips[2] - Column.chevron)
            Image(systemName: "chevron.right")
                .font(.system(size: 5.5, weight: .semibold))
                .foregroundStyle(V5P.muted)
                .frame(width: Column.chevron, alignment: .center)
        }
        .frame(height: Self.rowHeight)
        .contentShape(Rectangle())
    }

    private func valueCell(_ value: Double?, unit: String?) -> some View {
        Text(Self.valueText(value, unit: unit))
            .font(.system(size: 7, weight: .medium))
            .monospacedDigit()
            .foregroundStyle(.white)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .frame(width: Column.value)
    }

    private func pipsCell(_ pips: Double?, width: CGFloat) -> some View {
        Text(Self.pipsText(pips))
            .font(.system(size: 7, weight: .medium))
            .monospacedDigit()
            .foregroundStyle(pips.map { $0 >= 0 ? Self.plusColor : Self.minusColor } ?? SettingsCardStyle.subtitleColor)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .frame(width: width)
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
