@testable import FXEventAnalyzer

final class MockAPIClient: APIClient {
    enum MockResult {
        case success(Any)
        case failure(Error)
    }

    var result: MockResult = .failure(APIError.notConfigured)
    private(set) var lastEndpoint: Endpoint?

    func send<T: Decodable>(_ endpoint: Endpoint) async throws -> T {
        lastEndpoint = endpoint
        switch result {
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
