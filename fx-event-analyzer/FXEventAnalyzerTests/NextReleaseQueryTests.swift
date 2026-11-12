import XCTest
@testable import FXEventAnalyzer

/// v1.31「次の発表」: 未来の予定(BLS・FOMC)が何件あっても、現在以降で最も近い予定を次の発表にする。
/// 予定が無いときに、過去の発表(や発表時刻を過ぎた取り込み待ちの行)を次の発表にしない。
final class NextReleaseQueryTests: XCTestCase {
    private let now = NextReleaseQueryTests.date("2026-10-22T00:00:00Z")

    private static func date(_ value: String) -> Date {
        ISO8601DateFormatter().date(from: value)!
    }

    private func date(_ value: String) -> Date { Self.date(value) }

    private func event(_ id: String, _ release: String, _ status: EventStatus = .scheduled) -> IndicatorEventSummary {
        IndicatorEventSummary(
            id: id, releaseDatetime: date(release), status: status, dataStatus: .dataPending,
            forecast: nil, actual: nil, previous: nil, surprise: nil, surpriseDirection: nil
        )
    }

    func testQueryItemsAskForFutureSchedulesNearestFirst() {
        let items = NextReleaseQuery.queryItems(limit: 1, now: now)
        XCTAssertEqual(items, [
            URLQueryItem(name: "status", value: "SCHEDULED"),
            URLQueryItem(name: "from", value: "2026-10-22T00:00:00Z"),
            URLQueryItem(name: "order", value: "asc"),
            URLQueryItem(name: "limit", value: "1"),
        ])
    }

    func testNextPicksTheNearestFutureScheduleAcrossTheDSTChange() {
        // 夏時間(12:30Z)と冬時間(13:30Z)が混ざり、並びも日付順でない。
        let events = [
            event("2027-12", "2027-12-10T13:30:00Z"),
            event("2027-04", "2027-04-13T12:30:00Z"),
            event("2026-11", "2026-11-10T13:30:00Z"),
        ]
        XCTAssertEqual(NextReleaseQuery.next(in: events, after: now)?.id, "2026-11")
    }

    func testNextIgnoresPastRowsAndReleasedRows() {
        let events = [
            event("due", "2026-10-15T12:30:00Z"), // 発表時刻を過ぎた取り込み待ち
            event("released", "2026-09-10T12:30:00Z", .released),
            event("cancelled", "2026-12-10T13:30:00Z", .cancelled),
        ]
        XCTAssertNil(NextReleaseQuery.next(in: events, after: now))
        XCTAssertNil(NextReleaseQuery.next(in: [], after: now))
    }

    func testNextExcludesTheEventBeingShown() {
        let events = [event("this", "2026-11-06T13:30:00Z"), event("following", "2026-12-04T13:30:00Z")]
        XCTAssertEqual(NextReleaseQuery.next(in: events, after: now, excluding: "this")?.id, "following")
        XCTAssertNil(NextReleaseQuery.next(in: [events[0]], after: now, excluding: "this"))
    }

    func testFavoriteIndicatorUsesTheNextReleaseQueryAndNeverAPastRow() async {
        let apiClient = MockAPIClient()
        let indicator = IndicatorSummary(
            id: "ind_1", code: "US_CPI", name: "US CPI", countryCode: "US", currencyCode: "USD",
            importance: .high, description: nil, frequency: "MONTHLY", unit: "%", source: nil,
            sourceUrl: nil, favorableDirection: .higherIsPositive
        )
        apiClient.results["indicators/ind_1"] = .success(IndicatorDetailResponse(indicator: indicator, relatedFxPairs: []))
        let past = IndicatorEventSummary(
            id: "past", releaseDatetime: Date().addingTimeInterval(-3600), status: .scheduled, dataStatus: .dataPending,
            forecast: nil, actual: nil, previous: nil, surprise: nil, surpriseDirection: nil
        )
        apiClient.results["indicators/ind_1/events"] = .success(
            IndicatorEventsListResponse(data: [past], meta: PaginationMeta(page: 1, limit: 1, total: 1, hasNext: false))
        )

        let item = await FavoriteItemLoader(apiClient: apiClient).fetchFavoriteIndicator(id: "ind_1")

        guard case .indicator(_, _, _, _, _, let nextReleaseDatetime) = item else {
            return XCTFail("expected an indicator item")
        }
        XCTAssertNil(nextReleaseDatetime)
        let eventsQuery = apiClient.requestedEndpoints.first { $0.path == "indicators/ind_1/events" }?.queryItems ?? []
        XCTAssertTrue(eventsQuery.contains(URLQueryItem(name: "order", value: "asc")))
        XCTAssertTrue(eventsQuery.contains(URLQueryItem(name: "status", value: "SCHEDULED")))
        XCTAssertTrue(eventsQuery.contains { $0.name == "from" && $0.value != nil })
    }
}
