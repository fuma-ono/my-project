import Foundation
import os

/// HQ指示(2026-10-20)「起動診断画面」: 起動シーケンスの計測値そのものを
/// 保持する。既存の`ClientTiming`(os.Loggerへのログ出力専用)はそのまま
/// 残し、ログを後から解析して値を取り出す設計にはしていない — 同じ
/// 計測イベントの場で、ログ出力(`ClientTiming`)とこの保持(このクラス)
/// の両方を行う。
///
/// `FavoritesStore`/`AppPreferences`/`PlanStore`と同じ`.shared`シングル
/// トン・`UserDefaults`永続化のパターンに合わせている。
///
/// 診断データに含めるのはラベル・経過ミリ秒・成功/失敗の状態・HTTP
/// ステータスコードのみ。トークン・ユーザーID・認証ヘッダー・リクエスト
/// /レスポンス本文・個人情報は一切保持しない(秘匿情報はそもそも呼び出し
/// 側からこのクラスに渡さない設計)。
///
/// 外部通信は一切行わない(ローカルのUserDefaultsのみ)。
@MainActor
final class DiagnosticsStore: ObservableObject {
    static let shared = DiagnosticsStore()

    /// 今回の起動の計測値(ライブ更新)。
    @Published private(set) var current: LaunchDiagnostics
    /// 前回の起動(このプロセスを起動する前にアプリが記録していた値)。
    /// 取得できない場合(初回起動・データ消去後等)は`nil`。
    @Published private(set) var previous: LaunchDiagnostics?

    private static let storageKey = "com.fumaono.fxeventanalyzer.launchDiagnostics.lastRecorded"
    private let defaults: UserDefaults
    private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "FXEventAnalyzer", category: "diagnostics")

    /// 基準点(経過msの起点)。`FXEventAnalyzerApp.init()`で生成されるこの
    /// インスタンス自身の初期化時点が、アプリ内コードが動き始める最初の
    /// 地点に最も近い — それより前の時間(プロセス起動〜Swiftランタイム
    /// 初期化等)はアプリ内計測だけでは直接測れない。
    private let launchReference: ContinuousClock.Instant

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.launchReference = ContinuousClock.now

        if let data = defaults.data(forKey: Self.storageKey),
           let decoded = try? JSONDecoder().decode(LaunchDiagnostics.self, from: data) {
            self.previous = decoded
        } else {
            self.previous = nil
        }

        var fresh = LaunchDiagnostics(launchID: UUID(), startedAt: Date())
        fresh.systemUptimeAtLaunchSeconds = ProcessInfo.processInfo.systemUptime
        self.current = fresh
        persist()
    }

    private func elapsedMs() -> Int64 {
        (ContinuousClock.now - launchReference).milliseconds
    }

    /// 起動ごとに`current`をUserDefaultsへ上書き保存する。次回起動時の
    /// `init()`がこれを読んで「前回」にする — 明示的な「正常終了」通知を
    /// 必要としないため、起動が完了しなかった場合(失敗・強制終了)でも、
    /// その時点までの値が次回「前回の起動」として残る。1件(数百バイト)
    /// のみ保持し、履歴を蓄積しない。
    private func persist() {
        guard let data = try? JSONEncoder().encode(current) else { return }
        defaults.set(data, forKey: Self.storageKey)
    }

    // MARK: - A. 起動シーケンス(SplashViewModel)

    func recordRunInitSequenceStart() {
        current.runInitSequenceStartMs = elapsedMs()
        persist()
    }

    func recordSessionCheckStart() {
        current.sessionCheckStartMs = elapsedMs()
        persist()
    }

    func recordSessionCheckEnd(succeeded: Bool) {
        current.sessionCheckEndMs = elapsedMs()
        current.sessionCheckOutcome = succeeded ? .success : .failure
        persist()
    }

    func recordRunInitSequenceFinished(succeeded: Bool) {
        current.splashFinishedMs = elapsedMs()
        current.runInitSequenceOutcome = succeeded ? .success : .failure
        persist()
        logger.log("[diagnostics] runInitSequence finished outcome=\(succeeded ? "success" : "failure", privacy: .public)")
    }

    // MARK: - F. Splash→ホームの画面遷移

    /// 最初の1回だけ記録する(タブ切り替え等での再表示では上書きしない)。
    func recordMainScreenAppeared() {
        guard current.mainScreenAppearedMs == nil else { return }
        current.mainScreenAppearedMs = elapsedMs()
        persist()
    }

    // MARK: - B・C・D. /home の認証・通信・デコード

    /// 新しい`/home`取得が始まったことを記録し、以降のB/C/Dの値をこの
    /// リクエストに紐づけるためのID(診断セッション内だけのランダム値、
    /// ユーザーID等とは無関係)を払い出す。
    @discardableResult
    func beginHomeRequest() -> UUID {
        let id = UUID()
        current.homeRequestID = id
        current.homeRequestCount += 1
        // 新しいリクエストを始める時点で、前回ぶんの詳細値をクリアする
        // (古いリクエストの値が新しいリクエストの値と混ざらないように)。
        current.homeAuthTokenStartMs = nil
        current.homeAuthTokenEndMs = nil
        current.homeHTTPStartMs = nil
        current.homeHTTPEndMs = nil
        current.homeHTTPStatusCode = nil
        current.homeDecodeStartMs = nil
        current.homeDecodeEndMs = nil
        current.homeRequestOutcome = .notMeasured
        current.homeStateAppliedMs = nil
        persist()
        return id
    }

    func recordHomeAuthTokenStart(requestID: UUID) {
        guard requestID == current.homeRequestID else { return }
        current.homeAuthTokenStartMs = elapsedMs()
        persist()
    }

    func recordHomeAuthTokenEnd(requestID: UUID) {
        guard requestID == current.homeRequestID else { return }
        current.homeAuthTokenEndMs = elapsedMs()
        persist()
    }

    func recordHomeHTTPStart(requestID: UUID) {
        guard requestID == current.homeRequestID else { return }
        current.homeHTTPStartMs = elapsedMs()
        persist()
    }

    /// `statusCode`はHTTPステータスのみ(本文・ヘッダーは渡さないこと)。
    func recordHomeHTTPEnd(requestID: UUID, statusCode: Int?) {
        guard requestID == current.homeRequestID else { return }
        current.homeHTTPEndMs = elapsedMs()
        current.homeHTTPStatusCode = statusCode
        persist()
    }

    func recordHomeDecodeStart(requestID: UUID) {
        guard requestID == current.homeRequestID else { return }
        current.homeDecodeStartMs = elapsedMs()
        persist()
    }

    func recordHomeDecodeEnd(requestID: UUID, succeeded: Bool) {
        guard requestID == current.homeRequestID else { return }
        current.homeDecodeEndMs = elapsedMs()
        current.homeRequestOutcome = succeeded ? .success : .failure
        persist()
    }

    // MARK: - E. ホームデータの反映・表示

    func recordHomeStateApplied(requestID: UUID) {
        guard requestID == current.homeRequestID else { return }
        current.homeStateAppliedMs = elapsedMs()
        persist()
    }

    /// 最初の1回だけ記録する(再読み込みのたびには更新しない — あくまで
    /// 「起動シーケンス中に初めてホームが表示可能になった時刻」)。
    func recordHomeReadyToDisplay() {
        guard current.homeReadyToDisplayMs == nil else { return }
        current.homeReadyToDisplayMs = elapsedMs()
        persist()
        logger.log("[diagnostics] home ready to display")
    }
}
