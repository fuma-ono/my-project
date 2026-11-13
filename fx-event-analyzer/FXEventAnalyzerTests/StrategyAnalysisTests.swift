import XCTest
@testable import FXEventAnalyzer

/// Pro イベント別トレード戦略分析(HQ指示 2026-11-06、api-design v1.48)。応答の読み込み、FREE のロック、データ準備中、
/// 判定できない値を作らない表示を確かめる。
/// HQ指示(2026-11-07「イベント別トレード戦略分析の完成・統合」): 高値・安値ブレイクの合計が発表数を超えうることの
/// 注記(breakOverlapNote)と、403などの権限エラーを通信失敗と区別する表示(.notEntitled)も確かめる。
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
     "co_released_indicators":[{"indicator_id":"ind-unrate","indicator_code":"US_UNEMPLOYMENT_RATE"}],
     "analysis":{"status":"READY","sample_window":5,"minimum_samples":3,
      "releases":[
        {"event_id":"e1","release_datetime":"2026-10-14T12:30:00Z","forecast":3.0,"actual":3.2,"surprise":0.2,"surprise_direction":"POSITIVE",
         "direction_1m":"UP","pips_1m":5,"pips_5m":7,"pips_15m":-9,"pips_30m":-10,"pips_60m":-11,"pattern_15m":"REVERSAL",
         "high_break_15m":false,"low_break_15m":true,"high_break_60m":false,"low_break_60m":true,
         "round_trip_15m":false,"round_trip_60m":false,"sell_the_fact":true},
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
        guard case .loaded(let pair, let analysis, let coReleasedIndicators) = StrategyAnalysisViewModel.state(for: response) else {
            return XCTFail("expected loaded")
        }
        XCTAssertEqual(pair.symbol, "USDJPY")
        XCTAssertTrue(analysis.isReady)
        XCTAssertEqual(analysis.releases.map(\.id), ["e1", "e2"])
        XCTAssertEqual(analysis.releases[0].sellTheFact, true)
        XCTAssertNil(analysis.summary.breaks60m)
        XCTAssertEqual(coReleasedIndicators, [StrategyCoReleasedIndicator(indicatorId: "ind-unrate", indicatorCode: "US_UNEMPLOYMENT_RATE")])
    }

    /// HQ指示(2026-11-10「重複排除・集計改善・AI分析基盤の整備」STEP1・STEP3): 同時発表の他の指標、5分・30分・60分の
    /// 値動き、往復(round_trip)を読み込めること。
    func testDecodesCoReleasedIndicatorsAndRiskCharacteristics() throws {
        let response = try decoder().decode(StrategyAnalysisResponse.self, from: Data(readyJSON.utf8))
        XCTAssertEqual(
            response.coReleasedIndicators,
            [StrategyCoReleasedIndicator(indicatorId: "ind-unrate", indicatorCode: "US_UNEMPLOYMENT_RATE")]
        )
        let judged = try XCTUnwrap(response.analysis?.releases.first)
        XCTAssertEqual(judged.pips5m, 7)
        XCTAssertEqual(judged.pips30m, -10)
        XCTAssertEqual(judged.pips60m, -11)
        XCTAssertEqual(judged.roundTrip15m, false)
        XCTAssertEqual(judged.roundTrip60m, false)
    }

    /// available が false のとき、co_released_indicators はキーごと省略される(nil)。
    func testCoReleasedIndicatorsIsNilWhenLocked() throws {
        let json = #"{"event_id":"e0","available":false,"required_entitlement":"VIEW_ADVANCED_STATS","fx_pair":null,"analysis":null}"#
        let response = try decoder().decode(StrategyAnalysisResponse.self, from: Data(json.utf8))
        XCTAssertNil(response.coReleasedIndicators)
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
        guard case .loaded(_, let analysis, let coReleasedIndicators) = StrategyAnalysisViewModel.state(for: response) else {
            return XCTFail("expected loaded")
        }
        XCTAssertEqual(coReleasedIndicators, []) // co_released_indicatorsが応答に無ければ空配列(nilではない)
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

    /// HQ指示(2026-11-07)「件数の合計が対象イベント数を超える場合があることをUI上で誤解させない」。
    func testBreakOverlapNoteOnlyWhenBothCanOverlap() throws {
        // both = 0: 高値・安値の合計(2+2=4)がsamples(4)を超えないため、誤解の余地が無く注記しない。
        XCTAssertNil(StrategyAnalysisText.breakOverlapNote(StrategyBreakSummary(high: 2, low: 2, both: 0, neither: 0, samples: 4)))
        // both = 1: 高値・安値の合計(3+2=5)がsamples(4)を超えるため注記する。
        let note = StrategyAnalysisText.breakOverlapNote(StrategyBreakSummary(high: 3, low: 2, both: 1, neither: 0, samples: 4))
        XCTAssertEqual(note, "うち両方抜けた回 1回・どちらも抜けていない回 0回（高値・安値ブレイクの回数の合計が発表数を超えることがあります）")
        XCTAssertNil(StrategyAnalysisText.breakOverlapNote(nil))
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

    /// 高値のみ・安値のみ・両方・どちらもなし・判定不能の5分類(HQ指示 2026-11-07)。
    func testBreaksClassifiesIntoFiveCategories() {
        XCTAssertEqual(StrategyAnalysisText.breaks(high: true, low: false), "高値")
        XCTAssertEqual(StrategyAnalysisText.breaks(high: false, low: true), "安値")
        XCTAssertEqual(StrategyAnalysisText.breaks(high: true, low: true), "高値・安値")
        XCTAssertEqual(StrategyAnalysisText.breaks(high: false, low: false), "なし")
        XCTAssertEqual(StrategyAnalysisText.breaks(high: nil, low: nil), "--")
        XCTAssertEqual(StrategyAnalysisText.breaks(high: true, low: nil), "--")
    }

    func testNotesDoNotRecommendTrades() {
        let notes = StrategyAnalysisText.notes.joined()
        XCTAssertTrue(notes.contains("売買の推奨ではありません"))
        XCTAssertTrue(notes.contains("どちらが先に起きたかは判定していません"))
        for word in ["勝率", "利益", "買い推奨", "売り推奨"] {
            XCTAssertFalse(notes.contains(word), word)
        }
    }

    /// HQ指示(2026-11-07)「画面上部に注意書きを表示する」: 既存の詳しい注意事項(notes)とは別に、
    /// 指定の文言をそのまま持つこと。
    func testTopDisclaimerMatchesTheRequiredWording() {
        XCTAssertEqual(
            StrategyAnalysisText.topDisclaimer,
            "過去の値動きの統計です。1分足の欠損などにより判定できない場合があります。売買推奨ではありません。"
        )
    }

    /// HQ指示(2026-11-07)「403などの権限エラーを単なる通信失敗として扱わず、適切な表示にする」。
    func testForbiddenAndRelatedErrorsAreNotEntitledNotAGenericFailure() {
        for code: APIErrorCode in [.featureNotEntitled, .subscriptionRequired, .forbidden, .unauthorized] {
            let error = APIError.server(code: code, message: "denied", httpStatus: 403)
            XCTAssertEqual(StrategyAnalysisViewModel.state(forError: error), .notEntitled, "\(code) should map to .notEntitled")
        }
        // 他のサーバーエラー(例: INTERNAL_ERROR)は通信失敗のまま。
        let serverError = APIError.server(code: .internalError, message: "boom", httpStatus: 500)
        guard case .error = StrategyAnalysisViewModel.state(forError: serverError) else {
            return XCTFail("expected a generic .error state for INTERNAL_ERROR")
        }
        guard case .notFound = StrategyAnalysisViewModel.state(forError: .server(code: .eventNotFound, message: "", httpStatus: 404)) else {
            return XCTFail("expected .notFound for EVENT_NOT_FOUND")
        }
    }

    /// HQ指示(2026-11-07「画面デザインの変更」): 色分けした件数タイルに添えるパーセンテージ。
    func testPercentOfSamples() {
        XCTAssertEqual(StrategyAnalysisText.percentOfSamples(2, 4), "50%")
        XCTAssertEqual(StrategyAnalysisText.percentOfSamples(1, 4), "25%")
        XCTAssertEqual(StrategyAnalysisText.percentOfSamples(0, 4), "0%")
        XCTAssertEqual(StrategyAnalysisText.percentOfSamples(1, 3), "33.3%")
        // samplesが0(作れない)なら値を作らない。
        XCTAssertEqual(StrategyAnalysisText.percentOfSamples(0, 0), "--")
    }

    /// HQ指示(2026-11-10 STEP5): 「件数が足りない」と「この指標はそもそも予想値が無い」を区別する。
    /// 構造的に判定できない(予想が無い)指標は、件数が増えても「分析データ準備中」のままにならないことを示す文言にする。
    func testSellTheFactLineDistinguishesNoForecastFromInsufficientSamples() throws {
        func releases(forecasts: [Double?]) throws -> [StrategyRelease] {
            let items = forecasts.enumerated().map { index, forecast in
                let forecastJSON = forecast.map { "\($0)" } ?? "null"
                return #"""
                {"event_id":"e\#(index)","release_datetime":"2026-01-0\#(index + 1)T00:00:00Z",
                 "forecast":\#(forecastJSON),"actual":1.0,"surprise":null,"surprise_direction":null,
                 "direction_1m":null,"pips_1m":null,"pips_15m":null,"pattern_15m":null,
                 "high_break_15m":null,"low_break_15m":null,"high_break_60m":null,"low_break_60m":null,"sell_the_fact":null}
                """#
            }
            let json = "[\(items.joined(separator: ","))]"
            return try decoder().decode([StrategyRelease].self, from: Data(json.utf8))
        }

        XCTAssertEqual(
            StrategyAnalysisText.sellTheFactLine(nil, releases: try releases(forecasts: [3.0, nil, 2.9])),
            "分析データ準備中（予想と結果がそろった発表が足りません）"
        )
        XCTAssertEqual(
            StrategyAnalysisText.sellTheFactLine(nil, releases: try releases(forecasts: [nil, nil, nil])),
            "分析データ準備中（この指標は予想値が無く、判定できません）"
        )
        // releasesを渡さない既存の呼び出しは、互換のため「件数不足」側の文言のまま。
        XCTAssertTrue(StrategyAnalysisText.sellTheFactLine(nil).hasPrefix("分析データ準備中"))
    }

    /// 発表ごとの実績の表で、高値・安値ブレイクを個別に出すセル文言。
    func testBreakCell() {
        XCTAssertEqual(StrategyAnalysisText.breakCell(true), "あり")
        XCTAssertEqual(StrategyAnalysisText.breakCell(false), "なし")
        XCTAssertEqual(StrategyAnalysisText.breakCell(nil), "--")
    }

    /// HQ指示(2026-11-11「StrategyAnalysis 4タブUI実装」): 4タブが指示どおりの順序・名前で
    /// 揃っていることを確かめる(イベント戦略・通貨分析・価格帯分析・AI分析)。
    func testStrategyAnalysisTabsOrderAndTitles() {
        XCTAssertEqual(
            StrategyAnalysisTab.allCases.map(\.title),
            ["イベント戦略", "通貨分析", "価格帯分析", "AI分析"]
        )
    }

    /// CIで原因調査した不具合(日本語のaccessibilityIdentifierはXCUITestのmatching(identifier:)で
    /// 一度も見つからず、タブがタップできなくなっていた)の再発防止。このアプリの既存の
    /// accessibilityIdentifierは全てASCIIのみのため、testIdentifierも同じ慣習を守る。
    func testStrategyAnalysisTabTestIdentifiersAreASCIIAndUnique() {
        let identifiers = StrategyAnalysisTab.allCases.map(\.testIdentifier)
        XCTAssertTrue(identifiers.allSatisfy { $0.allSatisfy(\.isASCII) }, "testIdentifier must be ASCII-only")
        XCTAssertEqual(Set(identifiers).count, identifiers.count, "testIdentifier must be unique per tab")
    }

    /// HQ指示(2026-11-11「ピクセル単位の再現」フィードバック対応): ①イベント戦略タブの新しい
    /// ゲージ・折れ線グラフ用に追加した、既存の実データ(StrategyRelease)を単純平均するだけの
    /// 補助。新しい値を作らず、値が無ければnilのままであることを確かめる。
    func testAveragePipsOnlyUsesStoredValues() throws {
        let response = try decoder().decode(StrategyAnalysisResponse.self, from: Data(readyJSON.utf8))
        let releases = try XCTUnwrap(response.analysis?.releases)
        // e1はpips1m=5のみ、e2は全てnil → 平均は5(nilの発表は数に入れない)。
        XCTAssertEqual(releases.averagePips(\.pips1m), 5)
        XCTAssertEqual(releases.averagePips(\.pips5m), 7)
        // 誰もpips判定できない項目はnilのまま(0や作った値を入れない)。
        XCTAssertNil([StrategyRelease]().averagePips(\.pips1m))
    }

    func testRoundTripRateOnlyCountsJudgedReleases() throws {
        let response = try decoder().decode(StrategyAnalysisResponse.self, from: Data(readyJSON.utf8))
        let releases = try XCTUnwrap(response.analysis?.releases)
        // e1はroundTrip15m=false、e2はnil(キーなし) → 判定できた1件のうち0件が往復 = 0%。
        XCTAssertEqual(releases.roundTripRate(\.roundTrip15m), 0)
        XCTAssertNil([StrategyRelease]().roundTripRate(\.roundTrip15m))
    }

    /// HQ指示(2026-11-11): リスクレベルは反転率から導く。データが無ければ「データ不足」のまま
    /// (架空のレベルを作らない)。
    func testRiskLevelThresholds() {
        XCTAssertEqual(StrategyAnalysisText.riskLevel(reversalPercent: nil), "データ不足")
        XCTAssertEqual(StrategyAnalysisText.riskLevel(reversalPercent: 10), "低")
        XCTAssertEqual(StrategyAnalysisText.riskLevel(reversalPercent: 25), "中")
        XCTAssertEqual(StrategyAnalysisText.riskLevel(reversalPercent: 50), "高")
    }
}
