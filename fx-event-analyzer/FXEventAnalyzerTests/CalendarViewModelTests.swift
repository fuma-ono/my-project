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

    /// HQ指示(2026-10-24)「開いた瞬間は日付だけ出て、点だけ遅れて浮いてくる」対策:
    /// 表示中の月を読み込んだ後、前後1か月を裏で先読みしておき、実際にその月へ
    /// 移動したときは通信せずそのまま(=点も一緒に)表示できることを確認する。
    func testPrefetchesAdjacentMonthsSoMovingThereDoesNotRefetch() async throws {
        let apiClient = MockAPIClient()
        apiClient.result = .success(CalendarResponse(items: [
            item("nov-high", .indicator, .high, at: date(2026, 11, 10, 8, 30)),
        ]))
        let viewModel = CalendarViewModel(apiClient: apiClient, today: date(2026, 10, 8), calendar: calendar, plan: proPlan)
        await viewModel.load()
        // 先読みは裏のTaskなので、走り終わるまで少し待つ(MainActorは今の
        // 続き — ここまでの同期処理 — を終えてから先読みのTaskを実行する)。
        try await Task.sleep(nanoseconds: 100_000_000)
        let requestsAfterPrefetch = apiClient.requestedEndpoints.count
        XCTAssertGreaterThan(requestsAfterPrefetch, 1, "表示中の月の前後1か月を先読みしているはず")

        await viewModel.moveMonth(by: 1) // 11月へ移動(先読み済みのはず)
        XCTAssertEqual(viewModel.monthTitle, "2026年11月")
        // 先読みのレスポンスで点(dots)も既に入っている — 日付だけ先に出て
        // 点が遅れる、ということがない。
        XCTAssertEqual(viewModel.dots(on: date(2026, 11, 10)), [.high])
        // 先読み済みのキャッシュをそのまま使うので、11月への移動では新たな
        // 通信は発生しない。
        XCTAssertEqual(apiClient.requestedEndpoints.count, requestsAfterPrefetch)
    }

    /// 月を連続して送り、さらに前の月へ戻ってきても、既に先読み・取得済みの
    /// 月は通信し直さないことを確認する(HQ指示 2026-10-24「月を連続して送る
    /// 操作、前後の月へ戻る操作」)。
    func testConsecutiveMovesUsePrefetchedCacheBothForwardAndBack() async throws {
        let apiClient = MockAPIClient()
        apiClient.result = .success(CalendarResponse(items: [
            item("nov-high", .indicator, .high, at: date(2026, 11, 10, 8, 30)),
        ]))
        let viewModel = CalendarViewModel(apiClient: apiClient, today: date(2026, 10, 8), calendar: calendar, plan: proPlan)
        await viewModel.load()
        try await Task.sleep(nanoseconds: 100_000_000) // 9月・11月の先読みを待つ

        await viewModel.moveMonth(by: 1) // 10月→11月(先読み済み、通信なし)
        XCTAssertEqual(viewModel.monthTitle, "2026年11月")
        try await Task.sleep(nanoseconds: 100_000_000) // 12月の先読みを待つ

        await viewModel.moveMonth(by: 1) // 11月→12月(先読み済み、通信なし)
        XCTAssertEqual(viewModel.monthTitle, "2026年12月")
        try await Task.sleep(nanoseconds: 100_000_000) // 1月の先読みを待つ
        let requestsBeforeGoingBack = apiClient.requestedEndpoints.count

        await viewModel.moveMonth(by: -1) // 12月→11月(戻る。先読み済みのはず)
        XCTAssertEqual(viewModel.monthTitle, "2026年11月")
        XCTAssertEqual(viewModel.dots(on: date(2026, 11, 10)), [.high])
        await viewModel.moveMonth(by: -1) // 11月→10月(戻る。最初に読み込んだ月)
        XCTAssertEqual(viewModel.monthTitle, "2026年10月")
        // 既に先読み・取得済みの月を行き来するだけなら、新たな通信は発生しない。
        XCTAssertEqual(apiClient.requestedEndpoints.count, requestsBeforeGoingBack)
    }

    /// 呼び出された順にレスポンス/エラーを返す簡易スタブ。既存の`MockAPIClient`は
    /// パス単位(どの呼び出しも同じ"calendar"パス)でしか結果を分けられないため、
    /// 「先読みだけ失敗する」状況を再現するのに使う(このテスト専用のローカル
    /// 実装 — `MockAPIClient`自体は変更していない)。
    private final class SequencedAPIClient: APIClient {
        private let results: [MockAPIClient.MockResult]
        private(set) var callCount = 0
        init(_ results: [MockAPIClient.MockResult]) { self.results = results }
        func send<T: Decodable>(_ endpoint: Endpoint) async throws -> T {
            let outcome = results[min(callCount, results.count - 1)]
            callCount += 1
            switch outcome {
            case .success(let value):
                guard let typed = value as? T else {
                    throw APIError.decoding("SequencedAPIClient: configured result does not match requested type \(T.self)")
                }
                return typed
            case .failure(let error):
                throw error
            }
        }
    }

    /// 前後の月の先読みが失敗しても、表示中の月の表示状態には影響せず、
    /// 実際にその月へ移動したときは取り直して正しく表示できることを確認する
    /// (HQ指示 2026-10-24「取得失敗時の挙動」)。
    func testFailedPrefetchIsRetriedWhenTheUserActuallyNavigatesThere() async throws {
        let apiClient = SequencedAPIClient([
            .success(CalendarResponse(items: [])), // 10月(表示中の月): 成功
            .failure(APIError.transport("network error")), // 9月の先読み: 失敗
            .failure(APIError.transport("network error")), // 11月の先読み: 失敗
            .success(CalendarResponse(items: [item("nov-high", .indicator, .high, at: date(2026, 11, 10, 8, 30))])),
        ])
        let viewModel = CalendarViewModel(apiClient: apiClient, today: date(2026, 10, 8), calendar: calendar, plan: proPlan)
        await viewModel.load()
        try await Task.sleep(nanoseconds: 100_000_000) // 失敗する先読みが終わるまで待つ
        XCTAssertEqual(viewModel.loadState, .loaded, "先読みの失敗は表示中の月の状態に影響しない")

        await viewModel.moveMonth(by: 1) // 11月へ(先読みは失敗していたので取り直すはず)
        XCTAssertEqual(viewModel.loadState, .loaded)
        XCTAssertEqual(viewModel.dots(on: date(2026, 11, 10)), [.high], "先読みが失敗していても、実際に移動すれば取り直して表示できる")
    }

    /// `is_provisional`(api-design v1.32、HQ承認 2026-10-22 Task 3)。返さない古いBackendでも読める(暫定ではない扱い)。
    func testDecodesIsProvisionalWithAndWithoutTheField() throws {
        let json = """
        {
          "from": "2026-12-01T00:00:00Z",
          "to": "2027-01-01T00:00:00Z",
          "items": [
            {
              "kind": "INDICATOR", "id": "fomc-dec", "indicator_id": "ind-fomc", "title": "FOMC政策金利",
              "display_name": "FOMC政策金利", "speaker_name": null, "speaker_photo_url": null,
              "country_code": "US", "currency_code": "USD", "importance": "HIGH",
              "datetime": "2026-12-09T19:00:00+00:00", "datetime_precision": "EXACT", "status": "SCHEDULED",
              "is_provisional": true
            },
            {
              "kind": "INDICATOR", "id": "cpi", "indicator_id": "ind-cpi", "title": "米国CPI",
              "display_name": null, "speaker_name": null, "speaker_photo_url": null,
              "country_code": "US", "currency_code": "USD", "importance": "HIGH",
              "datetime": "2026-12-10T13:30:00+00:00", "datetime_precision": "EXACT", "status": "SCHEDULED",
              "is_provisional": false
            },
            {
              "kind": "SPEECH", "id": "old-backend", "title": "講演",
              "speaker_name": "ジェローム・パウエル",
              "country_code": "US", "currency_code": "USD", "importance": "MEDIUM",
              "datetime": "2026-12-11T15:00:00.123456+00:00", "datetime_precision": "EXACT", "status": "SCHEDULED"
            }
          ]
        }
        """
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom(BackendDate.decode)
        let response = try decoder.decode(CalendarResponse.self, from: Data(json.utf8))
        XCTAssertEqual(response.items.map(\.isProvisional), [true, false, false])
        XCTAssertNil(response.items[2].provisionalFlag)
        XCTAssertFalse(item("x", .indicator, .high, at: date(2026, 12, 9)).isProvisional)
    }
}
