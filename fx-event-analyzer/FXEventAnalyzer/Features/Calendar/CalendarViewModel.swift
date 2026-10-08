import Foundation

/// SCR-010 経済カレンダー。表示中の月のカレンダー(前後の月の日を含む6週分)の
/// 期間を`GET /calendar`でまとめて取り、日ごとに分ける。日付の下の点と、
/// 選んだ日のイベント一覧の両方をこの結果から作る。
@MainActor
final class CalendarViewModel: ObservableObject {
    enum LoadState: Equatable {
        case loading
        case loaded
        case backendNotConfigured
        case error(String)
    }

    @Published private(set) var loadState: LoadState = .loading
    /// 表示中の月の1日(0時)。
    @Published private(set) var month: Date
    @Published private(set) var selectedDate: Date
    @Published private(set) var itemsByDay: [Date: [CalendarItem]] = [:]

    private let service: CalendarService
    let calendar: Calendar
    /// 前月・翌月への切り替えが重なったとき、古い結果で上書きしない。
    private var revision = 0

    init(apiClient: APIClient, today: Date = Date(), calendar: Calendar = CalendarViewModel.makeCalendar()) {
        service = CalendarService(apiClient: apiClient)
        self.calendar = calendar
        let day = calendar.startOfDay(for: today)
        selectedDate = day
        month = calendar.date(from: calendar.dateComponents([.year, .month], from: day)) ?? day
    }

    /// 参考画像どおり月曜始まり。
    static func makeCalendar() -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = Locale(identifier: "ja_JP")
        calendar.timeZone = .current
        calendar.firstWeekday = 2
        return calendar
    }

    /// カレンダーに並べる42日(6週)。先頭は月の1日を含む週の月曜。
    var gridDays: [Date] {
        let weekday = calendar.component(.weekday, from: month)
        let offset = (weekday - calendar.firstWeekday + 7) % 7
        guard let start = calendar.date(byAdding: .day, value: -offset, to: month) else { return [] }
        return (0..<42).compactMap { calendar.date(byAdding: .day, value: $0, to: start) }
    }

    func isInMonth(_ day: Date) -> Bool {
        calendar.isDate(day, equalTo: month, toGranularity: .month)
    }

    func items(on day: Date) -> [CalendarItem] {
        itemsByDay[calendar.startOfDay(for: day)] ?? []
    }

    var selectedItems: [CalendarItem] { items(on: selectedDate) }

    /// 日付の下の点(最大3つ)。重要度の高い順。
    func dots(on day: Date) -> [Importance] {
        let rank: (Importance) -> Int = { $0 == .high ? 0 : $0 == .medium ? 1 : 2 }
        return Array(items(on: day).map(\.importance).sorted { rank($0) < rank($1) }.prefix(3))
    }

    func load() async {
        revision += 1
        let current = revision
        let days = gridDays
        guard let first = days.first, let last = days.last,
              let end = calendar.date(byAdding: .day, value: 1, to: last) else { return }
        if itemsByDay.isEmpty { loadState = .loading }
        do {
            let response = try await service.fetch(from: first, to: end)
            guard current == revision else { return }
            itemsByDay = Dictionary(grouping: response.items) { calendar.startOfDay(for: $0.datetime) }
            loadState = .loaded
        } catch let error as APIError where error.isNotConfigured {
            guard current == revision else { return }
            loadState = .backendNotConfigured
        } catch {
            guard current == revision else { return }
            loadState = .error("カレンダーの取得に失敗しました。")
        }
    }

    func select(_ day: Date) {
        selectedDate = calendar.startOfDay(for: day)
        // 前後の月の日を選んだら、その月へ移る。
        if !isInMonth(selectedDate) {
            month = calendar.date(from: calendar.dateComponents([.year, .month], from: selectedDate)) ?? month
            Task { await load() }
        }
    }

    /// 前月(-1)・翌月(+1)へ。選んでいる日はその月の1日にする。
    func moveMonth(by value: Int) async {
        guard let next = calendar.date(byAdding: .month, value: value, to: month) else { return }
        month = next
        selectedDate = next
        await load()
    }

    // MARK: - 表示

    var monthTitle: String {
        let parts = calendar.dateComponents([.year, .month], from: month)
        return "\(parts.year ?? 0)年\(parts.month ?? 0)月"
    }

    /// 「10/2(金)のイベント」。
    var selectedTitle: String {
        let parts = calendar.dateComponents([.month, .day, .weekday], from: selectedDate)
        let weekday = calendar.shortWeekdaySymbols[(parts.weekday ?? 1) - 1]
        return "\(parts.month ?? 0)/\(parts.day ?? 0)(\(weekday))のイベント"
    }

    /// 月曜始まりの曜日(月〜日)。
    var weekdaySymbols: [String] {
        let symbols = calendar.veryShortWeekdaySymbols
        return (0..<7).map { symbols[(calendar.firstWeekday - 1 + $0) % 7] }
    }
}
