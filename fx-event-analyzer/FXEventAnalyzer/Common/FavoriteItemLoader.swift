import Foundation

/// お気に入り(`FavoritesStore`)の1件ずつを、表示に使う形(`HomeFavoriteItem`)に読み込む。
/// ホームの「お気に入り」カード(先頭3件)とお気に入り一覧(全件)で同じものを使う。
struct FavoriteItemLoader {
    let apiClient: APIClient

    /// 並び順はお気に入りの順のまま。読み込めなかったもの(削除された指標など)と通貨ペアは飛ばす。
    ///
    /// HQ指示(2026-10-23「iOS画面表示速度の改善」): 以前は`entries`を`for`文で
    /// 1件ずつ直列に取得しており、件数(最大3件、PROはお気に入り一覧で最大10件)
    /// に比例して待ち時間が伸びていた。各件の取得は互いに依存しないため、
    /// `TaskGroup`で並行化する。並び順は`entries`の元の添字で管理し、取得完了の
    /// 順序に関わらず`entries`と同じ並びで返す(コメント通り順序を維持する)。
    func load(_ entries: [FavoritesStore.Entry]) async -> [HomeFavoriteItem] {
        // 添字ぶんの枠を先に確保しておき、完了した順に該当する枠を埋める
        // (タプルの並べ替えに頼らない、最も素直な形)。
        var slots = [HomeFavoriteItem?](repeating: nil, count: entries.count)
        await withTaskGroup(of: (Int, HomeFavoriteItem?).self) { group in
            for (index, entry) in entries.enumerated() {
                group.addTask {
                    switch entry.type {
                    case .event:
                        return (index, await fetchFavoriteEvent(id: entry.id))
                    case .indicator:
                        return (index, await fetchFavoriteIndicator(id: entry.id))
                    case .fxPair:
                        return (index, nil)
                    }
                }
            }
            for await (index, item) in group {
                slots[index] = item
            }
        }
        return slots.compactMap { $0 }
    }

    func fetchFavoriteEvent(id: String) async -> HomeFavoriteItem? {
        do {
            let response: EventDetailResponse = try await apiClient.send(Endpoint(path: "events/\(id)"))
            return .event(
                id: response.event.id,
                countryCode: response.event.countryCode,
                currencyCode: response.event.currencyCode,
                // 表示名は全画面統一(HQ指示 2026-10-13)。
                name: CountryFlag.indicatorDisplayText(response.event.indicatorName, countryCode: response.event.countryCode, displayName: response.event.displayName),
                importance: response.event.importance,
                releaseDatetime: response.event.releaseDatetime
            )
        } catch {
            return nil
        }
    }

    func fetchFavoriteIndicator(id: String) async -> HomeFavoriteItem? {
        do {
            async let detail: IndicatorDetailResponse = apiClient.send(Endpoint(path: "indicators/\(id)"))
            // v1.31: 次の発表は現在以降の近い順(`NextReleaseQuery`)。
            let now = Date()
            async let scheduled: IndicatorEventsListResponse = apiClient.send(
                Endpoint(
                    path: "indicators/\(id)/events",
                    queryItems: NextReleaseQuery.queryItems(limit: 1, now: now)
                )
            )
            let (response, scheduledResponse) = try await (detail, scheduled)
            return .indicator(
                id: response.indicator.id,
                countryCode: response.indicator.countryCode,
                currencyCode: response.indicator.currencyCode,
                name: CountryFlag.indicatorDisplayText(response.indicator.name, countryCode: response.indicator.countryCode, displayName: response.indicator.displayName),
                importance: response.indicator.importance,
                nextReleaseDatetime: NextReleaseQuery.next(in: scheduledResponse.data, after: now)?.releaseDatetime
            )
        } catch {
            return nil
        }
    }

}
