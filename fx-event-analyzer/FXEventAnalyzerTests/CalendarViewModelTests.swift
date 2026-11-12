import XCTest
@testable import FXEventAnalyzer

@MainActor
final class CalendarViewModelTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = CalendarViewModel.makeCalendar()
        calendar.timeZone = TimeZone(identifier: "Asia/Tokyo")!
        return calendar
    }

    private var proPlan: PlanStore {
        let plan = PlanStore()
        plan.set(plan: .pro, limits: .pro(now: date(2026, 10, 8), calendar: calendar))
        return plan
    }

    private func date(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 0, _ min: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: y, month: m, day: d, hour: h, minute: min))!
    }

    private func item(_ id: String, _ kind: CalendarItem.Kind, _ importance: Importance, at datetime: Date) -> CalendarItem {
        CalendarItem(kind: kind, id: id, title: id, speakerName: nil, countryCode: "US", currencyCode: "USD",
                     importance: importance, datetime: datetime, datetimePrecision: .exact, status: "SCHEDULED")
    }

    func testGridStartsOnMondayAndEndsWithTheMonthsLastWeek() {
        // 2026-10-01 is a Thursday, so the grid starts on Monday 9/28 and ends
        // on Sunday 11/1 (5 weeks) — the 11/2〜8 week is not shown.
        let viewModel = CalendarViewModel(apiClient: MockAPIClient(), today: date(2026, 10, 8), calendar: calendar, plan: proPlan)
        XCTAssertEqual(viewModel.gridDays.count, 35)
        XCTAssertEqual(viewModel.gridDays.first, date(2026, 9, 28))
        XCTAssertEqual(viewModel.gridDays.last, date(2026, 11, 1))
        // 2026-02 starts on Sunday and has 28 days: 2/1 is alone in the first week.
        let february = CalendarViewModel(apiClient: MockAPIClient(), today: date(2026, 2, 10), calendar: calendar, plan: proPlan)
        XCTAssertEqual(february.gridDays.count, 35)
        // 2026-03 starts on Sunday and has 31 days: 6 weeks.
        let march = CalendarViewModel(apiClient: MockAPIClient(), today: date(2026, 3, 10), calendar: calendar, plan: proPlan)
        XCTAssertEqual(march.gridDays.count, 42)
        XCTAssertEqual(viewModel.weekdaySymbols, ["月", "火", "水", "木", "金", "土", "日"])
        XCTAssertEqual(viewModel.monthTitle, "2026年10月")
        XCTAssertEqual(viewModel.selectedTitle, "10/8(木)のイベント")
    }

    func testLoadGroupsByDayAndRequestsTheWholeGrid() async throws {
        let apiClient = MockAPIClient()
        apiClient.result = .success(CalendarResponse(items: [
            item("a", .indicator, .medium, at: date(2026, 10, 8, 8, 50)),
            item("b", .speech, .high, at: date(2026, 10, 8, 15, 0)),
            item("c", .indicator, .low, at: date(2026, 10, 9, 21, 30)),
        ]))
        let viewModel = CalendarViewModel(apiClient: apiClient, today: date(2026, 10, 8), calendar: calendar, plan: proPlan)
        await viewModel.load()

        XCTAssertEqual(viewModel.loadState, .loaded)
        XCTAssertEqual(viewModel.selectedItems.map(\.id), ["a", "b"])
        XCTAssertEqual(viewModel.dots(on: date(2026, 10, 8)), [.high, .medium])
        XCTAssertEqual(viewModel.items(on: date(2026, 10, 9)).map(\.route), [.eventDetail(id: "c")])
        XCTAssertEqual(viewModel.items(on: date(2026, 10, 8))[1].route, .speechDetail(id: "b"))
        let query = try XCTUnwrap(apiClient.lastEndpoint?.queryItems)
        XCTAssertEqual(apiClient.lastEndpoint?.path, "calendar")
        XCTAssertEqual(query.map(\.name), ["from", "to", "timezone"])
    }

    func testMoveMonthSelectsTheFirstDay() async {
        let apiClient = MockAPIClient()
        apiClient.result = .success(CalendarResponse(items: []))
        let viewModel = CalendarViewModel(apiClient: apiClient, today: date(2026, 10, 8), calendar: calendar, plan: proPlan)
        await viewModel.moveMonth(by: 1)
        XCTAssertEqual(viewModel.monthTitle, "2026年11月")
        XCTAssertEqual(viewModel.selectedDate, date(2026, 11, 1))
    }

    func testFreePlanCanGoBackOneMonthAndProFiveYears() {
        let today = date(2026, 10, 8)
        let free = PlanStore()
        free.set(plan: .free, limits: .free(now: today, calendar: calendar))
        let viewModel = CalendarViewModel(apiClient: MockAPIClient(), today: today, calendar: calendar, plan: free)
        XCTAssertEqual(viewModel.moveAvailability(by: -1), .allowed, "9月は見られる")
        XCTAssertEqual(viewModel.availability(of: date(2026, 8, 31)), .needsPro)
        XCTAssertEqual(viewModel.moveAvailability(by: -12), .needsPro)
        XCTAssertEqual(viewModel.moveAvailability(by: 12), .allowed, "来年は見られる")
        XCTAssertEqual(viewModel.availability(of: date(2028, 1, 1)), .unavailable)
        XCTAssertEqual(viewModel.availability(of: date(2020, 12, 31)), .unavailable)

        let pro = PlanStore()
        pro.set(plan: .pro, limits: .pro(now: today, calendar: calendar))
        let proModel = CalendarViewModel(apiClient: MockAPIClient(), today: today, calendar: calendar, plan: pro)
        XCTAssertEqual(proModel.availability(of: date(2021, 1, 1)), .allowed)
        XCTAssertEqual(proModel.availability(of: date(2020, 12, 31)), .unavailable)
    }

    func testLoadOnlyRequestsTheAllowedRange() async throws {
        let today = date(2026, 10, 8)
        let free = PlanStore()
        free.set(plan: .free, limits: .free(now: today, calendar: calendar))
        let apiClient = MockAPIClient()
        apiClient.result = .success(CalendarResponse(items: []))
        let viewModel = CalendarViewModel(apiClient: apiClient, today: today, calendar: calendar, plan: free)
        await viewModel.moveMonth(by: -1)
        // 9月のカレンダーは8/31から始まるが、無料プランは9/1から。
        let from = try XCTUnwrap(apiClient.lastEndpoint?.queryItems.first { $0.name == "from" }?.value)
        let formatter = ISO8601DateFormatter()
        XCTAssertEqual(formatter.date(from: from), date(2026, 9, 1))
    }

    func testMoveYear() async {
        let apiClient = MockAPIClient()
        apiClient.result = .success(CalendarResponse(items: []))
        let viewModel = CalendarViewModel(apiClient: apiClient, today: date(2026, 10, 8), calendar: calendar, plan: proPlan)
        await viewModel.moveMonth(by: -12)
        XCTAssertEqual(viewModel.monthTitle, "2025年10月")
    }
}
