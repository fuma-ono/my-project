import Combine
import Foundation

enum IndicatorsState: Equatable {
    case loading
    case backendNotConfigured
    case loaded([IndicatorSummary])
    case error(String)
}

/// SCR-005 指標一覧(HQ指示 2026-10-13の参考画像)。指標を次回発表の近い順に並べ、
/// 検索(指標名・国・通貨ペア)と、重要度・国/地域・時間帯で絞り込む。指標の数は少ない
/// ので、一覧は1回で取り、検索と絞り込みは端末の中で行う(入力のたびに通信しない)。
@MainActor
final class IndicatorsViewModel: ObservableObject {
    /// 時間帯(次回発表の時刻、アプリの設定の時間帯で判定)。
    enum TimeBand: String, CaseIterable, Identifiable {
        case earlyMorning, morning, afternoon, night

        var id: String { rawValue }

        var label: String {
            switch self {
            case .earlyMorning: return "早朝（0〜6時）"
            case .morning: return "午前（6〜12時）"
            case .afternoon: return "午後（12〜18時）"
            case .night: return "夜（18〜24時）"
            }
        }

        static func of(hour: Int) -> TimeBand {
            switch hour {
            case 0..<6: return .earlyMorning
            case 6..<12: return .morning
            case 12..<18: return .afternoon
            default: return .night
            }
        }
    }

    @Published private(set) var state: IndicatorsState = .loading
    @Published var searchText: String = ""
    @Published var importanceFilter: Importance?
    @Published var countryFilter: String?
    @Published var timeBandFilter: TimeBand?
    /// HQ指示(2026-10-14)「重要度順をつけて」。既定は日付順(次回発表の近い順)。
    @Published var sortOrder: ListSortOrder = .date

    private let apiClient: APIClient
    private let calendar: Calendar

    init(apiClient: APIClient, calendar: Calendar? = nil) {
        self.apiClient = apiClient
        self.calendar = calendar ?? {
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = AppPreferences.shared.timeZone
            return calendar
        }()
    }

    func load() {
        state = .loading
        Task { await fetch() }
    }

    var hasFilters: Bool { importanceFilter != nil || countryFilter != nil || timeBandFilter != nil }

    func clearFilters() {
        importanceFilter = nil
        countryFilter = nil
        timeBandFilter = nil
    }

    /// 一覧にある国(国・地域の絞り込みの選択肢)。
    var countries: [String] {
        guard case .loaded(let indicators) = state else { return [] }
        return Array(Set(indicators.map(\.countryCode))).sorted()
    }

    /// 検索と絞り込みを通した一覧。次回発表の近い順、次回が無いものは後ろに名前順。
    var filtered: [IndicatorSummary] {
        guard case .loaded(let indicators) = state else { return [] }
        let byDate = indicators
            .filter { matches($0) }
            .sorted { lhs, rhs in
                switch (lhs.nextReleaseDatetime, rhs.nextReleaseDatetime) {
                case let (l?, r?): return l < r
                case (.some, .none): return true
                case (.none, .some): return false
                case (.none, .none): return lhs.name < rhs.name
                }
            }
        return sortOrder.apply(byDate, importance: \.importance)
    }

    func matches(_ indicator: IndicatorSummary) -> Bool {
        if let importanceFilter, indicator.importance != importanceFilter { return false }
        if let countryFilter, indicator.countryCode != countryFilter { return false }
        if let timeBandFilter {
            guard let next = indicator.nextReleaseDatetime,
                  TimeBand.of(hour: calendar.component(.hour, from: next)) == timeBandFilter else { return false }
        }
        return Self.matchesSearch(indicator, query: searchText)
    }

    /// HQ指示(2026-10-29)「雇用統計と検索したらNFPしか出ていないけど失業率
    /// なども出すようにして」: 同じ発表(雇用統計=Employment Situation)で
    /// まとめて公表される指標でも、指標名(`indicator.name`)自体にその発表名を
    /// 含まない指標(米国失業率・米国平均時給、どちらも名前は「米国失業率」
    /// 「米国平均時給」で「雇用統計」を含まない)は、検索語が発表名と一致しても
    /// 従来マッチしなかった(米国雇用統計(非農業部門雇用者数)=NFPだけは名前に
    /// 「雇用統計」を含むため、偶然マッチしていた)。`indicator.code`をキーに、
    /// 同じ発表でまとめて出したい追加の検索語をここで補う。グループ分けは
    /// バックエンドの`src/ingestion/mappings/indicators.ts`のコメント
    /// (「Same release (Employment Situation) as US_NFP」等)に基づく実際の
    /// 組み合わせ。CPI/コアCPI・PPI/コアPPIは指標名自体に「CPI」「PPI」を
    /// 含み既に一緒に出るため、ここに追加する必要はない。
    static let releaseGroupKeywords: [String: [String]] = [
        "US_NFP": ["雇用統計"],
        "US_UNEMPLOYMENT_RATE": ["雇用統計"],
        "US_AVG_HOURLY_EARNINGS": ["雇用統計"],
    ]

    /// 指標名・英語名・コード・国名・通貨で探す。「USD/JPY」「usdjpy」のような通貨ペアなら、
    /// そのどちらかの通貨の指標を出す。
    static func matchesSearch(_ indicator: IndicatorSummary, query: String) -> Bool {
        let keyword = query.trimmingCharacters(in: .whitespaces)
        guard !keyword.isEmpty else { return true }
        let compact = keyword.uppercased().replacingOccurrences(of: "/", with: "").replacingOccurrences(of: " ", with: "")
        if compact.count == 6, compact.allSatisfy(\.isLetter) {
            let base = String(compact.prefix(3)), quote = String(compact.suffix(3))
            if indicator.currencyCode == base || indicator.currencyCode == quote { return true }
        }
        let haystack = ([
            indicator.name, indicator.nameEn ?? "", indicator.code, indicator.currencyCode,
            CountryFlag.japaneseName(forCountry: indicator.countryCode), indicator.countryCode,
        ] + (releaseGroupKeywords[indicator.code] ?? [])).joined(separator: " ").lowercased()
        return haystack.contains(keyword.lowercased())
    }

    private func fetch() async {
        let endpoint = Endpoint(path: "indicators", queryItems: [
            URLQueryItem(name: "sort", value: "next_release"),
            URLQueryItem(name: "limit", value: "100"),
        ])
        do {
            let response: IndicatorsListResponse = try await apiClient.send(endpoint)
            state = .loaded(response.data)
        } catch let error as APIError where error.isNotConfigured {
            state = .backendNotConfigured
        } catch {
            state = .error("指標一覧の取得に失敗しました。")
        }
    }
}
