import XCTest
@testable import FXEventAnalyzer

/// api-design v1.44(HQ判断 2026-10-30 P1-1 段階1): `reaction_state`は任意の項目。古いBackend(項目なし)・
/// 知らない値でも応答を読めること、`analysis_status`の読み方を変えないこと、表示の文言を確かめる。
final class ReactionStateTests: XCTestCase {
    private func decodeSummary(_ json: String) throws -> EventReactionSummary {
        try JSONDecoder().decode(EventReactionSummary.self, from: Data(json.utf8))
    }

    private func decodeEntry(_ json: String) throws -> ReactionTimeframeEntry {
        try JSONDecoder().decode(ReactionTimeframeEntry.self, from: Data(json.utf8))
    }

    func testSummaryDecodesEachState() throws {
        let notCalculated = try decodeSummary(#"{"timeframe":"5m","pips":null,"change_percent":null,"analysis_status":"DATA_PENDING","reaction_state":"NOT_CALCULATED","retry_scheduled":false}"#)
        XCTAssertEqual(notCalculated.analysisStatus, .dataPending)
        XCTAssertEqual(notCalculated.reactionState, .notCalculated)

        let notDue = try decodeSummary(#"{"timeframe":"5m","pips":null,"change_percent":null,"analysis_status":"DATA_PENDING","reaction_state":"NOT_DUE","retry_scheduled":null}"#)
        XCTAssertEqual(notDue.reactionState, .notDue)

        let calculated = try decodeSummary(#"{"timeframe":"5m","pips":56.0,"change_percent":0.38,"analysis_status":"READY","reaction_state":"CALCULATED","retry_scheduled":null}"#)
        XCTAssertEqual(calculated.reactionState, .calculated)
        XCTAssertEqual(calculated.pips, 56.0)
    }

    func testOldBackendWithoutTheFieldStillDecodes() throws {
        let summary = try decodeSummary(#"{"timeframe":"5m","pips":null,"change_percent":null,"analysis_status":"DATA_PENDING"}"#)
        XCTAssertEqual(summary.analysisStatus, .dataPending)
        XCTAssertNil(summary.reactionState)

        let entry = try decodeEntry(#"{"timeframe":"1m","post_release_price":null,"movement":null,"pips":null,"change_percent":null,"max_upward":null,"max_downward":null,"max_upward_pips":null,"max_downward_pips":null,"analysis_status":"DATA_PENDING"}"#)
        XCTAssertEqual(entry.analysisStatus, .dataPending)
        XCTAssertNil(entry.reactionState)
    }

    func testNullOrUnknownStateIsNilAndDoesNotFailTheResponse() throws {
        let null = try decodeSummary(#"{"timeframe":"1m","pips":null,"change_percent":null,"analysis_status":"NOT_ANALYZABLE","reaction_state":null}"#)
        XCTAssertNil(null.reactionState)
        XCTAssertEqual(null.analysisStatus, .notAnalyzable)

        let unknown = try decodeEntry(#"{"timeframe":"1m","post_release_price":null,"movement":null,"pips":null,"change_percent":null,"max_upward":null,"max_downward":null,"max_upward_pips":null,"max_downward_pips":null,"analysis_status":"DATA_PENDING","reaction_state":"SOMETHING_NEW"}"#)
        XCTAssertNil(unknown.reactionState)
    }

    func testEntryDecodesState() throws {
        let entry = try decodeEntry(#"{"timeframe":"15m","post_release_price":null,"movement":null,"pips":null,"change_percent":null,"max_upward":null,"max_downward":null,"max_upward_pips":null,"max_downward_pips":null,"analysis_status":"DATA_PENDING","reaction_state":"NOT_CALCULATED","retry_scheduled":true}"#)
        XCTAssertEqual(entry.reactionState, .notCalculated)
    }

    func testShortLabelsMatchHQWording() {
        XCTAssertEqual(ReactionState.notDue.shortLabel, "発表後に表示")
        XCTAssertEqual(ReactionState.notCalculated.shortLabel, "未計算")
        XCTAssertNil(ReactionState.calculated.shortLabel) // CALCULATED: 今までの状態の表示のまま
    }
}
