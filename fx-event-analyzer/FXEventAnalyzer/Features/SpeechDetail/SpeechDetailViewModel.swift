import Combine
import Foundation

enum SpeechDetailState: Equatable {
    case loading
    case backendNotConfigured
    case loaded(SpeechDetailResponse)
    case notEntitled
    case notFound
    case error(String)
}

/// SCR-013 要人発言詳細 — `GET /speeches/{speech_id}`(api-design.md §14.5)
/// 1本だけの呼び出し。`EventDetailViewModel`と同じ形(Backendの値をそのまま
/// 表示し、クライアント側で再計算・捏造しない)。
@MainActor
final class SpeechDetailViewModel: ObservableObject {
    @Published private(set) var state: SpeechDetailState = .loading

    private let apiClient: APIClient
    private let speechId: String

    init(apiClient: APIClient, speechId: String) {
        self.apiClient = apiClient
        self.speechId = speechId
    }

    func load() {
        state = .loading
        Task { await fetch() }
    }

    private func fetch() async {
        do {
            let response: SpeechDetailResponse = try await apiClient.send(Endpoint(path: "speeches/\(speechId)"))
            state = .loaded(response)
        } catch let error as APIError where error.isNotConfigured {
            state = .backendNotConfigured
        } catch let error as APIError {
            if case .server(let code, _, _) = error {
                switch code {
                case .speechNotFound:
                    state = .notFound
                case .featureNotEntitled, .subscriptionRequired:
                    state = .notEntitled
                default:
                    state = .error("要人発言情報の取得に失敗しました。")
                }
            } else {
                state = .error("要人発言情報の取得に失敗しました。")
            }
        } catch {
            state = .error("要人発言情報の取得に失敗しました。")
        }
    }
}
