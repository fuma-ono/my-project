import Foundation

/// Talks to the Backend API described in `api-design.md`. No concrete
/// endpoint is wired to a real Backend yet (Phase 6 builds the Backend
/// itself) — this is the foundation Phase 2+ features will call into.
protocol APIClient {
    func send<T: Decodable>(_ endpoint: Endpoint) async throws -> T
}

/// `URLSession`-backed `APIClient`. Reads its base URL from Info.plist's
/// `API_BASE_URL` (unset in Phase 1 — there is no Backend to point at yet),
/// and attaches `Authorization: Bearer <token>` per api-design.md §2.2 when
/// a token is available. `authTokenProvider` is injected rather than
/// depending on the Auth layer directly, keeping Networking and Auth
/// independent of each other (per "過剰な抽象化は禁止" — no DI container,
/// just a plain closure).
final class URLSessionAPIClient: APIClient {
    private let session: URLSession
    private let baseURLProvider: () -> URL?
    private let authTokenProvider: () async -> String?
    /// 通信の内訳(HQ指示 2026-10-21)を記録する先。テストだけ別のインスタンスを渡す。
    private let diagnosticsStore: @MainActor () -> DiagnosticsStore
    private let decoder: JSONDecoder

    init(
        session: URLSession = .shared,
        baseURLProvider: @escaping () -> URL? = URLSessionAPIClient.defaultBaseURLProvider,
        authTokenProvider: @escaping () async -> String? = { nil },
        diagnosticsStore: @escaping @MainActor () -> DiagnosticsStore = { DiagnosticsStore.shared }
    ) {
        self.session = session
        self.baseURLProvider = baseURLProvider
        self.authTokenProvider = authTokenProvider
        self.diagnosticsStore = diagnosticsStore
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom(BackendDate.decode)
        self.decoder = decoder
    }

    private static func defaultBaseURLProvider() -> URL? {
        guard
            let raw = Bundle.main.infoDictionary?["API_BASE_URL"] as? String,
            !raw.isEmpty,
            let url = URL(string: raw)
        else {
            return nil
        }
        return url
    }

    func send<T: Decodable>(_ endpoint: Endpoint) async throws -> T {
        guard let baseURL = baseURLProvider() else {
            throw APIError.notConfigured
        }

        var components = URLComponents(url: baseURL.appendingPathComponent(endpoint.path), resolvingAgainstBaseURL: false)
        if !endpoint.queryItems.isEmpty {
            components?.queryItems = endpoint.queryItems
        }
        guard let url = components?.url else {
            throw APIError.transport("Invalid URL for path \(endpoint.path)")
        }

        var request = URLRequest(url: url)
        request.httpMethod = endpoint.method.rawValue
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body = endpoint.body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        // HQ指示(2026-10-20)「起動診断画面」: /homeの認証・通信・デコードを
        // `DiagnosticsStore`にも記録する。他エンドポイント(settings/plan等)
        // はこれまで通りos.Loggerへの`ClientTiming`出力のみで、構造化保持
        // の対象を増やさない(過剰な計測を避ける)。`DiagnosticsStore`側が
        // 「1回目の/home取得中かどうか」を自分で判定して記録を受け付ける
        // かどうかを決めるため、ここではIDを扱わない(2026-10-20、2回目の
        // 修正: IDをこちらで読み直す方式は、2回目以降の取得でも常に
        // 「現在のID」が一致してしまい上書きを防げていなかった)。
        let isHomeRequest = endpoint.path == "home"
        // HQ指示(2026-10-21)「通信遅延の詳細計測」: 起動後1回目の home・calendar・
        // speeches だけ、通信の内訳(URLSessionTaskMetrics)を記録する。記録するか
        // どうかはDiagnosticsStoreが決める(`home`は上の既存の判定と同じ1回目だけ)。
        // 記録しない要求は、下の`session.data(for:)`も含めて今までとまったく同じ経路。
        // 記録に使うのはパス(`endpoint.path`、クエリなし)と時間・ステータスだけ。
        let diagnosticsPath = endpoint.path
        var diagnostics: DiagnosticsStore?
        var tracksNetwork = false
        if LaunchDiagnostics.trackedAPIPaths.contains(diagnosticsPath) {
            let store = await diagnosticsStore()
            diagnostics = store
            tracksNetwork = await store.beginAPIRequestDiagnostics(path: diagnosticsPath)
        }
        if isHomeRequest {
            await DiagnosticsStore.shared.recordHomeAuthTokenStart()
        }
        let authTokenStartedAt = ContinuousClock.now
        if let token = await ClientTiming.measure("authTokenProvider \(endpoint.path)", { await authTokenProvider() }) {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if tracksNetwork {
            await diagnostics?.recordAPIRequestAuthToken(path: diagnosticsPath, ms: (ContinuousClock.now - authTokenStartedAt).milliseconds)
        }
        if isHomeRequest {
            await DiagnosticsStore.shared.recordHomeAuthTokenEnd()
        }
        if let body = endpoint.body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let data: Data
        let response: URLResponse
        if isHomeRequest {
            await DiagnosticsStore.shared.recordHomeHTTPStart()
        }
        let requestStartedAt = ContinuousClock.now
        do {
            // HQ指示(2026-10-20)「初回起動が約30秒かかる原因調査」: Renderの
            // `[timing]`(ハンドラ内のみ、1〜2秒)と、このクライアント視点の
            // 時間(認証+ネットワーク+Renderのコールドスタート待ちを含む)を
            // 比較できるようにする。
            (data, response) = try await ClientTiming.measure("request \(endpoint.method.rawValue) \(endpoint.path)") { () async throws -> (Data, URLResponse) in
                guard tracksNetwork else { return try await session.data(for: request) }
                // メトリクスを受け取るだけのタスク用の受け取り役(他の処理は既定のまま)。
                // メトリクスは通信の完了の前後どちらで届いてもよい(届いた時点で記録する)。
                let metricsStore = diagnostics
                let collector = NetworkMetricsCollector { breakdown in
                    Task { @MainActor in metricsStore?.recordAPIRequestNetwork(path: diagnosticsPath, breakdown) }
                }
                return try await session.data(for: request, delegate: collector)
            }
        } catch {
            if tracksNetwork {
                await diagnostics?.recordAPIRequestFinished(
                    path: diagnosticsPath,
                    clientTotalMs: (ContinuousClock.now - requestStartedAt).milliseconds,
                    statusCode: nil,
                    succeeded: false
                )
            }
            if isHomeRequest {
                await DiagnosticsStore.shared.recordHomeHTTPEnd(statusCode: nil)
                await DiagnosticsStore.shared.recordHomeDecodeEnd(succeeded: false)
            }
            throw APIError.transport(error.localizedDescription)
        }

        let clientTotalMs = (ContinuousClock.now - requestStartedAt).milliseconds
        guard let httpResponse = response as? HTTPURLResponse else {
            if tracksNetwork {
                await diagnostics?.recordAPIRequestFinished(path: diagnosticsPath, clientTotalMs: clientTotalMs, statusCode: nil, succeeded: false)
            }
            if isHomeRequest {
                await DiagnosticsStore.shared.recordHomeHTTPEnd(statusCode: nil)
                await DiagnosticsStore.shared.recordHomeDecodeEnd(succeeded: false)
            }
            throw APIError.transport("No HTTP response")
        }
        if tracksNetwork {
            await diagnostics?.recordAPIRequestFinished(
                path: diagnosticsPath,
                clientTotalMs: clientTotalMs,
                statusCode: httpResponse.statusCode,
                succeeded: (200...299).contains(httpResponse.statusCode)
            )
        }
        if isHomeRequest {
            await DiagnosticsStore.shared.recordHomeHTTPEnd(statusCode: httpResponse.statusCode)
        }

        switch httpResponse.statusCode {
        case 200...299:
            if data.isEmpty, let empty = EmptyResponse() as? T {
                if isHomeRequest {
                    await DiagnosticsStore.shared.recordHomeDecodeStart()
                    await DiagnosticsStore.shared.recordHomeDecodeEnd(succeeded: true)
                }
                return empty
            }
            if isHomeRequest {
                await DiagnosticsStore.shared.recordHomeDecodeStart()
            }
            do {
                let decoded = try await ClientTiming.measure("decode \(endpoint.method.rawValue) \(endpoint.path)") {
                    try decoder.decode(T.self, from: data)
                }
                if isHomeRequest {
                    await DiagnosticsStore.shared.recordHomeDecodeEnd(succeeded: true)
                }
                return decoded
            } catch {
                if isHomeRequest {
                    await DiagnosticsStore.shared.recordHomeDecodeEnd(succeeded: false)
                }
                throw APIError.decoding(error.localizedDescription)
            }
        default:
            if isHomeRequest {
                await DiagnosticsStore.shared.recordHomeDecodeEnd(succeeded: false)
            }
            if let body = try? decoder.decode(APIErrorBody.self, from: data),
               let code = APIErrorCode(rawValue: body.error.code) {
                throw APIError.server(code: code, message: body.error.message, httpStatus: httpResponse.statusCode)
            }
            throw APIError.unexpectedStatus(httpResponse.statusCode)
        }
    }
}

/// Response type for endpoints that answer `204 No Content` (e.g.
/// `DELETE /account`), whose empty body `JSONDecoder` can't decode.
struct EmptyResponse: Decodable, Equatable {}

/// Backendの日時。`.iso8601`は秒の小数(`…45.123456+00:00`、Postgresの
/// `timestamptz`をそのまま返す`/account`・`/subscription`など)を読めず、
/// 本番ではアカウント情報・購入が読み込みに失敗していた。小数を外して読み、
/// 小数分を足す(桁数は問わない)。
enum BackendDate {
    static func decode(_ decoder: Decoder) throws -> Date {
        let container = try decoder.singleValueContainer()
        let raw = try container.decode(String.self)
        guard let date = parse(raw) else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid ISO 8601 date: \(raw)")
        }
        return date
    }

    static func parse(_ raw: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        guard let dot = raw.firstIndex(of: "."), raw.distance(from: raw.startIndex, to: dot) >= 19 else {
            return formatter.date(from: raw)
        }
        let digits = raw[raw.index(after: dot)...].prefix { $0.isNumber }
        guard !digits.isEmpty else { return formatter.date(from: raw) }
        let rest = raw[raw.index(dot, offsetBy: digits.count + 1)...]
        guard let whole = formatter.date(from: String(raw[..<dot]) + rest),
              let fraction = Double("0." + digits) else { return nil }
        return whole.addingTimeInterval(fraction)
    }
}
