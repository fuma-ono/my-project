import Foundation

/// 起動直後にAPIサーバーの`/health`へGETを1回投げ、Renderの無料枠のコールドスタートを
/// 先に始めさせる。認証ヘッダ・本文・ユーザーの情報は一切付けず、結果とエラーは無視する。
enum ServerWarmUp {
    /// `API_BASE_URL`(例 `https://host/api/v1`)のホストのルートにある`/health`。
    static func healthURL(from baseURL: URL?) -> URL? {
        guard let baseURL else { return nil }
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else { return nil }
        guard components.scheme != nil, let host = components.host, !host.isEmpty else { return nil }
        components.path = "/health"
        components.query = nil
        components.fragment = nil
        components.user = nil
        components.password = nil
        return components.url
    }

    static func fire(baseURL: URL? = URLSessionAPIClient.defaultBaseURLProvider(), session: URLSession = .shared) {
        guard let url = healthURL(from: baseURL) else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 90
        let task = session.dataTask(with: request) { _, _, _ in }
        task.resume()
    }
}
