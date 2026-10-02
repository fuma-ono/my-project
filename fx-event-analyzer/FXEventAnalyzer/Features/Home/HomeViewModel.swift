import Combine
import Foundation

enum HomeState: Equatable {
    case loading
    /// No Backend base URL configured yet — distinct from a real failure.
    case backendNotConfigured
    case loaded(events: [HomeEventSummary], majorFx: [MajorFxSummary])
    case error(String)
}

/// HQ指示(2026-10-02)「お気に入り」セクション用の軽量表示モデル。指標と
/// イベントは別々のAPIレスポンス形状を持つが、Homeのお気に入り行は両方とも
/// 同じコンパクトな見た目(国旗/通貨/名称/重要度バッジ)で表示するため、
/// 共通の最小限のフィールドだけを抜き出している。
enum HomeFavoriteItem: Identifiable, Equatable {
    case event(id: String, countryCode: String, currencyCode: String, name: String, importance: Importance)
    case indicator(id: String, countryCode: String, currencyCode: String, name: String, importance: Importance)

    var id: String {
        switch self {
        case .event(let id, _, _, _, _): return "event:\(id)"
        case .indicator(let id, _, _, _, _): return "indicator:\(id)"
        }
    }
}

/// SCR-001 Home. Phase 3 §4: real `GET /home` connection —
/// `HomeView → HomeViewModel → APIClient → Backend API → DTO → UI`, no
/// fake production data. Splits the single day-scoped `events` array into
/// "今日の注目イベント" (mainly SCHEDULED) and "最近のイベント" (RELEASED)
/// itself, per api-design.md §12's H-2 resolution — the Backend does not
/// provide a separate field/endpoint for this.
///
/// HQ指示(2026-10-02)「ホーム画面の構成」: お気に入りセクション追加に伴い、
/// `FavoritesStore`(端末ローカル、`Common/FavoritesStore.swift`)の登録順
/// (新しい順)を購読し、変更があるたびに最大3件ぶんを`GET /events/{id}`・
/// `GET /indicators/{id}`で個別に解決する。お気に入りAPIは無いため、
/// 既存の単一アイテム取得APIを再利用している(新規エンドポイントは追加
/// していない)。取得に失敗した項目(削除済みなど)は静かに除外する。
@MainActor
final class HomeViewModel: ObservableObject {
    @Published private(set) var state: HomeState = .loading
    @Published private(set) var favoriteItems: [HomeFavoriteItem] = []

    private let apiClient: APIClient
    private let favoritesStore: FavoritesStore
    private var cancellables = Set<AnyCancellable>()

    init(apiClient: APIClient, favoritesStore: FavoritesStore = .shared) {
        self.apiClient = apiClient
        self.favoritesStore = favoritesStore
        favoritesStore.$entries
            .sink { [weak self] entries in
                Task { await self?.loadFavorites(entries) }
            }
            .store(in: &cancellables)
    }

    var upcomingEvents: [HomeEventSummary] {
        guard case .loaded(let events, _) = state else { return [] }
        return events.filter { $0.status == .scheduled }
    }

    var recentEvents: [HomeEventSummary] {
        guard case .loaded(let events, _) = state else { return [] }
        return events.filter { $0.status == .released }
    }

    func load() {
        state = .loading
        Task { await fetch() }
    }

    private func fetch() async {
        let today = Self.isoDateFormatter.string(from: Date())
        let timezone = TimeZone.current.identifier
        let endpoint = Endpoint(
            path: "home",
            queryItems: [
                URLQueryItem(name: "date", value: today),
                URLQueryItem(name: "timezone", value: timezone),
            ]
        )
        do {
            let response: HomeResponse = try await apiClient.send(endpoint)
            state = .loaded(events: response.events, majorFx: response.majorFx)
        } catch let error as APIError where error.isNotConfigured {
            state = .backendNotConfigured
        } catch {
            state = .error("イベント情報の取得に失敗しました。")
        }
    }

    private func loadFavorites(_ entries: [FavoritesStore.Entry]) async {
        var items: [HomeFavoriteItem] = []
        for entry in entries.prefix(3) {
            switch entry.type {
            case .event:
                if let item = await fetchFavoriteEvent(id: entry.id) {
                    items.append(item)
                }
            case .indicator:
                if let item = await fetchFavoriteIndicator(id: entry.id) {
                    items.append(item)
                }
            }
        }
        favoriteItems = items
    }

    private func fetchFavoriteEvent(id: String) async -> HomeFavoriteItem? {
        do {
            let response: EventDetailResponse = try await apiClient.send(Endpoint(path: "events/\(id)"))
            return .event(
                id: response.event.id,
                countryCode: response.event.countryCode,
                currencyCode: response.event.currencyCode,
                name: response.event.indicatorName,
                importance: response.event.importance
            )
        } catch {
            return nil
        }
    }

    private func fetchFavoriteIndicator(id: String) async -> HomeFavoriteItem? {
        do {
            let response: IndicatorDetailResponse = try await apiClient.send(Endpoint(path: "indicators/\(id)"))
            return .indicator(
                id: response.indicator.id,
                countryCode: response.indicator.countryCode,
                currencyCode: response.indicator.currencyCode,
                name: response.indicator.name,
                importance: response.indicator.importance
            )
        } catch {
            return nil
        }
    }

    private static let isoDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .current
        return formatter
    }()
}
