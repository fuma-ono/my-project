import SwiftUI

/// SCR-005 指標一覧(HQ指示 2026-10-13の参考画像)。上に検索欄と絞り込み(すべて/重要度/
/// 国・地域/時間帯)、下に指標を次回発表の近い順に並べる。各行は発表日・時刻、国旗、
/// 指標名、国名、重要度で、押すとSCR-006 指標詳細へ移る。
struct IndicatorsView: View {
    @StateObject private var viewModel: IndicatorsViewModel
    @Binding var path: NavigationPath
    @Binding var tabSelection: Int
    private let apiClient: APIClient

    init(apiClient: APIClient, path: Binding<NavigationPath>, tabSelection: Binding<Int>) {
        self.apiClient = apiClient
        _viewModel = StateObject(wrappedValue: IndicatorsViewModel(apiClient: apiClient))
        _path = path
        _tabSelection = tabSelection
    }

    var body: some View {
        NavigationStack(path: $path) {
            content
                .toolbar(.hidden, for: .navigationBar)
                .navigationDestination(for: AppRoute.self) { route in
                    AppRouteDestinationView(route: route, apiClient: apiClient, tabSelection: $tabSelection)
                }
        }
        .task { viewModel.load() }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .loading:
            loadingScaffold { LoadingView(caption: "読み込み中...") }
        case .backendNotConfigured:
            loadingScaffold { FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "経済指標データはまだ利用できません。") }
        case .loaded:
            V5Viewport {
                V5Header(title: "指標一覧", back: false)
                VStack(alignment: .leading, spacing: 7) {
                    HelpSearchField(text: $viewModel.searchText, placeholder: "指標名・国・通貨ペアで検索")
                    filterBar
                    ListSortBar(countText: "\(viewModel.filtered.count)件", order: $viewModel.sortOrder)
                    list
                }
                .frame(width: 214)
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
            V5Header(title: "指標一覧", back: false)
            content()
                .frame(width: V5P.W, height: V5P.H - 92, alignment: .center)
                .padding(.top, 53)
            V5BottomBar(selected: $tabSelection)
        }
    }

    // MARK: - 絞り込み

    private var filterBar: some View {
        HStack(spacing: 4) {
            Button { viewModel.clearFilters() } label: {
                chip("すべて", active: !viewModel.hasFilters, dropdown: false)
            }
            .buttonStyle(.plain)
            Menu {
                Button("すべて") { viewModel.importanceFilter = nil }
                Button("HIGH") { viewModel.importanceFilter = .high }
                Button("MEDIUM") { viewModel.importanceFilter = .medium }
                Button("LOW") { viewModel.importanceFilter = .low }
            } label: {
                chip(viewModel.importanceFilter?.rawValue ?? "重要度", active: viewModel.importanceFilter != nil, dropdown: true)
            }
            Menu {
                Button("すべて") { viewModel.countryFilter = nil }
                ForEach(viewModel.countries, id: \.self) { code in
                    Button(CountryFlag.japaneseName(forCountry: code)) { viewModel.countryFilter = code }
                }
            } label: {
                chip(viewModel.countryFilter.map { CountryFlag.japaneseName(forCountry: $0) } ?? "国・地域", active: viewModel.countryFilter != nil, dropdown: true)
            }
            Menu {
                Button("すべて") { viewModel.timeBandFilter = nil }
                ForEach(IndicatorsViewModel.TimeBand.allCases) { band in
                    Button(band.label) { viewModel.timeBandFilter = band }
                }
            } label: {
                chip(viewModel.timeBandFilter.map { String($0.label.prefix(2)) } ?? "時間帯", active: viewModel.timeBandFilter != nil, dropdown: true)
            }
        }
    }

    private func chip(_ title: String, active: Bool, dropdown: Bool) -> some View {
        HStack(spacing: 2) {
            NotoText.text(title, size: 7.5)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            if dropdown {
                Image(systemName: "chevron.down").font(.system(size: 5.5, weight: .bold))
            }
        }
        .foregroundStyle(active ? .white : SettingsCardStyle.subtitleColor)
        .frame(maxWidth: .infinity)
        .frame(height: 20)
        .background(Capsule().fill(active ? V5P.blue : SettingsCardStyle.cardFill))
        .overlay(Capsule().stroke(active ? V5P.blue : SettingsCardStyle.cardBorder, lineWidth: 0.6))
    }

    // MARK: - 一覧

    private var list: some View {
        let indicators = viewModel.filtered
        return ScrollView(showsIndicators: false) {
            // HQ指示(2026-10-13)「画像のように各カードの外枠を変更して。中の配置は変更しない」:
            // 1枚の枠に区切り線で並べていたのを、1件ずつ別のカードにし、左端に重要度の色の帯を付けた。
            VStack(spacing: 5) {
                if indicators.isEmpty {
                    NotoText.text("条件に合う指標はありません。", size: 8)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                        .frame(maxWidth: .infinity, minHeight: 40)
                        .background(AccountCardBackground())
                }
                ForEach(indicators, id: \.id) { indicator in
                    NavigationLink(value: AppRoute.indicatorDetail(id: indicator.id)) {
                        row(indicator)
                            .background(rowCard(indicator.importance))
                    }
                    .buttonStyle(SettingsRowPressStyle())
                    // スクショのテストは正式名(「米国CPI(消費者物価指数)」)で押す。
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(indicator.name)
                    .accessibilityAddTraits(.isButton)
                }
            }
            .frame(width: 214)
            .padding(.bottom, 6)
        }
    }

    /// 1件分のカード。左端の帯は重要度の色(HIGHは赤、MEDIUMは黄、LOWは青)。
    private func rowCard(_ importance: Importance) -> some View {
        let shape = RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius)
        return shape.fill(V5CardGradient.fill)
            .overlay(alignment: .leading) {
                Rectangle().fill(Self.accentColor(importance)).frame(width: 3)
            }
            .clipShape(shape)
            .overlay(shape.stroke(SettingsCardStyle.cardBorder, lineWidth: 0.7))
    }

    /// 重要度の色の帯(要人発言一覧も同じ色を使う)。
    static func accentColor(_ importance: Importance) -> Color {
        switch importance {
        case .high: return HomeView.changeUpColor
        case .medium: return HomeView.importanceBadgeColors(.medium).border
        case .low: return V5P.blue
        }
    }

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "MM/dd"
        return formatter
    }()

    private func row(_ indicator: IndicatorSummary) -> some View {
        // 次回発表があればその日時、無ければ前回の発表日時を薄く出す。
        let date = indicator.nextReleaseDatetime ?? indicator.latestReleaseDatetime
        let isNext = indicator.nextReleaseDatetime != nil
        let parts = Self.listNameParts(indicator.name, countryCode: indicator.countryCode, displayName: indicator.displayName)
        // HQ指示(2026-10-13): 参考画像どおり、1行目に日時、2行目に左端の国旗・名前・国。
        // 2026-10-13(2回目)「日時と指標名との間の余白を詰めて縦幅を狭めて」「HIGHは枠の右側の中心に、＞を付けて」:
        // 日時と名前の間を3→0、上下の余白を5→4にし、重要度と＞は左側全体の縦の中心に置いた。
        let colors = HomeView.importanceBadgeColors(indicator.importance)
        return HStack(spacing: 5) {
            VStack(alignment: .leading, spacing: 0) {
                // HQ指示(2026-10-14)「日時の前に『次回』と小さく付ける。次回の予定が無い指標は
                // 『前回 10/01』のように前回の発表日を薄く出す」。
                HStack(spacing: 6) {
                    if let date {
                        // 2026-10-14「次回の文字サイズは日時と揃えて」: 6→7.5、2回目「0.5小さく」で7。
                        NotoText.text(isNext ? "次回" : "前回", size: 7)
                        Text(Self.dateString(date))
                        if isNext { Text(Self.timeString(date)) }
                    } else {
                        NotoText.text("予定なし", size: 7)
                    }
                }
                .font(.system(size: 7.5, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(isNext ? SettingsCardStyle.subtitleColor : SettingsCardStyle.subtitleColor.opacity(0.6))
                HStack(spacing: 7) {
                    CountryFlagView(countryCode: indicator.countryCode, diameter: 17)
                    VStack(alignment: .leading, spacing: 1) {
                        nameText(parts)
                        NotoText.text(CountryFlag.japaneseName(forCountry: indicator.countryCode), size: 7)
                            .foregroundStyle(SettingsCardStyle.subtitleColor)
                            .frame(height: 9, alignment: .leading)
                    }
                }
                // 名前は1行なので、行の高さは名前14+国名9でそろう。
                .frame(height: 24)
            }
            Spacer(minLength: 4)
            NotoText.text(indicator.importance.rawValue, size: 6.5)
                .tracking(-0.3)
                .foregroundStyle(.white)
                .frame(width: 36, height: 14)
                .background(colors.fill, in: Capsule())
                .overlay(Capsule().stroke(colors.border, lineWidth: 0.6))
            // HQ指示(2026-10-13)「＞は10.5にそろえる」: 検索結果の＞と同じ大きさ・色。
            Image(systemName: "chevron.right")
                .font(.system(size: 10.5, weight: .semibold))
                .foregroundStyle(V5P.muted)
        }
        .padding(.leading, 9)
        .padding(.trailing, 7)
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }

    /// HQ指示(2026-10-13)「指標名は1行分だけ。どうしても切れる場合は、最小限の文字サイズの変更で
    /// 自動調整」: 1行に固定し、入りきらないときだけ必要な分だけ縮める(下限は9.5の8割)。
    private func nameText(_ parts: (main: String, suffix: String?)) -> some View {
        let full = parts.suffix.map { "\(parts.main)（\($0)）" } ?? parts.main
        return NotoText.text(full, size: 9.5)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            // 高さ12では9.5の文字の行の高さに足りず、どの名前も縮んでいた(2026-10-13)。
            .frame(height: 14, alignment: .leading)
            .foregroundStyle(.white)
    }

    /// 名前と、カッコに入れる部分(無ければnil)。カッコの無い名前は先頭の国名を外す
    /// (下に国名を出すので。「米国小売売上高」→「小売売上高」)。
    static func listNameParts(_ name: String, countryCode: String, displayName: String? = nil) -> (main: String, suffix: String?) {
        let display = CountryFlag.indicatorDisplayName(name, countryCode: countryCode, displayName: displayName)
        if display.abbreviation != nil { return (display.main, display.abbreviation) }
        // カッコの無い名前は先頭の国名を外す(下に国名を出すので。「米国小売売上高」→「小売売上高」)。
        let country = CountryFlag.japaneseName(forCountry: countryCode)
        var main = display.main
        if displayName == nil, main.hasPrefix(country), main.count > country.count { main = String(main.dropFirst(country.count)) }
        return (main, nil)
    }

    /// 一覧の名前。指標詳細・検索と同じ規則(`CountryFlag.indicatorDisplayName`)で、カッコの中の
    /// 正式名+カッコの前の略称にする(HQ指示 2026-10-13「非農業部門雇用者数（雇用統計）の形に、
    /// 他もそのように」)。例: 「米国CPI(消費者物価指数)」→「消費者物価指数（CPI）」。
    static func listName(_ name: String, countryCode: String, displayName: String? = nil) -> String {
        let parts = listNameParts(name, countryCode: countryCode, displayName: displayName)
        return parts.suffix.map { "\(parts.main)（\($0)）" } ?? parts.main
    }

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    /// 「06:30」(桁をそろえる)。アプリの設定の時間帯で。
    @MainActor private static func timeString(_ date: Date) -> String {
        timeFormatter.timeZone = AppPreferences.shared.timeZone
        return timeFormatter.string(from: date)
    }

    /// 「10/03」。アプリの設定の時間帯で。
    @MainActor private static func dateString(_ date: Date) -> String {
        dateFormatter.timeZone = AppPreferences.shared.timeZone
        return dateFormatter.string(from: date)
    }
}
