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
            VStack(spacing: 0) {
                if indicators.isEmpty {
                    NotoText.text("条件に合う指標はありません。", size: 8)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                        .frame(maxWidth: .infinity, minHeight: 40)
                }
                ForEach(Array(indicators.enumerated()), id: \.element.id) { index, indicator in
                    if index > 0 { SettingsListSeparator() }
                    NavigationLink(value: AppRoute.indicatorDetail(id: indicator.id)) {
                        row(indicator)
                    }
                    .buttonStyle(SettingsRowPressStyle())
                    // スクショのテストは正式名(「米国CPI(消費者物価指数)」)で押す。
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(indicator.name)
                    .accessibilityAddTraits(.isButton)
                }
            }
            .frame(width: 214)
            .background(AccountCardBackground())
            .padding(.bottom, 6)
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
        let name = Self.listName(indicator.name, countryCode: indicator.countryCode)
        return HStack(spacing: 7) {
            VStack(alignment: .leading, spacing: 1) {
                if let date {
                    Text(Self.dateString(date))
                        .font(.system(size: 8.5, weight: .semibold))
                        .monospacedDigit()
                    Text(Self.timeString(date))
                        .font(.system(size: 7.5))
                        .monospacedDigit()
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                } else {
                    Text("--").font(.system(size: 8.5, weight: .semibold))
                }
            }
            .foregroundStyle(isNext ? .white : SettingsCardStyle.subtitleColor)
            .frame(width: 30, alignment: .leading)
            CountryFlagView(countryCode: indicator.countryCode, diameter: 16)
            VStack(alignment: .leading, spacing: 1) {
                NotoText.text(name, size: 8.5)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                NotoText.text(CountryFlag.japaneseName(forCountry: indicator.countryCode), size: 7)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
            }
            Spacer(minLength: 4)
            let colors = HomeView.importanceBadgeColors(indicator.importance)
            NotoText.text(indicator.importance.rawValue, size: 6.5)
                .tracking(-0.3)
                .foregroundStyle(.white)
                .frame(width: 36, height: 14)
                .background(colors.fill, in: Capsule())
                .overlay(Capsule().stroke(colors.border, lineWidth: 0.6))
        }
        .padding(.horizontal, 9)
        .frame(height: 36)
        .contentShape(Rectangle())
    }

    /// 一覧の名前。国名を外し、「CPI(消費者物価指数)」のように英字の略称+長い正式名のときだけ
    /// 「消費者物価指数（CPI）」と入れ替える(参考画像)。「雇用統計(非農業部門雇用者数)」
    /// 「GDP(改定値)」「製造業PMI(速報値)」などは入れ替えると意味が変わるので、元の順のまま。
    static func listName(_ name: String, countryCode: String) -> String {
        var body = name
        let country = CountryFlag.japaneseName(forCountry: countryCode)
        if body.hasPrefix(country) { body = String(body.dropFirst(country.count)) }
        guard let open = body.firstIndex(where: { $0 == "(" || $0 == "（" }),
              let close = body.lastIndex(where: { $0 == ")" || $0 == "）" }), open < close else { return body }
        let head = String(body[..<open]).trimmingCharacters(in: .whitespaces)
        let inner = String(body[body.index(after: open)..<close]).trimmingCharacters(in: .whitespaces)
        guard !head.isEmpty, !inner.isEmpty else { return body }
        let isAcronym = head.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber) }
        return isAcronym && inner.count >= 4 ? "\(inner)（\(head)）" : "\(head)（\(inner)）"
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
