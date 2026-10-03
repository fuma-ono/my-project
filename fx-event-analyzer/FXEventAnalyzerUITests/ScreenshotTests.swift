import XCTest

/// HQ instruction "FX Event Analyzer UIスクリーンショット取得" (2026-09-18):
/// drives the real, unmodified app (`FXEventAnalyzer` target — this test
/// target adds no code to it) against
/// `fx-event-analyzer-backend/scripts/ui-screenshot-mock-server.mjs`
/// (started by `.github/workflows/fx-event-analyzer-ui-screenshots.yml`
/// before this test runs; `SUPABASE_URL`/`API_BASE_URL` point at it, same
/// mechanism the real CI workflow uses for the real Backend) and captures
/// an `XCTAttachment` screenshot of each required screen so HQ can review
/// them as a GitHub Actions Artifact.
///
/// Runs only under the `FXEventAnalyzerUIScreenshots` scheme (project.yml)
/// — never under the `FXEventAnalyzer` scheme the existing
/// `fx-event-analyzer-ios-build.yml` workflow uses, so that workflow is
/// unaffected by this target's existence.
final class ScreenshotTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        // Capture as many of the 7 required screens as possible even if a
        // later navigation step fails, rather than aborting the whole run
        // on the first miss.
        continueAfterFailure = true
        app = XCUIApplication()
        // Holds SplashViewModel for 20s (test-only; see its doc comment) —
        // shorter than the 60s that previously broke app.launch() itself,
        // but still longer than the fastest launch+automation-session-setup
        // latency observed in real CI (~13s), so faster runs should still
        // catch Splash below.
        app.launchEnvironment["UI_SCREENSHOT_HOLD_SPLASH"] = "1"
        app.launch()
    }

    func testCaptureAllScreens() throws {
        // SCR-000 Splash — bonus, not in HQ's required 7. See setUpWithError
        // for the 20s hold; kept the "-bestEffort" name since a slower CI
        // runner (automation-session-setup alone has been observed up to
        // ~46s) can still miss it.
        capture("00-Splash-bestEffort", settle: 0)

        // SCR-010 Login — also bonus, but required to reach every other
        // screen, so always exercised. 35s, not 20s: up to the full 20s
        // hold can still be outstanding here depending on how long
        // automation-session-setup took before the Splash capture above.
        let emailField = app.textFields["メールアドレス"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 35), "Login screen did not appear")
        capture("01-Login")

        emailField.tap()
        emailField.typeText("ui-screenshot@example.com")
        app.secureTextFields["パスワード"].tap()
        app.secureTextFields["パスワード"].typeText("ui-screenshot-password")
        app.buttons["ログイン"].tap()

        // SCR-001 Home (required #1). Not app.tabBars.buttons["Home"] —
        // iPadOS's adaptive tab bar (floating/sidebar depending on size
        // class) doesn't always expose as a `TabBar`-typed accessibility
        // element the way iPhone's bottom tab bar does (real iPad CI
        // failure: "No matches found for Descendants matching type
        // TabBar"), so search broadly instead of assuming a container type.
        XCTAssertTrue(waitForAnyElement(containing: "ホーム", timeout: 20), "Home tab did not appear after login")
        // HQ指示(2026-10-03、9回目)「今日の重要イベントはホームから削除
        // します」により、Homeの最初に見えるカードは「通貨ペア」になった
        // (以前の「米国雇用統計」待機は、その節が削除されたため使えない)。
        XCTAssertTrue(
            waitForAnyElement(containing: "通貨ペア", timeout: 15),
            "Home did not load major FX data from the mock Backend"
        )

        // SCR-002 Indicators (required #6, via tab bar — independent nav
        // path). Same reasoning as the Home tab wait above — use the
        // broad-search helper, not a `tabBars`-typed query.
        tap(containing: "指標一覧")
        XCTAssertTrue(waitForAnyElement(containing: "米国CPI", timeout: 15), "Indicators list did not load")
        capture("07-Indicators")

        // SCR-003 Indicator Detail (required #7)
        tap(containing: "米国CPI(消費者物価指数)")
        XCTAssertTrue(waitForAnyElement(containing: "米国CPI", timeout: 15), "Indicator Detail did not load")
        capture("08-IndicatorDetail")

        // HQ指示(2026-10-03、6回目)「通貨ペアの下にお気に入りを作成して
        // ください」: Homeの「お気に入り」カードは`FavoritesStore`(端末
        // ローカル)が空だと非表示になる(`HomeView`の`if !favorites.isEmpty`)
        // ため、参考画像通りカードを表示させるには実際に★を1件登録する
        // 必要がある。架空データを足すのではなく、実在のモック指標
        // (米国CPI)を実際にお気に入り登録する。
        tapIdentifier("v5HeaderFavoriteStar")

        // SCR-004 Event Detail (required #2)。「今日の重要イベント」削除に
        // 伴い、Home経由の導線が無くなったため、Indicator Detailの
        // 「次回発表予定」エリア(2026-10-03、9回目の配線)から遷移する。
        tap(containing: "次回発表予定")
        XCTAssertTrue(waitForAnyElement(containing: "発表日時", timeout: 15), "Event Detail did not load")
        capture("03-EventDetail")

        // SCR-005 Movement Detail (required #3, via Event Detail's related FX pair row)
        tap(containing: "USDJPY")
        XCTAssertTrue(waitForAnyElement(containing: "過去の値動きと比較する", timeout: 15), "Movement Detail did not load")
        capture("04-MovementDetail")

        // SCR-006 Historical Comparison (required #4, via Movement Detail's link)
        tap(containing: "過去の値動きと比較する")
        XCTAssertTrue(waitForAnyElement(containing: "過去の発表一覧", timeout: 15), "Historical Comparison did not load")
        capture("05-HistoricalComparison")

        // SCR-007 Historical Event Detail (required #5, via a comparison
        // event row). Row text is variable mock data (dates/numbers), not a
        // stable literal, so the row carries its own accessibility
        // identifier for this tap instead of matching on displayed text.
        tapIdentifier("historyEventRow")
        XCTAssertTrue(waitForAnyElement(containing: "指標詳細を見る", timeout: 15), "Historical Event Detail did not load")
        capture("06-HistoricalEventDetail")

        // 02-Home (required #1の実キャプチャ)。上でお気に入り登録した
        // 米国CPIが「お気に入り」カードに実際に表示された状態でHomeに戻って
        // 撮る — 参考画像通りの3セクション(通貨ペア/お気に入り/直近の
        // 要人発言)構成をそのまま確認できる。
        tap(containing: "ホーム")
        XCTAssertTrue(waitForAnyElement(containing: "米国CPI", timeout: 15), "Home did not show the newly-favorited indicator")
        capture("02-Home")

        // SCR-016 Settings (bonus, not in HQ's original required 7 — added
        // 2026-09-30 so HQ's reference-image-driven redesign of this screen
        // has a real CI capture to verify against, the same "never trust
        // build-succeeds alone" rule Splash/Login screenshots follow).
        tap(containing: "設定")
        XCTAssertTrue(waitForAnyElement(containing: "アカウント情報", timeout: 15), "Settings did not load")
        capture("09-Settings")

        // SCR-011 Analysis tab (bonus — added 2026-09-30 so the bottom tab
        // bar's *selected*-state rendering for the "分析" tab has a real CI
        // capture to verify against; no other capture in this test ever
        // selects it, and HQ's feedback rounds on this tab specifically
        // needed that state visible).
        tap(containing: "分析")
        XCTAssertTrue(waitForAnyElement(containing: "チャート分析", timeout: 15), "Analysis tab did not load")
        capture("10-Analysis")
    }

    // MARK: - Helpers

    private func capture(_ name: String, settle: TimeInterval = 0.6) {
        if settle > 0 {
            Thread.sleep(forTimeInterval: settle)
        }
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// SwiftUI exposes a `NavigationLink` row as different XCUITest element
    /// types depending on its container (`List` vs plain `VStack`/
    /// `ScrollView`) and OS version — this tries the common ones in order
    /// rather than assuming one.
    private func tap(containing text: String, timeout: TimeInterval = 10) {
        let predicate = NSPredicate(format: "label CONTAINS[c] %@", text)
        let collections: [XCUIElementQuery] = [app.buttons, app.cells, app.otherElements, app.staticTexts]
        let deadline = Date().addingTimeInterval(timeout)
        var swipeAttempts = 0
        while Date() < deadline {
            for collection in collections {
                let element = collection.matching(predicate).firstMatch
                guard element.exists else { continue }
                if element.isHittable {
                    element.tap()
                    return
                }
                // Found in the accessibility tree (e.g. a ScrollView row
                // rendered off-screen) but not yet hittable — scroll and
                // retry rather than waiting out the timeout. Real failure
                // seen in CI on Historical Comparison's event list: 06-
                // HistoricalEventDetail came out as a stale screenshot of
                // Historical Comparison because this case wasn't handled.
                if swipeAttempts < 8 {
                    app.swipeUp()
                    swipeAttempts += 1
                }
            }
            Thread.sleep(forTimeInterval: 0.3)
        }
        XCTFail("Could not find a tappable element containing '\(text)' within \(timeout)s")
    }

    /// Same scroll-and-retry approach as `tap(containing:)`, but matches by
    /// `accessibilityIdentifier` instead of displayed text — for rows whose
    /// text is variable mock data (dates, numbers) rather than a stable
    /// literal.
    private func tapIdentifier(_ identifier: String, timeout: TimeInterval = 10) {
        let collections: [XCUIElementQuery] = [app.buttons, app.cells, app.otherElements]
        let deadline = Date().addingTimeInterval(timeout)
        var swipeAttempts = 0
        while Date() < deadline {
            for collection in collections {
                let element = collection.matching(identifier: identifier).firstMatch
                guard element.exists else { continue }
                if element.isHittable {
                    element.tap()
                    return
                }
                if swipeAttempts < 8 {
                    app.swipeUp()
                    swipeAttempts += 1
                }
            }
            Thread.sleep(forTimeInterval: 0.3)
        }
        XCTFail("Could not find a tappable element with identifier '\(identifier)' within \(timeout)s")
    }

    private func waitForAnyElement(containing text: String, timeout: TimeInterval) -> Bool {
        let predicate = NSPredicate(format: "label CONTAINS[c] %@", text)
        let collections: [XCUIElementQuery] = [app.staticTexts, app.buttons, app.cells, app.otherElements]
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            for collection in collections where collection.matching(predicate).firstMatch.exists {
                return true
            }
            Thread.sleep(forTimeInterval: 0.3)
        }
        return false
    }
}
