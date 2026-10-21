import Foundation

/// HQ指示(2026-10-20)「起動診断画面」: 起動シーケンス(Splash〜Home表示)
/// 1回ぶんの計測値。`DiagnosticsStore`が生成・更新し、設定画面の
/// 「起動診断」はこれを表示専用で読む。
///
/// すべての時刻は`DiagnosticsStore`が起動時に一度だけ記録する基準点
/// (`FXEventAnalyzerApp.init()`、アプリ内コードが動き始める最初の地点)
/// からの経過ミリ秒(`Int64`)。`nil`は「未計測」であり、`0`(計測済みで
/// 経過0ms)とは明確に区別する。
///
/// 秘匿情報(トークン・ユーザーID・認証ヘッダー・リクエスト/レスポンス
/// 本文・個人情報・APIキー)は一切保持しない — ラベル・時刻・ミリ秒・
/// 成功/失敗の状態と、HTTPステータスコード(数値のみ)だけを保持する。
struct LaunchDiagnostics: Codable, Equatable {
    /// この起動だけのランダムな識別子。ユーザーID等とは無関係で、起動
    /// ごとに新しく発行する「今回/前回」を区別するためだけのもの。
    let launchID: UUID
    /// この起動の記録を開始した日時(壁時計時刻、「最終起動日時」表示用)。
    let startedAt: Date
    /// 参考値: OS起動(端末の最後の再起動)からの経過秒数。アプリ起動時間
    /// とは別物であることを診断画面側で明記する。
    var systemUptimeAtLaunchSeconds: Double?

    // MARK: - A. 起動シーケンス(SplashViewModel.runInitSequence)

    /// `runInitSequence()`が呼ばれた時点(基準点からの経過ms、通常0に近い)。
    var runInitSequenceStartMs: Int64?
    /// `authService.currentSession()`の呼び出し開始・終了。
    var sessionCheckStartMs: Int64?
    var sessionCheckEndMs: Int64?
    var sessionCheckOutcome: MeasurementOutcome = .notMeasured
    /// `onFinished(outcome)`が呼ばれた時点(Splash完了コールバック)。
    /// セッション取得が失敗した場合はここに到達しないため`nil`のまま。
    var splashFinishedMs: Int64?
    var runInitSequenceOutcome: MeasurementOutcome = .notMeasured

    // MARK: - F. Splash→ホームの画面遷移

    /// メイン画面(`MainTabView`)が最初に画面に現れた時点。SwiftUIの
    /// `.onAppear`は「表示イベントが発生した」ことを示すのみで、
    /// 描画が完全に終わったことを保証しない — 診断画面側でもその
    /// 前提で説明する。
    var mainScreenAppearedMs: Int64?

    // MARK: - B・C・D. /home の認証・通信・デコード(起動時=1回目のリクエストぶん)

    /// このプロセス内で`/home`取得が何回走ったか。起動シーケンスの診断が
    /// 目的のため、以下の詳細値は常に1回目(起動時)のものに固定され、
    /// 2回目以降(タブの出入り等での再取得)では上書きされない —
    /// `DiagnosticsStore.beginHomeRequest()`のドキュメントコメント参照。
    var homeRequestCount: Int = 0
    /// 1回目(起動時)の`/home`取得だけに紐づく、診断セッション内限定のID
    /// (ユーザーIDやセッションIDとは無関係なランダム値)。
    var homeRequestID: UUID?
    var homeAuthTokenStartMs: Int64?
    var homeAuthTokenEndMs: Int64?
    var homeHTTPStartMs: Int64?
    var homeHTTPEndMs: Int64?
    /// 必要な場合のみ(診断目的)。レスポンス本文は含まない。
    var homeHTTPStatusCode: Int?
    var homeDecodeStartMs: Int64?
    var homeDecodeEndMs: Int64?
    var homeRequestOutcome: MeasurementOutcome = .notMeasured

    // MARK: - E. ホームデータの反映・表示

    /// `HomeViewModel.state = .loaded(...)`を代入した時点。
    var homeStateAppliedMs: Int64?
    /// `HomeView`の読み込み済みコンテンツが最初に画面に現れた時点
    /// (`.onAppear`、完全な描画完了の保証ではない)。
    var homeReadyToDisplayMs: Int64?

    // MARK: - G. 通信の内訳(HQ指示 2026-10-21「通信遅延の詳細計測」)

    /// 起動後1回目の`home`・`calendar`・`speeches`の通信の内訳(キーは
    /// `Endpoint.path`)。古い保存データには無いため`Optional`(読めなくなら
    /// ないように)。`nil`・キーなし = その要求はまだ走っていない。
    var apiRequests: [String: APIRequestDiagnostics]?

    init(launchID: UUID, startedAt: Date) {
        self.launchID = launchID
        self.startedAt = startedAt
    }
}

/// 個々の計測の成否。「未計測」を「0ms(=一瞬で成功)」と混同しないための
/// 専用の状態。
enum MeasurementOutcome: String, Codable, Equatable {
    case notMeasured = "未計測"
    case success = "成功"
    case failure = "失敗"
}

// MARK: - 表示用の計算値

extension LaunchDiagnostics {
    /// 名前付きの区間ひとつぶん: 開始点・終了点の簡潔な説明と、実測の
    /// 所要時間(両端が揃って初めて計算できる)。
    struct Span: Equatable {
        let label: String
        let startDescription: String
        let endDescription: String
        let durationMs: Int64?

        var isMeasured: Bool { durationMs != nil }
    }

    /// HQ指定の計測項目に対応する区間一覧(開始点・終了点を明記)。
    /// 表示・コピー・書き出しのすべてがこの1箇所から値を作る。
    var spans: [Span] {
        [
            Span(
                label: "Supabaseセッション取得",
                startDescription: "authService.currentSession() 呼び出し開始",
                endDescription: "authService.currentSession() 完了(成功/失敗いずれも)",
                durationMs: diff(sessionCheckStartMs, sessionCheckEndMs)
            ),
            Span(
                label: "Splash最小表示時間待機など",
                startDescription: "Supabaseセッション取得完了",
                endDescription: "Splash完了コールバック(onFinished)",
                durationMs: diff(sessionCheckEndMs, splashFinishedMs)
            ),
            Span(
                label: "Splash→メイン画面遷移",
                startDescription: "Splash完了コールバック(onFinished)",
                endDescription: "メイン画面の表示イベント(MainTabView .onAppear)",
                durationMs: diff(splashFinishedMs, mainScreenAppearedMs)
            ),
            Span(
                label: "メイン画面表示→/home認証開始",
                startDescription: "メイン画面の表示イベント",
                endDescription: "API認証トークン取得(/home)開始",
                durationMs: diff(mainScreenAppearedMs, homeAuthTokenStartMs)
            ),
            Span(
                label: "API認証トークン取得(/home)",
                startDescription: "authTokenProvider() 呼び出し開始",
                endDescription: "authTokenProvider() 完了",
                durationMs: diff(homeAuthTokenStartMs, homeAuthTokenEndMs)
            ),
            Span(
                label: "/home HTTP通信往復",
                startDescription: "HTTPリクエスト送信開始",
                endDescription: "HTTPレスポンス受信完了(通信往復のみ、サーバー内部処理・Renderのコールドスタート待ちを含みうる)",
                durationMs: diff(homeAuthTokenEndMs, homeHTTPEndMs)
            ),
            Span(
                label: "/home JSONデコード",
                startDescription: "レスポンス受信完了",
                endDescription: "JSONデコード完了",
                durationMs: diff(homeDecodeStartMs, homeDecodeEndMs)
            ),
            Span(
                label: "ホームデータの状態反映",
                startDescription: "JSONデコード完了",
                endDescription: "state = .loaded(...) 反映完了",
                durationMs: diff(homeDecodeEndMs, homeStateAppliedMs)
            ),
            Span(
                label: "ホーム画面の表示イベントまで",
                startDescription: "state = .loaded(...) 反映完了",
                endDescription: "ホーム画面コンテンツの表示イベント(.onAppear、完全な描画完了の保証ではない)",
                durationMs: diff(homeStateAppliedMs, homeReadyToDisplayMs)
            ),
        ]
    }

    /// 起動シーケンス(Splash内)の所要時間。`sessionCheckStartMs`〜
    /// `splashFinishedMs`(成功時のみ到達)。
    var runInitSequenceTotalMs: Int64? { diff(runInitSequenceStartMs, splashFinishedMs) }

    /// 起動シーケンス全体: 基準点(0)からホーム画面の表示イベントまで。
    /// これが実機で報告されている「約30秒」に対応する数値。
    var totalUntilHomeReadyMs: Int64? { homeReadyToDisplayMs }

    /// 計測済み区間の合計(重複なし、`spans`はすべて隣接区間なので単純合計でよい)。
    var sumOfMeasuredSpansMs: Int64 {
        spans.compactMap(\.durationMs).reduce(0, +)
    }

    /// 全体時間と、測れた区間の合計との差。基準点(アプリ内最初の計測点)
    /// より前の時間や、どの区間にも入らない未計測の空白を表す。
    /// 全区間が計測済みなら理論上0に近いはず — 大きくずれる場合は
    /// どこかの区間が未計測であることを意味する。
    var unaccountedMs: Int64? {
        guard let total = totalUntilHomeReadyMs else { return nil }
        return total - sumOfMeasuredSpansMs
    }

    private func diff(_ start: Int64?, _ end: Int64?) -> Int64? {
        guard let start, let end, end >= start else { return nil }
        return end - start
    }

    /// HQ指示(2026-10-20、2回目「起動遅延の再調査」): 「アプリをすぐ
    /// 再起動した場合」と「しばらく時間を空けた場合」を、既存の起動診断
    /// 画面(今回/前回の表示)だけで比較できるようにするための表示専用の
    /// 値。新しい計測(アプリ内コードの計測フック)は追加せず、既に保持
    /// している両方の起動の`startedAt`から計算するだけ — Renderの無料
    /// プランが15分アクセスが無いと眠る(次のアクセスで起きるまで30〜60秒)
    /// 仕様と突き合わせる際の目安になる。
    func intervalSincePreviousDescription(previous: LaunchDiagnostics?) -> String {
        guard let previous else { return "前回の起動データがないため算出できません" }
        let seconds = startedAt.timeIntervalSince(previous.startedAt)
        guard seconds >= 0 else { return "算出不可" }
        return Self.describeInterval(seconds)
    }

    /// 秒単位の間隔を「X分Y秒」等で表示する(起動区間の`describe(_:)`は
    /// ミリ秒〜数十秒向けのため、分・時間単位になりうるこの値には別の
    /// 書式を使う)。
    private static func describeInterval(_ seconds: TimeInterval) -> String {
        let totalSeconds = Int(seconds)
        if totalSeconds < 60 { return "\(totalSeconds)秒" }
        let minutes = totalSeconds / 60
        let remainingSeconds = totalSeconds % 60
        if minutes < 60 { return "\(minutes)分\(remainingSeconds)秒" }
        let hours = minutes / 60
        let remainingMinutes = minutes % 60
        return "\(hours)時間\(remainingMinutes)分"
    }

    /// 項目11「計測成功・失敗・未計測の状態」の要約。
    var overallStatusDescription: String {
        let outcomes = [sessionCheckOutcome, runInitSequenceOutcome, homeRequestOutcome]
        if outcomes.contains(.failure) { return "一部の処理が失敗しました" }
        if outcomes.contains(.notMeasured) { return "まだ起動シーケンスの途中です(一部未計測)" }
        return "すべて成功"
    }

    /// msを「1000ms以上は秒、未満はms」で表示し、未計測は"未計測"と表示する
    /// (0msと混同しない)。コピー・書き出しと画面表示の両方がこれを使う。
    static func describe(_ ms: Int64?) -> String {
        guard let ms else { return "未計測" }
        if ms >= 1000 {
            return String(format: "%.2f秒(%dms)", Double(ms) / 1000, ms)
        }
        return "\(ms)ms"
    }

    private static let reportDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.dateFormat = "yyyy/MM/dd HH:mm:ss"
        return formatter
    }()

    /// コピー・書き出しの両方が使う、診断結果のプレーンテキスト表現。
    /// このメソッドが参照するのはこの構造体の値(と、引数で渡された前回の
    /// 起動の値)だけで、トークン・ユーザーID・認証ヘッダー・本文等は
    /// そもそも保持していないため混入しない。
    ///
    /// `previous`はHQ指示(2026-10-20、2回目「起動遅延の再調査」)対応:
    /// 「すぐ再起動した場合」と「しばらく時間を空けた場合」をコピー・
    /// 書き出し結果だけでも比較できるよう、前回の起動日時との間隔を含める
    /// (省略時は従来通り今回の起動の値のみ、既存の呼び出し元・テストに
    /// 影響しない)。
    func reportText(appVersion: String, buildNumber: String, generatedAt: Date = Date(), previous: LaunchDiagnostics? = nil) -> String {
        var lines: [String] = []
        lines.append("FX Event Analyzer 起動診断結果")
        lines.append("バージョン: \(appVersion) (\(buildNumber))")
        lines.append("診断日時: \(Self.reportDateFormatter.string(from: generatedAt))")
        lines.append("対象の起動の記録開始日時: \(Self.reportDateFormatter.string(from: startedAt))")
        if let previous {
            lines.append("前回の起動の記録開始日時: \(Self.reportDateFormatter.string(from: previous.startedAt))")
            lines.append("前回の起動との間隔: \(intervalSincePreviousDescription(previous: previous))")
        } else {
            lines.append("前回の起動データ: なし")
        }
        lines.append("")
        lines.append("[起動シーケンス全体]")
        lines.append("合計時間(起動基準点〜ホーム表示イベント): \(Self.describe(totalUntilHomeReadyMs))")
        lines.append("起動シーケンス(Splash)所要時間: \(Self.describe(runInitSequenceTotalMs)) [状態: \(runInitSequenceOutcome.rawValue)]")
        lines.append("区間外・未計測の時間: \(unaccountedMs.map { Self.describe($0) } ?? "算出不可(合計時間が未計測)")")
        lines.append("計測の状態: \(overallStatusDescription)")
        lines.append("")
        lines.append("[区間ごとの計測値(開始点→終了点)]")
        for span in spans {
            lines.append("- \(span.label): \(Self.describe(span.durationMs))")
            lines.append("    開始: \(span.startDescription)")
            lines.append("    終了: \(span.endDescription)")
        }
        lines.append("")
        lines.append("[/homeリクエストの詳細]")
        lines.append("今回の起動内での/home取得回数: \(homeRequestCount == 0 ? "未実行" : "\(homeRequestCount)回")")
        lines.append("Supabaseセッション取得: \(Self.describe(diff(sessionCheckStartMs, sessionCheckEndMs))) [状態: \(sessionCheckOutcome.rawValue)]")
        lines.append("/homeリクエスト全体の状態: \(homeRequestOutcome.rawValue)")
        lines.append("/home HTTPステータスコード: \(homeHTTPStatusCode.map(String.init) ?? "未計測")")
        lines.append("")
        lines.append("[通信の内訳(起動後1回目の要求)]")
        for path in Self.trackedAPIPaths {
            lines.append(contentsOf: Self.networkReportLines(path: path, request: apiRequests?[path]))
        }
        lines.append("応答待ち(送信完了→応答開始)には、サーバーの処理時間と途中の中継(Renderの入り口など)での待ちの両方が入り、この計測だけでは区別できません。")
        lines.append("")
        lines.append("[参考・注記]")
        if let uptime = systemUptimeAtLaunchSeconds {
            lines.append("OS起動(端末の最後の再起動)からの経過秒数(起動時点): \(String(format: "%.1f", uptime))秒 — アプリの起動時間とは別物")
        }
        lines.append("この計測の基準点(経過0ms)より前の時間(プロセス起動・Swiftランタイム初期化等)は、アプリ内計測だけでは直接測れません。")
        lines.append("「表示イベント」はSwiftUIの.onAppearが発生した時刻で、描画が完全に終了したことを保証するものではありません。")
        return lines.joined(separator: "\n")
    }
}

// MARK: - 通信の内訳の表示(画面・コピーで共通)

extension LaunchDiagnostics {
    /// 通信の内訳を記録するAPI(`Endpoint.path`)。表示もこの順。
    static let trackedAPIPaths = ["home", "calendar", "speeches"]

    /// 1つの区間の表示名と値(「N/A(理由)」を含む)。
    static func networkRows(_ request: APIRequestDiagnostics) -> [(String, String)] {
        var rows: [(String, String)] = [
            ("認証トークン取得", describe(request.authTokenMs)),
            ("通信全体(アプリから見た待ち時間)", describe(request.clientTotalMs)),
            ("HTTPステータス", request.statusCode.map(String.init) ?? "未計測"),
            ("状態", request.outcome.rawValue),
        ]
        guard let network = request.network else {
            rows.append(("通信の内訳", "未取得(URLSessionのメトリクスが届いていない)"))
            return rows
        }
        rows.append(contentsOf: [
            ("URLSession全体(taskInterval)", describe(network.taskTotalMs)),
            ("接続待ち(開始→最初の通信)", network.describe(.queue)),
            ("DNS", network.describe(.dns)),
            ("TCP(TLSを除く)", network.describe(.tcp)),
            ("TLS", network.describe(.tls)),
            ("送信", network.describe(.requestSend)),
            ("応答待ち(送信完了→応答開始)", network.describe(.wait)),
            ("受信", network.describe(.responseReceive)),
            ("内訳外(全体−上の区間)", network.unattributedMs.map { describe($0) } ?? "算出不可"),
            ("接続", network.connectionDescription),
            ("プロトコル", network.networkProtocol ?? "不明"),
            ("取得の種類", network.fetchType),
            ("リダイレクト", network.redirectCount == 0 ? "なし" : "\(network.redirectCount)回"),
        ])
        return rows
    }

    static func networkReportLines(path: String, request: APIRequestDiagnostics?) -> [String] {
        guard let request else { return ["/\(path): 未実行(この起動ではまだ要求していない)"] }
        return ["/\(path):"] + networkRows(request).map { "  - \($0.0): \($0.1)" }
    }
}

