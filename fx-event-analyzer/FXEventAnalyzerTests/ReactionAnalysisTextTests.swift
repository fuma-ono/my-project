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
    // MARK: - レベル2: 過去との比較(HQ指示 2026-11-04「独自の相場分析」)

    private func past(_ id: String, _ m1: Double?, _ m5: Double?, _ m15: Double?, surprise: Double? = nil) -> MovementAnalysisText.PastReaction {
        var pips: [String: Double] = [:]
        if let m1 { pips["1m"] = m1 }
        if let m5 { pips["5m"] = m5 }
        if let m15 { pips["15m"] = m15 }
        return MovementAnalysisText.PastReaction(id: id, pips: pips, surprise: surprise)
    }

    func testPastComparisonCountsSizeDirectionReversalAndSurprise() {
        let current = [entry("1m", -8.2), entry("5m", -24.5), entry("15m", -40)]
        let history = [
            past("a", -5, -10, -20, surprise: -0.1),
            past("b", 4, 6, -10, surprise: -0.2),
            past("c", -3, -8, -10, surprise: -0.1),
            past("d", 2, 5, 10, surprise: 0.1),
        ]
        let lines = MovementAnalysisText.pastComparison(reactions: current, selectedTimeframe: "15m", past: history, currentSurprise: -0.1)
        XCTAssertEqual(lines, [
            "今回の15分後の値幅(40pips)は、過去4回の15分後の値幅の平均(上下を問わない、12.5pips)と比べて大きい。",
            "過去4回のうち、15分後に今回と同じく下落したのは3回だった。",
            "過去4回のうち、初動と15分後の向きが逆になった(反転した)のは1回で、今回は反転しなかった。",
            "過去に結果が予想を下回った3回のうち、15分後に下落したのは3回だった。",
            "(過去の回数を数えた結果で、今回の値動きの理由を示すものではない。)",
        ])
    }

    func testPastComparisonNeedsAtLeastThreeSamples() {
        let current = [entry("1m", -8.2), entry("15m", -40)]
        XCTAssertNil(MovementAnalysisText.pastComparison(
            reactions: current, selectedTimeframe: "15m", past: [past("a", -5, nil, -20), past("b", 4, nil, -10)], currentSurprise: nil
        ))
        // サプライズが同じ向きの過去が3回未満なら、サプライズ別の文は出さない。
        let lines = MovementAnalysisText.pastComparison(
            reactions: current, selectedTimeframe: "15m",
            past: [past("a", -5, nil, -20, surprise: -0.1), past("b", 4, nil, -10, surprise: 0.2), past("c", -3, nil, -10)],
            currentSurprise: -0.1
        )
        XCTAssertFalse(lines?.contains { $0.contains("予想を") } ?? true)
    }

    func testPastComparisonFollowsTheSelectedTimeframe() {
        let current = [entry("1m", -2), entry("5m", -6), entry("15m", -9)]
        let history = [past("a", -1, -2, -3), past("b", -1, -2, -3), past("c", 1, 2, 3)]
        let five = MovementAnalysisText.pastComparison(reactions: current, selectedTimeframe: "5m", past: history, currentSurprise: nil)
        XCTAssertEqual(five?.first, "今回の5分後の値幅(6pips)は、過去3回の5分後の値幅の平均(上下を問わない、2pips)と比べて大きい。")
        // 30分・60分を選んでいれば、過去のデータがある15分で比べる。
        let sixty = MovementAnalysisText.pastComparison(reactions: current, selectedTimeframe: "60m", past: history, currentSurprise: nil)
        XCTAssertEqual(sixty?.first, "今回の15分後の値幅(9pips)は、過去3回の15分後の値幅の平均(上下を問わない、3pips)と比べて大きい。")
    }

    /// HQ指示(2026-11-05)「相場反応分析の比較基準統一」: 反転の回数も選んでいる時間で数える。1分では出さない。
    func testReversalUsesTheSelectedTimeframe() {
        let current = [entry("1m", -2), entry("5m", 3), entry("15m", -9)]
        let history = [past("a", -1, 2, -3), past("b", -1, -2, -3), past("c", 1, 2, 3)]
        let five = MovementAnalysisText.pastComparison(reactions: current, selectedTimeframe: "5m", past: history, currentSurprise: nil)
        XCTAssertTrue(five?.contains("過去3回のうち、初動と5分後の向きが逆になった(反転した)のは1回で、今回は反転した。") ?? false, "\(five ?? [])")
        let fifteen = MovementAnalysisText.pastComparison(reactions: current, selectedTimeframe: "15m", past: history, currentSurprise: nil)
        XCTAssertTrue(fifteen?.contains("過去3回のうち、初動と15分後の向きが逆になった(反転した)のは0回で、今回は反転しなかった。") ?? false, "\(fifteen ?? [])")
        let one = MovementAnalysisText.pastComparison(reactions: current, selectedTimeframe: "1m", past: history, currentSurprise: nil)
        XCTAssertFalse(one?.contains { $0.contains("反転") } ?? true, "no reversal line for 1m")
    }

    /// 「過去の類似イベントとの比較」のカードは、文と同じ時間・回数・向きを問わない平均を使う。
    func testPastAverageMatchesTheComparisonSentence() {
        let current = [entry("1m", -8.2), entry("5m", -24.5), entry("15m", -40)]
        let history = [past("a", -5, -10, -20), past("b", 4, 6, -10), past("c", -3, -8, -10), past("d", 2, 5, 10)]
        for (selected, timeframe) in [("1m", "1m"), ("5m", "5m"), ("15m", "15m"), ("60m", "15m")] {
            let stats = MovementAnalysisText.pastAverage(reactions: current, selectedTimeframe: selected, past: history)
            XCTAssertEqual(stats?.timeframe, timeframe)
            XCTAssertEqual(stats?.count, 4)
            let span = MovementAnalysisText.label(timeframe) + "後"
            let first = MovementAnalysisText.pastComparison(reactions: current, selectedTimeframe: selected, past: history, currentSurprise: nil)?.first
            XCTAssertTrue(first?.contains("過去4回の\(span)の値幅の平均") ?? false, "\(first ?? "")")
        }
        // 向きを問わない平均: 1分は(5+4+3+2)/4、向き付きなら-0.5になる。
        XCTAssertEqual(MovementAnalysisText.pastAverage(reactions: current, selectedTimeframe: "1m", past: history)?.average, 3.5)
        XCTAssertEqual(MovementAnalysisText.pastAverage(reactions: current, selectedTimeframe: "15m", past: history)?.current, -40)
        // 過去が3回未満なら、カードも出さない(文の「分析データ不足」とそろえる)。
        XCTAssertNil(MovementAnalysisText.pastAverage(reactions: current, selectedTimeframe: "15m", past: Array(history.prefix(2))))
    }

    func testReactionAnalysisCarriesTheComparisonAndTheStatementSummary() {
        let long = String(repeating: "あ", count: 90)
        let analysis = MovementAnalysisText.reactionAnalysis(
            reactions: speechReactions, selectedTimeframe: "15m", noun: "発言",
            past: [past("a", -1, -2, -3), past("b", -1, -2, -3), past("c", 1, 2, 3)], statementSummary: long
        )
        XCTAssertNotNil(analysis?.comparison)
        XCTAssertEqual(analysis?.statementSummary, String(repeating: "あ", count: 80) + "…")
        XCTAssertEqual(analysis?.reasonUnavailable, true, "a summary is not a basis for the reason")

        let noHistory = MovementAnalysisText.reactionAnalysis(reactions: speechReactions, selectedTimeframe: "15m", noun: "発言", past: nil, statementSummary: "  ")
        XCTAssertNil(noHistory?.comparison, "no past data → 分析データ不足")
        XCTAssertNil(noHistory?.statementSummary)
    }
}

