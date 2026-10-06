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
        // SCR-000 Splash — bonus. See setUpWithError for the 20s hold; kept
        // the "-bestEffort" name since a slower CI runner
        // (automation-session-setup alone has been observed up to ~46s) can
        // still miss it.
        capture("00-Splash-bestEffort", settle: 0)

        // SCR-001 ログイン画面 — also bonus, but required to reach every
        // other screen, so always exercised. 35s, not 20s: up to the full
        // 20s hold can still be outstanding here depending on how long
        // automation-session-setup took before the Splash capture above.
        let emailField = app.textFields["メールアドレス"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 35), "Login screen did not appear")
        capture("01-Login")

        type("ui-screenshot@example.com", into: emailField)
        type("ui-screenshot-password", into: app.secureTextFields["パスワード"])
        app.buttons["ログイン"].tap()

        // SCR-004 ホーム画面. Not app.tabBars.buttons["Home"] — iPadOS's
        // adaptive tab bar (floating/sidebar depending on size class)
        // doesn't always expose as a `TabBar`-typed accessibility element
        // the way iPhone's bottom tab bar does (real iPad CI failure: "No
        // matches found for Descendants matching type TabBar"), so search
        // broadly instead of assuming a container type.
        XCTAssertTrue(waitForAnyElement(containing: "ホーム", timeout: 20), "Home tab did not appear after login")
        XCTAssertTrue(
            waitForAnyElement(containing: "通貨ペア", timeout: 15),
            "Home did not load major FX data from the mock Backend"
        )

        // SCR-005 指標一覧(via タブバー — independent nav path)。HQ指示
        // (2026-10-03、画面構成全面更新)でタブラベルが「指標一覧」→
        // 「指標」に変わった(画面タイトル自体は引き続き「指標一覧」)。
        // Same reasoning as the Home tab wait above — use the broad-search
        // helper, not a `tabBars`-typed query.
        tap(containing: "指標")
        XCTAssertTrue(waitForAnyElement(containing: "米国CPI", timeout: 15), "Indicators list did not load")
        capture("05-Indicators")

        // SCR-006 指標詳細
        tap(containing: "米国CPI(消費者物価指数)")
        XCTAssertTrue(waitForAnyElement(containing: "米国CPI", timeout: 15), "Indicator Detail did not load")
        capture("06-IndicatorDetail")

        // HQ指示(2026-10-03、6回目)「通貨ペアの下にお気に入りを作成して
        // ください」: Homeの「お気に入り」カードは`FavoritesStore`(端末
        // ローカル)が空だと非表示になる(`HomeView`の`if !favorites.isEmpty`)
        // ため、参考画像通りカードを表示させるには実際に★を1件登録する
        // 必要がある。架空データを足すのではなく、実在のモック指標
        // (米国CPI)を実際にお気に入り登録する。
        tapIdentifier("v5HeaderFavoriteStar")

        // SCR-007 イベント詳細。「今日の重要イベント」削除に伴い、Home経由
        // の導線が無くなったため、Indicator Detailの「次回発表予定」エリア
        // から遷移する。
        tap(containing: "次回発表予定")
        XCTAssertTrue(waitForAnyElement(containing: "発表日時", timeout: 15), "Event Detail did not load")
        capture("07-EventDetail")

        // SCR-008 相場反応詳細(via Event Detail's related FX pair row)
        tap(containing: "USDJPY")
        XCTAssertTrue(waitForAnyElement(containing: "過去の値動きと比較する", timeout: 15), "Movement Detail did not load")
        capture("08-MovementDetail")

        // SCR-009 過去イベント比較(via Movement Detail's link)
        tap(containing: "過去の値動きと比較する")
        XCTAssertTrue(waitForAnyElement(containing: "過去の発表一覧", timeout: 15), "Historical Comparison did not load")
        capture("09-HistoricalComparison")

        // HQ指示(2026-10-03、画面構成全面更新)「旧『過去イベント詳細』の
        // 独立画面は作成しない」により、過去の発表行は独立画面ではなく
        // SCR-008 相場反応詳細(上で既に撮影済みの08と同じ画面構成)へ
        // 直接遷移するようになった。ここでは遷移が壊れていないことだけを
        // 確認し、視覚的に重複するスクリーンショットは撮らない。行の
        // 文字は可変のモックデータ(日付・数値)のため、固定の
        // accessibilityIdentifierでタップする。
        tapIdentifier("historyEventRow")
        XCTAssertTrue(waitForAnyElement(containing: "過去の値動きと比較する", timeout: 15), "Historical Comparison row did not navigate to SCR-008")

        // 04-Home(SCR-004の実キャプチャ)。上でお気に入り登録した米国CPIが
        // 「お気に入り」カードに実際に表示された状態でHomeに戻って撮る —
        // 参考画像通りの3セクション(通貨ペア/お気に入り/直近の要人発言)
        // 構成をそのまま確認できる。
        tap(containing: "ホーム")
        XCTAssertTrue(waitForAnyElement(containing: "米国CPI", timeout: 15), "Home did not show the newly-favorited indicator")
        capture("04-Home")

        // 通知一覧(HQ指示 2026-10-05「通知はホーム画面の通知マークを押したら
        // そこで確認できる仕様にして」)。ログイン時に`RootView`が
        // `GET /notifications/upcoming`を取り込み、モックの通知時刻を過ぎた
        // 2件が一覧に並ぶ。
        let bell = app.buttons["通知"]
        if bell.waitForExistence(timeout: 5) { bell.tap() } else { tap(containing: "通知") }
        XCTAssertTrue(waitForAnyElement(containing: "分前です", timeout: 15), "Notification list did not load")
        capture("04a-Notifications")

        // SCR-014 設定画面(bonus — added 2026-09-30 so HQ's
        // reference-image-driven redesign of this screen has a real CI
        // capture to verify against, the same "never trust build-succeeds
        // alone" rule Splash/Login screenshots follow).
        tap(containing: "設定")
        XCTAssertTrue(waitForAnyElement(containing: "アカウント情報", timeout: 15), "Settings did not load")
        capture("14-Settings")

        // SCR-010 経済カレンダー(bonus — HQ指示2026-10-03で旧「分析」タブ
        // (SCR-011、削除済み)から置き換わった新タブ。選択状態の
        // レンダリングを確認できるよう、タブ自体を撮る)。
        tap(containing: "カレンダー")
        XCTAssertTrue(waitForAnyElement(containing: "経済カレンダー", timeout: 15), "Calendar tab did not load")
        capture("10-Calendar")

        // SCR-016 / SCR-018 / SCR-019 (bonus — added 2026-10-02 with the
        // real settings sub-screens, same "never trust build-succeeds
        // alone" rule). Between captures, switching to Home and back
        // rebuilds SettingsView and so resets its NavigationStack to the
        // root — no need to find V5Header's unlabeled back chevron.
        captureSettingsSubScreen(row: "通知設定", rowIndex: 1, waitFor: "要人発言の通知", name: "16-NotificationSettings")
        // 通知しない時間帯をONにすると開始・終了の行が増える。それでも1画面に
        // 収まることを確かめる(HQ指示 2026-10-06)。
        // V5Viewport内のボタンは文字では押せないため、行の位置(V5座標、
        // 通知時間帯カードの1行目・中心y≈289)を直接タップする。
        tapV5(x: 117, y: 289)
        if !waitForAnyElement(containing: "開始", timeout: 5) {
            // iPadでは座標がずれることがあるため、スイッチそのものを押し直す。
            let toggle = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "通知しない時間帯")).firstMatch
            if toggle.exists {
                toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            }
        }
        // 撮れなくても他の画面の撮影は続ける(この1枚だけの確認用)。
        if waitForAnyElement(containing: "開始", timeout: 10) {
            capture("16b-NotificationQuietHours")
        }
        captureSettingsSubScreen(row: "プラン・購読管理", rowIndex: 2, waitFor: "特典内容の確認", name: "17-Subscription")
        captureSettingsSubScreen(row: "表示・地域設定", rowIndex: 3, waitFor: "タイムゾーン", name: "18-DisplaySettings")
        captureSettingsSubScreen(row: "チャート設定", rowIndex: 4, waitFor: "時間足", name: "19-ChartSettings")
        // SCR-015 アカウント情報 (added 2026-10-05 with the reference-image
        // rebuild) and SCR-024 アカウント削除, opened from SCR-015's
        // bottom row (V5 card top 342.9, height 33.9). The deletion screen
        // is only captured — its button opens a confirmation dialog first.
        // Captured before SCR-026: that placeholder has no tab bar, so the
        // next captureSettingsSubScreen couldn't get back to Settings from it.
        captureSettingsSubScreen(row: "アカウント情報", rowIndex: 0, waitFor: "プロフィール編集", name: "15-Account")
        // SCR-015's sub-screens, each reached afresh from Settings (row
        // centers from AccountView's V5 layout: group 1 top 120.7 with rows
        // 30.6/41.3/32.6, deletion card 342.9+33.9/2).
        captureAccountSubScreen(y: 120.7 + 30.6 / 2, waitFor: "生年月日を変更する場合", name: "15a-ProfileEdit")
        captureAccountSubScreen(y: 120.7 + 30.6 + 41.3 / 2, waitFor: "確認メールを送信", name: "15b-EmailChange")
        captureAccountSubScreen(y: 120.7 + 30.6 + 41.3 + 32.6 / 2, waitFor: "変更する", name: "15c-PasswordChange")
        captureAccountSubScreen(y: 342.9 + 33.9 / 2, waitFor: "アカウントを削除しますか", name: "24-AccountDeletion")
        // SCR-026 (added 2026-10-05 as Settings' 6th row). Wait for the
        // placeholder's detail text, not the screen name, which the
        // Settings row itself also shows.
        captureSettingsSubScreen(row: "ホーム通貨ペア編集", rowIndex: 5, waitFor: "お気に入り通貨ペアAPI未実装", name: "26-HomeCurrencyPairEditor")
    }

    /// Taps the row's center through SettingsView's fixed V5 layout (group 1
    /// top y=54.5, 34pt rows) mapped through V5Viewport's scale-to-fit.
    /// Center taps used to land in the row's Spacer gap, which had no
    /// contentShape and so ignored touches under `.buttonStyle(.plain)`
    /// (three CI runs captured 11-13 as the untouched Settings list).
    /// SettingsView now gives each row a contentShape, so tapping the
    /// center deliberately also checks that the whole row is tappable. If
    /// it doesn't navigate, attach a screenshot whose name records what
    /// XCUITest reports for the row.
    private func captureSettingsSubScreen(row: String, rowIndex: Int, waitFor text: String, name: String) {
        tap(containing: "ホーム")
        tap(containing: "設定")
        XCTAssertTrue(waitForAnyElement(containing: "アカウント情報", timeout: 15), "Settings did not load before \(name)")
        tapV5(x: 117, y: 54.5 + (CGFloat(rowIndex) + 0.5) * 34)
        if waitForAnyElement(containing: text, timeout: 15) {
            capture(name)
        } else {
            let element = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", row)).firstMatch
            let f = element.exists ? element.frame : .zero
            let w = app.frame
            capture("\(name)-diag-exists\(element.exists)-hit\(element.exists && element.isHittable)-frame\(Int(f.minX))_\(Int(f.minY))_\(Int(f.width))_\(Int(f.height))-app\(Int(w.width))_\(Int(w.height))")
            XCTFail("\(name) did not load")
        }
    }

    /// Opens SCR-015 from Settings, then taps the row at V5 `y` in it.
    private func captureAccountSubScreen(y: CGFloat, waitFor text: String, name: String) {
        tap(containing: "ホーム")
        tap(containing: "設定")
        XCTAssertTrue(waitForAnyElement(containing: "アカウント情報", timeout: 15), "Settings did not load before \(name)")
        tapV5(x: 117, y: 54.5 + 0.5 * 34)
        XCTAssertTrue(waitForAnyElement(containing: "プロフィール編集", timeout: 15), "Account did not load before \(name)")
        tapV5(x: 117, y: y)
        XCTAssertTrue(waitForAnyElement(containing: text, timeout: 15), "\(name) did not load")
        capture(name)
    }

    /// Taps a point given in V5's 234×491 canvas coordinates, using the same
    /// scale-to-fit and centering as `V5Viewport` (which ignores the safe
    /// area, so it fills the whole app frame).
    private func tapV5(x: CGFloat, y: CGFloat) {
        let frame = app.frame
        let scale = min(frame.width / 234, frame.height / 491)
        let dx = (frame.width - 234 * scale) / 2 + x * scale
        let dy = (frame.height - 491 * scale) / 2 + y * scale
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: dx, dy: dy)).tap()
    }

    // MARK: - Helpers

    /// Taps a text field and types into it only once the keyboard is up.
    /// A single tap occasionally doesn't give the field keyboard focus in
    /// time (real CI failure on 01-Login: "Neither element nor any
    /// descendant has keyboard focus"), so retry the tap a few times first.
    private func type(_ text: String, into field: XCUIElement) {
        for _ in 0..<3 {
            field.tap()
            if app.keyboards.firstMatch.waitForExistence(timeout: 5) { break }
        }
        field.typeText(text)
    }

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
