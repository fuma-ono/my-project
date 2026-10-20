import XCTest
@testable import FXEventAnalyzer

final class LaunchDiagnosticsTests: XCTestCase {
    private func makeDiagnostics() -> LaunchDiagnostics {
        LaunchDiagnostics(launchID: UUID(), startedAt: Date())
    }

    func testDescribeDistinguishesNotMeasuredFromZeroMilliseconds() {
        XCTAssertEqual(LaunchDiagnostics.describe(nil), "未計測")
        XCTAssertEqual(LaunchDiagnostics.describe(0), "0ms")
    }

    func testDescribeSwitchesToSecondsAtOneThousandMilliseconds() {
        XCTAssertEqual(LaunchDiagnostics.describe(999), "999ms")
        XCTAssertEqual(LaunchDiagnostics.describe(1000), "1.00秒(1000ms)")
        XCTAssertEqual(LaunchDiagnostics.describe(30_125), "30.12秒(30125ms)")
    }

    func testSpanDurationIsNilWhenEitherEndpointIsMissing() {
        var diagnostics = makeDiagnostics()
        diagnostics.sessionCheckStartMs = 10
        // sessionCheckEndMs left unmeasured.
        let sessionSpan = diagnostics.spans[0]
        XCTAssertNil(sessionSpan.durationMs)
        XCTAssertFalse(sessionSpan.isMeasured)
    }

    func testSpanDurationIsComputedWhenBothEndpointsArePresent() {
        var diagnostics = makeDiagnostics()
        diagnostics.sessionCheckStartMs = 100
        diagnostics.sessionCheckEndMs = 340
        XCTAssertEqual(diagnostics.spans[0].durationMs, 240)
        XCTAssertTrue(diagnostics.spans[0].isMeasured)
    }

    func testUnaccountedMsIsNilWithoutATotal() {
        let diagnostics = makeDiagnostics()
        XCTAssertNil(diagnostics.totalUntilHomeReadyMs)
        XCTAssertNil(diagnostics.unaccountedMs)
    }

    /// 全区間がちょうど隙間なく埋まっていれば、区間外の時間は0になる
    /// (重複して足し合わせていないことの確認)。
    func testUnaccountedMsIsZeroWhenAllAdjacentSpansAreFullyMeasured() {
        var diagnostics = makeDiagnostics()
        diagnostics.sessionCheckStartMs = 0
        diagnostics.sessionCheckEndMs = 100
        diagnostics.splashFinishedMs = 200
        diagnostics.mainScreenAppearedMs = 250
        diagnostics.homeAuthTokenStartMs = 260
        diagnostics.homeAuthTokenEndMs = 310
        diagnostics.homeHTTPEndMs = 1310
        diagnostics.homeDecodeStartMs = 1310
        diagnostics.homeDecodeEndMs = 1340
        diagnostics.homeStateAppliedMs = 1341
        diagnostics.homeReadyToDisplayMs = 1400

        XCTAssertEqual(diagnostics.totalUntilHomeReadyMs, 1400)
        XCTAssertEqual(diagnostics.sumOfMeasuredSpansMs, 1400)
        XCTAssertEqual(diagnostics.unaccountedMs, 0)
    }

    /// セッション取得開始より前の時間(起動基準点からの空白)は、どの区間にも
    /// 入らないため、未計測の空白として残る。
    func testUnaccountedMsSurfacesTimeBeforeTheFirstMeasuredSpan() {
        var diagnostics = makeDiagnostics()
        diagnostics.sessionCheckStartMs = 5_000 // 基準点から5秒後にようやく最初の計測が始まった
        diagnostics.sessionCheckEndMs = 5_100
        diagnostics.splashFinishedMs = 5_200
        diagnostics.mainScreenAppearedMs = 5_250
        diagnostics.homeAuthTokenStartMs = 5_260
        diagnostics.homeAuthTokenEndMs = 5_310
        diagnostics.homeHTTPEndMs = 5_310
        diagnostics.homeDecodeStartMs = 5_310
        diagnostics.homeDecodeEndMs = 5_320
        diagnostics.homeStateAppliedMs = 5_320
        diagnostics.homeReadyToDisplayMs = 5_320

        XCTAssertEqual(diagnostics.totalUntilHomeReadyMs, 5_320)
        // 計測済み区間の合計は320ms(5000〜5320)ぶんだけ — 最初の5秒は
        // どの区間にも入っていない。
        XCTAssertEqual(diagnostics.sumOfMeasuredSpansMs, 320)
        XCTAssertEqual(diagnostics.unaccountedMs, 5_000)
    }

    func testOverallStatusDescriptionReflectsFailure() {
        var diagnostics = makeDiagnostics()
        diagnostics.sessionCheckOutcome = .failure
        XCTAssertEqual(diagnostics.overallStatusDescription, "一部の処理が失敗しました")
    }

    func testOverallStatusDescriptionReflectsNotMeasuredBeforeFailure() {
        let diagnostics = makeDiagnostics()
        XCTAssertEqual(diagnostics.overallStatusDescription, "まだ起動シーケンスの途中です(一部未計測)")
    }

    func testOverallStatusDescriptionIsSuccessWhenEverythingSucceeded() {
        var diagnostics = makeDiagnostics()
        diagnostics.sessionCheckOutcome = .success
        diagnostics.runInitSequenceOutcome = .success
        diagnostics.homeRequestOutcome = .success
        XCTAssertEqual(diagnostics.overallStatusDescription, "すべて成功")
    }

    // MARK: - reportText: 秘匿情報不混入・必要項目の網羅

    func testReportTextNeverContainsSecretLookingContent() {
        var diagnostics = makeDiagnostics()
        diagnostics.sessionCheckStartMs = 0
        diagnostics.sessionCheckEndMs = 100
        diagnostics.homeHTTPStatusCode = 200
        let text = diagnostics.reportText(appVersion: "1.2.3", buildNumber: "45")

        for forbidden in ["Bearer", "Authorization", "accessToken", "access_token", "refreshToken", "eyJ", "apiKey", "api_key"] {
            XCTAssertFalse(text.contains(forbidden), "reportText must not contain \"\(forbidden)\"")
        }
    }

    func testReportTextIncludesVersionAndEachSpanLabel() {
        let diagnostics = makeDiagnostics()
        let text = diagnostics.reportText(appVersion: "1.2.3", buildNumber: "45")

        XCTAssertTrue(text.contains("1.2.3"))
        XCTAssertTrue(text.contains("45"))
        for span in diagnostics.spans {
            XCTAssertTrue(text.contains(span.label), "missing span label: \(span.label)")
            XCTAssertTrue(text.contains(span.startDescription))
            XCTAssertTrue(text.contains(span.endDescription))
        }
    }

    func testReportTextShowsNotMeasuredRatherThanZeroForUnmeasuredValues() {
        let diagnostics = makeDiagnostics()
        let text = diagnostics.reportText(appVersion: "1.0", buildNumber: "1")
        // 何も計測していない状態では、どの区間も"未計測"になるはず。
        XCTAssertTrue(text.contains("未計測"))
        XCTAssertFalse(text.contains(": 0ms"))
    }

    // MARK: - 前回の起動との間隔(HQ指示 2026-10-20「起動遅延の再調査」)

    func testIntervalSincePreviousDescriptionWhenThereIsNoPreviousLaunch() {
        let diagnostics = makeDiagnostics()
        XCTAssertEqual(diagnostics.intervalSincePreviousDescription(previous: nil), "前回の起動データがないため算出できません")
    }

    func testIntervalSincePreviousDescriptionUnderOneMinute() {
        let previous = LaunchDiagnostics(launchID: UUID(), startedAt: Date(timeIntervalSince1970: 1_000))
        let current = LaunchDiagnostics(launchID: UUID(), startedAt: Date(timeIntervalSince1970: 1_045))
        XCTAssertEqual(current.intervalSincePreviousDescription(previous: previous), "45秒")
    }

    func testIntervalSincePreviousDescriptionInMinutesAndSeconds() {
        let previous = LaunchDiagnostics(launchID: UUID(), startedAt: Date(timeIntervalSince1970: 0))
        // 20分ちょうど — Renderの無料プランのスリープ基準(15分)を超えた間隔。
        let current = LaunchDiagnostics(launchID: UUID(), startedAt: Date(timeIntervalSince1970: 1_200))
        XCTAssertEqual(current.intervalSincePreviousDescription(previous: previous), "20分0秒")
    }

    func testIntervalSincePreviousDescriptionInHoursAndMinutes() {
        let previous = LaunchDiagnostics(launchID: UUID(), startedAt: Date(timeIntervalSince1970: 0))
        let current = LaunchDiagnostics(launchID: UUID(), startedAt: Date(timeIntervalSince1970: 3_700)) // 1時間1分40秒
        XCTAssertEqual(current.intervalSincePreviousDescription(previous: previous), "1時間1分")
    }

    func testReportTextIncludesPreviousLaunchComparisonWhenAvailable() {
        let previous = LaunchDiagnostics(launchID: UUID(), startedAt: Date(timeIntervalSince1970: 0))
        let current = LaunchDiagnostics(launchID: UUID(), startedAt: Date(timeIntervalSince1970: 1_200))
        let text = current.reportText(appVersion: "1.0", buildNumber: "1", previous: previous)
        XCTAssertTrue(text.contains("前回の起動との間隔: 20分0秒"))
    }

    func testReportTextShowsNoPreviousLaunchWhenNoneIsPassed() {
        let diagnostics = makeDiagnostics()
        let text = diagnostics.reportText(appVersion: "1.0", buildNumber: "1")
        XCTAssertTrue(text.contains("前回の起動データ: なし"))
    }

    func testCodableRoundTrip() throws {
        var diagnostics = makeDiagnostics()
        diagnostics.sessionCheckStartMs = 12
        diagnostics.sessionCheckEndMs = 340
        diagnostics.sessionCheckOutcome = .success
        diagnostics.homeRequestCount = 2
        diagnostics.homeHTTPStatusCode = 200

        let data = try JSONEncoder().encode(diagnostics)
        let decoded = try JSONDecoder().decode(LaunchDiagnostics.self, from: data)

        XCTAssertEqual(decoded, diagnostics)
    }
}
