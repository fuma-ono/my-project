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

    /// 副指標(api-design v1.35、HQ指示2026-10-25「前年の結果予想前回、前月の
    /// 結果予想前回が必要」)の列が無い指標(米国CPI以外)では非表示にする —
    /// `secondaryActual`・`secondaryForecast`・`secondaryPrevious`のいずれかが
    /// ある行が1件もない場合は列ごと隠す。
    private static func hasSecondaryColumn(_ events: [ComparisonEventSummary]) -> Bool {
        events.contains { $0.secondaryActual != nil || $0.secondaryForecast != nil || $0.secondaryPrevious != nil }
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

    /// 列の幅(参考画像の比率: 日時110px・数値3列235px・pips3列199px → 43 / 30.7×3 / 26×3)。
    /// 2026-10-14: 文字を8.5にしたらpips(「-24.5」)が詰まって見えたので、数値列を少し狭めてpips列を広げた。
    private enum Column {
        static let date: CGFloat = 40
        static let value: CGFloat = 28
        static let pips: CGFloat = 30
    }

    private static let headerFill = Color(red: 0.06, green: 0.17, blue: 0.33)
    private static let tableFill = Color(red: 0.02, green: 0.09, blue: 0.20)
    private static let timeColor = Color(red: 0.36, green: 0.63, blue: 0.95)
    // HQ指示(2026-10-14)「プラスが赤・マイナスが緑」: イベント詳細など他の画面と同じ色。
    private static let plusColor = HomeView.changeUpColor
    private static let minusColor = HomeView.changeDownColor

    /// 表の列を全部並べた時の本来の幅。現在は214相当(日時40+区切り0.5+
    /// 数値3列84+区切り0.5+pips3列90)で、過去イベント比較の表示幅(214)と
    /// ほぼ一致するが、この先列が増えれば(例: 前月・前年の追加)この値も
    /// 自動的に大きくなる — 下の`table(_:)`はこの値を表の実寸として使い、
    /// 表示幅(214)に収まらない分は横スクロールで見せる。
    /// `includeSecondary`: 前年(結果/予想/前回)に加え、前月(結果/予想/前回)
    /// の3列も含めるか(HQ指示2026-10-25「前年の結果予想前回、前月の結果
    /// 予想前回が必要」) — 含める場合、区切り線がもう1本増える。
    private static func tableContentWidth(includeSecondary: Bool) -> CGFloat {
        let dividers: CGFloat = includeSecondary ? 1.5 : 1.0
        return Column.date + dividers + Column.value * (includeSecondary ? 6 : 3) + Column.pips * 3
    }

    /// HQ指示(2026-10-25)「縦画面に入らないから縦画面の場合は横スクロールで
    /// pipsが見えるようにして」: 表の本来の幅(`tableContentWidth`)が表示幅
    /// (214)を超えても列を切り詰めず、`ScrollView(.horizontal)`で表全体を
    /// 横にスクロールできるようにした(以前は`.frame(width: 214)`で強制的に
    /// 切り詰めていたため、列を増やすと右側のpipsが見えなくなっていた)。
    private func table(_ response: ComparisonResponse) -> some View {
        let events = newestFirst
            ? response.events.sorted { $0.releaseDatetime > $1.releaseDatetime }
            : response.events.sorted { $0.releaseDatetime < $1.releaseDatetime }
        let unit = response.indicator.unit
        let shape = RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius)
        // HQ指示(2026-10-25)「過去イベント比較は前年の結果予想前回、前月の
        // 結果予想前回が必要」: 副指標(米国CPIのMoM%)がある指標だけ「前月」の
        // 結果/予想/前回の3列を出す(api-design v1.35)。
        let showSecondary = Self.hasSecondaryColumn(events)
        let height = Self.tableHeight(
            rows: events.count,
            limited: response.historyLimit?.isLimited == true,
            showSecondary: showSecondary
        )
        let tableBody = VStack(spacing: 0) {
            tableHeader(showSecondary: showSecondary)
            if events.isEmpty {
                // ユーザー指摘(2026-10-20)「過去の発表はまだありませんの文字の
                // 位置がおかしい、下すぎる」: 以前はScrollViewの中に
                // `minHeight: 36`で置いていたため、表の実際の高さ(0件時は
                // ヘッダーを除くと約22.5pt)より中身の希望高さの方が大きく、
                // ScrollViewの中でコンテンツが窮屈にはみ出し、文字が本来の
                // 表示領域からズレて見えていた。ScrollViewの外に出し、
                // 残りの領域いっぱいに`.center`で配置することで、表の
                // 実際の高さに関わらず常に中央に来るようにした。
                NotoText.text("過去の発表はまだありません。", size: 7)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .frame(maxHeight: .infinity, alignment: .center)
                    .frame(width: Self.tableContentWidth(includeSecondary: showSecondary))
            } else {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 0) {
                        ForEach(Array(events.enumerated()), id: \.element.id) { index, event in
                            if index > 0 {
                                Rectangle().fill(SettingsCardStyle.cardBorder.opacity(0.6)).frame(height: 0.5)
                            }
                            NavigationLink(value: AppRoute.eventDetail(id: event.id)) {
                                tableRow(event, unit: unit, showSecondary: showSecondary)
                            }
                            .buttonStyle(SettingsRowPressStyle())
                            .accessibilityIdentifier("historyEventRow")
                        }
                    }
                }
            }
        }
        .frame(height: height, alignment: .top)
        // HQ指示(2026-10-15): 表の外枠もグラデーションに(見出しの帯は今の色のまま)。
        .background(V5CardGradient.fill)
        .clipShape(shape)
        .overlay(shape.stroke(SettingsCardStyle.cardBorder, lineWidth: 0.7))

        // HQ指示(2026-10-26)「横スクロールバーを下に表示させてください」:
        // 列が多く(前年/前月+pips)横に隠れていることに気づきにくいため、
        // スクロールバーを常に表示するようにした。
        return ScrollView(.horizontal, showsIndicators: true) {
            tableBody
        }
        .frame(width: 214, height: height, alignment: .topLeading)
    }

    /// 表の高さ。行が少なければ行の分だけ、多ければ画面に入る高さで止めて中をスクロールする。
    /// `showSecondary`: 前年/前月のグループ見出し行(`groupHeaderHeight`)が
    /// 付く分、表全体の高さも増える(HQ指示2026-10-25)。
    static func tableHeight(rows: Int, limited: Bool, showSecondary: Bool) -> CGFloat {
        let header = headerHeight + (showSecondary ? groupHeaderHeight : 0)
        let content = header + CGFloat(max(rows, 1)) * (rowHeight + 0.5)
        return min(content, limited ? 312 : 334)
    }

    /// HQ指示(2026-10-14)「参考画像と比べて文字が小さすぎる。枠も小さい。見やすく」:
    /// 見出し20→26・行18→24、文字は表の見出し6.5→8.5・数字6.5→8.5・時刻5→6.5に上げた。
    /// 2026-10-14(2回目)の指定: 見出し・日付・数値・pips 7、見出しの下の小さな字 5、見出しの帯24・行22。
    static let headerHeight: CGFloat = 24
    static let rowHeight: CGFloat = 22
    /// HQ指示(2026-10-25)「前年の結果予想前回、前月の結果予想前回が必要」:
    /// 2つの結果/予想/前回を区別するグループ見出し行(「前年」「前月」)の高さ。
    static let groupHeaderHeight: CGFloat = 11

    /// HQ指示(2026-10-25): 列見出しの上にグループ見出し行を出して、
    /// 前年の結果/予想/前回と前月の結果/予想/前回を区別する。
    /// HQ指示(2026-10-26)「前年前月の線がないので結果、前回の縦線を伸ばして
    /// ください」: 以前はこの行に実際の区切り線が無く(`Color.clear`の余白
    /// だけ)、下の`tableHeader`側の区切り線ともつながっていなかったため、
    /// 「前年」「前月」の境目が分かりにくかった。`tableHeader`・`tableRow`と
    /// 同じ位置に実際の縦線(`groupDivider`)を置き、グループ見出し行〜列見出し
    /// 行〜各データ行まで縦線が一直線につながるようにした。
    private func groupHeaderRow(showSecondary: Bool) -> some View {
        HStack(spacing: 0) {
            Color.clear.frame(width: Column.date)
            groupDivider
            groupLabel("前年", width: Column.value * 3)
            if showSecondary {
                groupDivider
                groupLabel("前月", width: Column.value * 3)
            }
            groupDivider
            Color.clear.frame(width: Column.pips * 3)
        }
        .frame(height: Self.groupHeaderHeight)
    }

    private var groupDivider: some View {
        Rectangle().fill(SettingsCardStyle.cardBorder).frame(width: 0.5, height: Self.groupHeaderHeight)
    }

    private func groupLabel(_ title: String, width: CGFloat) -> some View {
        NotoText.text(title, size: 6)
            .foregroundStyle(SettingsCardStyle.subtitleColor)
            .frame(width: width, alignment: .center)
    }

    private func tableHeader(showSecondary: Bool) -> some View {
        VStack(spacing: 0) {
            groupHeaderRow(showSecondary: showSecondary)
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
                headerCell("予想", "(市場予想)", width: Column.value)
                headerCell("前回", "(前回値)", width: Column.value)
                // HQ指示(2026-10-25)「前年の結果予想前回、前月の結果予想前回が
                // 必要」: 副指標(米国CPIのMoM%)がある指標だけ、同じ3列構成を
                // もう1組出す(`groupHeaderRow`の「前月」label と対になる)。
                if showSecondary {
                    divider
                    headerCell("結果", "(実績)", width: Column.value)
                    headerCell("予想", "(市場予想)", width: Column.value)
                    headerCell("前回", "(前回値)", width: Column.value)
                }
                divider
                headerCell("1分", "(pips)", width: Column.pips)
                headerCell("5分", "(pips)", width: Column.pips)
                headerCell("15分", "(pips)", width: Column.pips)
            }
            .frame(height: Self.headerHeight)
        }
        .background(Self.headerFill)
        .overlay(alignment: .bottom) {
            Rectangle().fill(SettingsCardStyle.cardBorder).frame(height: 0.5)
        }
    }

    private var divider: some View {
        Rectangle().fill(SettingsCardStyle.cardBorder).frame(width: 0.5, height: Self.headerHeight)
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

    private func tableRow(_ event: ComparisonEventSummary, unit: String?, showSecondary: Bool) -> some View {
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
            // HQ指示(2026-10-26)「結果、前回の縦線を伸ばしてください」:
            // 列見出し(`tableHeader`)と同じ位置に縦線を入れ、グループ見出し行
            // 〜列見出し行〜各データ行まで縦線がつながって見えるようにした。
            rowDivider
            valueCell(event.actual, unit: unit)
            valueCell(event.forecast, unit: unit)
            valueCell(event.previous, unit: unit)
            if showSecondary {
                rowDivider
                valueCell(event.secondaryActual, unit: unit)
                valueCell(event.secondaryForecast, unit: unit)
                valueCell(event.secondaryPrevious, unit: unit)
            }
            rowDivider
            pipsCell(event.pipsByTimeframe?["1m"] ?? nil)
            pipsCell(event.pipsByTimeframe?["5m"] ?? nil)
            pipsCell(event.pipsByTimeframe?["15m"] ?? nil)
        }
        .frame(height: Self.rowHeight)
        .contentShape(Rectangle())
    }

    private var rowDivider: some View {
        Rectangle().fill(SettingsCardStyle.cardBorder.opacity(0.5)).frame(width: 0.5, height: Self.rowHeight)
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

    private func pipsCell(_ pips: Double?) -> some View {
        Text(Self.pipsText(pips))
            .font(.system(size: 7, weight: .medium))
            .monospacedDigit()
            .foregroundStyle(pips.map { $0 >= 0 ? Self.plusColor : Self.minusColor } ?? SettingsCardStyle.subtitleColor)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .padding(.trailing, 2)
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
        // 表示設定の日付の形式(年なし)とタイムゾーン(HQ指示 2026-10-15)。
        AppPreferences.shared.shortDateString(date)
    }

    @MainActor private static func timeString(_ date: Date) -> String {
        // 表示設定の時刻の形式(24時間/12時間)とタイムゾーン(HQ指示 2026-10-15)。
        AppPreferences.shared.timeString(date)
    }
}
