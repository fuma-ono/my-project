import Combine
import SwiftUI

/// `GET /speakers/{speaker_id}/comparison`(api-design v1.28)。
struct SpeakerComparisonResponse: Decodable, Equatable {
    let speaker: SpeechSpeaker
    let fxPairId: String?
    let symbol: String?
    let events: [SpeakerComparisonEvent]
    let historyLimit: ComparisonResponse.HistoryLimit?

    enum CodingKeys: String, CodingKey {
        case speaker, symbol, events
        case fxPairId = "fx_pair_id"
        case historyLimit = "history_limit"
    }
}

struct SpeakerComparisonEvent: Decodable, Equatable, Identifiable {
    let speechId: String
    let title: String
    let statementDatetime: Date
    let importance: Importance
    let pipsByTimeframe: [String: Double?]

    var id: String { speechId }

    enum CodingKeys: String, CodingKey {
        case title, importance
        case speechId = "speech_id"
        case statementDatetime = "statement_datetime"
        case pipsByTimeframe = "pips_by_timeframe"
    }
}

@MainActor
final class SpeakerComparisonViewModel: ObservableObject {
    enum State: Equatable {
        case loading
        case notEntitled
        case loaded(SpeakerComparisonResponse)
        case error(String)
    }

    @Published private(set) var state: State = .loading
    private let apiClient: APIClient
    private let speakerId: String
    private let fxPairId: String?

    init(apiClient: APIClient, speakerId: String, fxPairId: String?) {
        self.apiClient = apiClient
        self.speakerId = speakerId
        self.fxPairId = fxPairId
    }

    func load() async {
        state = .loading
        var query: [URLQueryItem] = []
        if let fxPairId { query.append(URLQueryItem(name: "fx_pair_id", value: fxPairId)) }
        do {
            let response: SpeakerComparisonResponse = try await apiClient.send(Endpoint(path: "speakers/\(speakerId)/comparison", queryItems: query))
            state = .loaded(response)
        } catch let error as APIError {
            if case .server(let code, _, _) = error, code == .featureNotEntitled || code == .subscriptionRequired {
                state = .notEntitled
            } else {
                state = .error("過去の発言の取得に失敗しました。")
            }
        } catch {
            state = .error("過去の発言の取得に失敗しました。")
        }
    }
}

/// 要人発言の過去イベント比較(HQ指示 2026-10-15「本番データで機能を作成」)。指標の過去イベント比較
/// (`HistoricalComparisonView`)と同じ見た目で、同じ要人の過去の発言ごとに 1分・5分・15分の値動きを並べる。
/// 行を押すとその発言の要人発言詳細へ。
struct SpeakerComparisonView: View {
    @StateObject private var viewModel: SpeakerComparisonViewModel
    @Binding var tabSelection: Int
    private let symbol: String?
    @State private var newestFirst = true
    @State private var planPrompt: String?
    private let apiClient: APIClient
    @Environment(\.dismiss) private var dismiss

    init(apiClient: APIClient, speakerId: String, fxPairId: String?, symbol: String?, tabSelection: Binding<Int>) {
        self.apiClient = apiClient
        self.symbol = symbol
        _viewModel = StateObject(wrappedValue: SpeakerComparisonViewModel(apiClient: apiClient, speakerId: speakerId, fxPairId: fxPairId))
        _tabSelection = tabSelection
    }

    var body: some View {
        V5Viewport {
            V5Header(title: "過去イベント比較", back: true, onBack: { dismiss() })
            content
            V5BottomBar(selected: $tabSelection)
        }
        .toolbar(.hidden, for: .navigationBar)
        .task { await viewModel.load() }
        .planLimitPrompt($planPrompt, apiClient: apiClient, tabSelection: $tabSelection)
    }

    @ViewBuilder private var content: some View {
        switch viewModel.state {
        case .loading:
            centered { LoadingView(caption: "読み込み中...") }
        case .notEntitled:
            centered { FXEmptyState(icon: "lock.fill", title: "この情報はご利用いただけません", message: "現在のプランでは過去の比較データを閲覧できません。") }
        case .error(let message):
            centered { ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { Task { await viewModel.load() } }) }
        case .loaded(let response):
            VStack(alignment: .leading, spacing: 8) {
                header(response)
                table(response)
                if let limit = response.historyLimit, limit.isLimited {
                    Button {
                        planPrompt = "無料プランで比べられるのは、直近\(limit.maxForPlan)回分です。プレミアムプランなら\(limit.proMax)回分(約5年)と比べられます。"
                    } label: {
                        HStack(spacing: 3) {
                            Image(systemName: "lock.fill").font(.system(size: 5.5))
                            NotoText.text("無料プランは直近\(limit.maxForPlan)回分です。プレミアムなら\(limit.proMax)回分", size: 6.5)
                            Image(systemName: "chevron.right").font(.system(size: 5.5, weight: .semibold))
                        }
                        .foregroundStyle(V5P.cyan)
                    }
                    .buttonStyle(.plain)
                    .padding(.leading, 4)
                }
            }
            .frame(width: 214)
            .padding(.top, 8)
            .frame(width: V5P.W, height: 398, alignment: .top)
            .position(x: V5P.W / 2, y: 54 + 398 / 2)
        }
    }

    private func centered(@ViewBuilder _ content: () -> some View) -> some View {
        content()
            .frame(width: V5P.W, height: V5P.H - 92, alignment: .center)
            .padding(.top, 53)
    }

    private func header(_ response: SpeakerComparisonResponse) -> some View {
        let speaker = response.speaker
        let pairSymbol = response.symbol ?? symbol
        return HStack(spacing: 8) {
            SpeakerAvatar(name: speaker.name, organization: speaker.organization, countryCode: speaker.countryCode, photoURL: speaker.photoURL, size: 34)
            VStack(alignment: .leading, spacing: 3) {
                NotoText.text("\(SpeechListView.familyName(speaker.name))　\(speaker.title)", size: 11)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                HStack(spacing: 3) {
                    NotoText.text(CountryFlag.japaneseName(forCountry: speaker.countryCode), size: 8.5)
                    NotoText.text("｜", size: 8.5).opacity(0.6)
                    NotoText.text(speaker.organization, size: 8.5)
                    Spacer(minLength: 4)
                    if let pairSymbol {
                        OverlappingPairFlags(symbol: pairSymbol, diameter: 10)
                        NotoText.text(HistoricalComparisonView.pairLabel(pairSymbol), size: 9)
                            .foregroundStyle(.white)
                    }
                }
                .foregroundStyle(SettingsCardStyle.subtitleColor)
            }
        }
        .frame(height: 36)
        .padding(.horizontal, 2)
    }

    // 列: 日時42 / 発言87 / 1分28・5分28・15分29(指標の過去イベント比較と同じ合計212)。
    private enum Column {
        static let date: CGFloat = 42
        static let title: CGFloat = 87
        static let pips: [CGFloat] = [28, 28, 29]
    }

    private func table(_ response: SpeakerComparisonResponse) -> some View {
        let events = newestFirst
            ? response.events.sorted { $0.statementDatetime > $1.statementDatetime }
            : response.events.sorted { $0.statementDatetime < $1.statementDatetime }
        let shape = RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius)
        return VStack(spacing: 0) {
            tableHeader
            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    ForEach(Array(events.enumerated()), id: \.element.id) { index, event in
                        if index > 0 {
                            Rectangle().fill(SettingsCardStyle.cardBorder.opacity(0.6)).frame(height: 0.5)
                        }
                        NavigationLink(value: AppRoute.speechDetail(id: event.speechId)) {
                            row(event)
                        }
                        .buttonStyle(SettingsRowPressStyle())
                    }
                    if events.isEmpty {
                        NotoText.text("過去の発言はまだありません。", size: 7)
                            .foregroundStyle(SettingsCardStyle.subtitleColor)
                            .frame(maxWidth: .infinity, minHeight: 36)
                    }
                }
            }
        }
        .frame(
            width: 212,
            height: HistoricalComparisonView.tableHeight(
                rows: events.count,
                limited: response.historyLimit?.isLimited == true,
                // 要人発言の比較には前年/前月の副指標(HQ指示2026-10-25)が無いため常にfalse。
                showSecondary: false
            ),
            alignment: .top
        )
        .background(V5CardGradient.fill)
        .clipShape(shape)
        .overlay(shape.stroke(SettingsCardStyle.cardBorder, lineWidth: 0.7))
    }

    private var tableHeader: some View {
        HStack(spacing: 0) {
            Button { newestFirst.toggle() } label: {
                HStack(spacing: 2) {
                    Image(systemName: "calendar").font(.system(size: 6.5, weight: .semibold))
                    NotoText.text("日時", size: 7)
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 5, weight: .bold))
                }
                .foregroundStyle(.white)
                .frame(width: Column.date, height: HistoricalComparisonView.headerHeight)
            }
            .buttonStyle(.plain)
            headerCell("発言", width: Column.title)
            headerCell("1分", width: Column.pips[0])
            headerCell("5分", width: Column.pips[1])
            headerCell("15分", width: Column.pips[2])
        }
        .frame(height: HistoricalComparisonView.headerHeight)
        .background(Color(red: 0.06, green: 0.17, blue: 0.33))
    }

    private func headerCell(_ title: String, width: CGFloat) -> some View {
        VStack(spacing: 0) {
            NotoText.text(title, size: 7).foregroundStyle(.white)
            if title != "発言" {
                NotoText.text("(pips)", size: 5).foregroundStyle(SettingsCardStyle.subtitleColor)
            }
        }
        .frame(width: width, height: HistoricalComparisonView.headerHeight)
    }

    private func row(_ event: SpeakerComparisonEvent) -> some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                Text(AppPreferences.shared.shortDateString(event.statementDatetime))
                    .font(.system(size: 7, weight: .semibold))
                    .foregroundStyle(.white)
                Text(AppPreferences.shared.timeString(event.statementDatetime))
                    .font(.system(size: 5.5, weight: .medium))
                    .foregroundStyle(Color(red: 0.36, green: 0.63, blue: 0.95))
            }
            .monospacedDigit()
            .padding(.leading, 5)
            .frame(width: Column.date, alignment: .leading)
            NotoText.text(event.title, size: 7)
                .foregroundStyle(.white)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
                .frame(width: Column.title, alignment: .leading)
            pipsCell(event.pipsByTimeframe["1m"] ?? nil, width: Column.pips[0])
            pipsCell(event.pipsByTimeframe["5m"] ?? nil, width: Column.pips[1])
            pipsCell(event.pipsByTimeframe["15m"] ?? nil, width: Column.pips[2])
        }
        .frame(height: HistoricalComparisonView.rowHeight)
        .contentShape(Rectangle())
    }

    private func pipsCell(_ pips: Double?, width: CGFloat) -> some View {
        Text(HistoricalComparisonView.pipsText(pips))
            .font(.system(size: 7, weight: .medium))
            .monospacedDigit()
            .foregroundStyle(pips.map { $0 >= 0 ? HomeView.changeUpColor : HomeView.changeDownColor } ?? SettingsCardStyle.subtitleColor)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .frame(width: width)
    }
}
