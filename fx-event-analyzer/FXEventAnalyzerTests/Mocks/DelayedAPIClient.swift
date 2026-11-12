import Foundation
@testable import FXEventAnalyzer

/// `MockAPIClient`と同じ結果設定方式(`results`/`result`)だが、返す前に指定した
/// 時間だけ待つ — Splashの先行取得の早期終了・上限打ち切りのテストで、
/// 「`/home`・`/entitlements`それぞれどれだけ時間がかかるか」を制御するために使う。
final class DelayedAPIClient: APIClient {
    var result: MockAPIClient.MockResult = .failure(APIError.notConfigured)
    var results: [String: MockAPIClient.MockResult] = [:]
    private(set) var requestedPaths: [String] = []
    private let delays: [String: Duration]
    private let defaultDelay: Duration
    private let stateLock = NSLock()

    /// すべてのパスに同じ遅延をかける。
    init(delay: Duration) {
        self.delays = [:]
        self.defaultDelay = delay
    }

    /// パスごとに異なる遅延をかける(キーに無いパスは`defaultDelay`、既定`.zero`)。
    init(delays: [String: Duration], defaultDelay: Duration = .zero) {
        self.delays = delays
        self.defaultDelay = defaultDelay
    }

    func send<T: Decodable>(_ endpoint: Endpoint) async throws -> T {
        stateLock.lock()
        requestedPaths.append(endpoint.path)
        stateLock.unlock()
        let delay = delays[endpoint.path] ?? defaultDelay
        if delay > .zero {
            try? await Task.sleep(for: delay)
        }
        let outcome = results[endpoint.path] ?? result
        switch outcome {
        case .success(let value):
            guard let typed = value as? T else {
                throw APIError.decoding("DelayedAPIClient: configured result does not match requested type \(T.self)")
            }
            return typed
        case .failure(let error):
            throw error
        }
    }
}
