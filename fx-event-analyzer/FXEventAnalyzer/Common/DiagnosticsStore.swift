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

    /// 新しい`/home`取得が始まったことを記録する。
    ///
    /// 診断の目的は「起動シーケンス」の内訳であり、起動後にタブの
    /// 出入り等で`/home`が再度走っても、その値で起動時の値を上書きして
    /// はいけない — 実機確認(UI自動テストのスクリーンショットで2回
    /// 実際に検出): 複数画面を回った後に設定画面を開くと「メイン画面
    /// 表示→/home認証開始」が100秒を超え、区間外の時間が負になる不具合が
    /// あった。
    ///
    /// 1回目の修正(IDが一致するかで判定)は不十分だった: `APIClient.
    /// send()`は`beginHomeRequest()`の戻り値を受け取らず、呼ばれるたびに
    /// `DiagnosticsStore.shared.current.homeRequestID`を読み直していた
    /// ため、2回目以降の取得でもそのつど「現在のID」を読んで一致判定に
    /// 通ってしまい、結局毎回上書きされていた。
    ///
    /// 対応: IDの一致ではなく、`homeRequestCount`が1(=まだ1回目の取得中)
    /// のときだけ記録を受け付けるようにした。`beginHomeRequest()`は
    /// `HomeViewModel.fetch()`から`apiClient.send()`より必ず先に呼ばれる
    /// ため、2回目の取得が始まった時点で`homeRequestCount`は既に2になって
    /// おり、以降の`recordHomeXxx`呼び出しは自動的に無視される。
    /// `homeRequestID`自体は診断画面に出す識別用の値として引き続き
    /// 1回目の取得時にだけ発行する。
    @discardableResult
    func beginHomeRequest() -> UUID {
        current.homeRequestCount += 1
        if current.homeRequestCount == 1 {
            current.homeRequestID = UUID()
        }
        persist()
        return current.homeRequestID ?? UUID()
    }

    /// 1回目の`/home`取得が進行中の間だけ記録を受け付ける。
    private var isRecordingFirstHomeRequest: Bool { current.homeRequestCount == 1 }

    func recordHomeAuthTokenStart() {
        guard isRecordingFirstHomeRequest else { return }
        current.homeAuthTokenStartMs = elapsedMs()
        persist()
    }

    func recordHomeAuthTokenEnd() {
        guard isRecordingFirstHomeRequest else { return }
        current.homeAuthTokenEndMs = elapsedMs()
        persist()
    }

    func recordHomeHTTPStart() {
        guard isRecordingFirstHomeRequest else { return }
        current.homeHTTPStartMs = elapsedMs()
        persist()
    }

    /// `statusCode`はHTTPステータスのみ(本文・ヘッダーは渡さないこと)。
    func recordHomeHTTPEnd(statusCode: Int?) {
        guard isRecordingFirstHomeRequest else { return }
        current.homeHTTPEndMs = elapsedMs()
        current.homeHTTPStatusCode = statusCode
        persist()
    }

    func recordHomeDecodeStart() {
        guard isRecordingFirstHomeRequest else { return }
        current.homeDecodeStartMs = elapsedMs()
        persist()
    }

    func recordHomeDecodeEnd(succeeded: Bool) {
        guard isRecordingFirstHomeRequest else { return }
        current.homeDecodeEndMs = elapsedMs()
        current.homeRequestOutcome = succeeded ? .success : .failure
        persist()
    }

    // MARK: - E. ホームデータの反映・表示

    func recordHomeStateApplied() {
        guard isRecordingFirstHomeRequest else { return }
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

    // MARK: - G. 通信の内訳(HQ指示 2026-10-21「通信遅延の詳細計測」)

    /// この要求の通信の内訳を記録するかどうかを決め、記録する場合は枠を作る。
    /// 記録するのは`LaunchDiagnostics.trackedAPIPaths`の、起動後1回目の要求だけ:
    /// - `home`: 既存の判定と同じ(1回目の`/home`取得中 = `homeRequestCount == 1`)
    /// - `calendar`・`speeches`: この起動でまだ記録していないとき
    /// `false`を返した要求は、APIClientが今までと同じ経路で送る(計測しない)。
    func beginAPIRequestDiagnostics(path: String) -> Bool {
        guard LaunchDiagnostics.trackedAPIPaths.contains(path) else { return false }
        if path == "home", !isRecordingFirstHomeRequest { return false }
        var requests = current.apiRequests ?? [:]
        guard requests[path] == nil else { return false }
        requests[path] = APIRequestDiagnostics(path: path)
        current.apiRequests = requests
        persist()
        return true
    }

    func recordAPIRequestAuthToken(path: String, ms: Int64) {
        updateAPIRequest(path) { $0.authTokenMs = ms }
    }

    /// `statusCode`はHTTPステータスのみ(本文・ヘッダーは渡さないこと)。
    func recordAPIRequestFinished(path: String, clientTotalMs: Int64, statusCode: Int?, succeeded: Bool) {
        updateAPIRequest(path) {
            $0.clientTotalMs = clientTotalMs
            $0.statusCode = statusCode
            $0.outcome = succeeded ? .success : .failure
        }
    }

    /// URLSessionのメトリクスが届いたとき(通信の完了の前後どちらでもよい)。
    func recordAPIRequestNetwork(path: String, _ network: NetworkTimingBreakdown) {
        updateAPIRequest(path) { $0.network = network }
        let reused: String
        switch network.reusedConnection {
        case .some(true): reused = "true"
        case .some(false): reused = "false"
        case .none: reused = "NA"
        }
        let fields: [String] = [
            "path=" + path,
            "total_ms=" + Self.logValue(network.taskTotalMs),
            "queue_ms=" + Self.logValue(network.queueMs),
            "dns_ms=" + Self.logValue(network.dnsMs),
            "tcp_ms=" + Self.logValue(network.tcpMs),
            "tls_ms=" + Self.logValue(network.tlsMs),
            "send_ms=" + Self.logValue(network.requestSendMs),
            "wait_ms=" + Self.logValue(network.waitMs),
            "receive_ms=" + Self.logValue(network.responseReceiveMs),
            "status=" + (network.statusCode.map(String.init) ?? "NA"),
            "reused=" + reused,
            "protocol=" + (network.networkProtocol ?? "NA"),
            "redirects=" + String(network.redirectCount),
        ]
        // 値はパス・ミリ秒・ステータス・接続の種類だけ(秘匿情報を含まない)ので .public で出す。
        let summary = fields.joined(separator: " ")
        logger.log("[diagnostics] network \(summary, privacy: .public)")
    }

    private func updateAPIRequest(_ path: String, _ change: (inout APIRequestDiagnostics) -> Void) {
        guard var request = current.apiRequests?[path] else { return }
        change(&request)
        current.apiRequests?[path] = request
        persist()
    }

    private static func logValue(_ ms: Int64?) -> String { ms.map(String.init) ?? "NA" }

    // MARK: - H. 前回のホームデータの先行表示(HQ決定 2026-10-21「起動の遅れの改善A1」)

    /// 前回データを画面に表示した時点。最初の1回だけ記録する
    /// (`recordHomeReadyToDisplay()`と同じ考え方)。
    func recordHomeSnapshotShown() {
        guard current.homeSnapshotShownMs == nil else { return }
        current.homeSnapshotShownMs = elapsedMs()
        persist()
        logger.log("[diagnostics] home snapshot shown")
    }

    /// 前回データが使えた/使えなかった理由と、その古さ(秒)を記録する。
    /// `ageSeconds`はトークン・ユーザーID等を含まない、単なる経過秒数。
    func recordHomeSnapshotOutcome(_ outcome: String, ageSeconds: Double?) {
        current.homeSnapshotOutcome = outcome
        current.homeSnapshotAgeSeconds = ageSeconds
        persist()
        logger.log("[diagnostics] home snapshot outcome=\(outcome, privacy: .public)")
    }
}
