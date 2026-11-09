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
    private let plan: PlanStore
    private(set) var calendar: Calendar
    /// 前月・翌月への切り替えが重なったとき、古い結果で上書きしない。
    private var revision = 0
    /// 先読み済み・取得済みの月(1日0時に正規化)。含まれていれば`load()`は
    /// 通信せずそのまま表示する(HQ指示 2026-10-24「月を開いた瞬間に日付だけ
    /// 出て、重要度の点が遅れて浮いてくる」対策: 表示中の月の前後1か月を
    /// 裏で先読みしておく)。
    private var loadedMonths: Set<Date> = []
    /// `applyPreferences`でカレンダー(タイムゾーン・週の開始曜日)を作り直す
    /// たびに増やす。先読みのTaskが完了した時点でこれが変わっていれば、
    /// 古いカレンダーで計算した結果を後から書き込まない。
    private var calendarEpoch = 0

    init(apiClient: APIClient, today: Date = Date(), calendar: Calendar = CalendarViewModel.makeCalendar(), plan: PlanStore? = nil) {
        service = CalendarService(apiClient: apiClient)
        self.plan = plan ?? .shared
        self.calendar = calendar
        let day = calendar.startOfDay(for: today)
        selectedDate = day
        month = calendar.date(from: calendar.dateComponents([.year, .month], from: day)) ?? day
    }

    /// 既定は月曜始まり(参考画像)。HQ指示(2026-10-15)「週の開始曜日をカレンダーに反映」で、
    /// 表示設定の週の開始曜日(`firstWeekday`: 1=日曜, 2=月曜)とタイムゾーンを受け取れるようにした。
    nonisolated static func makeCalendar(timeZone: TimeZone = .current, firstWeekday: Int = 2) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = Locale(identifier: "ja_JP")
        calendar.timeZone = timeZone
        calendar.firstWeekday = firstWeekday
        return calendar
    }

    /// 表示設定(週の開始曜日・タイムゾーン)が変わったら、カレンダーを作り直して読み直す。
    func applyPreferences(timeZone: TimeZone, firstWeekday: Int) async {
        guard calendar.timeZone != timeZone || calendar.firstWeekday != firstWeekday else { return }
        calendar = Self.makeCalendar(timeZone: timeZone, firstWeekday: firstWeekday)
        calendarEpoch += 1
        // 古いカレンダー(タイムゾーン・週の開始曜日)で計算した日付キーは
        // 新しいカレンダーの下では無効なので、先読みキャッシュも作り直す。
        itemsByDay = [:]
        loadedMonths = []
        selectedDate = calendar.startOfDay(for: selectedDate)
        month = calendar.date(from: calendar.dateComponents([.year, .month], from: selectedDate)) ?? month
        await load()
    }

    /// カレンダーに並べる日。先頭は月の1日を含む週の月曜で、月の最後の日を含む週まで
    /// (HQ指示 2026-10-08「11/2〜8の週は不要」。月によって4〜6週)。
    var gridDays: [Date] {
        let weekday = calendar.component(.weekday, from: month)
        let offset = (weekday - calendar.firstWeekday + 7) % 7
        let daysInMonth = calendar.range(of: .day, in: .month, for: month)?.count ?? 30
        let weeks = (offset + daysInMonth + 6) / 7
        guard let start = calendar.date(byAdding: .day, value: -offset, to: month) else { return [] }
        return (0..<(weeks * 7)).compactMap { calendar.date(byAdding: .day, value: $0, to: start) }
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
        guard let gridFirst = days.first, let last = days.last,
              let gridEnd = calendar.date(byAdding: .day, value: 1, to: last) else { return }
        // プランで見られる範囲の外(前後の月の日)はBackendが403を返すので、範囲内だけ取る。
        let first = max(gridFirst, plan.limits.calendarEarliestFrom)
        let end = min(gridEnd, plan.limits.calendarLatestTo)
        guard first < end else {
            itemsByDay = [:]
            loadedMonths = []
            loadState = .loaded
            return
        }
        // 前後の月への移動で既に先読み済みなら、通信せずそのまま表示する
        // (HQ指示 2026-10-24: 日付だけ先に出て点が遅れて浮いてくるのを防ぐ)。
        if loadedMonths.contains(month) {
            loadState = .loaded
            prefetchAdjacentMonths()
            return
        }
        if itemsByDay.isEmpty { loadState = .loading }
        do {
            let response = try await service.fetch(from: first, to: end, timeZone: calendar.timeZone)
            guard current == revision else { return }
            mergeItems(response.items)
            loadedMonths.insert(month)
            loadState = .loaded
            prefetchAdjacentMonths()
        } catch let error as APIError where error.isNotConfigured {
            guard current == revision else { return }
            loadState = .backendNotConfigured
        } catch {
            guard current == revision else { return }
            loadState = .error("カレンダーの取得に失敗しました。")
        }
    }

    /// 表示中の月の前後1か月を裏で取得し、`itemsByDay`に加えておく(ベスト
    /// エフォート: 失敗しても画面の表示状態は変えず、次に`load()`されたときに
    /// 取り直せるよう`loadedMonths`から外すだけ)。実際にその月へ移動した
    /// ときは`load()`が`loadedMonths`を見て通信せずそのまま表示する。
    private func prefetchAdjacentMonths() {
        let epoch = calendarEpoch
        for offset in [-1, 1] {
            guard let targetMonth = calendar.date(byAdding: .month, value: offset, to: month),
                  !loadedMonths.contains(targetMonth),
                  let range = gridRange(forMonth: targetMonth) else { continue }
            let first = max(range.first, plan.limits.calendarEarliestFrom)
            let end = min(range.end, plan.limits.calendarLatestTo)
            guard first < end else { continue }
            loadedMonths.insert(targetMonth)
            Task {
                do {
                    let response = try await service.fetch(from: first, to: end, timeZone: calendar.timeZone)
                    guard epoch == calendarEpoch else { return }
                    mergeItems(response.items)
                } catch {
                    guard epoch == calendarEpoch else { return }
                    loadedMonths.remove(targetMonth)
                }
            }
        }
    }

    /// 取得した項目を日付ごとに`itemsByDay`へ書き加える(他の月の既存分は消さない)。
    private func mergeItems(_ items: [CalendarItem]) {
        for (day, dayItems) in Dictionary(grouping: items, by: { calendar.startOfDay(for: $0.datetime) }) {
            itemsByDay[day] = dayItems
        }
    }

    /// `targetMonth`のグリッド(前後の月の日を含む6週分)の範囲 [開始, 終了)。
    /// `gridDays`と同じ計算だが、表示中でない月にも使える(先読み用)。
    private func gridRange(forMonth targetMonth: Date) -> (first: Date, end: Date)? {
        let weekday = calendar.component(.weekday, from: targetMonth)
        let offset = (weekday - calendar.firstWeekday + 7) % 7
        let daysInMonth = calendar.range(of: .day, in: .month, for: targetMonth)?.count ?? 30
        let weeks = (offset + daysInMonth + 6) / 7
        guard let start = calendar.date(byAdding: .day, value: -offset, to: targetMonth),
              let end = calendar.date(byAdding: .day, value: weeks * 7, to: start) else { return nil }
        return (start, end)
    }

    func select(_ day: Date) {
        selectedDate = calendar.startOfDay(for: day)
        // 前後の月の日を選んだら、その月へ移る。
        if !isInMonth(selectedDate) {
            month = calendar.date(from: calendar.dateComponents([.year, .month], from: selectedDate)) ?? month
            Task { await load() }
        }
    }

    /// 前月(-1)・翌月(+1)、前年(-12)・翌年(+12)へ。選んでいる日はその月の1日にする。
    func moveMonth(by value: Int) async {
        guard let next = calendar.date(byAdding: .month, value: value, to: month) else { return }
        month = next
        selectedDate = next
        await load()
    }

    // MARK: - プランで見られる範囲(HQ指示 2026-10-08)

    enum Availability: Equatable {
        case allowed
        /// 無料プランでは見られないが、プレミアムプランなら見られる。
        case needsPro
        /// どのプランでも見られない(5年より前・来年より先)。
        case unavailable
    }

    /// その日(または月)を見られるか。
    func availability(of day: Date) -> Availability {
        let limits = plan.limits
        if day >= limits.calendarLatestTo { return .unavailable }
        if day >= limits.calendarEarliestFrom { return .allowed }
        if !plan.isPro, day >= PlanLimits.pro(calendar: calendar).calendarEarliestFrom { return .needsPro }
        return .unavailable
    }

    /// 「‹ ›」(±1)・「« »」(±12)で移る先の月を見られるか。月の最後の日で判定するので、
    /// 範囲の始まりが月の途中でもその月には移れる。
    func moveAvailability(by value: Int) -> Availability {
        guard let target = calendar.date(byAdding: .month, value: value, to: month),
              let next = calendar.date(byAdding: .month, value: 1, to: target),
              let lastDay = calendar.date(byAdding: .day, value: -1, to: next) else { return .unavailable }
        return value < 0 ? availability(of: lastDay) : availability(of: target)
    }

    /// 無料プランの範囲を超えたときの案内文。
    static let needsProMessage = "無料プランの経済カレンダーは、先月の1日から見られます。プレミアムプランなら5年前までさかのぼれます。"

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

    /// 週の開始曜日から並べた曜日(月曜始まりなら月〜日、日曜始まりなら日〜土)。
    var weekdaySymbols: [String] {
        let symbols = calendar.veryShortWeekdaySymbols
        return (0..<7).map { symbols[(calendar.firstWeekday - 1 + $0) % 7] }
    }
}
