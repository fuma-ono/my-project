import Foundation

/// 「次の発表」(指標の詳細・お気に入り・イベントの詳細)を求める
/// `/indicators/{id}/events` の条件(api-design.md §13.3、v1.31)。
///
/// 未来の予定(BLS・FOMC)が何件も入ると、新しい順の先頭はいちばん先の予定
/// (翌年の12月など)になるため、現在以降(`from`)に絞り、近い順(`order=asc`)で受け取る。
/// 発表時刻を過ぎてもまだ `SCHEDULED` の行(取り込み待ち)は「次の発表」にしない。
enum NextReleaseQuery {
    static func queryItems(limit: Int, now: Date = Date()) -> [URLQueryItem] {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return [
            URLQueryItem(name: "status", value: "SCHEDULED"),
            URLQueryItem(name: "from", value: formatter.string(from: now)),
            URLQueryItem(name: "order", value: "asc"),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
    }

    /// 受け取った行のうち、`now` 以降で最も早い予定。サーバーが古い(`order` を知らない)場合や
    /// 過去の行が混ざった場合でも、過去の発表を「次の発表」にしないよう端末側でも絞る。
    static func next(
        in events: [IndicatorEventSummary],
        after now: Date = Date(),
        excluding eventId: String? = nil
    ) -> IndicatorEventSummary? {
        events
            .filter { $0.status == .scheduled && $0.releaseDatetime >= now && $0.id != eventId }
            .min { $0.releaseDatetime < $1.releaseDatetime }
    }
}
