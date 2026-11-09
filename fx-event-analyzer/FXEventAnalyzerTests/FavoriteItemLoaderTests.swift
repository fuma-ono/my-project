import XCTest
@testable import FXEventAnalyzer

/// HQ指示(2026-10-23「iOS画面表示速度の改善」)で`FavoriteItemLoader.load(_:)`を
/// 直列の`for`ループから`TaskGroup`による並行取得に変更したことを検証する。
/// 並び順の維持・失敗の除外・実際に並行して通信していることの3点を確認する。
@MainActor
final class FavoriteItemLoaderTests: XCTestCase {
    /// `MockAPIClient`はパスごとの固定応答のみで遅延を持たないため、完了順を
    /// 入力順と意図的にずらすためのラッパー。`concurrency`アクターで
    /// 「同時に処理中のリクエスト数の最大値」も記録し、並行実行そのものを
    /// タイミングに依存せず検証できるようにする。
    private actor ConcurrencyTracker {
        private var current = 0
        private(set) var maxConcurrent = 0

        func begin() {
            current += 1
            maxConcurrent = max(maxConcurrent, current)
        }

        func end() {
            current -= 1
        }
    }

    private struct TrackedDelayedAPIClient: APIClient {
        let wrapped: APIClient
        let tracker: ConcurrencyTracker
        /// パスごとの追加待機(ms)。小さい値ほど先に終わる — 完了順と入力順を
        /// わざとずらす。
        let delaysMs: [String: UInt64]

        func send<T: Decodable>(_ endpoint: Endpoint) async throws -> T {
            await tracker.begin()
            defer { Task { await tracker.end() } }
            if let delay = delaysMs[endpoint.path] {
                try? await Task.sleep(nanoseconds: delay * 1_000_000)
            }
            return try await wrapped.send(endpoint)
        }
    }

    private func makeEventResponse(id: String) -> EventDetailResponse {
        EventDetailResponse(
            event: EventDetailEvent(
                id: id, indicatorId: "ind_x", indicatorName: "Event \(id)", countryCode: "US", currencyCode: "USD",
                releaseDatetime: Date(), releaseDatetimePrecision: .exact, importance: .high,
                status: .released, dataStatus: .ready, revisionStatus: .none
            ),
            snapshot: EventSnapshotDetail(forecast: nil, actual: nil, previous: nil, unit: nil, source: nil, sourceUrl: nil),
            analysis: EventAnalysis(surprise: nil, surpriseDirection: nil),
            explanation: nil,
            relatedFxPairs: [],
            availableTimeframes: []
        )
    }

    private func makeIndicatorResponses(id: String) -> (detail: IndicatorDetailResponse, events: IndicatorEventsListResponse) {
        let indicator = IndicatorSummary(
            id: id, code: "CODE_\(id)", name: "Indicator \(id)", countryCode: "US", currencyCode: "USD",
            importance: .high, description: nil, frequency: "MONTHLY", unit: nil, source: nil,
            sourceUrl: nil, favorableDirection: .higherIsPositive
        )
        let detail = IndicatorDetailResponse(indicator: indicator, relatedFxPairs: [])
        let events = IndicatorEventsListResponse(data: [], meta: PaginationMeta(page: 1, limit: 1, total: 0, hasNext: false))
        return (detail, events)
    }

    /// 完了順をわざと入力順と逆にしても(1件目が一番遅く、3件目が一番速い)、
    /// 返る配列は常に`entries`の並び順(1→2→3)のままであることを確認する。
    func testPreservesOriginalOrderRegardlessOfCompletionOrder() async {
        let mock = MockAPIClient()
        mock.results["events/e1"] = .success(makeEventResponse(id: "e1"))
        mock.results["events/e2"] = .success(makeEventResponse(id: "e2"))
        mock.results["events/e3"] = .success(makeEventResponse(id: "e3"))

        let tracker = ConcurrencyTracker()
        // e1が最も遅く完了し、e3が最も速く完了するように意図的にずらす。
        let apiClient = TrackedDelayedAPIClient(
            wrapped: mock,
            tracker: tracker,
            delaysMs: ["events/e1": 60, "events/e2": 30, "events/e3": 0]
        )

        let entries = [
            FavoritesStore.Entry(type: .event, id: "e1"),
            FavoritesStore.Entry(type: .event, id: "e2"),
            FavoritesStore.Entry(type: .event, id: "e3"),
        ]

        let items = await FavoriteItemLoader(apiClient: apiClient).load(entries)

        XCTAssertEqual(items.map(\.id), ["event:e1", "event:e2", "event:e3"])
    }

    /// event・indicatorが混在していても、完了順に関わらず元の並び順で返す
    /// ことを確認する(indicatorは内部で2リクエストをさらに並行して出すため、
    /// 完了順が特に乱れやすいケース)。
    func testPreservesOrderWithMixedEventAndIndicatorEntries() async {
        let mock = MockAPIClient()
        mock.results["events/e1"] = .success(makeEventResponse(id: "e1"))
        let (detail, events) = makeIndicatorResponses(id: "i1")
        mock.results["indicators/i1"] = .success(detail)
        mock.results["indicators/i1/events"] = .success(events)
        mock.results["events/e2"] = .success(makeEventResponse(id: "e2"))

        let tracker = ConcurrencyTracker()
        // indicatorの2件(detail/events)を一番遅く、先頭のevent(e1)を最も遅く
        // 完了するものに続けて並べ、末尾のevent(e2)を最速にする。
        let apiClient = TrackedDelayedAPIClient(
            wrapped: mock,
            tracker: tracker,
            delaysMs: ["events/e1": 40, "indicators/i1": 60, "indicators/i1/events": 50, "events/e2": 0]
        )

        let entries = [
            FavoritesStore.Entry(type: .event, id: "e1"),
            FavoritesStore.Entry(type: .indicator, id: "i1"),
            FavoritesStore.Entry(type: .event, id: "e2"),
        ]

        let items = await FavoriteItemLoader(apiClient: apiClient).load(entries)

        XCTAssertEqual(items.map(\.id), ["event:e1", "indicator:i1", "event:e2"])
    }

    /// 取得に失敗した項目(削除済みの指標など)は飛ばし、成功した項目だけを
    /// 元の並び順のまま返すことを確認する。
    func testSkipsFailedEntriesButKeepsOrderOfSucceeded() async {
        let mock = MockAPIClient()
        mock.results["events/e1"] = .success(makeEventResponse(id: "e1"))
        mock.results["events/e2"] = .failure(APIError.server(code: .eventNotFound, message: "not found", httpStatus: 404))
        mock.results["events/e3"] = .success(makeEventResponse(id: "e3"))

        let entries = [
            FavoritesStore.Entry(type: .event, id: "e1"),
            FavoritesStore.Entry(type: .event, id: "e2"),
            FavoritesStore.Entry(type: .event, id: "e3"),
        ]

        let items = await FavoriteItemLoader(apiClient: mock).load(entries)

        XCTAssertEqual(items.map(\.id), ["event:e1", "event:e3"])
    }

    /// `.fxPair`のエントリ(お気に入り単体取得APIが無いため常に飛ばす設計、
    /// `FavoriteItemLoader.swift`参照)は結果に含まれないことを確認する。
    func testSkipsFxPairEntries() async {
        let mock = MockAPIClient()
        mock.results["events/e1"] = .success(makeEventResponse(id: "e1"))

        let entries = [
            FavoritesStore.Entry(type: .fxPair, id: "fx1"),
            FavoritesStore.Entry(type: .event, id: "e1"),
        ]

        let items = await FavoriteItemLoader(apiClient: mock).load(entries)

        XCTAssertEqual(items.map(\.id), ["event:e1"])
    }

    /// 本来の目的: 複数件が直列ではなく並行して取得されていることを、タイミング
    /// ではなく「同時に処理中だったリクエスト数の最大値」で検証する。3件とも
    /// `.event`(`fetchFavoriteEvent`は1リクエストのみで、`fetchFavoriteIndicator`
    /// のような内部並行化を持たない)にすることで、観測される並行性が
    /// `load(_:)`自体の並行化によるものだけになるようにしている(indicatorを
    /// 混ぜると、その内部`async let`だけでmaxConcurrentが2になり得て、
    /// `load(_:)`自体の並行化を区別できなくなるため)。
    func testFetchesEntriesConcurrentlyNotSerially() async {
        let mock = MockAPIClient()
        mock.results["events/e1"] = .success(makeEventResponse(id: "e1"))
        mock.results["events/e2"] = .success(makeEventResponse(id: "e2"))
        mock.results["events/e3"] = .success(makeEventResponse(id: "e3"))

        let tracker = ConcurrencyTracker()
        // 全リクエストが重なり合う時間を作るため、揃って少し待たせる。
        let apiClient = TrackedDelayedAPIClient(
            wrapped: mock,
            tracker: tracker,
            delaysMs: ["events/e1": 30, "events/e2": 30, "events/e3": 30]
        )

        let entries = [
            FavoritesStore.Entry(type: .event, id: "e1"),
            FavoritesStore.Entry(type: .event, id: "e2"),
            FavoritesStore.Entry(type: .event, id: "e3"),
        ]

        _ = await FavoriteItemLoader(apiClient: apiClient).load(entries)

        let maxConcurrent = await tracker.maxConcurrent
        // 直列であれば常に1だったはず(今回の修正前はこのテストは失敗する)。
        XCTAssertEqual(maxConcurrent, 3, "お気に入り3件が並行して取得されていません(直列のままの可能性があります)")
    }
}
