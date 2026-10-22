import Foundation
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
    /// Every endpoint sent, in order — for asserting query items (e.g. the
    /// "次の発表" query, v1.31).
    private(set) var requestedEndpoints: [Endpoint] = []
    /// View models like `IndicatorDetailViewModel` fire two `send` calls
    /// concurrently via `async let`; without this, concurrent mutation of
    /// `requestedPaths`/`lastEndpoint` from those overlapping calls is a
    /// data race that intermittently drops an append (flaky CI failures).
    private let stateLock = NSLock()

    func send<T: Decodable>(_ endpoint: Endpoint) async throws -> T {
        stateLock.lock()
        lastEndpoint = endpoint
        requestedPaths.append(endpoint.path)
        requestedEndpoints.append(endpoint)
        let outcome = results[endpoint.path] ?? result
        stateLock.unlock()
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
