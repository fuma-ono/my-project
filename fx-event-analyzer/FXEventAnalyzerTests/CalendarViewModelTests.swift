import XCTest
@testable import FXEventAnalyzer

@MainActor
final class CalendarViewModelTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = CalendarViewModel.makeCalendar()
        calendar.timeZone = TimeZone(identifier: "Asia/Tokyo")!
        return calendar
    }

    private func date(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 0, _ min: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: y, month: m, day: d, hour: h, minute: min))!
    }

    private func item(_ id: String, _ kind: CalendarItem.Kind, _ importance: Importance, at datetime: Date) -> CalendarItem {
        CalendarItem(kind: kind, id: id, title: id, speakerName: nil, countryCode: "US", currencyCode: "USD",
                     importance: importance, datetime: datetime, datetimePrecision: .exact, status: "SCHEDULED")
    }

    func testGridStartsOnMondayAndHasSixWeeks() {
        // 2026-10-01 is a Thursday, so the grid starts on Monday 9/28.
        let viewModel = CalendarViewModel(apiClient: MockAPIClient(), today: date(2026, 10, 8), calendar: calendar)
        XCTAssertEqual(viewModel.gridDays.count, 42)
        XCTAssertEqual(viewModel.gridDays.first, date(2026, 9, 28))
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
        let viewModel = CalendarViewModel(apiClient: apiClient, today: date(2026, 10, 8), calendar: calendar)
        await viewModel.load()

        XCTAssertEqual(viewModel.loadState, .loaded)
        XCTAssertEqual(viewModel.selectedItems.map(\.id), ["a", "b"])
        XCTAssertEqual(viewModel.dots(on: date(2026, 10, 8)), [.high, .medium])
        XCTAssertEqual(viewModel.items(on: date(2026, 10, 9)).map(\.route), [.eventDetail(id: "c")])
        XCTAssertEqual(viewModel.items(on: date(2026, 10, 8))[1].route, .speechDetail(id: "b"))
        let query = try XCTUnwrap(apiClient.lastEndpoint?.queryItems)
        XCTAssertEqual(apiClient.lastEndpoint?.path, "calendar")
        XCTAssertEqual(query.map(\.name), ["from", "to"])
    }

    func testMoveMonthSelectsTheFirstDay() async {
        let apiClient = MockAPIClient()
        apiClient.result = .success(CalendarResponse(items: []))
        let viewModel = CalendarViewModel(apiClient: apiClient, today: date(2026, 10, 8), calendar: calendar)
        await viewModel.moveMonth(by: 1)
        XCTAssertEqual(viewModel.monthTitle, "2026年11月")
        XCTAssertEqual(viewModel.selectedDate, date(2026, 11, 1))
    }

    func testMoveYear() async {
        let apiClient = MockAPIClient()
        apiClient.result = .success(CalendarResponse(items: []))
        let viewModel = CalendarViewModel(apiClient: apiClient, today: date(2026, 10, 8), calendar: calendar)
        await viewModel.moveMonth(by: -12)
        XCTAssertEqual(viewModel.monthTitle, "2025年10月")
    }
}
