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
        // 2026-10-09: 「指標」の文字ではホームの「経済指標」の行を押すことがあったので、
        // タブの目印(V5BottomBarの`v5Tab1`)で押す。
        tapIdentifier("v5Tab1")
        if !waitForAnyElement(containing: "米国CPI", timeout: 15) {
            capture("05-Indicators-diag")
            XCTFail("Indicators list did not load")
        }
        capture("05-Indicators")

        // SCR-006 指標詳細
        // 2026-10-14: 米国CPIは前回の発表が終わると次回が翌月になり、一覧の下のほうへ移る。
        // スクロールした先の行は(拡大表示の都合で)押せる判定にならないことがあるので、
        // 「国・地域」で米国に絞り、最初の画面に入れてから押す。
        tap(containing: "国・地域")
        let usMenuItem = app.buttons["米国"]
        if usMenuItem.waitForExistence(timeout: 5) { usMenuItem.tap() }
        tap(containing: "米国CPI(消費者物価指数)")
        XCTAssertTrue(waitForAnyElement(containing: "過去イベント比較", timeout: 15), "Indicator Detail did not load")
        capture("06-IndicatorDetail")

        // HQ指示(2026-10-03、6回目)「通貨ペアの下にお気に入りを作成して
        // ください」: Homeの「お気に入り」カードは`FavoritesStore`(端末
        // ローカル)が空だと非表示になる(`HomeView`の`if !favorites.isEmpty`)
        // ため、参考画像通りカードを表示させるには実際に★を1件登録する
        // 必要がある。架空データを足すのではなく、実在のモック指標
        // (米国CPI)を実際にお気に入り登録する。
        // 2026-10-09: 指標詳細の星はヘッダーからカードの右上へ移った。
        tapIdentifier("indicatorFavoriteStar")

        // SCR-007 イベント詳細。「今日の重要イベント」削除に伴い、Home経由
        // の導線が無くなったため、Indicator Detailの「次回発表予定」エリア
        // から遷移する。
        tap(containing: "次回発表予定")
        XCTAssertTrue(waitForAnyElement(containing: "主要通貨ペアの値動き", timeout: 15), "Event Detail did not load")
        capture("07-EventDetail")

        // HQ指示(2026-11-05)「政策金利データありの iOS 表示確認」(api-design v1.47): 撮影はしない(スクリーンショットの枚数は
        // 変えない)。データが無い今の画面は従来の結果のカードのまま → モックを「政策決定が記録された FOMC の会合」にして
        // 開き直し、誘導目標レンジ・適用日・NY連銀の出典のリンクが出て、結果のカードと EFFR の値が出ないこと → 戻すと
        // 従来の表示に戻ること、を確かめる。
        assertConventionalResults("before the policy-rate switch")
        if setMockPolicyRate(true) {
            addTeardownBlock { [weak self] in _ = self?.setMockPolicyRate(false) }
            reopenEventDetail()
            XCTAssertTrue(waitForAnyElement(containing: "フェデラルファンド金利の誘導目標レンジ", timeout: 10), "The policy-rate heading is not shown")
            XCTAssertTrue(app.staticTexts["3.75%〜4.00%"].exists, "The target range is not shown")
            XCTAssertTrue(app.staticTexts["適用日 2026/09/17"].exists, "The effective date is not shown")
            // SwiftUI の Link が UIテストでどの種類(link / button)に見えるかに頼らず、ラベルで探す。そのうえで、押せる種類
            // (link か button)の要素があることを確かめる(子の文字の要素だけ、ではない)。
            let sourceLabel = NSPredicate(format: "label CONTAINS %@", "出典：ニューヨーク連邦準備銀行")
            XCTAssertTrue(app.descendants(matching: .any).matching(sourceLabel).firstMatch.exists, "The NY Fed source is not shown")
            let tappable = NSPredicate(
                format: "label CONTAINS %@ AND (elementType == %d OR elementType == %d)",
                "出典：ニューヨーク連邦準備銀行", Int(XCUIElement.ElementType.link.rawValue), Int(XCUIElement.ElementType.button.rawValue)
            )
            XCTAssertTrue(app.descendants(matching: .any).matching(tappable).firstMatch.exists, "The NY Fed source is not a link")
            // HQ決定(2026-11-10「取得日の表示方法と出典対応」案a): 出典は1行+タップで免責文の
            // 全文を見るシートに変わったため、タップして開いたシートの中で確かめる。
            tap(containing: "出典：ニューヨーク連邦準備銀行")
            XCTAssertTrue(waitForAnyElement(containing: "出典について", timeout: 10), "The attribution detail sheet did not open")
            XCTAssertTrue(
                waitForAnyElement(containing: "EFFR（実際の取引の金利）の値は表示していません", timeout: 5),
                "The notice that the EFFR itself is not shown is missing"
            )
            // HQ指示(2026-11-06「NY連銀の規約対応」修正案1): 会合との対応付けは本アプリが行っていることも出る
            XCTAssertTrue(
                waitForAnyElement(containing: "FOMC会合との対応付け（発表日の翌営業日以降で最初に有効になったレンジ）は、本アプリが行っています。", timeout: 5),
                "The notice that the app links the range to the FOMC meeting is missing"
            )
            tap(containing: "閉じる")
            XCTAssertTrue(waitForAnyElement(containing: "フェデラルファンド金利の誘導目標レンジ", timeout: 10), "Did not return to Event Detail after closing the attribution sheet")
            // 結果のカード(結果・予想・前回)も、EFFR の実績(モックの EFFR 3.88)も出さない
            XCTAssertFalse(app.staticTexts["結果"].firstMatch.exists, "The results card is shown together with the policy rate")
            XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "3.88")).firstMatch.exists, "An EFFR value is shown")
            XCTAssertTrue(setMockPolicyRate(false), "Could not turn the policy-rate switch off")
            reopenEventDetail()
            assertConventionalResults("after the policy-rate switch")
        } else {
            XCTFail("Could not reach the mock server for the policy-rate switch")
        }

        // HQ指示(2026-11-06「Pro イベント別トレード戦略分析」、api-design v1.48): イベント詳細の「トレード戦略分析」から開く。
        // PRO(モックの既定)は過去5回の発表の傾向の回数が出る → 撮る。FREE は開いた先がロック表示で、傾向は出ない(撮らない)。
        // HQ指示(2026-11-07「画面デザインの変更」): カード単位の色分け表示に変更されたため、確認する文言も
        // 新しいデザインで実際に見える文言(カードの見出し・内訳の件数・補足事項)に合わせている。
        tapIdentifier("eventDetailStrategyAnalysisLink")
        XCTAssertTrue(waitForAnyElement(containing: "過去5回の分析結果", timeout: 15), "Strategy analysis did not load")
        XCTAssertTrue(
            waitForAnyElement(containing: "両方 1回", timeout: 5),
            "The high/low break overlap breakdown is not shown"
        )
        XCTAssertTrue(waitForAnyElement(containing: "売買の推奨ではありません", timeout: 5), "The not-a-recommendation note is missing")
        capture("07b-EventStrategyAnalysis")
        tapIdentifier("v5HeaderBack")
        XCTAssertTrue(waitForAnyElement(containing: "主要通貨ペアの値動き", timeout: 10), "Did not go back to Event Detail")
        if setMockSubscriptionPlan("FREE") {
            addTeardownBlock { [weak self] in _ = self?.setMockSubscriptionPlan("PRO") }
            tapIdentifier("eventDetailStrategyAnalysisLink")
            XCTAssertTrue(waitForAnyElement(containing: "プレミアムプランで解放", timeout: 15), "The locked state is not shown for FREE")
            XCTAssertFalse(
                app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "過去5回の分析結果")).firstMatch.exists,
                "The analysis is shown to FREE"
            )
            XCTAssertTrue(setMockSubscriptionPlan("PRO"), "Could not switch the mock plan back to PRO")
            tapIdentifier("v5HeaderBack")
            XCTAssertTrue(waitForAnyElement(containing: "主要通貨ペアの値動き", timeout: 10), "Did not go back to Event Detail (free plan)")
        } else {
            XCTFail("Could not reach the mock server for the plan switch")
        }

        // SCR-008 相場反応詳細。2026-10-09から、値動きの表のUSD/JPYの行から直接進む。
        tap(containing: "USD/JPYの相場反応を見る")
        XCTAssertTrue(waitForAnyElement(containing: "値動きの分析", timeout: 15), "Movement Detail did not load")
        capture("08-MovementDetail")

        // HQ承認(2026-11-05)「過去との比較の画面確認」: 「相場反応の分析」の枠の下にある「過去との比較」の行は、08 の
        // 1画面に入らない。下へスクロールして、比較の文(モックは PRO で、同じ指標の過去の発表が3回以上)が出ていることを
        // 確かめて撮る。撮ったら上へ戻す(次の手順の「戻る」は画面の上にある)。画面・分析は変えない。
        if scrollUntilHittable(containing: "過去との比較") {
            let comparison = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "過去との比較: ")).firstMatch
            XCTAssertTrue(comparison.label.contains("回のうち"), "The comparison sentences are not shown: \(comparison.label)")
            XCTAssertFalse(comparison.label.contains("分析データ不足"), "The comparison says there is not enough data")
            // HQ指示(2026-11-05)「相場反応分析の比較基準統一」: 「過去の類似イベントとの比較」のカードも、文と同じ時間で比べる。
            if let range = comparison.label.range(of: "今回の[0-9]+分後", options: .regularExpression) {
                let span = String(comparison.label[range].dropFirst(3))
                let average = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "回の平均値幅（")).firstMatch
                XCTAssertTrue(average.exists, "The average row of the similar-events card is not shown")
                XCTAssertTrue(average.label.contains("（\(span)・上下問わず）"), "The card average is not for \(span): \(average.label)")
                let currentRow = app.staticTexts.matching(NSPredicate(format: "label == %@", "今回の変動（\(span)）")).firstMatch
                XCTAssertTrue(currentRow.exists, "The card current row is not for \(span)")
            } else {
                XCTFail("The comparison does not name its timeframe: \(comparison.label)")
            }
            capture("08c-MovementDetail-Comparison")
        } else {
            XCTFail("Movement Detail did not scroll to 過去との比較")
        }
        for _ in 0..<4 { app.swipeDown(velocity: .slow) }

        // api-design v1.45(HQ指示 2026-11-02): 発表の時刻が概算(APPROXIMATE)のときの相場反応詳細。モックの応答にだけ
        // 精度を付けて同じ画面を開き直し、注記とチャートの「約」を撮る。撮ったら元に戻す(後の撮影は今までどおり)。
        if setMockReactionPrecision("APPROXIMATE") {
            tapIdentifier("v5HeaderBack")
            XCTAssertTrue(waitForAnyElement(containing: "主要通貨ペアの値動き", timeout: 10), "Did not go back to Event Detail")
            tap(containing: "USD/JPYの相場反応を見る")
            XCTAssertTrue(waitForAnyElement(containing: "値動きは概算の時刻を起点に計算しています", timeout: 15), "Approximate notice did not appear")
            capture("08b-MovementDetail-Approximate")
            _ = setMockReactionPrecision(nil)
        }

        // SCR-009 過去イベント比較。2026-10-09から遷移元は指標詳細なので、
        // 相場反応詳細 → イベント詳細 → 指標詳細 と戻ってから進む。
        tapIdentifier("v5HeaderBack")
        XCTAssertTrue(waitForAnyElement(containing: "主要通貨ペアの値動き", timeout: 10), "Did not go back to Event Detail")
        tapIdentifier("v5HeaderBack")
        XCTAssertTrue(waitForAnyElement(containing: "過去イベント比較", timeout: 10), "Did not go back to Indicator Detail")
        tap(containing: "過去イベント比較")
        // 2026-10-14: 参考画像どおりの表に作り直したので、表の見出し「前回値」で待つ。
        XCTAssertTrue(waitForAnyElement(containing: "前回値", timeout: 15), "Historical Comparison did not load")
        capture("09-HistoricalComparison")

        // HQ指示(2026-10-03、画面構成全面更新)「旧『過去イベント詳細』の
        // 独立画面は作成しない」により、過去の発表行は独立画面ではなく
        // SCR-008 相場反応詳細(上で既に撮影済みの08と同じ画面構成)へ
        // 直接遷移するようになった。ここでは遷移が壊れていないことだけを
        // 確認し、視覚的に重複するスクリーンショットは撮らない。行の
        // 文字は可変のモックデータ(日付・数値)のため、固定の
        // accessibilityIdentifierでタップする。
        tapIdentifier("historyEventRow")
        XCTAssertTrue(waitForAnyElement(containing: "主要通貨ペアの値動き", timeout: 15), "Historical Comparison row did not navigate to SCR-007")

        // 04-Home(SCR-004の実キャプチャ)。上でお気に入り登録した米国CPIが
        // 「お気に入り」カードに実際に表示された状態でHomeに戻って撮る —
        // 参考画像通りの3セクション(通貨ペア/お気に入り/直近の要人発言)
        // 構成をそのまま確認できる。
        tap(containing: "ホーム")
        XCTAssertTrue(waitForAnyElement(containing: "消費者物価指数（CPI）", timeout: 15), "Home did not show the newly-favorited indicator")
        capture("04-Home")

        // お気に入り一覧(HQ指示 2026-10-15)。上でお気に入りにした米国CPIが並ぶ。
        tapIdentifier("homeFavoritesSeeAll")
        XCTAssertTrue(waitForAnyElement(containing: "消費者物価指数（CPI）", timeout: 15), "Favorites list did not load")
        Thread.sleep(forTimeInterval: 1.0)
        capture("04c-Favorites")
        // HQ承認(2026-11-02)「ホーム画面のキャッシュ表示改善」: ホームに戻ると取り直す。その間だけモックの
        // /home を失敗させ、前回のデータを出したまま「更新できませんでした」が出る状態を撮る。撮ったら
        // モックを戻して「再試行」し、1行が消えてから先へ進む(後の撮影は今までと同じ画面のまま)。
        let homeFailSet = setMockHomeFail(true)
        tapIdentifier("v5HeaderBack")
        XCTAssertTrue(waitForAnyElement(containing: "通貨ペア", timeout: 10), "Did not return to Home from Favorites")
        if homeFailSet {
            XCTAssertTrue(waitForAnyElement(containing: "更新できませんでした", timeout: 15), "Home did not show the refresh-failed notice")
            capture("04d-Home-Cached")
            XCTAssertTrue(setMockHomeFail(false), "Could not restore the mock /home")
            tapIdentifier("homeRefreshRetry", timeout: 10)
            let notice = app.descendants(matching: .any)["homeRefreshNotice"]
            var waited = 0.0
            while notice.exists && waited < 15 {
                Thread.sleep(forTimeInterval: 0.5)
                waited += 0.5
            }
            XCTAssertFalse(notice.exists, "Home refresh notice did not go away after retry")
        }

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

        // SCR-012 要人発言一覧(HQ指示 2026-10-14)。「直近の要人発言」の「すべて見る」から開き、
        // 撮ったらホームへ戻る。
        tapIdentifier("homeSpeechesSeeAll")
        XCTAssertTrue(waitForAnyElement(containing: "金融経済懇談会での講演", timeout: 15), "Speech list did not load")
        capture("12-SpeechList")
        // 発言済みの要人発言(本番と同じ計算の値動き)と、同じ要人の過去イベント比較(HQ指示 2026-10-15)。
        // (2026-10-15: CIのシミュレータがアプリを起動できず全画面が撮れなかった回があったため撮り直し。)
        tap(containing: "欧州議会での証言")
        // HQ指示(2026-10-28)「要人発言詳細も相場反応詳細ボタンを消して。
        // 通貨を押したらその通貨の相場反応詳細に行くようにして」により、
        // 別枠の「相場反応詳細」ボタン自体を削除したため、代わりに値動きの
        // 表の行(先頭はEUR/USD、`speechFxPairs`の並び順)のaccessibility
        // labelで「値動きのデータが読み込まれ発言済みである」ことを確かめる。
        if waitForAnyElement(containing: "EUR/USDの相場反応を見る", timeout: 15) {
            Thread.sleep(forTimeInterval: 1.0)
            capture("13b-SpeechDetailDelivered")
            tap(containing: "過去イベント比較")
            if waitForAnyElement(containing: "発言", timeout: 15) {
                Thread.sleep(forTimeInterval: 1.0)
                capture("13c-SpeakerComparison")
            }
            tapIdentifier("v5HeaderBack")
            _ = waitForAnyElement(containing: "通貨ペア別の値動き", timeout: 10)
        }
        tapIdentifier("v5HeaderBack")
        _ = waitForAnyElement(containing: "これからの発言", timeout: 10)
        tapIdentifier("v5HeaderBack")
        XCTAssertTrue(waitForAnyElement(containing: "直近の要人発言", timeout: 10), "Did not return to Home from Speech list")

        // ホーム画面ヘッダーの人物アイコン(HQ指示 2026-10-23「ホーム画面の人物アイコン」)。
        // タップしても遷移しなかった不具合の修正確認 — SCR-015アカウント情報
        // (SettingsからのAppRoute.accountと同じ画面)へ遷移し、ホームへ戻れることを確認する。
        tapIdentifier("homeAccountIcon")
        XCTAssertTrue(waitForAnyElement(containing: "プロフィール編集", timeout: 15), "Home account icon did not open Account screen")
        tapIdentifier("v5HeaderBack")
        XCTAssertTrue(waitForAnyElement(containing: "直近の要人発言", timeout: 10), "Did not return to Home from Account screen")

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
        // ログアウトの確認(HQ指示 2026-10-07)。ログアウト行(V5座標の中心y≈396)を
        // 押して撮り、背景をタップして閉じる(ログアウトはしない)。
        // 2026-10-09: チャート設定の行がなくなり、ログアウトは1行分(31)上がった。
        tapV5(x: 117, y: 365)
        if waitForAnyElement(containing: "ログアウトしますか", timeout: 5) {
            capture("14b-LogoutConfirmation")
            tapV5(x: 117, y: 80)
        }

        // SCR-010 経済カレンダー(HQ指示2026-10-08で仮画面から実装)。ヘッダーの
        // 画面名ではなく、読み込み後に出る「〜のイベント」(今日の一覧の見出し)を待つ。
        tap(containing: "カレンダー")
        XCTAssertTrue(waitForAnyElement(containing: "のイベント", timeout: 15), "Calendar tab did not load")
        capture("10-Calendar")

        // SCR-013 要人発言詳細(HQ指示2026-10-11で仮画面から実装)。今日の
        // カレンダー項目(モックサーバーの`CALENDAR_TODAY_ITEMS`)に固定で
        // 含まれる発言行からタップする。
        tap(containing: "FOMCメンバー発言")
        XCTAssertTrue(waitForAnyElement(containing: "ウォラー", timeout: 15), "Speech Detail did not load from Calendar")
        capture("13-SpeechDetail")
        tapIdentifier("v5HeaderBack")
        XCTAssertTrue(waitForAnyElement(containing: "のイベント", timeout: 10), "Did not return to Calendar from Speech Detail")

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
        // 2026-10-13: 検索欄を指標一覧と同じ見た目にした後、キーボードが出たままだと
        // 結果の行が押せる状態と判定されずタップに失敗したので、先にキーボードを閉じる。
        // iPadはキーボードを出したままで押せていて、閉じると逆に押せなくなったのでiPhoneだけ。
        if UIDevice.current.userInterfaceIdiom == .phone {
            searchField.typeText("\n")
        } else {
            // 2026-10-14: iPadでも、大きいキーボードが結果の行に重なって押せないことがあった
            // (毎回ではない)。キーボードの「キーボードを閉じる」ボタンで閉じてから押す。
            let hideKeyboard = app.keyboards.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@ OR label CONTAINS %@", "keyboard", "キーボード")).firstMatch
            if hideKeyboard.waitForExistence(timeout: 2) { hideKeyboard.tap() }
        }

        // 「最近の検索履歴」にデータが入った状態(HQ指示 2026-10-09、7回目
        // 「最近の検索お表示見たいから何か1つデータを入れて」)。架空データは
        // 作らず、実際に検索結果の行をタップして`RecentSearchStore`へ実データ
        // (実在のモック指標)を記録させてから検索欄を空に戻し、その状態を撮る。
        tap(containing: "米国CPI(消費者物価指数)")
        XCTAssertTrue(waitForAnyElement(containing: "過去イベント比較", timeout: 15), "Indicator Detail did not load from Search")
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

        // 検索欄にまだフォーカス・キーボードが残ったまま次のタブ(設定)へ
        // 進むと、V5Viewportのスケール計算がキーボード表示中のものに
        // ずれたままタブバーのタップ座標が解決され、実際には検索画面内の
        // 別要素(フィルターのピルなど)を押してしまう実障害を確認した
        // (CI screenshots job、commit 2a5e605で検出 — 診断スクリーン
        // ショットが検索画面のまま「要人発言」フィルターが選択された状態
        // を示していた)。改行で入力を終えてキーボードを閉じてから進む。
        searchField.typeText("\n")
        Thread.sleep(forTimeInterval: 0.5)

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
        // 無料プランの表示(HQ指示 2026-10-06)。モックの購読をFREEに切り替えてから撮る。
        if setMockSubscriptionPlan("FREE") {
            captureSettingsSubScreen(row: "プラン・購読管理", rowIndex: 2, waitFor: "プランを確認する", name: "17b-SubscriptionFree")
            _ = setMockSubscriptionPlan("PRO")
        }
        captureSettingsSubScreen(row: "表示・地域設定", rowIndex: 3, waitFor: "タイムゾーン", name: "18-DisplaySettings")
        // HQ指示(2026-10-20)「起動診断画面を追加」でグループ1が5行→6行に
        // なったため、グループ2(2つ目のまとまり)の各行のrowIndexを+1した
        // (1つ目6行+間隔8)。
        captureSettingsSubScreen(row: "起動診断", rowIndex: 5, waitFor: "起動シーケンス全体の時間", name: "19-LaunchDiagnostics")
        // HQ指示(2026-10-30)「通信内訳カードの表示検証」: 同じ画面を下へスクロールして、
        // 「通信の内訳」のカードの見出しと、カードの最後の注記(応答待ちの説明)を撮る。撮るだけで、画面・計測は変えない。
        XCTAssertTrue(scrollUntilHittable(containing: "通信の内訳(起動後1回目の要求)"), "LaunchDiagnostics did not scroll to the network card")
        capture("19c-LaunchDiagnostics-Network")
        XCTAssertTrue(scrollUntilHittable(containing: "途中の中継(Renderの入り口など)での待ちの両方が入ります"), "LaunchDiagnostics did not scroll to the network note")
        capture("19d-LaunchDiagnostics-NetworkNote")
        // SCR-020 ヘルプ・お問い合わせは2つ目のまとまりの先頭(1つ目6行+間隔8)。
        captureSettingsSubScreen(row: "ヘルプ・お問い合わせ", rowIndex: 6, extraOffset: 8, waitFor: "よくある質問", name: "20-Help")
        captureSettingsSubScreen(row: "利用規約", rowIndex: 7, extraOffset: 8, waitFor: "第1条", name: "21-Terms")
        captureSettingsSubScreen(row: "プライバシーポリシー", rowIndex: 8, extraOffset: 8, waitFor: "第1条", name: "22-PrivacyPolicy")
        captureSettingsSubScreen(row: "アプリ情報", rowIndex: 9, extraOffset: 8, waitFor: "利用しているライブラリ", name: "23-AppInfo")
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
        // SCR-026 (Settings' 6th row). Wait for the editor's own button,
        // not the screen name, which the Settings row also shows. Then open
        // its picker through that button.
        captureSettingsSubScreen(row: "ホーム通貨ペア編集", rowIndex: 4, waitFor: "通貨ペアを追加する", name: "26-HomeCurrencyPairEditor")
        tap(containing: "通貨ペアを追加する")
        XCTAssertTrue(waitForAnyElement(containing: "クロス円", timeout: 15), "26a-HomeCurrencyPairPicker did not load")
        capture("26a-HomeCurrencyPairPicker")
    }

    /// HQ指示(2026-11-09「StrategyAnalysis画面07bの個別スクリーンショット取得・視覚確認」):
    /// `testCaptureAllScreens()`は、この画面より前にある既存のFOMC関連アサーション
    /// (「policy-rate heading is not shown」)がCIで不安定に失敗することがあり、その
    /// 失敗自体には`continueAfterFailure = true`のため07bの撮影まで到達できているが、
    /// 確実な検証経路として、この画面だけ・独立して撮れるテストを別途用意する。
    /// 導線(経済指標詳細 → イベント詳細 → トレード戦略分析)自体も
    /// `testCaptureAllScreens()`と同じ実際の画面遷移を踏むため、ここでその遷移の健全性も
    /// 確かめられる。FOMC・政策金利関連のモック切り替えは一切行わない(無関係な画面には
    /// 触れない)。
    ///
    /// `testCaptureAllScreens()`と違い、スクロールしないと見えないカード(発表直後の傾向・
    /// 15分後までの反応・Sell the Fact分析・発表ごとの実績・補足事項)も実際に画面内に
    /// 入れてから撮り、新デザイン全体を目視確認できるようにする。
    func testCaptureEventStrategyAnalysisScreenStandalone() throws {
        let emailField = app.textFields["メールアドレス"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 35), "Login screen did not appear")
        type("ui-screenshot@example.com", into: emailField)
        type("ui-screenshot-password", into: app.secureTextFields["パスワード"])
        app.buttons["ログイン"].tap()

        XCTAssertTrue(waitForAnyElement(containing: "ホーム", timeout: 20), "Home tab did not appear after login")
        XCTAssertTrue(
            waitForAnyElement(containing: "通貨ペア", timeout: 25),
            "Home did not load major FX data from the mock Backend"
        )

        tapIdentifier("v5Tab1")
        XCTAssertTrue(waitForAnyElement(containing: "米国CPI", timeout: 15), "Indicators list did not load")

        tap(containing: "国・地域")
        let usMenuItem = app.buttons["米国"]
        if usMenuItem.waitForExistence(timeout: 5) { usMenuItem.tap() }
        tap(containing: "米国CPI(消費者物価指数)")
        XCTAssertTrue(waitForAnyElement(containing: "過去イベント比較", timeout: 15), "Indicator Detail did not load")

        tap(containing: "次回発表予定")
        XCTAssertTrue(waitForAnyElement(containing: "主要通貨ペアの値動き", timeout: 15), "Event Detail did not load")

        tapIdentifier("eventDetailStrategyAnalysisLink")
        XCTAssertTrue(waitForAnyElement(containing: "過去5回の分析結果", timeout: 15), "Strategy analysis did not load")
        XCTAssertTrue(
            waitForAnyElement(containing: "両方 1回", timeout: 5),
            "The high/low break overlap breakdown is not shown"
        )
        capture("07b-EventStrategyAnalysis-Standalone-Top")

        XCTAssertTrue(
            scrollUntilHittable(containing: "Sell the Fact 分析"),
            "Did not scroll to the Sell the Fact card"
        )
        capture("07b-EventStrategyAnalysis-Standalone-Middle")

        XCTAssertTrue(scrollUntilHittable(containing: "補足事項"), "Did not scroll to the notes card")
        capture("07b-EventStrategyAnalysis-Standalone-Bottom")
    }

    /// HQ承認(2026-11-04「Home Cache更新中表示のUIテスト追加」、案A): ログインしたまま設定で文字サイズを変えると
    /// RootView の `.id(textSize)` で全画面が作り直され、新しい HomeViewModel ができる。その間だけモックの /home を
    /// 遅らせ、前回のデータ(キャッシュ)を出したまま「前回の情報を表示しています・更新中…」が出ること、応答の後に
    /// 1行が消えて最新のデータに切り替わることを確かめる。
    ///
    /// 「前回の情報を表示しています」は HomeViewModel.applyCache だけが出す。applyCache は state がまだ .loaded で
    /// ない(= 作られたばかりの)HomeViewModel でしか呼ばれない(表示中の HomeViewModel は、取り直しても1行を出さない —
    /// HomeCacheTests.testReloadKeepsTheDisplayedDataWhileRefreshing)。この1行が出たこと自体が、作り直しの証拠になる。
    ///
    /// このテストでは確かめられないこと: アプリを終了して起動し直したときのキャッシュの表示(UI テストではログインが
    /// 残らず、ログイン画面でキャッシュを消すため)、プランを確かめる前の非表示(ユニットテストで確認済み)。
    func testHomeShowsCacheWhileRefreshing() throws {
        // 失敗・タイムアウトでも、後のテストに遅延と文字サイズ(「大」)を残さない。文字サイズは画面の操作ではなく
        // モックの設定に直接「標準」を書く(失敗した時点の画面に左右されない。次のテストは起動し直してモックから読む)。
        addTeardownBlock { [weak self] in
            guard let self else { return }
            XCTAssertTrue(self.setMockHomeDelay(0), "Teardown could not restore the mock /home delay")
            XCTAssertTrue(self.setMockTextSizeStandard(), "Teardown could not restore the text size to STANDARD")
        }
        XCTAssertTrue(setMockHomeDelay(0), "Could not reach the mock server")

        let emailField = app.textFields["メールアドレス"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 35), "Login screen did not appear")
        type("ui-screenshot@example.com", into: emailField)
        type("ui-screenshot-password", into: app.secureTextFields["パスワード"])
        app.buttons["ログイン"].tap()
        XCTAssertTrue(waitForAnyElement(containing: "FOMC政策金利", timeout: 25), "Home did not load")
        let notice = app.descendants(matching: .any)["homeRefreshNotice"]
        // ログインの直後はキャッシュが無い: 1行が「出てこない」ことを確かめる(消えるのを待つのではない)。
        XCTAssertFalse(notice.waitForExistence(timeout: 3), "Home showed a notice right after login (there should be no cache)")
        // 1回目: 「大」へ。作り直したホームが最新のデータになり、キャッシュがこのユーザー・プランで保存される。
        // 「大」を押しても、設定の保存の後で作り直されるので、すぐには作り直さない(タブの裏に作り直す前のホームが残る)。
        // /home を3秒遅らせて、作り直したホームが1行を出すのを確かめてから、消えるのを待つ(HQ指示 2026-11-04、
        // f78508b5 の UI Screenshots で、作り直す前のホームを見て0.3秒で判定して落ちたため)。
        XCTAssertTrue(setMockHomeDelay(3_000), "Could not delay the mock /home")
        changeTextSize(to: "大")
        XCTAssertTrue(notice.waitForExistence(timeout: 20), "Home was not rebuilt with the cached data after the text size change")
        XCTAssertTrue(waitUntilGone(notice, timeout: 20), "Home refresh notice did not go away after /home answered")
        XCTAssertTrue(waitForAnyElement(containing: "FOMC政策金利", timeout: 5), "Home did not show the fresh data")

        // 2回目: 「標準」へ戻す(今までの表示の大きさで撮る)。この間だけ /home を20秒遅らせる。
        XCTAssertTrue(setMockHomeDelay(20_000), "Could not delay the mock /home")
        changeTextSize(to: "標準")
        XCTAssertTrue(waitForAnyElement(containing: "前回の情報", timeout: 15), "Home did not show the cached data with the refreshing notice")
        XCTAssertTrue(waitForAnyElement(containing: "更新中", timeout: 2), "The notice does not say it is refreshing")
        XCTAssertTrue(waitForAnyElement(containing: "FOMC政策金利", timeout: 2), "Cached events are not shown while refreshing")
        XCTAssertTrue(waitForAnyElement(containing: "USD/JPY", timeout: 2), "Cached currency pairs are not shown while refreshing")
        capture("04e-Home-CacheRefreshing")

        // 応答の後: 1行が消え、最新のデータのまま(読み込み中にもエラーにもならない)。
        XCTAssertTrue(waitUntilGone(notice, timeout: 40), "Home refresh notice did not go away after /home answered")
        XCTAssertTrue(waitForAnyElement(containing: "FOMC政策金利", timeout: 5), "Home did not show the fresh data")
        XCTAssertFalse(waitForAnyElement(containing: "更新できませんでした", timeout: 1), "Home showed the refresh-failed notice")
        XCTAssertTrue(setMockHomeDelay(0), "Could not restore the mock /home")
    }

    /// HQ指示(2026-10-23「起動遅延とホーム画面の人物アイコン不具合の調査」)で
    /// `MainTabView.swift`の縦横分岐を再構成した(`HomeView`等を`landscape`の
    /// if/elseの外側に移動)ことの回帰確認。端末を横向きにしても`HomeView`の
    /// `HomeViewModel`が再生成されず、`/home`が2回取得されないことを、起動
    /// 診断画面の「/home取得回数」が「1回」のままであることで確認する。
    ///
    /// 注記(未検証事項): このテストを現時点で実行するCIパスは存在しない。
    /// `fx-event-analyzer-ui-screenshots.yml`のiPadシミュレータ実行は
    /// 2026-10-06のHQ判断で一時停止中(iPhoneのみ)で、`fx-event-analyzer-
    /// ios-build.yml`もiPhoneシミュレータのみを使用する。横画面(landscape)は
    /// iPadでのみ許可されており(`project.yml`の`UISupportedInterfaceOrientations
    /// ~ipad`、iPhoneはPortrait固定)、iPhone実行ではこの回転は何も起こさない。
    /// そのため、このテスト自体は今回のラウンドでCI実行・成功確認できていない
    /// (iPad実機・iPadシミュレータでの確認が別途必要)。修正の正しさはコード
    /// レビュー(`HomeView`が`landscape`の分岐の外、`body`内の1箇所だけに
    /// 置かれ続けること)で裏付けている。
    func testOrientationChangeDoesNotDuplicateHomeFetch() throws {
        let emailField = app.textFields["メールアドレス"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 35), "Login screen did not appear")
        type("ui-screenshot@example.com", into: emailField)
        type("ui-screenshot-password", into: app.secureTextFields["パスワード"])
        app.buttons["ログイン"].tap()
        XCTAssertTrue(waitForAnyElement(containing: "直近の要人発言", timeout: 20), "Home did not load")

        // iPadでのみ向き変更が意味を持つ(iPhoneはPortrait固定)。landscapeへの
        // 回転が`MainTabView`の`landscape`を切り替え、修正前は`HomeView`
        // (`HomeViewModel`)が再生成されて`/home`を2回目取得していた。
        XCUIDevice.shared.orientation = .landscapeLeft
        Thread.sleep(forTimeInterval: 2.0)
        // 以降のタップは既存ヘルパー(`tapV5`等)がPortrait基準のため、
        // 向きを戻してから起動診断画面を開く。
        XCUIDevice.shared.orientation = .portrait
        Thread.sleep(forTimeInterval: 1.0)

        captureSettingsSubScreen(row: "起動診断", rowIndex: 5, waitFor: "起動シーケンス全体の時間", name: "19b-LaunchDiagnostics-AfterRotation")

        let homeRequestCountValue = app.staticTexts["homeRequestCountValue"]
        XCTAssertTrue(homeRequestCountValue.waitForExistence(timeout: 10), "homeRequestCountValue row not found")
        XCTAssertEqual(
            homeRequestCountValue.label, "1回",
            "/homeが複数回取得されている(MainTabViewのlandscape/portrait分岐でHomeViewが再生成された可能性)"
        )
    }

    /// HQ指示(2026-10-24)「全画面共通でタブ画面から他画面に遷移した場合に
    /// タブを押しても元に戻らない」: 設定タブから「アカウント情報」(SCR-015)
    /// へ進んだ状態で設定タブを再タップすると、`TabBarReselection`経由で
    /// pathがルートまで戻ることを確認する(`V5BottomBar.tab`の`selected`は
    /// 再タップでは値が変わらないため、素朴な`onChange`では検知できない点が
    /// 修正前の原因)。
    func testReselectingTabPopsToRoot() throws {
        let emailField = app.textFields["メールアドレス"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 35), "Login screen did not appear")
        type("ui-screenshot@example.com", into: emailField)
        type("ui-screenshot-password", into: app.secureTextFields["パスワード"])
        app.buttons["ログイン"].tap()
        XCTAssertTrue(waitForAnyElement(containing: "直近の要人発言", timeout: 20), "Home did not load")

        tap(containing: "設定")
        XCTAssertTrue(waitForAnyElement(containing: "アカウント情報", timeout: 15), "Settings did not load")
        tap(containing: "アカウント情報")
        XCTAssertTrue(waitForAnyElement(containing: "プロフィール編集", timeout: 15), "Account did not load")

        // 設定タブを再タップ(既に設定タブを選択中のまま)。
        tapIdentifier("v5Tab4")
        XCTAssertTrue(waitForAnyElement(containing: "アカウント情報", timeout: 15), "Re-tapping the Settings tab did not pop back to the Settings root")
    }

    /// HQ指示(2026-10-25、再指示2026-10-26)「過去イベント比較の表が縦画面に
    /// 入らないから、この画面だけ横画面できるようにしたい」。文字列の存在
    /// だけでなく「横画面専用の要素(`historyLandscapeTopBar`)が出て、
    /// 縦画面専用の要素(`v5HeaderBack`・タブバー)が消える」という構造の
    /// 変化を確認する。
    ///
    /// HQ指示(2026-10-29、7回目)「横画面が直っていない(実機確認)」:
    /// OSのインターフェース自体を回転させる方式(`UIWindowScene.
    /// requestGeometryUpdate`、旧`OrientationLock.swift`)を6回試みたが、
    /// 実機確認のたびに同じ壊れ方(ウィンドウの実寸は横長になるが中身が
    /// Portrait時のレイアウトのまま小さく収まり、広がった分が黒いまま)を
    /// 繰り返した。アクセシビリティツリーの構造面アサーションは毎回パス
    /// していたため、5回目は「CIのスクリーンショット取得タイミングの
    /// 問題だろう」と判断していたが、実機でのHQ確認でも同じ壊れ方が
    /// 再現し、この判断自体が誤りだったと判明した。
    ///
    /// 方針変更: アプリ全体をPortrait固定に戻し(project.yml)、OSの
    /// インターフェース回転には一切頼らない。`HistoricalComparisonView`は
    /// 端末の物理的な向き(`UIDevice.orientation`)だけを見て、中身を
    /// `.rotationEffect`で見かけ上回転させる(詳細は同Viewのコメント参照)。
    /// `XCUIDevice.shared.orientation`はシミュレーターのセンサー値
    /// (`UIDevice.orientation`)を変えるため、アプリがPortrait固定のままでも
    /// この画面の回転ロジックは引き続き動く。
    ///
    /// 重要: ウィンドウの実寸(`app.windows.firstMatch.frame`)は、この方式
    /// では横画面中も常にPortraitのまま変わらない。そのためこの後の
    /// スクリーンショット(`09b-HistoricalComparison-Landscape`)は、実機で
    /// 物理的に端末を横向きに持ったときの見た目(文字が正立して見える)を
    /// そのまま撮れているわけではなく、Portrait寸法の画像の中に回転後の
    /// 中身が収まった状態で保存される(平らな画面・この画像だけを見ると
    /// 文字が横倒しに見えるが、実機で端末を横に傾けて見れば正立する —
    /// これは不具合ではなく、OS回転に頼らない本方式の既知の見え方)。
    /// 本当に実機で正立して見えるかどうかは、このCIスクリーンショットでは
    /// 検証できないため、実機での目視確認が別途必要。
    /// 横画面の表の測定(デザイン上のpt)。行が並ぶ向き(画面の座標で縦か横か、+か-か)は、見出し「日時」から行への向きで
    /// 決め、行を見出しに近い順に並べる。拡大率は行の間隔(44pt + 区切り線0.5pt)から求める。
    /// `headerToFirstRow` = 見出し「日時」の始まりから最初の行の始まりまで。`lastRowToNote` = 最後の行の終わりから
    /// 注記の始まりまで(注記が無ければnil)。`detail` は失敗の時に出す測定値。
    private func measureLandscapeTable(noteContaining note: String) -> (rows: Int, headerToFirstRow: Double, lastRowToNote: Double?, detail: String) {
        let header = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "日時")).firstMatch.frame
        var rows = app.descendants(matching: .any).matching(identifier: "historyEventRow").allElementsBoundByIndex
            .map(\.frame).filter { !$0.isEmpty }
        guard rows.count >= 2, !header.isEmpty else {
            return (rows.count, 0, nil, "rows=\(rows.count) header=\(header)")
        }
        let spreadX = (rows.map(\.midX).max() ?? 0) - (rows.map(\.midX).min() ?? 0)
        let spreadY = (rows.map(\.midY).max() ?? 0) - (rows.map(\.midY).min() ?? 0)
        let vertical = spreadY >= spreadX
        func mid(_ r: CGRect) -> CGFloat { vertical ? r.midY : r.midX }
        let forward = (rows.map(mid).reduce(0, +) / CGFloat(rows.count)) > mid(header)
        func start(_ r: CGRect) -> CGFloat { vertical ? (forward ? r.minY : r.maxY) : (forward ? r.minX : r.maxX) }
        func end(_ r: CGRect) -> CGFloat { vertical ? (forward ? r.maxY : r.minY) : (forward ? r.maxX : r.minX) }
        rows.sort { abs(start($0) - start(header)) < abs(start($1) - start(header)) }
        let pitch = abs(start(rows[1]) - start(rows[0]))
        // HQ決定(2026-11-10「取得日の表示方法と出典対応」案a)で`landscapeRowHeight`を
        // 44→54に上げた(行高54+区切り線0.5)。UIテスト対象はApp側の型を見られない
        // (`@testable import`なし)ため、ここは`HistoricalComparisonView`の定数ではなく
        // 固定値54.5を直接書く。
        let scale = pitch / 54.5
        let headerToFirstRow = Double(abs(start(rows[0]) - start(header)) / scale)
        let noteFrame = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", note)).firstMatch
        let lastRowToNote: Double? = noteFrame.exists
            ? Double((forward ? start(noteFrame.frame) - end(rows[rows.count - 1]) : end(rows[rows.count - 1]) - start(noteFrame.frame)) / scale)
            : nil
        let detail = "rows=\(rows.count) vertical=\(vertical) forward=\(forward) scale=\(scale) header=\(header) "
            + "firstRow=\(rows[0]) lastRow=\(rows[rows.count - 1]) note=\(noteFrame.exists ? "\(noteFrame.frame)" : "none") "
            + "headerToFirstRow=\(headerToFirstRow) lastRowToNote=\(lastRowToNote.map { "\($0)" } ?? "nil")"
        print("[landscape table] \(detail)")
        return (rows.count, headerToFirstRow, lastRowToNote, detail)
    }

    func testHistoricalComparisonAllowsLandscape() throws {
        let emailField = app.textFields["メールアドレス"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 35), "Login screen did not appear")
        type("ui-screenshot@example.com", into: emailField)
        type("ui-screenshot-password", into: app.secureTextFields["パスワード"])
        app.buttons["ログイン"].tap()
        XCTAssertTrue(waitForAnyElement(containing: "通貨ペア", timeout: 25), "Home did not load")

        tapIdentifier("v5Tab1")
        XCTAssertTrue(waitForAnyElement(containing: "米国CPI", timeout: 15), "Indicators list did not load")
        tap(containing: "国・地域")
        let usMenuItem = app.buttons["米国"]
        if usMenuItem.waitForExistence(timeout: 5) { usMenuItem.tap() }
        tap(containing: "米国CPI(消費者物価指数)")
        XCTAssertTrue(waitForAnyElement(containing: "過去イベント比較", timeout: 15), "Indicator Detail did not load")
        tap(containing: "過去イベント比較")
        XCTAssertTrue(waitForAnyElement(containing: "前回値", timeout: 15), "Historical Comparison did not load")
        // 縦画面では横画面専用の要素が無く、縦画面専用の戻るボタンがある。
        XCTAssertFalse(app.otherElements["historyLandscapeTopBar"].exists, "Landscape-only top bar should not exist in portrait")
        XCTAssertTrue(app.buttons["v5HeaderBack"].exists, "Portrait-only back button should exist in portrait")

        XCUIDevice.shared.orientation = .landscapeLeft
        Thread.sleep(forTimeInterval: 1.5)
        XCTAssertTrue(
            waitForAnyElement(containing: "前回値", timeout: 10),
            "Historical Comparison did not keep rendering its table after rotating to landscape"
        )
        // 横画面専用の要素が実際に現れ、縦画面専用の戻るボタン・タブバーが
        // 消えていることを確認する(文字列の存在だけでは回転の成否を
        // 検知できなかった反省を踏まえた、構造面のアサーション)。
        XCTAssertTrue(
            app.otherElements["historyLandscapeTopBar"].waitForExistence(timeout: 5),
            "Landscape-only top bar did not appear after rotating to landscape — the screen likely did not actually switch to the landscape layout"
        )
        XCTAssertFalse(app.buttons["v5HeaderBack"].exists, "Portrait-only back button should not exist in landscape")
        // `NavigationStack`はこの画面を押す前の画面(指標詳細)を画面裏に
        // 保持し続けており、その画面にも同じ`v5Tab1`識別子のタブバーが
        // 存在する — `app.buttons[id]`は画面の前面・裏面を問わずアプリ全体の
        // アクセシビリティツリーから一致する要素を探すため、
        // `.exists`だと裏の指標詳細の方が引っかかる。「画面として見えている
        // (ヒットテスト可能)かどうか」を見る`isHittable`を使う。
        XCTAssertFalse(app.buttons["v5Tab1"].isHittable, "Bottom tab bar should not be visible in landscape")
        print("=== [landscape debug] 前年/前月/日時 staticTexts ===")
        for text in app.staticTexts.allElementsBoundByIndex {
            if ["前年", "前月", "日時"].contains(text.label) {
                print("[landscape debug] label=\(text.label) frame=\(text.frame) exists=\(text.exists)")
            }
        }
        print("=== [landscape debug] historyLandscapeTopBar / table frames ===")
        print("[landscape debug] historyLandscapeTopBar frame=\(app.otherElements["historyLandscapeTopBar"].frame)")
        print("[landscape debug] window frame=\(app.windows.firstMatch.frame)")
        // OSのインターフェース回転に頼らない(`.rotationEffect`で見かけ上
        // 回転させるだけの)方式のため、UIKitの回転トランジションアニメー
        // ションは発生しない。このスクリーンショットの見え方自体について
        // は、このファイル冒頭の本テストのコメントを参照。
        capture("09b-HistoricalComparison-Landscape", settle: 1.5)

        // HQ指示(2026-11-06「過去イベント比較画面の横画面レイアウトの追加確認」、A の修正 195b645c): 横画面の表の高さは行の数に
        // 合わせる(行の高さの合計が上限 250pt を超えるときだけスクロール)。撮影はしない(スクリーンショットの枚数は変えない)。
        // PRO(7件、311pt > 250pt): 7行、無料プランの注記なし。
        XCTAssertTrue(app.otherElements["historyLandscapeTable"].waitForExistence(timeout: 5), "The landscape table is not shown")
        let pro = measureLandscapeTable(noteContaining: "無料プランは直近")
        XCTAssertEqual(pro.rows, 7, "The PRO plan should list 7 past releases. \(pro.detail)")
        XCTAssertNil(pro.lastRowToNote, "The plan-limit note should not be shown for PRO. \(pro.detail)")

        // 戻る: Portraitに戻すと、横画面専用の要素が消えて縦画面の見た目に戻る。
        XCUIDevice.shared.orientation = .portrait
        Thread.sleep(forTimeInterval: 1.0)
        XCTAssertTrue(waitForAnyElement(containing: "前回値", timeout: 10), "Historical Comparison did not resume its portrait layout")
        XCTAssertFalse(app.otherElements["historyLandscapeTopBar"].exists, "Landscape-only top bar should disappear after rotating back to portrait")
        tapIdentifier("v5HeaderBack")
        XCTAssertTrue(waitForAnyElement(containing: "過去イベント比較", timeout: 10), "Did not return to Indicator Detail after leaving Historical Comparison")

        // 無料プラン(直近3件): 表の外枠(カード)の大きさはアクセシビリティの枠では測れない(中の部品を囲むだけ)ため、カードの
        // すぐ下に出る「無料プランは直近3回分です…」の注記までの距離で、カードの中の空白を測る(修正前は 77pt で、注記が画面の
        // 端まで押し出されていた。Run 42151149763)。表の上側(見出しから最初の行まで)は PRO と同じ。
        addTeardownBlock { [weak self] in _ = self?.setMockSubscriptionPlan("PRO") }
        XCTAssertTrue(setMockSubscriptionPlan("FREE"), "Could not switch the mock plan to FREE")
        tap(containing: "過去イベント比較")
        XCTAssertTrue(waitForAnyElement(containing: "前回値", timeout: 15), "Historical Comparison did not load (free plan)")
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(app.otherElements["historyLandscapeTopBar"].waitForExistence(timeout: 10), "The screen did not switch to landscape (free plan)")
        XCTAssertTrue(app.otherElements["historyLandscapeTable"].waitForExistence(timeout: 10), "The landscape table is not shown (free plan)")
        Thread.sleep(forTimeInterval: 1.0)
        let free = measureLandscapeTable(noteContaining: "無料プランは直近3回分です")
        XCTAssertEqual(free.rows, 3, "The free plan should list 3 past releases. \(free.detail)")
        if let gap = free.lastRowToNote {
            XCTAssertLessThan(gap, 60, "Blank space between the last row and the plan note (free plan). \(free.detail)")
        } else {
            XCTFail("The plan-limit note is not shown below the table. \(free.detail)")
        }
        XCTAssertEqual(free.headerToFirstRow, pro.headerToFirstRow, accuracy: 2, "The top of the table moved between PRO and FREE. \(free.detail)")
        XCUIDevice.shared.orientation = .portrait
        Thread.sleep(forTimeInterval: 1.0)
        XCTAssertTrue(waitForAnyElement(containing: "前回値", timeout: 10), "Historical Comparison did not resume its portrait layout (free plan)")
        tapIdentifier("v5HeaderBack")
        XCTAssertTrue(waitForAnyElement(containing: "過去イベント比較", timeout: 10), "Did not return to Indicator Detail (free plan)")
    }

    /// Taps the row's center through SettingsView's fixed V5 layout (group 1
    /// top y=54.5, 31pt rows — SettingsView.rowHeight) mapped through V5Viewport's scale-to-fit.
    /// Center taps used to land in the row's Spacer gap, which had no
    /// contentShape and so ignored touches under `.buttonStyle(.plain)`
    /// (three CI runs captured 11-13 as the untouched Settings list).
    /// SettingsView now gives each row a contentShape, so tapping the
    /// center deliberately also checks that the whole row is tappable. If
    /// it doesn't navigate, attach a screenshot whose name records what
    /// XCUITest reports for the row.
    private func captureSettingsSubScreen(row: String, rowIndex: Int, extraOffset: CGFloat = 0, waitFor text: String, name: String) {
        tap(containing: "ホーム")
        tap(containing: "設定")
        XCTAssertTrue(waitForAnyElement(containing: "アカウント情報", timeout: 15), "Settings did not load before \(name)")
        tapV5(x: 117, y: 54.5 + (CGFloat(rowIndex) + 0.5) * 31 + extraOffset)
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
        tapV5(x: 117, y: 54.5 + 0.5 * 31)
        XCTAssertTrue(waitForAnyElement(containing: "プロフィール編集", timeout: 15), "Account did not load before \(name)")
        tapV5(x: 117, y: y)
        XCTAssertTrue(waitForAnyElement(containing: text, timeout: 15), "\(name) did not load")
        capture(name)
    }

    /// Taps a point given in V5's 234×491 canvas coordinates, using the same
    /// scale-to-fit and centering as `V5Viewport` (which ignores the safe
    /// area, so it fills the whole app frame).
    /// スクショ用モックサーバー(CIでは127.0.0.1:8090、シミュレーターから届く)の
    /// 購読プランを切り替える。届かなければfalse(その撮影だけ飛ばす)。
    /// モックの相場反応・チャートの応答に release_datetime_precision を付ける(nil = 付けない、今までの応答)。
    /// 届かなければfalse(その撮影だけ飛ばす)。
    private func setMockReactionPrecision(_ value: String?) -> Bool {
        guard let url = URL(string: "http://127.0.0.1:8090/__mock/reaction-precision?value=\(value ?? "")") else { return false }
        var request = URLRequest(url: url, timeoutInterval: 5)
        request.httpMethod = "POST"
        let done = DispatchSemaphore(value: 0)
        var succeeded = false
        URLSession.shared.dataTask(with: request) { _, response, _ in
            succeeded = (response as? HTTPURLResponse)?.statusCode == 200
            done.signal()
        }.resume()
        _ = done.wait(timeout: .now() + 6)
        return succeeded
    }

    /// モックの GET /events/{id} を「政策決定が記録された FOMC の会合」の形にする(false = 今までの応答)。届かなければfalse。
    private func setMockPolicyRate(_ on: Bool) -> Bool {
        guard let url = URL(string: "http://127.0.0.1:8090/__mock/policy-rate?value=\(on ? "1" : "0")") else { return false }
        var request = URLRequest(url: url, timeoutInterval: 5)
        request.httpMethod = "POST"
        let done = DispatchSemaphore(value: 0)
        var succeeded = false
        URLSession.shared.dataTask(with: request) { _, response, _ in
            succeeded = (response as? HTTPURLResponse)?.statusCode == 200
            done.signal()
        }.resume()
        _ = done.wait(timeout: .now() + 6)
        return succeeded
    }

    /// イベント詳細から指標詳細へ戻り、「次回発表予定」からもう一度イベント詳細を開く。
    private func reopenEventDetail() {
        tapIdentifier("v5HeaderBack")
        XCTAssertTrue(waitForAnyElement(containing: "過去イベント比較", timeout: 10), "Did not go back to Indicator Detail")
        tap(containing: "次回発表予定")
        XCTAssertTrue(waitForAnyElement(containing: "主要通貨ペアの値動き", timeout: 15), "Event Detail did not load")
    }

    /// 政策金利のデータが無いイベント詳細: 従来の結果のカード(結果・予想・前回)で、政策金利の見出し・NY連銀の出典は無い。
    private func assertConventionalResults(_ when: String) {
        XCTAssertTrue(app.staticTexts["結果"].firstMatch.waitForExistence(timeout: 10), "The results card is not shown (\(when))")
        XCTAssertTrue(app.staticTexts["予想"].firstMatch.exists, "The forecast column is not shown (\(when))")
        XCTAssertFalse(app.staticTexts["フェデラルファンド金利の誘導目標レンジ"].exists, "The policy-rate card is shown without data (\(when))")
        XCTAssertFalse(
            app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "ニューヨーク連邦準備銀行")).firstMatch.exists,
            "The NY Fed source is shown without data (\(when))"
        )
    }

    /// モックの GET /home をこの時間(ミリ秒)だけ遅らせる。0で戻す。届かなければfalse。
    private func setMockHomeDelay(_ milliseconds: Int) -> Bool {
        guard let url = URL(string: "http://127.0.0.1:8090/__mock/home-delay?ms=\(milliseconds)") else { return false }
        var request = URLRequest(url: url, timeoutInterval: 5)
        request.httpMethod = "POST"
        let done = DispatchSemaphore(value: 0)
        var succeeded = false
        URLSession.shared.dataTask(with: request) { _, response, _ in
            succeeded = (response as? HTTPURLResponse)?.statusCode == 200
            done.signal()
        }.resume()
        _ = done.wait(timeout: .now() + 6)
        return succeeded
    }

    /// モックの設定の文字サイズを「標準」にする(teardown 用)。モックが「標準」を返したらtrue。
    private func setMockTextSizeStandard() -> Bool {
        guard let url = URL(string: "http://127.0.0.1:8090/api/v1/settings") else { return false }
        var request = URLRequest(url: url, timeoutInterval: 5)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(#"{"display":{"text_size":"STANDARD"}}"#.utf8)
        let done = DispatchSemaphore(value: 0)
        var succeeded = false
        URLSession.shared.dataTask(with: request) { data, response, _ in
            if (response as? HTTPURLResponse)?.statusCode == 200,
               let data,
               let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let display = body["display"] as? [String: Any] {
                succeeded = display["text_size"] as? String == "STANDARD"
            }
            done.signal()
        }.resume()
        _ = done.wait(timeout: .now() + 6)
        return succeeded
    }

    /// 設定 → 表示・地域設定 → 文字サイズで `label`(小・標準・大)を選ぶ。保存されると全画面が作り直されて
    /// ホームのタブに戻る(RootView の `.id(textSize)`)。
    private func changeTextSize(to label: String) {
        tap(containing: "設定")
        XCTAssertTrue(waitForAnyElement(containing: "アカウント情報", timeout: 15), "Settings did not load")
        tapV5(x: 117, y: 54.5 + 3.5 * 31)
        XCTAssertTrue(waitForAnyElement(containing: "タイムゾーン", timeout: 15), "Display settings did not load")
        tap(containing: "文字サイズ")
        // 行のボタンのラベルは「大」か、チェックの画像の分が付いた「大, …」。
        let option = app.buttons.matching(NSPredicate(format: "label == %@ OR label BEGINSWITH %@", label, label + ",")).firstMatch
        XCTAssertTrue(option.waitForExistence(timeout: 10), "Text size option \(label) not found")
        option.tap()
    }

    /// `element`が消えるまで待つ(最大`timeout`秒)。期限内に1回でも無いことを確かめたらtrue。
    /// 呼ぶのは、要素が出たことを確かめた後だけ(初めから無いことを「消えた」と取り違えないため)。
    private func waitUntilGone(_ element: XCUIElement, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if !element.exists { return true }
            Thread.sleep(forTimeInterval: 0.5)
        }
        return false
    }

    /// モックの GET /home を失敗させる(true)・戻す(false)。届かなければfalse(その撮影だけ飛ばす)。
    private func setMockHomeFail(_ fail: Bool) -> Bool {
        guard let url = URL(string: "http://127.0.0.1:8090/__mock/home-fail?value=\(fail ? "1" : "0")") else { return false }
        var request = URLRequest(url: url, timeoutInterval: 5)
        request.httpMethod = "POST"
        let done = DispatchSemaphore(value: 0)
        var succeeded = false
        URLSession.shared.dataTask(with: request) { _, response, _ in
            succeeded = (response as? HTTPURLResponse)?.statusCode == 200
            done.signal()
        }.resume()
        _ = done.wait(timeout: .now() + 6)
        return succeeded
    }

    private func setMockSubscriptionPlan(_ plan: String) -> Bool {
        guard let url = URL(string: "http://127.0.0.1:8090/__mock/subscription-plan?plan=\(plan)") else { return false }
        var request = URLRequest(url: url, timeoutInterval: 5)
        request.httpMethod = "POST"
        let done = DispatchSemaphore(value: 0)
        var succeeded = false
        URLSession.shared.dataTask(with: request) { _, response, _ in
            succeeded = (response as? HTTPURLResponse)?.statusCode == 200
            done.signal()
        }.resume()
        _ = done.wait(timeout: .now() + 6)
        return succeeded
    }

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

    /// `text`を含む文字が画面内に入る(isHittable)まで、上へゆっくりスワイプする(最大10回)。
    /// ScrollView の中身は画面外でも`.exists`が true になるため、`isHittable`で判定する(04b と同じ)。
    private func scrollUntilHittable(containing text: String, maxSwipes: Int = 10) -> Bool {
        let element = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", text)).firstMatch
        var swipes = 0
        while !(element.exists && element.isHittable) && swipes < maxSwipes {
            app.swipeUp(velocity: .slow)
            swipes += 1
        }
        return element.exists && element.isHittable
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

    /// `query`に合う要素のうち押せるものを押す。押せるものが無ければ、画面の横幅の中にある
    /// (=今のタブの)要素に向かって1回だけゆっくりスクロールする。
    ///
    /// 2026-10-14: 以前は最初に見つかった要素だけを見て、押せなければ上へ素早くスワイプを
    /// 繰り返していたため、(1)行を通り過ぎる、(2)別のタブに同じ名前の要素があるとそちらを
    /// 追いかけ続ける、の2つでiPadのテストが時々止まっていた。合う要素を全部見て、押せる
    /// ものを優先し、スクロールは向きを見て1回ずつにした。
    private func tapFirstHittable(in queries: [XCUIElementQuery], timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        var swipes = 0
        while Date() < deadline {
            let candidates = queries.flatMap { $0.allElementsBoundByIndex }.filter { $0.exists }
            if let hittable = candidates.first(where: { $0.isHittable }) {
                hittable.tap()
                return true
            }
            let screen = app.windows.firstMatch.frame
            if let target = candidates.first(where: { !$0.frame.isEmpty && $0.frame.midX > screen.minX && $0.frame.midX < screen.maxX }),
               swipes < 12 {
                if target.frame.midY < screen.midY {
                    app.swipeDown(velocity: .slow)
                } else {
                    app.swipeUp(velocity: .slow)
                }
                swipes += 1
            }
            Thread.sleep(forTimeInterval: 0.4)
        }
        return false
    }

    /// SwiftUI exposes a `NavigationLink` row as different XCUITest element
    /// types depending on its container (`List` vs plain `VStack`/
    /// `ScrollView`) and OS version — this tries the common ones in order
    /// rather than assuming one.
    private func tap(containing text: String, timeout: TimeInterval = 10) {
        let predicate = NSPredicate(format: "label CONTAINS[c] %@", text)
        let queries = [app.buttons, app.cells, app.otherElements, app.staticTexts].map { $0.matching(predicate) }
        if !tapFirstHittable(in: queries, timeout: timeout) {
            XCTFail("Could not find a tappable element containing '\(text)' within \(timeout)s")
        }
    }

    /// `tap(containing:)`と同じ探し方を、表示文字ではなく`accessibilityIdentifier`で行う
    /// (日付・数値など、文字が変わるモックデータの行用)。
    private func tapIdentifier(_ identifier: String, timeout: TimeInterval = 10) {
        let queries = [app.buttons, app.cells, app.otherElements].map { $0.matching(identifier: identifier) }
        if !tapFirstHittable(in: queries, timeout: timeout) {
            XCTFail("Could not find a tappable element with identifier '\(identifier)' within \(timeout)s")
        }
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
