import Foundation

/// HQ指示(2026-10-21)「通信遅延の詳細計測」: 起動診断で`/home` HTTP RTTが
/// 34.555秒だった一方、Render側のFastify `responseTime`は2.100秒だった。
/// サーバーの外側の時間がどこにあるかを次回の実測で切り分けるため、
/// `URLSessionTaskMetrics`から通信の内訳を取り出す。
///
/// 値の意味(Appleの`URLSessionTaskTransactionMetrics`の各時刻に従う):
/// - 接続待ち: `fetchStartDate` → 最初の通信開始(`domainLookupStartDate`、
///   無ければ`connectStartDate`、無ければ`requestStartDate`)
/// - DNS: `domainLookupStartDate` → `domainLookupEndDate`
/// - TCP: `connectStartDate` → `secureConnectionStartDate`(TLSあり)/
///   `connectEndDate`(TLSなし)。`connectStart〜connectEnd`はTLSを含むため、
///   TLSの区間を二重に数えないようにTLS開始で切る
/// - TLS: `secureConnectionStartDate` → `secureConnectionEndDate`
/// - 送信: `requestStartDate` → `requestEndDate`
/// - 応答待ち(TTFB相当): `requestEndDate` → `responseStartDate`。サーバーの
///   処理時間と、途中の中継(Renderの入り口など)での待ちを両方含み、
///   この計測だけでは区別できない
/// - 受信: `responseStartDate` → `responseEndDate`
/// - 全体: `URLSessionTaskMetrics.taskInterval`
///
/// 接続を再利用した場合、DNS・TCP・TLSの時刻はURLSessionから`nil`で届く。
/// 取得できない値は`nil`のまま保持し、0msとしては扱わない(表示は「N/A」)。
///
/// 秘匿情報: 保持するのは時間・HTTPステータス・接続の種類・プロトコル名・
/// リダイレクト回数だけ。URL・ヘッダー・本文・トークンは保持しない。
struct NetworkTimingBreakdown: Codable, Equatable {
    var taskTotalMs: Int64?
    var queueMs: Int64?
    var dnsMs: Int64?
    var tcpMs: Int64?
    var tlsMs: Int64?
    var requestSendMs: Int64?
    var waitMs: Int64?
    var responseReceiveMs: Int64?
    /// 全体から、最後の通信の内訳(上の7区間)の合計を引いた残り。リダイレクト
    /// 前の通信や、区間と区間の間のすき間がここに入る。負になる場合は`nil`。
    var unattributedMs: Int64?
    var statusCode: Int?
    /// `true` = 既存の接続を再利用、`false` = 新しい接続、`nil` = 不明。
    var reusedConnection: Bool?
    var proxyConnection: Bool?
    /// "network" / "localCache" / "serverPush" / "unknown"
    var fetchType: String
    /// "h2" / "http/1.1" など(取得できない場合は`nil`)。
    var networkProtocol: String?
    var redirectCount: Int
    var transactionCount: Int

    /// 1回の通信(トランザクション)の時刻。`URLSessionTaskTransactionMetrics`
    /// から作るが、テストでは直接組み立てる(Foundationのメトリクス型は
    /// 自分で生成できないため)。
    struct Transaction: Equatable {
        var fetchStart: Date?
        var domainLookupStart: Date?
        var domainLookupEnd: Date?
        var connectStart: Date?
        var connectEnd: Date?
        var secureConnectionStart: Date?
        var secureConnectionEnd: Date?
        var requestStart: Date?
        var requestEnd: Date?
        var responseStart: Date?
        var responseEnd: Date?
        var isReusedConnection: Bool
        var isProxyConnection: Bool
        var fetchType: String
        var networkProtocolName: String?
    }

    /// 内訳は最後の通信(リダイレクトがあればリダイレクト後)から作る。
    init(taskInterval: DateInterval?, redirectCount: Int, transactions: [Transaction], statusCode: Int?) {
        let last = transactions.last
        taskTotalMs = taskInterval.map { Self.ms($0.duration) }
        self.statusCode = statusCode
        self.redirectCount = redirectCount
        transactionCount = transactions.count
        fetchType = last?.fetchType ?? "unknown"
        networkProtocol = last?.networkProtocolName
        reusedConnection = last?.isReusedConnection
        proxyConnection = last?.isProxyConnection

        guard let last else {
            unattributedMs = nil
            return
        }
        let firstActivity = last.domainLookupStart ?? last.connectStart ?? last.requestStart
        queueMs = Self.diff(last.fetchStart, firstActivity)
        dnsMs = Self.diff(last.domainLookupStart, last.domainLookupEnd)
        tcpMs = Self.diff(last.connectStart, last.secureConnectionStart ?? last.connectEnd)
        tlsMs = Self.diff(last.secureConnectionStart, last.secureConnectionEnd)
        requestSendMs = Self.diff(last.requestStart, last.requestEnd)
        waitMs = Self.diff(last.requestEnd, last.responseStart)
        responseReceiveMs = Self.diff(last.responseStart, last.responseEnd)

        if let total = taskTotalMs {
            let phases = [queueMs, dnsMs, tcpMs, tlsMs, requestSendMs, waitMs, responseReceiveMs].compactMap { $0 }
            let rest = total - phases.reduce(0, +)
            unattributedMs = rest >= 0 ? rest : nil
        } else {
            unattributedMs = nil
        }
    }

    init(metrics: URLSessionTaskMetrics, statusCode: Int?) {
        self.init(
            taskInterval: metrics.taskInterval,
            redirectCount: metrics.redirectCount,
            transactions: metrics.transactionMetrics.map(Transaction.init(metrics:)),
            statusCode: statusCode
        )
    }

    private static func ms(_ seconds: TimeInterval) -> Int64 { Int64((seconds * 1000).rounded()) }

    private static func diff(_ start: Date?, _ end: Date?) -> Int64? {
        guard let start, let end, end >= start else { return nil }
        return ms(end.timeIntervalSince(start))
    }
}

extension NetworkTimingBreakdown.Transaction {
    init(metrics: URLSessionTaskTransactionMetrics) {
        self.init(
            fetchStart: metrics.fetchStartDate,
            domainLookupStart: metrics.domainLookupStartDate,
            domainLookupEnd: metrics.domainLookupEndDate,
            connectStart: metrics.connectStartDate,
            connectEnd: metrics.connectEndDate,
            secureConnectionStart: metrics.secureConnectionStartDate,
            secureConnectionEnd: metrics.secureConnectionEndDate,
            requestStart: metrics.requestStartDate,
            requestEnd: metrics.requestEndDate,
            responseStart: metrics.responseStartDate,
            responseEnd: metrics.responseEndDate,
            isReusedConnection: metrics.isReusedConnection,
            isProxyConnection: metrics.isProxyConnection,
            fetchType: Self.fetchTypeName(metrics.resourceFetchType),
            networkProtocolName: metrics.networkProtocolName
        )
    }

    static func fetchTypeName(_ type: URLSessionTaskMetrics.ResourceFetchType) -> String {
        switch type {
        case .networkLoad: return "network"
        case .localCache: return "localCache"
        case .serverPush: return "serverPush"
        case .unknown: return "unknown"
        @unknown default: return "unknown"
        }
    }
}

// MARK: - 表示用

extension NetworkTimingBreakdown {
    enum Phase: CaseIterable {
        case queue, dns, tcp, tls, requestSend, wait, responseReceive
    }

    func value(_ phase: Phase) -> Int64? {
        switch phase {
        case .queue: return queueMs
        case .dns: return dnsMs
        case .tcp: return tcpMs
        case .tls: return tlsMs
        case .requestSend: return requestSendMs
        case .wait: return waitMs
        case .responseReceive: return responseReceiveMs
        }
    }

    /// 値が無いときの理由。値があるときは`nil`。0msとN/Aを混同しないため、
    /// 表示とコピーの両方がこれを使う。
    func unavailableReason(_ phase: Phase) -> String? {
        guard value(phase) == nil else { return nil }
        if fetchType != "network" {
            return fetchType == "unknown" ? "通信の時刻が提供されていない" : "ネットワーク通信なし(\(fetchType))"
        }
        switch phase {
        case .dns, .tcp, .tls:
            if reusedConnection == true { return "接続を再利用(新しい接続なし)" }
            if phase == .tls, tcpMs != nil { return "TLSの時刻なし" }
            return "取得不可"
        default:
            return "取得不可"
        }
    }

    /// 「1234ms」/「N/A(理由)」。
    func describe(_ phase: Phase) -> String {
        if let ms = value(phase) { return LaunchDiagnostics.describe(ms) }
        return "N/A(\(unavailableReason(phase) ?? "取得不可"))"
    }

    var connectionDescription: String {
        switch reusedConnection {
        case .some(true): return "既存の接続を再利用"
        case .some(false): return "新しい接続"
        case .none: return "不明"
        }
    }
}

/// 1回のAPI呼び出しぶんの診断値(起動後1回目の`home`・`calendar`・`speeches`)。
struct APIRequestDiagnostics: Codable, Equatable {
    /// `Endpoint.path`のみ(例: "home")。クエリ文字列は含めない。
    let path: String
    var authTokenMs: Int64?
    /// `URLSession.data(for:)`を待っていた時間(アプリ側から見た通信全体)。
    var clientTotalMs: Int64?
    var statusCode: Int?
    var outcome: MeasurementOutcome = .notMeasured
    /// `nil` = URLSessionのメトリクスがまだ届いていない/届かなかった。
    var network: NetworkTimingBreakdown?
}

/// 1回の通信にだけ付けるタスク用の受け取り役。メトリクスを受け取るだけで、
/// リダイレクト・認証・キャッシュなど他の処理は既定の動き(セッション側)のまま。
final class NetworkMetricsCollector: NSObject, URLSessionTaskDelegate {
    private let onMetrics: (NetworkTimingBreakdown) -> Void

    init(onMetrics: @escaping (NetworkTimingBreakdown) -> Void) {
        self.onMetrics = onMetrics
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics) {
        let statusCode = (task.response as? HTTPURLResponse)?.statusCode
        onMetrics(NetworkTimingBreakdown(metrics: metrics, statusCode: statusCode))
    }
}
