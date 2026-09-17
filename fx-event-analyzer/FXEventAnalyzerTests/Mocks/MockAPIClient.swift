@testable import FXEventAnalyzer

final class MockAPIClient: APIClient {
    enum MockResult {
        case success(Any)
        case failure(Error)
    }

    /// Default result used when no path-specific override in `results`
    /// matches — sufficient for the common single-request-per-load case.
    var result: MockResult = .failure(APIError.notConfigured)
    /// Per-path overrides, keyed by `Endpoint.path`, for view models that
    /// fire more than one concurrent request per load (e.g.
    /// IndicatorDetailViewModel's indicator + events calls) and need a
    /// distinct response per path.
    var results: [String: MockResult] = [:]
    private(set) var lastEndpoint: Endpoint?
    private(set) var requestedPaths: [String] = []

    func send<T: Decodable>(_ endpoint: Endpoint) async throws -> T {
        lastEndpoint = endpoint
        requestedPaths.append(endpoint.path)
        let outcome = results[endpoint.path] ?? result
        switch outcome {
        case .success(let value):
            guard let typed = value as? T else {
                throw APIError.decoding("MockAPIClient: configured result does not match requested type \(T.self)")
            }
            return typed
        case .failure(let error):
            throw error
        }
    }
}
