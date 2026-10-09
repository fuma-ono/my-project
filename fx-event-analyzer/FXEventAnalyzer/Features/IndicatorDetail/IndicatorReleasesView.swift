import SwiftUI

/// SCR-006 指標詳細の「過去の発表日」(HQ指示 2026-10-09)。その指標の発表済みの回を
/// 新しい順に並べ、行からSCR-007 イベント詳細へ移る。
struct IndicatorReleasesView: View {
    @StateObject private var viewModel: IndicatorReleasesViewModel
    @Binding var tabSelection: Int
    @Environment(\.dismiss) private var dismiss

    init(apiClient: APIClient, indicatorId: String, indicatorName: String, tabSelection: Binding<Int>) {
        _viewModel = StateObject(wrappedValue: IndicatorReleasesViewModel(apiClient: apiClient, indicatorId: indicatorId, indicatorName: indicatorName))
        _tabSelection = tabSelection
    }

    var body: some View {
        V5Viewport {
            V5Header(title: "過去の発表日", back: true, onBack: { dismiss() })
            switch viewModel.state {
            case .loading:
                centered { LoadingView(caption: "読み込み中...") }
            case .backendNotConfigured:
                centered { FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "発表の履歴はまだ利用できません。") }
            case .error(let message):
                centered { ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { Task { await viewModel.load() } }) }
            case .loaded(let events):
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 6) {
                        NotoText.text(viewModel.indicatorName, size: 9).foregroundStyle(SettingsListLayout.sectionTitleColor)
                            .padding(.horizontal, 4)
                        list(events)
                    }
                    .frame(width: 214)
                    .padding(.vertical, 6)
                    .frame(width: V5P.W)
                }
                .frame(width: V5P.W, height: 398)
                .position(x: V5P.W / 2, y: 54 + 398 / 2)
            }
            V5BottomBar(selected: $tabSelection)
        }
        .toolbar(.hidden, for: .navigationBar)
        .task { await viewModel.load() }
    }

    private func centered(@ViewBuilder _ content: () -> some View) -> some View {
        content()
            .frame(width: V5P.W, height: V5P.H - 92, alignment: .center)
            .padding(.top, 53)
    }

    private func list(_ events: [IndicatorEventSummary]) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                header("発表日").frame(maxWidth: .infinity, alignment: .leading)
                header("結果").frame(width: 34, alignment: .trailing)
                header("予想").frame(width: 34, alignment: .trailing)
                header("前回").frame(width: 34, alignment: .trailing)
                Color.clear.frame(width: 12)
            }
            .padding(.horizontal, 9)
            .frame(height: 20)
            if events.isEmpty {
                SettingsListSeparator()
                NotoText.text("発表済みの回はまだありません。", size: 8)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .frame(maxWidth: .infinity, minHeight: 36)
            }
            ForEach(events) { event in
                SettingsListSeparator()
                NavigationLink(value: AppRoute.eventDetail(id: event.id)) {
                    HStack(spacing: 0) {
                        NotoText.text("\(AppPreferences.shared.dateString(event.releaseDatetime)) \(AppPreferences.shared.timeString(event.releaseDatetime))", size: 7.5)
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        number(event.actual).frame(width: 34, alignment: .trailing)
                        number(event.forecast).frame(width: 34, alignment: .trailing)
                        number(event.previous).frame(width: 34, alignment: .trailing)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 7, weight: .semibold))
                            .foregroundStyle(SettingsCardStyle.chevronColor)
                            .frame(width: 12, alignment: .trailing)
                    }
                    .padding(.horizontal, 9)
                    .frame(height: 28)
                    .contentShape(Rectangle())
                }
                .buttonStyle(SettingsRowPressStyle())
            }
        }
        .frame(width: 214)
        .background(AccountCardBackground())
    }

    private func header(_ text: String) -> some View {
        NotoText.text(text, size: 6.5).foregroundStyle(SettingsCardStyle.subtitleColor)
    }

    private func number(_ value: Double?) -> some View {
        Text(value.map { ValueFormat.number($0) } ?? "-")
            .font(.system(size: 8, weight: .semibold))
            .monospacedDigit()
            .foregroundStyle(.white)
    }
}

@MainActor
final class IndicatorReleasesViewModel: ObservableObject {
    enum State: Equatable {
        case loading
        case loaded([IndicatorEventSummary])
        case backendNotConfigured
        case error(String)
    }

    @Published private(set) var state: State = .loading
    let indicatorName: String
    private let apiClient: APIClient
    private let indicatorId: String

    init(apiClient: APIClient, indicatorId: String, indicatorName: String) {
        self.apiClient = apiClient
        self.indicatorId = indicatorId
        self.indicatorName = indicatorName
    }

    func load() async {
        state = .loading
        do {
            let response: IndicatorEventsListResponse = try await apiClient.send(Endpoint(
                path: "indicators/\(indicatorId)/events",
                queryItems: [
                    URLQueryItem(name: "status", value: "RELEASED"),
                    URLQueryItem(name: "limit", value: "20"),
                ]
            ))
            state = .loaded(response.data.sorted { $0.releaseDatetime > $1.releaseDatetime })
        } catch let error as APIError where error.isNotConfigured {
            state = .backendNotConfigured
        } catch {
            state = .error("発表の履歴の取得に失敗しました。")
        }
    }
}
