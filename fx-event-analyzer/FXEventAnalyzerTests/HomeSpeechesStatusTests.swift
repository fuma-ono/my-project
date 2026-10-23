import XCTest
@testable import FXEventAnalyzer

/// GET /home `speeches_status`(api-design.md §12 v1.34、HQ承認 2026-10-23)の
/// デコードと、「直近の要人発言」カードの空状態の文言の選び方。
@MainActor
final class HomeSpeechesStatusTests: XCTestCase {
    private func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom(BackendDate.decode)
        return decoder
    }

    private func decodeHome(_ extra: String) throws -> HomeResponse {
        let json = """
        {"date":"2026-10-23","timezone":"Asia/Tokyo","events":[],"major_fx":[],"speeches":[]\(extra)}
        """.data(using: .utf8)!
        return try makeDecoder().decode(HomeResponse.self, from: json)
    }

    /// 「10/23 15:00」(UTC 固定。テストの文言の確認用)
    private static func formatUTC(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "M/d HH:mm"
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter.string(from: date)
    }

    private static let lastSuccess = BackendDate.parse("2026-10-23T03:00:04Z")!

    // MARK: - Decoding

    func testDecodesSpeechesStatusWhenPresent() throws {
        let response = try decodeHome(#","speeches_status":{"window_days":7,"last_success_at":"2026-10-23T03:00:04Z","stale":false}"#)
        XCTAssertEqual(response.speechesStatus, HomeSpeechesStatus(windowDays: 7, lastSuccessAt: Self.lastSuccess, stale: false))
        XCTAssertEqual(response.speeches, [])
    }

    func testDecodesANullLastSuccessAt() throws {
        let response = try decodeHome(#","speeches_status":{"window_days":7,"last_success_at":null,"stale":true}"#)
        XCTAssertEqual(response.speechesStatus, HomeSpeechesStatus(windowDays: 7, lastSuccessAt: nil, stale: true))
    }

    func testDecodesAnOldServerResponseWithoutTheField() throws {
        let response = try decodeHome("")
        XCTAssertNil(response.speechesStatus)
    }

    // MARK: - Empty-state text

    func testFreshStatusShowsNoSpeechesWithTheLastUpdate() {
        let text = HomeSpeechesEmptyText.make(
            status: HomeSpeechesStatus(windowDays: 7, lastSuccessAt: Self.lastSuccess, stale: false),
            formatDate: Self.formatUTC
        )
        XCTAssertEqual(text, HomeSpeechesEmptyText(message: "直近7日間の要人発言はありません", detail: "最終更新 10/23 03:00"))
    }

    func testFreshStatusWithoutALastSuccessShowsNoUpdateLine() {
        let text = HomeSpeechesEmptyText.make(
            status: HomeSpeechesStatus(windowDays: 7, lastSuccessAt: nil, stale: false),
            formatDate: Self.formatUTC
        )
        XCTAssertEqual(text, HomeSpeechesEmptyText(message: "直近7日間の要人発言はありません", detail: nil))
    }

    func testStaleStatusSaysTheInformationCouldNotBeUpdated() {
        let text = HomeSpeechesEmptyText.make(
            status: HomeSpeechesStatus(windowDays: 7, lastSuccessAt: Self.lastSuccess, stale: true),
            formatDate: Self.formatUTC
        )
        XCTAssertEqual(text, HomeSpeechesEmptyText(message: "要人発言の情報を更新できていません（最終更新 10/23 03:00）", detail: nil))
    }

    func testStaleStatusWithoutALastSuccess() {
        let text = HomeSpeechesEmptyText.make(
            status: HomeSpeechesStatus(windowDays: 7, lastSuccessAt: nil, stale: true),
            formatDate: Self.formatUTC
        )
        XCTAssertEqual(text, HomeSpeechesEmptyText(message: "要人発言の情報を更新できていません", detail: nil))
    }

    func testNoStatusFromAnOldServer() {
        let text = HomeSpeechesEmptyText.make(status: nil, formatDate: Self.formatUTC)
        XCTAssertEqual(text, HomeSpeechesEmptyText(message: "直近7日間の要人発言はありません", detail: nil))
    }

    // MARK: - ViewModel

    func testViewModelExposesTheStatus() async {
        let apiClient = MockAPIClient()
        let status = HomeSpeechesStatus(windowDays: 7, lastSuccessAt: Self.lastSuccess, stale: true)
        apiClient.result = .success(
            HomeResponse(date: "2026-10-23", timezone: "UTC", events: [], majorFx: [], speeches: [], speechesStatus: status)
        )
        let viewModel = HomeViewModel(apiClient: apiClient)
        viewModel.load()
        for _ in 0..<50 {
            if viewModel.speechesStatus != nil { break }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertEqual(viewModel.speechesStatus, status)
        XCTAssertEqual(viewModel.recentSpeeches, [])
    }
}
