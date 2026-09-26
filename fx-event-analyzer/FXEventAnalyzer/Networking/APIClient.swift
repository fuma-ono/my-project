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
    private let decoder: JSONDecoder

    init(
        session: URLSession = .shared,
        baseURLProvider: @escaping () -> URL? = URLSessionAPIClient.defaultBaseURLProvider,
        authTokenProvider: @escaping () async -> String? = { nil }
    ) {
        self.session = session
        self.baseURLProvider = baseURLProvider
        self.authTokenProvider = authTokenProvider
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
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
        if let token = await authTokenProvider() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.transport(error.localizedDescription)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.transport("No HTTP response")
        }

        switch httpResponse.statusCode {
        case 200...299:
            do {
                return try decoder.decode(T.self, from: data)
            } catch {
                throw APIError.decoding(error.localizedDescription)
            }
        default:
            if let body = try? decoder.decode(APIErrorBody.self, from: data),
               let code = APIErrorCode(rawValue: body.error.code) {
                throw APIError.server(code: code, message: body.error.message, httpStatus: httpResponse.statusCode)
            }
            throw APIError.unexpectedStatus(httpResponse.statusCode)
        }
    }
}
