import Combine
import Foundation

enum EventDetailState: Equatable {
    case loading
    case backendNotConfigured
    case loaded(EventDetailResponse)
    case notEntitled
    case notFound
    case error(String)
}

/// 「次回発表予定」の読み込み状態。HQ指摘(2026-10-28)「イベント詳細などの
/// 次回発表の表示にラグがある」: `nextRelease: Date?`だけでは「まだ取得中」
/// と「取得済みだが次回発表が無い」の両方がnilで区別できず、画面本体が
/// 表示された直後は必ず前者(真の意味では読み込み中)なのに
/// `nextReleaseFooter`が「無い」ものとして高さ0で描画され、取得が終わった
/// 瞬間にカード1枚分(高さ26)が突然現れてレイアウトが縦にガタついて見えて
/// いた(これが「ラグ」として報告された見た目)。読み込み中は確定前の
/// プレースホルダーを同じ高さで表示することで、取得完了時のガタつきを防ぐ。
enum NextReleaseState: Equatable {
    case loading
    case available(Date)
    case none
}

/// SCR-007 イベント詳細 (H-1 order) — the central screen:
/// Forecast/Actual/Previous → Surprise → 乖離理由 → 市場への影響 → 関連FX
/// ペア/Reaction, all from a single `GET /events/{event_id}` call. Backend
/// is the sole Source of Truth for Surprise/Reaction (api-design.md §8) —
/// this view model never recomputes them.
@MainActor
final class EventDetailViewModel: ObservableObject {
    @Published private(set) var state: EventDetailState = .loading
    /// この指標の次回発表予定(画面下の表示)。取れなくても画面は出す。
    @Published private(set) var nextReleaseState: NextReleaseState = .loading

    private let apiClient: APIClient
    private let eventId: String

    init(apiClient: APIClient, eventId: String) {
        self.apiClient = apiClient
        self.eventId = eventId
    }

    /// 画面側がイベントを読み込んだ後に呼ぶ(`load`の通信の順番は変えない)。
    func loadIndicator(id: String) async {
        // v1.31: 現在以降の近い順(`NextReleaseQuery`)。このイベント自体が発表前なら
        // 先頭がこのイベントになるため2件受け取り、それより後の回を次回とする。
        let now = Date()
        let response: IndicatorEventsListResponse? = try? await apiClient.send(Endpoint(
            path: "indicators/\(id)/events",
            queryItems: NextReleaseQuery.queryItems(limit: 2, now: now)
        ))
        if let date = NextReleaseQuery.next(in: response?.data ?? [], after: now, excluding: eventId)?.releaseDatetime {
            nextReleaseState = .available(date)
        } else {
            nextReleaseState = .none
        }
    }

    func load() {
        state = .loading
        Task { await fetch() }
    }

    private func fetch() async {
        do {
            let response: EventDetailResponse = try await apiClient.send(Endpoint(path: "events/\(eventId)"))
            state = .loaded(response)
        } catch let error as APIError where error.isNotConfigured {
            state = .backendNotConfigured
        } catch let error as APIError {
            if case .server(let code, _, _) = error {
                switch code {
                case .eventNotFound:
                    state = .notFound
                case .featureNotEntitled, .subscriptionRequired:
                    state = .notEntitled
                default:
                    state = .error("イベント情報の取得に失敗しました。")
                }
            } else {
                state = .error("イベント情報の取得に失敗しました。")
            }
        } catch {
            state = .error("イベント情報の取得に失敗しました。")
        }
    }
}
