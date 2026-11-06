import XCTest
@testable import FXEventAnalyzer

/// Pro イベント別トレード戦略分析(HQ指示 2026-11-06、api-design v1.48)。応答の読み込み、FREE のロック、データ準備中、
/// 判定できない値を作らない表示を確かめる。
@MainActor
final class StrategyAnalysisTests: XCTestCase {
    private func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    private let readyJSON = #"""
    {"event_id":"e0","available":true,"required_entitlement":null,
     "fx_pair":{"fx_pair_id":"p1","symbol":"USDJPY"},
     "analysis":{"status":"READY","sample_window":5,"minimum_samples":3,
      "releases":[
        {"event_id":"e1","release_datetime":"2026-10-14T12:30:00Z","forecast":3.0,"actual":3.2,"surprise":0.2,"surprise_direction":"POSITIVE",
         "direction_1m":"UP","pips_1m":5,"pips_15m":-9,"pattern_15m":"REVERSAL",
         "high_break_15m":false,"low_break_15m":true,"high_break_60m":false,"low_break_60m":true,"sell_the_fact":true},
        {"event_id":"e2","release_datetime":"2026-09-11T12:30:00Z","forecast":null,"actual":2.9,"surprise":null,"surprise_direction":null,
         "direction_1m":null,"pips_1m":null,"pips_15m":null,"pattern_15m":null,
         "high_break_15m":null,"low_break_15m":null,"high_break_60m":null,"low_break_60m":null,"sell_the_fact":null}
      ],
      "summary":{"direction_1m":{"up":3,"down":1,"flat":0,"samples":4},
                 "breaks_15m":{"high":2,"low":2,"both":0,"neither":0,"samples":4},
                 "breaks_60m":null,
                 "pattern_15m":{"continuation":3,"reversal":1,"samples":4},
                 "sell_the_fact":null}}}
    """#

    func testDecodesTheProAnalysis() throws {
        let response = try decoder().decode(StrategyAnalysisResponse.self, from: Data(readyJSON.utf8))
        guard case .loaded(let pair, let analysis) = StrategyAnalysisViewModel.state(for: response) else {
            return XCTFail("expected loaded")
        }
        XCTAssertEqual(pair.symbol, "USDJPY")
        XCTAssertTrue(analysis.isReady)
        XCTAssertEqual(analysis.releases.map(\.id), ["e1", "e2"])
        XCTAssertEqual(analysis.releases[0].sellTheFact, true)
        XCTAssertNil(analysis.summary.breaks60m)
    }

    func testFreeIsLocked() throws {
        let json = #"{"event_id":"e0","available":false,"required_entitlement":"VIEW_ADVANCED_STATS","fx_pair":null,"analysis":null}"#
        let response = try decoder().decode(StrategyAnalysisResponse.self, from: Data(json.utf8))
        XCTAssertEqual(StrategyAnalysisViewModel.state(for: response), .locked)
    }

    func testNoPairAndDataPreparing() throws {
        let noPair = #"{"event_id":"e0","available":true,"required_entitlement":null,"fx_pair":null,"analysis":null}"#
        XCTAssertEqual(StrategyAnalysisViewModel.state(for: try decoder().decode(StrategyAnalysisResponse.self, from: Data(noPair.utf8))), .noPair)

        let preparing = #"""
        {"event_id":"e0","available":true,"required_entitlement":null,"fx_pair":{"fx_pair_id":"p1","symbol":"USDJPY"},
         "analysis":{"status":"DATA_PREPARING","sample_window":5,"minimum_samples":3,"releases":[],
          "summary":{"direction_1m":null,"breaks_15m":null,"breaks_60m":null,"pattern_15m":null,"sell_the_fact":null}}}
        """#
        let response = try decoder().decode(StrategyAnalysisResponse.self, from: Data(preparing.utf8))
        guard case .loaded(_, let analysis) = StrategyAnalysisViewModel.state(for: response) else { return XCTFail("expected loaded") }
        XCTAssertFalse(analysis.isReady)
        // 足りない項目は傾向を書かず「分析データ準備中」
        XCTAssertEqual(StrategyAnalysisText.directionLine(analysis.summary.direction1m), "分析データ準備中")
        XCTAssertEqual(StrategyAnalysisText.breakLine(analysis.summary.breaks15m), "分析データ準備中")
        XCTAssertEqual(StrategyAnalysisText.patternLine(analysis.summary.pattern15m), "分析データ準備中")
        XCTAssertTrue(StrategyAnalysisText.sellTheFactLine(analysis.summary.sellTheFact).hasPrefix("分析データ準備中"))
    }

    func testSummaryLinesOnlyCountWhatWasStored() throws {
        let response = try decoder().decode(StrategyAnalysisResponse.self, from: Data(readyJSON.utf8))
        let summary = try XCTUnwrap(response.analysis?.summary)
        XCTAssertEqual(StrategyAnalysisText.directionLine(summary.direction1m), "上昇 3回・下落 1回（4回中）")
        XCTAssertEqual(StrategyAnalysisText.breakLine(summary.breaks15m), "高値ブレイク 2回・安値ブレイク 2回（4回中）")
        XCTAssertEqual(StrategyAnalysisText.patternLine(summary.pattern15m), "続いた 3回・反転 1回（4回中）")
        XCTAssertEqual(
            StrategyAnalysisText.sellTheFactLine(StrategySellTheFactSummary(occurred: 2, samples: 3)),
            "2回（結果が良かった3回中）"
        )
    }

    func testReleaseRowsDoNotMakeUpMissingValues() throws {
        let response = try decoder().decode(StrategyAnalysisResponse.self, from: Data(readyJSON.utf8))
        let releases = try XCTUnwrap(response.analysis?.releases)
        let judged = releases[0]
        XCTAssertEqual(StrategyAnalysisText.direction(judged), "↑ +5.0")
        XCTAssertEqual(StrategyAnalysisText.breaks(high: judged.highBreak15m, low: judged.lowBreak15m), "安値")
        XCTAssertEqual(StrategyAnalysisText.pattern(judged), "反転")
        XCTAssertEqual(StrategyAnalysisText.surprise(judged), "予想比 +0.2")
        XCTAssertEqual(StrategyAnalysisText.sellTheFact(judged), "該当")

        let missing = releases[1]
        XCTAssertEqual(StrategyAnalysisText.direction(missing), "--")
        XCTAssertEqual(StrategyAnalysisText.breaks(high: missing.highBreak15m, low: missing.lowBreak15m), "--")
        XCTAssertEqual(StrategyAnalysisText.pattern(missing), "--")
        XCTAssertEqual(StrategyAnalysisText.surprise(missing), "予想なし")
        XCTAssertEqual(StrategyAnalysisText.sellTheFact(missing), "--")
    }

    func testNotesDoNotRecommendTrades() {
        let notes = StrategyAnalysisText.notes.joined()
        XCTAssertTrue(notes.contains("売買の推奨ではありません"))
        XCTAssertTrue(notes.contains("どちらが先に起きたかは判定していません"))
        for word in ["勝率", "利益", "買い推奨", "売り推奨"] {
            XCTAssertFalse(notes.contains(word), word)
        }
    }
}
