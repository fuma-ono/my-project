import Foundation

/// お気に入り(`FavoritesStore`)の1件ずつを、表示に使う形(`HomeFavoriteItem`)に読み込む。
/// ホームの「お気に入り」カード(先頭3件)とお気に入り一覧(全件)で同じものを使う。
struct FavoriteItemLoader {
    let apiClient: APIClient

    /// 並び順はお気に入りの順のまま。読み込めなかったもの(削除された指標など)と通貨ペアは飛ばす。
    func load(_ entries: [FavoritesStore.Entry]) async -> [HomeFavoriteItem] {
        var items: [HomeFavoriteItem] = []
        for entry in entries {
            switch entry.type {
            case .event:
                if let item = await fetchFavoriteEvent(id: entry.id) { items.append(item) }
            case .indicator:
                if let item = await fetchFavoriteIndicator(id: entry.id) { items.append(item) }
            case .fxPair:
                continue
            }
        }
        return items
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
            async let scheduled: IndicatorEventsListResponse = apiClient.send(
                Endpoint(
                    path: "indicators/\(id)/events",
                    queryItems: [
                        URLQueryItem(name: "status", value: "SCHEDULED"),
                        URLQueryItem(name: "limit", value: "1"),
                    ]
                )
            )
            let (response, scheduledResponse) = try await (detail, scheduled)
            return .indicator(
                id: response.indicator.id,
                countryCode: response.indicator.countryCode,
                currencyCode: response.indicator.currencyCode,
                name: CountryFlag.indicatorDisplayText(response.indicator.name, countryCode: response.indicator.countryCode, displayName: response.indicator.displayName),
                importance: response.indicator.importance,
                nextReleaseDatetime: scheduledResponse.data.first?.releaseDatetime
            )
        } catch {
            return nil
        }
    }

}
