import XCTest
@testable import FXEventAnalyzer

/// HQ指示(2026-11-04)「相場反応詳細画面の分析が表示されない問題を修正」: 「相場反応の分析」の文は、実際の値動き
/// (各時間の pips・最大の上下の幅)と、指標なら結果・予想・前回だけから作る。理由は断定しない。データが足りなければnil。
final class ReactionAnalysisTextTests: XCTestCase {
    private func entry(
        _ timeframe: String, _ pips: Double?, up: Double? = nil, down: Double? = nil, status: DataQualityStatus = .ready
    ) -> ReactionTimeframeEntry {
        ReactionTimeframeEntry(timeframe: timeframe, postReleasePrice: nil, movement: nil, pips: pips, changePercent: nil,
                               maxUpward: nil, maxDownward: nil, maxUpwardPips: up, maxDownwardPips: down, analysisStatus: status)
    }

    /// 実機の画面(2026-11-04、発言、USD/JPY)と同じ値: 初動 -0.6、15分後 -35.4。
    private var speechReactions: [ReactionTimeframeEntry] {
        [entry("1m", -0.6, up: 0.4, down: -1.2), entry("5m", -14.8, up: 0.9, down: -15.6), entry("15m", -35.4, up: 0.9, down: -37.1)]
    }

    func testContinuationGrowsWithTheRatio() {
        let analysis = MovementAnalysisText.reactionAnalysis(reactions: speechReactions, selectedTimeframe: "15m", noun: "発言")
        XCTAssertEqual(analysis?.sentences.first, "初動の下落が続き、15分後には初動の約59倍の値幅になった。")
    }

    func testSelectedTimeframeSwitchesTheExcursionSentence() {
        let fifteen = MovementAnalysisText.reactionAnalysis(reactions: speechReactions, selectedTimeframe: "15m", noun: "発言")
        XCTAssertEqual(fifteen?.sentences.dropFirst(), ["15分の間に、最大で上に0.9pips、下に37.1pips動いた。", "15分後の価格は、この間の安値の近くだった。"])
        let one = MovementAnalysisText.reactionAnalysis(reactions: speechReactions, selectedTimeframe: "1m", noun: "発言")
        XCTAssertEqual(one?.sentences.dropFirst(), ["1分の間に、最大で上に0.4pips、下に1.2pips動いた。"])
        let five = MovementAnalysisText.reactionAnalysis(reactions: speechReactions, selectedTimeframe: "5m", noun: "発言")
        XCTAssertEqual(five?.sentences.last, "5分後の価格は、この間の安値の近くだった。")
    }

    func testReversalSmallerAndReturn() {
        XCTAssertEqual(
            MovementAnalysisText.reactionAnalysis(reactions: [entry("1m", 5), entry("15m", -3)], selectedTimeframe: "1m", noun: "発表")?.sentences,
            ["初動は上昇だったが、15分後には下落に転じた。"]
        )
        XCTAssertEqual(
            MovementAnalysisText.reactionAnalysis(reactions: [entry("1m", 10), entry("15m", 4)], selectedTimeframe: "1m", noun: "発表")?.sentences,
            ["15分後も初動と同じ上昇だが、値幅は初動より小さくなった。"]
        )
        XCTAssertEqual(
            MovementAnalysisText.reactionAnalysis(reactions: [entry("1m", 10), entry("15m", 12)], selectedTimeframe: "1m", noun: "発表")?.sentences,
            ["初動の上昇が15分後まで続いた。"]
        )
        XCTAssertEqual(
            MovementAnalysisText.reactionAnalysis(reactions: [entry("1m", -6), entry("15m", 0)], selectedTimeframe: "1m", noun: "発言")?.sentences,
            ["初動は下落したが、15分後には発言前の水準に戻った。"]
        )
        XCTAssertEqual(
            MovementAnalysisText.reactionAnalysis(reactions: [entry("1m", 0), entry("15m", 7)], selectedTimeframe: "1m", noun: "発表")?.sentences,
            ["初動はほぼ動かず、15分後に7pips上昇した。"]
        )
    }

    func testUsesFiveMinutesWhenFifteenIsMissing() {
        let analysis = MovementAnalysisText.reactionAnalysis(reactions: [entry("1m", -2), entry("5m", -8)], selectedTimeframe: "1m", noun: "発表")
        XCTAssertEqual(analysis?.sentences, ["初動の下落が続き、5分後には初動の約4倍の値幅になった。"])
    }

    func testEventResultForecastAndPreviousAreFactsOnly() {
        let both = MovementAnalysisText.reactionAnalysis(
            reactions: [entry("1m", -8.2), entry("15m", -41.3)], selectedTimeframe: "1m", noun: "発表",
            actual: 3.1, forecast: 3.2, previous: 3.0, unit: "%", hasGeneralView: true
        )
        XCTAssertEqual(both?.sentences.first, "結果は予想を0.1ポイント下回り、前回より0.1ポイント高かった。")
        XCTAssertEqual(both?.reasonUnavailable, false)

        let forecastOnly = MovementAnalysisText.reactionAnalysis(
            reactions: [entry("1m", -8.2), entry("15m", -41.3)], selectedTimeframe: "1m", noun: "発表", actual: 3.1, forecast: 3.1, unit: "%"
        )
        XCTAssertEqual(forecastOnly?.sentences.first, "結果は予想どおりだった。")

        let previousOnly = MovementAnalysisText.reactionAnalysis(
            reactions: [entry("1m", -8.2), entry("15m", -41.3)], selectedTimeframe: "1m", noun: "発表", actual: 3.1, previous: 3.1, unit: "%"
        )
        XCTAssertEqual(previousOnly?.sentences.first, "結果は前回と同じだった。")
    }

    func testReasonIsUnavailableWithoutAGeneralView() {
        // 発言には、値動きの理由の根拠になるデータ(指標の一般的な見方)が無い。推測で理由を書かない。
        let analysis = MovementAnalysisText.reactionAnalysis(reactions: speechReactions, selectedTimeframe: "15m", noun: "発言")
        XCTAssertEqual(analysis?.reasonUnavailable, true)
        XCTAssertFalse(analysis?.sentences.joined().contains("ため") ?? true, "no causal wording")
    }

    func testInsufficientDataIsNil() {
        XCTAssertNil(MovementAnalysisText.reactionAnalysis(reactions: [], selectedTimeframe: "1m", noun: "発言"))
        XCTAssertNil(MovementAnalysisText.reactionAnalysis(reactions: [entry("1m", nil, status: .dataPending)], selectedTimeframe: "1m", noun: "発言"))
        // 1つの時間だけで最大の幅も無ければ、関係も特徴も書けない。
        XCTAssertNil(MovementAnalysisText.reactionAnalysis(reactions: [entry("1m", -3)], selectedTimeframe: "1m", noun: "発言"))
        // 選んだ時間がまだ READY でなければ、その時間の特徴の文は出さない(関係の文だけ)。
        let partial = MovementAnalysisText.reactionAnalysis(
            reactions: [entry("1m", -3), entry("15m", -9), entry("5m", nil, status: .dataPending)], selectedTimeframe: "5m", noun: "発言"
        )
        XCTAssertEqual(partial?.sentences, ["初動の下落が続き、15分後には初動の約3倍の値幅になった。"])
    }

    func testFactsListFiveMinutesWhenAvailable() {
        let summary = MovementAnalysisText.summary(reactions: speechReactions, actual: nil, forecast: nil, unit: nil)
        XCTAssertEqual(summary?.facts.map(\.label), ["初動（1分）", "5分後", "15分後"])
        XCTAssertEqual(summary?.facts.map(\.value), ["-0.6 pips", "-14.8 pips", "-35.4 pips"])
    }
}
