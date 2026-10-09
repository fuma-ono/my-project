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

        // SCR-002 新規会員登録 / SCR-003 パスワード再設定(HQ指示
        // 2026-10-09、2回目: 参考画像を基に完全再現 — ブランドマーク+タイトル、
        // 見出し+サブタイトル、Apple/Google登録のアウトラインボタン等を追加。
        // システムのナビゲーションバーは使わず(`.toolbar(.hidden, for:
        // .navigationBar)`)、単体のシェブロン戻るボタンに変更したため、戻るは
        // `navigationBars.buttons`ではなくaccessibilityIdentifierでタップする。
        // 1回目の実装(実CI commit 7bcb496)では「新規登録」NavigationLinkの
        // タップがSynthesize成功と報告されるのに実際には画面遷移が一度も
        // 起きていなかった問題があり、原因は`LoginView`だけが`NavigationStack`
        // に明示的な`NavigationPath`を束縛していなかったことだったため、既に
        // `LoginView.swift`で修正済み(`path`を追加)。
        //
        // CI実行(commit 942e590、ea91b3d、8010b37、いずれもpull_requestトリガー)
        // でiPadのみ繰り返し失敗: 同じテストコードでiPhoneは毎回1〜2秒で成功した
        // 一方、iPad側は15秒→30秒に広げても一度も成功しなかった — 単純な
        // CI実行速度差のマージン不足なら30秒で解消するはずで、実際には
        // 解消しなかったため、タイムアウトの問題ではなく`tap(containing:
        // "新規登録")`がiPad特有のアクセシビリティツリー構造で別の要素に
        // マッチしている可能性を疑い、`LoginView`の該当
        // `NavigationLink`に`accessibilityIdentifier`
        // ("signUpLink"/"passwordResetLink")を追加して曖昧さの無い
        // `tapIdentifier`でのタップに切り替えた。
        tapIdentifier("signUpLink")
        XCTAssertTrue(waitForAnyElement(containing: "パスワード(確認用)", timeout: 30), "Sign Up screen did not load")
        capture("02-SignUp")
        tapIdentifier("signUpBackButton", timeout: 20)
        XCTAssertTrue(emailField.waitForExistence(timeout: 20), "Did not return to Login screen from Sign Up")

        tapIdentifier("passwordResetLink")
        XCTAssertTrue(waitForAnyElement(containing: "再設定メールを送信", timeout: 30), "Password Reset screen did not load")
        capture("03-PasswordReset")
        tapIdentifier("passwordResetBackButton", timeout: 20)
        XCTAssertTrue(emailField.waitForExistence(timeout: 20), "Did not return to Login screen from Password Reset")

        emailField.tap()
        emailField.typeText("ui-screenshot@example.com")
        app.secureTextFields["パスワード"].tap()
        app.secureTextFields["パスワード"].typeText("ui-screenshot-password")
        app.buttons["ログイン"].tap()

        // SCR-004 ホーム画面. Not app.tabBars.buttons["Home"] — iPadOS's
        // adaptive tab bar (floating/sidebar depending on size class)
        // doesn't always expose as a `TabBar`-typed accessibility element
        // the way iPhone's bottom tab bar does (real iPad CI failure: "No
        // matches found for Descendants matching type TabBar"), so search
        // broadly instead of assuming a container type.
        XCTAssertTrue(waitForAnyElement(containing: "ホーム", timeout: 20), "Home tab did not appear after login")
        // HQ指示(2026-10-08)「ホーム画面は別アカで作った方を採用して」で
        // 採用したHome実装がCIで時々15秒を超えて読み込む(実測: 遅いCI実行で
        // タイムアウトし、`continueAfterFailure=true`によりテスト自体は
        // 後続の04-Home/04b-Home-Speechesキャプチャまで成功していた —
        // ロジックの不具合ではなく純粋なタイムアウト猶予不足)。タブ出現
        // 待ち(20秒)より余裕を持たせ、25秒に広げた。
        XCTAssertTrue(
            waitForAnyElement(containing: "通貨ペア", timeout: 25),
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

        // HQ指示(2026-10-06)「直近の要人発言が見えるようにして」: 本番の
        // 挙動は変えない(4枚目のカードが初期表示の折り返し線より下にあり、
        // スクロールして閲覧する設計は`contentAreaHeight`のドキュメント
        // コメント通りそのまま)。HQがCIで内容を確認できるよう、一番下まで
        // スクロールした状態のキャプチャを追加する。
        //
        // `waitForAnyElement`の`.exists`判定は使えない — SwiftUIの
        // `ScrollView`はLazy系と違い中身を即座に全部レンダリングするため、
        // 画面外にあっても要素は最初から`.exists`=trueになってしまう
        // (実際に1回目の実装で、スワイプが一度も起きないままキャプチャが
        // スクロール前と同一になる形で露見した)。実際に画面内に入ったかは
        // `isHittable`で判定する必要がある。
        let speechesHeader = [app.staticTexts, app.buttons, app.cells, app.otherElements]
            .map { $0.matching(NSPredicate(format: "label CONTAINS[c] %@", "直近の要人発言")).firstMatch }
            .first { $0.exists } ?? app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "直近の要人発言")).firstMatch
        var speechSwipes = 0
        while !speechesHeader.isHittable && speechSwipes < 6 {
            app.swipeUp()
            speechSwipes += 1
        }
        XCTAssertTrue(speechesHeader.isHittable, "Home did not scroll to reveal 直近の要人発言")
        capture("04b-Home-Speeches")

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

        // SCR-011 検索(HQ指示 2026-10-09、参考画像を基に完全再現 —
        // 「人気の検索キーワード」パネル+「最近の検索履歴」の初期表示と、
        // 検索後の結果一覧の両方を撮る)。
        tap(containing: "検索")
        XCTAssertTrue(waitForAnyElement(containing: "人気の検索キーワード", timeout: 15), "Search tab did not load")
        capture("11-Search")

        let searchField = app.textFields["検索"]
        XCTAssertTrue(searchField.waitForExistence(timeout: 10), "Search field did not appear")
        searchField.tap()
        searchField.typeText("CPI")
        XCTAssertTrue(waitForAnyElement(containing: "消費者物価指数", timeout: 15), "Search results for CPI did not load")
        capture("11b-Search-Results")

        // 「最近の検索履歴」にデータが入った状態(HQ指示 2026-10-09、7回目
        // 「最近の検索お表示見たいから何か1つデータを入れて」)。架空データは
        // 作らず、実際に検索結果の行をタップして`RecentSearchStore`へ実データ
        // (実在のモック指標)を記録させてから検索欄を空に戻し、その状態を撮る。
        tap(containing: "米国CPI(消費者物価指数)")
        XCTAssertTrue(waitForAnyElement(containing: "米国CPI", timeout: 15), "Indicator Detail did not load from Search")
        tapIdentifier("v5HeaderBack")
        XCTAssertTrue(searchField.waitForExistence(timeout: 10), "Did not return to Search from Indicator Detail")
        searchField.tap()
        // iOS's one-time "slide to type" keyboard tip can appear on this
        // second focus of the field and cover the bottom of the screen —
        // dismiss it before typing/capturing if it shows up.
        let continueButton = app.buttons["Continue"]
        if continueButton.waitForExistence(timeout: 2) {
            continueButton.tap()
        }
        searchField.typeText(String(repeating: "\u{8}", count: 10))
        XCTAssertTrue(waitForAnyElement(containing: "米国CPI(消費者物価指数)", timeout: 10), "Recent search history did not record the tapped indicator")
        capture("11c-Search-RecentHistory")
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
