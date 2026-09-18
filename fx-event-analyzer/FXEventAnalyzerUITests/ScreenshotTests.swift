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
        app.launch()
    }

    func testCaptureAllScreens() throws {
        // SCR-000 Splash — bonus, not in HQ's required 7; the real init
        // sequence (SplashViewModel) resolves in well under a second when
        // there is no persisted session (a fresh Simulator install always
        // starts this way), so this is best-effort only and may already
        // show Login.
        capture("00-Splash-bestEffort", settle: 0)

        // SCR-010 Login — also bonus, but required to reach every other
        // screen, so always exercised.
        let emailField = app.textFields["メールアドレス"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 20), "Login screen did not appear")
        capture("01-Login")

        emailField.tap()
        emailField.typeText("ui-screenshot@example.com")
        app.secureTextFields["パスワード"].tap()
        app.secureTextFields["パスワード"].typeText("ui-screenshot-password")
        app.buttons["ログイン"].tap()

        // SCR-001 Home (required #1)
        XCTAssertTrue(app.tabBars.buttons["Home"].waitForExistence(timeout: 20), "Home tab did not appear after login")
        XCTAssertTrue(
            waitForAnyElement(containing: "米国CPI", timeout: 15),
            "Home did not load event data from the mock Backend"
        )
        capture("02-Home")

        // SCR-004 Event Detail (required #2, via Home's event card)
        tap(containing: "米国CPI(消費者物価指数)")
        XCTAssertTrue(waitForAnyElement(containing: "Surprise", timeout: 15), "Event Detail did not load")
        capture("03-EventDetail")

        // SCR-005 Movement Detail (required #3, via Event Detail's related FX pair row)
        tap(containing: "USDJPY")
        XCTAssertTrue(waitForAnyElement(containing: "過去の値動きと比較する", timeout: 15), "Movement Detail did not load")
        capture("04-MovementDetail")

        // SCR-006 Historical Comparison (required #4, via Movement Detail's link)
        tap(containing: "過去の値動きと比較する")
        XCTAssertTrue(waitForAnyElement(containing: "過去のイベント", timeout: 15), "Historical Comparison did not load")
        capture("05-HistoricalComparison")

        // SCR-007 Historical Event Detail (required #5, via a comparison event row)
        tap(containing: "Surprise")
        XCTAssertTrue(waitForAnyElement(containing: "指標詳細を見る", timeout: 15), "Historical Event Detail did not load")
        capture("06-HistoricalEventDetail")

        // SCR-002 Indicators (required #6, via tab bar — independent nav path)
        app.tabBars.buttons["Indicators"].tap()
        XCTAssertTrue(waitForAnyElement(containing: "米国CPI", timeout: 15), "Indicators list did not load")
        capture("07-Indicators")

        // SCR-003 Indicator Detail (required #7)
        tap(containing: "米国CPI(消費者物価指数)")
        XCTAssertTrue(waitForAnyElement(containing: "米国CPI", timeout: 15), "Indicator Detail did not load")
        capture("08-IndicatorDetail")
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
