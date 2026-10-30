import XCTest
@testable import FXEventAnalyzer

/// HQ指示(2026-10-21)「通信遅延の詳細計測」: URLSessionTaskMetrics から作る通信の内訳。
/// Foundation のメトリクス型は自分で生成できないため、内訳の計算は
/// `NetworkTimingBreakdown.Transaction` を直接組み立てて確かめる。実際の
/// URLSession を通す経路は、下の `APIClientNetworkDiagnosticsTests` で確かめる。
final class NetworkMetricsTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)
    private func at(_ ms: Int) -> Date { t0.addingTimeInterval(Double(ms) / 1000) }

    private func newTLSConnection() -> NetworkTimingBreakdown.Transaction {
        .init(
            fetchStart: at(0),
            domainLookupStart: at(5), domainLookupEnd: at(25),
            connectStart: at(25), connectEnd: at(125),
            secureConnectionStart: at(60), secureConnectionEnd: at(125),
            requestStart: at(130), requestEnd: at(131),
            responseStart: at(32_131), responseEnd: at(32_200),
            isReusedConnection: false, isProxyConnection: false,
            fetchType: "network", networkProtocolName: "h2"
        )
    }

    func testNewTLSConnectionSplitsPhasesWithoutCountingTLSTwice() {
        let breakdown = NetworkTimingBreakdown(
            taskInterval: DateInterval(start: at(0), end: at(32_210)),
            redirectCount: 0,
            transactions: [newTLSConnection()],
            statusCode: 200
        )
        XCTAssertEqual(breakdown.taskTotalMs, 32_210)
        XCTAssertEqual(breakdown.queueMs, 5)
        XCTAssertEqual(breakdown.dnsMs, 20)
        XCTAssertEqual(breakdown.tcpMs, 35, "TCP is connectStart → secureConnectionStart (TLS excluded)")
        XCTAssertEqual(breakdown.tlsMs, 65)
        XCTAssertEqual(breakdown.requestSendMs, 1)
        XCTAssertEqual(breakdown.waitMs, 32_000)
        XCTAssertEqual(breakdown.responseReceiveMs, 69)
        // 5+20+35+65+1+32000+69 = 32195 → 15ms between phases / after responseEnd.
        XCTAssertEqual(breakdown.unattributedMs, 15)
        XCTAssertEqual(breakdown.reusedConnection, false)
        XCTAssertEqual(breakdown.connectionDescription, "新しい接続")
        XCTAssertEqual(breakdown.networkProtocol, "h2")
        XCTAssertEqual(breakdown.statusCode, 200)
        for phase in NetworkTimingBreakdown.Phase.allCases {
            XCTAssertNil(breakdown.unavailableReason(phase), "\(phase) was measured")
        }
    }

    func testTCPWithoutTLSUsesConnectEnd() {
        var tx = newTLSConnection()
        tx.secureConnectionStart = nil
        tx.secureConnectionEnd = nil
        let breakdown = NetworkTimingBreakdown(taskInterval: nil, redirectCount: 0, transactions: [tx], statusCode: 200)
        XCTAssertEqual(breakdown.tcpMs, 100)
        XCTAssertNil(breakdown.tlsMs)
        XCTAssertEqual(breakdown.unavailableReason(.tls), "TLSの時刻なし")
        XCTAssertNil(breakdown.unattributedMs, "no taskInterval → no total → not computed")
    }

    func testReusedConnectionShowsNAInsteadOfZero() {
        let tx = NetworkTimingBreakdown.Transaction(
            fetchStart: at(0), domainLookupStart: nil, domainLookupEnd: nil,
            connectStart: nil, connectEnd: nil, secureConnectionStart: nil, secureConnectionEnd: nil,
            requestStart: at(2), requestEnd: at(3), responseStart: at(1_503), responseEnd: at(1_510),
            isReusedConnection: true, isProxyConnection: false, fetchType: "network", networkProtocolName: "h2"
        )
        let breakdown = NetworkTimingBreakdown(
            taskInterval: DateInterval(start: at(0), end: at(1_510)), redirectCount: 0, transactions: [tx], statusCode: 200
        )
        XCTAssertNil(breakdown.dnsMs)
        XCTAssertNil(breakdown.tcpMs)
        XCTAssertNil(breakdown.tlsMs)
        XCTAssertEqual(breakdown.queueMs, 2, "fetchStart → requestStart when there is no DNS/connect")
        XCTAssertEqual(breakdown.waitMs, 1_500)
        XCTAssertEqual(breakdown.connectionDescription, "既存の接続を再利用")
        for phase in [NetworkTimingBreakdown.Phase.dns, .tcp, .tls] {
            XCTAssertEqual(breakdown.describe(phase), "N/A(接続を再利用(新しい接続なし))")
            XCTAssertFalse(breakdown.describe(phase).contains("0ms"))
        }
    }

    func testNoTimestampsAtAllIsNotMeasuredAndNeverZero() {
        let tx = NetworkTimingBreakdown.Transaction(
            fetchStart: nil, domainLookupStart: nil, domainLookupEnd: nil, connectStart: nil, connectEnd: nil,
            secureConnectionStart: nil, secureConnectionEnd: nil, requestStart: nil, requestEnd: nil,
            responseStart: nil, responseEnd: nil, isReusedConnection: false, isProxyConnection: false,
            fetchType: "unknown", networkProtocolName: nil
        )
        let breakdown = NetworkTimingBreakdown(
            taskInterval: DateInterval(start: at(0), end: at(40)), redirectCount: 0, transactions: [tx], statusCode: 503
        )
        for phase in NetworkTimingBreakdown.Phase.allCases {
            XCTAssertNil(breakdown.value(phase))
            XCTAssertEqual(breakdown.describe(phase), "N/A(通信の時刻が提供されていない)")
        }
        XCTAssertEqual(breakdown.unattributedMs, 40)
        XCTAssertEqual(breakdown.statusCode, 503)
        XCTAssertEqual(breakdown.networkProtocol, nil)
    }

    func testEndBeforeStartIsNotTurnedIntoANegativeOrZeroValue() {
        var tx = newTLSConnection()
        tx.responseEnd = at(100) // before responseStart
        let breakdown = NetworkTimingBreakdown(taskInterval: nil, redirectCount: 0, transactions: [tx], statusCode: 200)
        XCTAssertNil(breakdown.responseReceiveMs)
        XCTAssertEqual(breakdown.unavailableReason(.responseReceive), "取得不可")
    }

    func testRedirectUsesTheFinalTransactionAndCountsTheRedirect() {
        var first = newTLSConnection()
        first.responseStart = at(200)
        first.responseEnd = at(210)
        var second = newTLSConnection()
        second.fetchStart = at(210)
        second.domainLookupStart = nil
        second.domainLookupEnd = nil
        second.connectStart = nil
        second.connectEnd = nil
        second.secureConnectionStart = nil
        second.secureConnectionEnd = nil
        second.isReusedConnection = true
        second.requestStart = at(211)
        second.requestEnd = at(212)
        second.responseStart = at(712)
        second.responseEnd = at(720)
        let breakdown = NetworkTimingBreakdown(
            taskInterval: DateInterval(start: at(0), end: at(720)), redirectCount: 1, transactions: [first, second], statusCode: 200
        )
        XCTAssertEqual(breakdown.redirectCount, 1)
        XCTAssertEqual(breakdown.transactionCount, 2)
        XCTAssertEqual(breakdown.reusedConnection, true, "classified from the final transaction")
        XCTAssertEqual(breakdown.waitMs, 500)
        XCTAssertNil(breakdown.dnsMs)
        // The first (redirected) transaction's 210ms is not in the final phases → unattributed.
        XCTAssertEqual(breakdown.unattributedMs, 720 - (1 + 1 + 500 + 8))
    }

    func testNoTransactionsKeepsEverythingUnmeasured() {
        let breakdown = NetworkTimingBreakdown(taskInterval: nil, redirectCount: 0, transactions: [], statusCode: nil)
        XCTAssertEqual(breakdown.transactionCount, 0)
        XCTAssertNil(breakdown.reusedConnection)
        XCTAssertEqual(breakdown.connectionDescription, "不明")
        for phase in NetworkTimingBreakdown.Phase.allCases { XCTAssertNil(breakdown.value(phase)) }
    }
}

@MainActor
final class NetworkDiagnosticsStoreTests: XCTestCase {
    private func makeStore() -> DiagnosticsStore {
        DiagnosticsStore(defaults: UserDefaults(suiteName: "NetworkDiagnosticsStoreTests-\(UUID().uuidString)")!)
    }

    private func breakdown(status: Int) -> NetworkTimingBreakdown {
        NetworkTimingBreakdown(taskInterval: DateInterval(start: Date(), duration: 1), redirectCount: 0, transactions: [], statusCode: status)
    }

    func testTracksOnlyTheFirstRequestOfEachTrackedPath() {
        let store = makeStore()
        XCTAssertTrue(store.beginAPIRequestDiagnostics(path: "calendar"))
        XCTAssertFalse(store.beginAPIRequestDiagnostics(path: "calendar"), "second calendar request is not tracked")
        XCTAssertTrue(store.beginAPIRequestDiagnostics(path: "speeches"))
        XCTAssertFalse(store.beginAPIRequestDiagnostics(path: "speeches/abc"), "detail paths are not tracked")
        XCTAssertFalse(store.beginAPIRequestDiagnostics(path: "settings"))
        XCTAssertEqual(Set((store.current.apiRequests ?? [:]).keys), ["calendar", "speeches"])
    }

    func testHomeFollowsTheExistingFirstHomeRequestRule() {
        let store = makeStore()
        XCTAssertFalse(store.beginAPIRequestDiagnostics(path: "home"), "no /home fetch has begun yet")
        store.beginHomeRequest()
        XCTAssertTrue(store.beginAPIRequestDiagnostics(path: "home"))
        store.beginHomeRequest()
        XCTAssertFalse(store.beginAPIRequestDiagnostics(path: "home"), "2nd /home fetch never overwrites the launch values")
    }

    func testMetricsArrivingBeforeOrAfterTheFinishAreBothKept() {
        let store = makeStore()
        XCTAssertTrue(store.beginAPIRequestDiagnostics(path: "calendar"))
        store.recordAPIRequestNetwork(path: "calendar", breakdown(status: 200))
        store.recordAPIRequestAuthToken(path: "calendar", ms: 12)
        store.recordAPIRequestFinished(path: "calendar", clientTotalMs: 1_000, statusCode: 200, succeeded: true)
        let calendar = store.current.apiRequests?["calendar"]
        XCTAssertEqual(calendar?.authTokenMs, 12)
        XCTAssertEqual(calendar?.clientTotalMs, 1_000)
        XCTAssertEqual(calendar?.outcome, .success)
        XCTAssertEqual(calendar?.network?.statusCode, 200)

        XCTAssertTrue(store.beginAPIRequestDiagnostics(path: "speeches"))
        store.recordAPIRequestFinished(path: "speeches", clientTotalMs: 900, statusCode: 500, succeeded: false)
        XCTAssertNil(store.current.apiRequests?["speeches"]?.network)
        store.recordAPIRequestNetwork(path: "speeches", breakdown(status: 500))
        XCTAssertEqual(store.current.apiRequests?["speeches"]?.network?.statusCode, 500)
        XCTAssertEqual(store.current.apiRequests?["speeches"]?.outcome, .failure)
    }

    func testRecordsForAnUntrackedPathAreIgnored() {
        let store = makeStore()
        store.recordAPIRequestFinished(path: "calendar", clientTotalMs: 1, statusCode: 200, succeeded: true)
        XCTAssertNil(store.current.apiRequests)
    }

    func testPreviousLaunchDataWithoutTheNewFieldStillLoads() throws {
        let suite = "NetworkDiagnosticsStoreTests-old-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        // A launch saved by the previous app version (no `apiRequests` key).
        var old = try JSONSerialization.jsonObject(
            with: JSONEncoder().encode(LaunchDiagnostics(launchID: UUID(), startedAt: Date()))
        ) as! [String: Any]
        old.removeValue(forKey: "apiRequests")
        defaults.set(try JSONSerialization.data(withJSONObject: old), forKey: "com.fumaono.fxeventanalyzer.launchDiagnostics.lastRecorded")
        let store = DiagnosticsStore(defaults: defaults)
        XCTAssertNotNil(store.previous)
        XCTAssertNil(store.previous?.apiRequests)
    }

    func testReportShowsNAAndContainsNoSecretsOrQuery() {
        var diagnostics = LaunchDiagnostics(launchID: UUID(), startedAt: Date())
        var home = APIRequestDiagnostics(path: "home")
        home.authTokenMs = 3
        home.clientTotalMs = 34_555
        home.statusCode = 200
        home.outcome = .success
        home.network = NetworkTimingBreakdown(
            taskInterval: DateInterval(start: Date(), duration: 34.5),
            redirectCount: 0,
            transactions: [.init(
                fetchStart: Date(), domainLookupStart: nil, domainLookupEnd: nil, connectStart: nil, connectEnd: nil,
                secureConnectionStart: nil, secureConnectionEnd: nil, requestStart: Date(), requestEnd: Date(),
                responseStart: Date().addingTimeInterval(34), responseEnd: Date().addingTimeInterval(34.4),
                isReusedConnection: true, isProxyConnection: false, fetchType: "network", networkProtocolName: "h2"
            )],
            statusCode: 200
        )
        diagnostics.apiRequests = ["home": home]
        let text = diagnostics.reportText(appVersion: "1.0", buildNumber: "1")
        XCTAssertTrue(text.contains("[通信の内訳(起動後1回目の要求)]"))
        XCTAssertTrue(text.contains("/home:"))
        XCTAssertTrue(text.contains("DNS: N/A(接続を再利用(新しい接続なし))"))
        XCTAssertTrue(text.contains("/calendar: 未実行"))
        XCTAssertTrue(text.contains("/speeches: 未実行"))
        for forbidden in ["Bearer", "Authorization", "token=", "?", "timezone=", "date=", "@"] {
            XCTAssertFalse(text.contains(forbidden), "report must not contain \(forbidden)")
        }
    }
}

/// URLProtocol で応答を返し、実際の `URLSession.data(for:delegate:)` の経路を通す。
private final class StubURLProtocol: URLProtocol {
    static var handler: ((URLRequest) -> (Int, Data))?
    static var lastRequest: URLRequest?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lastRequest = request
        let (status, body) = Self.handler?(request) ?? (200, Data("{}".utf8))
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private struct Pong: Decodable, Equatable { let ok: Bool }

@MainActor
final class APIClientNetworkDiagnosticsTests: XCTestCase {
    private var store: DiagnosticsStore!
    private var client: URLSessionAPIClient!

    override func setUp() async throws {
        store = DiagnosticsStore(defaults: UserDefaults(suiteName: "APIClientNetworkDiagnosticsTests-\(UUID().uuidString)")!)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let store = store!
        client = URLSessionAPIClient(
            session: session,
            baseURLProvider: { URL(string: "https://api.example.invalid/api/v1") },
            authTokenProvider: { "secret-access-token" },
            diagnosticsStore: { store }
        )
        StubURLProtocol.lastRequest = nil
    }

    /// メトリクスは完了の前後どちらで届いてもよいので、少しだけ待つ(届かなくても失敗にしない)。
    private func waitForNetwork(_ path: String) async {
        for _ in 0..<50 where store.current.apiRequests?[path]?.network == nil {
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
    }

    func testSuccessfulResponseIsDecodedAsBeforeAndRecorded() async throws {
        StubURLProtocol.handler = { _ in (200, Data(#"{"ok":true}"#.utf8)) }
        let result: Pong = try await client.send(Endpoint(path: "calendar", queryItems: [URLQueryItem(name: "from", value: "2026-10-01")]))
        XCTAssertEqual(result, Pong(ok: true))
        // Auth header is still sent exactly as before.
        XCTAssertEqual(StubURLProtocol.lastRequest?.value(forHTTPHeaderField: "Authorization"), "Bearer secret-access-token")

        await waitForNetwork("calendar")
        let record = try XCTUnwrap(store.current.apiRequests?["calendar"])
        XCTAssertEqual(record.path, "calendar")
        XCTAssertEqual(record.statusCode, 200)
        XCTAssertEqual(record.outcome, .success)
        XCTAssertNotNil(record.authTokenMs)
        XCTAssertNotNil(record.clientTotalMs)
        if let network = record.network {
            // URLProtocol loads do not provide DNS/TCP/TLS times — they must be N/A, never 0ms.
            for phase in [NetworkTimingBreakdown.Phase.dns, .tcp, .tls] where network.value(phase) == nil {
                XCTAssertTrue(network.describe(phase).hasPrefix("N/A("))
            }
        }
        let text = store.current.reportText(appVersion: "1", buildNumber: "1")
        XCTAssertFalse(text.contains("secret-access-token"))
        XCTAssertFalse(text.contains("from="))
    }

    func testHTTPErrorKeepsTheSameErrorAndIsRecorded() async throws {
        StubURLProtocol.handler = { _ in (500, Data(#"{"error":{"code":"INTERNAL_ERROR","message":"x"}}"#.utf8)) }
        do {
            let _: Pong = try await client.send(Endpoint(path: "speeches"))
            XCTFail("expected an error")
        } catch let error as APIError {
            if case .server(_, _, let status) = error {
                XCTAssertEqual(status, 500)
            } else if case .unexpectedStatus(let status) = error {
                XCTAssertEqual(status, 500)
            } else {
                XCTFail("unexpected APIError \(error)")
            }
        }
        await waitForNetwork("speeches")
        let record = try XCTUnwrap(store.current.apiRequests?["speeches"])
        XCTAssertEqual(record.statusCode, 500)
        XCTAssertEqual(record.outcome, .failure)
    }

    func testUntrackedPathsAreNotRecorded() async throws {
        StubURLProtocol.handler = { _ in (200, Data(#"{"ok":true}"#.utf8)) }
        let result: Pong = try await client.send(Endpoint(path: "settings"))
        XCTAssertEqual(result, Pong(ok: true))
        XCTAssertNil(store.current.apiRequests)
    }
}
