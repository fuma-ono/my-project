import SwiftUI

/// SCR-006 指標詳細の「過去の発表日」(HQ指示 2026-10-09)。その指標の発表済みの回を
/// 新しい順に並べ、行からSCR-007 イベント詳細へ移る。
struct IndicatorReleasesView: View {
    @StateObject private var viewModel: IndicatorReleasesViewModel
    @Binding var tabSelection: Int
    @Environment(\.dismiss) private var dismiss
    private let apiClient: APIClient
    @ObservedObject private var plan = PlanStore.shared
    @State private var planPrompt: String?

    init(apiClient: APIClient, indicatorId: String, indicatorName: String, tabSelection: Binding<Int>) {
        self.apiClient = apiClient
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
        .planLimitPrompt($planPrompt, apiClient: apiClient, tabSelection: $tabSelection)
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
                if let values = Self.releaseValues(event) {
                    NavigationLink(value: AppRoute.eventDetail(id: event.id)) {
                        HStack(spacing: 0) {
                            dateText(event)
                            number(values.actual).frame(width: 34, alignment: .trailing)
                            number(values.forecast).frame(width: 34, alignment: .trailing)
                            number(values.previous).frame(width: 34, alignment: .trailing)
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
                } else {
                    // 無料プランで隠された過去の発表(HQ判断 2026-10-22): 値の3列の代わりに鍵の印。
                    // 押すとプランの案内(イベント詳細も値は隠されているため進まない)。
                    Button {
                        planPrompt = PastReleaseLock.promptMessage(maxForPlan: plan.limits.pastReleasesMax)
                    } label: {
                        HStack(spacing: 0) {
                            dateText(event)
                            PastReleaseLockBadge(size: 7)
                                .frame(width: 102, alignment: .trailing)
                            Color.clear.frame(width: 12)
                        }
                        .padding(.horizontal, 9)
                        .frame(height: 28)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(SettingsRowPressStyle())
                    .accessibilityIdentifier("indicatorReleaseLockedRow")
                }
            }
        }
        .frame(width: 214)
        .background(AccountCardBackground())
    }

    private func header(_ text: String) -> some View {
        NotoText.text(text, size: 6.5).foregroundStyle(SettingsCardStyle.subtitleColor)
    }

    private func dateText(_ event: IndicatorEventSummary) -> some View {
        NotoText.text("\(AppPreferences.shared.dateString(event.releaseDatetime)) \(AppPreferences.shared.timeString(event.releaseDatetime))", size: 7.5)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func number(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 8, weight: .semibold))
            .monospacedDigit()
            .foregroundStyle(.white)
    }

    /// 行に出す結果・予想・前回の文字。無料プランで隠された発表(`isLocked`)ではnil
    /// (値を「-」で出すとデータが無いように見えるため、行ごと鍵の印に替える)。
    static func releaseValues(_ event: IndicatorEventSummary) -> (actual: String, forecast: String, previous: String)? {
        guard !event.isLocked else { return nil }
        func text(_ value: Double?) -> String { value.map { ValueFormat.number($0) } ?? "-" }
        return (text(event.actual), text(event.forecast), text(event.previous))
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
