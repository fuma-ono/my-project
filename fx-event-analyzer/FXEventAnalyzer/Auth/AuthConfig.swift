import Foundation

/// 認証方式の切り替え(案B、2026-11-24)。
///
/// 1.0はApple/Googleでのログインのみ。メール/パスワードのログイン・新規登録・
/// パスワード再設定・メール変更・パスワード変更のUIは`emailAuthEnabled`がfalseの間
/// 表示しない(コードは削除せず残してあり、1.1で`emailAuthDefaultEnabled`をtrueにすれば
/// 画面が戻る)。アカウント削除・プロフィール編集はこの設定に関係なく常に使える。
enum AuthConfig {
    /// 1.0のリリース設定。メール認証UIを出すときはtrueにする(1.1用)。
    static let emailAuthDefaultEnabled = false

    /// UIスクリーンショットCI専用の環境変数。モックサーバーへメール/パスワードで
    /// ログインするUIテスト(`ScreenshotTests`)が付ける。ストア配布版のユーザーは
    /// 環境変数を設定できないので、通常利用では常に`emailAuthDefaultEnabled`と同じ。
    static let uiTestEmailAuthEnvironmentKey = "UI_SCREENSHOT_EMAIL_AUTH"

    static var emailAuthEnabled: Bool {
        if emailAuthDefaultEnabled { return true }
        return ProcessInfo.processInfo.environment[uiTestEmailAuthEnvironmentKey] != nil
    }
}
