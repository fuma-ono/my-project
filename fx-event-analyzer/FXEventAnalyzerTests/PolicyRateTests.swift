import XCTest
@testable import FXEventAnalyzer

/// api-design v1.47(HQ承認 2026-11-05「FOMC政策金利の実データ取り込み」案A): FOMCの会合の`event.policy_rate`。
/// 誘導目標レンジの下限・上限は別々の値のまま読み、表示は「下限%〜上限%」。古いBackend(項目が無い)・記録が
/// 無い会合(null)ではnil(今までの結果のカード)。
final class PolicyRateTests: XCTestCase {
    private func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    private let event = #"{"id":"e1","indicator_id":"i1","indicator_name":"FOMC政策金利","country_code":"US","currency_code":"USD","release_datetime":"2026-09-16T18:00:00Z","release_datetime_precision":"EXACT","importance":"HIGH","status":"SCHEDULED","data_status":"DATA_PENDING","revision_status":null"#

    func testDecodesLowerAndUpperApart() throws {
        let json = event + #","policy_rate":{"target_range_lower":3.75,"target_range_upper":4,"announced_at":"2026-09-16T18:00:00+00:00","effective_date":"2026-09-17","source":"NY Fed","source_url":"https://markets.newyorkfed.org","fetched_at":"2026-11-05T15:00:00+00:00"}}"#
        let decoded = try decoder().decode(EventDetailEvent.self, from: Data(json.utf8))
        XCTAssertEqual(decoded.policyRate, PolicyRate(targetRangeLower: 3.75, targetRangeUpper: 4, effectiveDate: "2026-09-17"))
        XCTAssertEqual(decoded.policyRate?.rangeText, "3.75%〜4.00%")
        XCTAssertEqual(decoded.policyRate?.effectiveDateText, "2026/09/17")
    }

    func testNilForOldBackendsAndMeetingsWithoutADecision() throws {
        XCTAssertNil(try decoder().decode(EventDetailEvent.self, from: Data((event + "}").utf8)).policyRate)
        XCTAssertNil(try decoder().decode(EventDetailEvent.self, from: Data((event + #","policy_rate":null}"#).utf8)).policyRate)
    }

    func testAZeroLowerBoundIsShown() {
        XCTAssertEqual(PolicyRate(targetRangeLower: 0, targetRangeUpper: 0.25, effectiveDate: "2020-03-16").rangeText, "0.00%〜0.25%")
        XCTAssertEqual(PolicyRate(targetRangeLower: 0, targetRangeUpper: 0.25, effectiveDate: "bad").effectiveDateText, "bad")
    }
}
