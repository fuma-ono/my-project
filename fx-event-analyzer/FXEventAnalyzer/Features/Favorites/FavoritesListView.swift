import SwiftUI

/// お気に入り一覧(HQ指示 2026-10-15、ホームの「お気に入り」の「すべて見る」から開く)。
/// 指標一覧(`IndicatorsView`)と同じデザイン: 1件ずつのグラデーションのカード、左端に重要度の色の帯、
/// 1行目に日時、2行目に国旗・名前・国、右に重要度と＞。指標は次回発表、イベントはその発表日時を出す。
struct FavoritesListView: View {
    let apiClient: APIClient
    @Binding var tabSelection: Int
    @ObservedObject private var store = FavoritesStore.shared
    @State private var items: [HomeFavoriteItem] = []
    @State private var isLoading = true
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        V5Viewport {
            V5Header(title: "お気に入り", back: true, onBack: { dismiss() })
            VStack(alignment: .leading, spacing: 7) {
                HStack {
                    NotoText.text("\(items.count)件", size: 8)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                    Spacer()
                }
                .padding(.horizontal, 2)
                list
            }
            .frame(width: 214)
            .padding(.top, 6)
            .frame(width: V5P.W, height: 398, alignment: .top)
            .position(x: V5P.W / 2, y: 54 + 398 / 2)
            V5BottomBar(selected: $tabSelection)
        }
        .toolbar(.hidden, for: .navigationBar)
        .task(id: store.entries) { await load() }
    }

    private func load() async {
        isLoading = true
        items = await FavoriteItemLoader(apiClient: apiClient).load(store.entries)
        isLoading = false
    }

    @ViewBuilder private var list: some View {
        if isLoading && items.isEmpty {
            LoadingView(caption: "読み込み中...")
                .frame(maxWidth: .infinity, minHeight: 120)
        } else if items.isEmpty {
            VStack(spacing: 4) {
                NotoText.text("お気に入りはまだありません。", size: 8.5)
                    .foregroundStyle(.white)
                NotoText.text("指標詳細の☆を押すと、ここに追加されます。", size: 7)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
            }
            .frame(maxWidth: .infinity, minHeight: 60)
            .background(GradientCardBackground())
        } else {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 5) {
                    ForEach(items) { item in
                        NavigationLink(value: route(for: item)) {
                            row(item)
                                .background(rowCard(importance(of: item)))
                        }
                        .buttonStyle(SettingsRowPressStyle())
                    }
                }
                .padding(.bottom, 6)
            }
        }
    }

    private func route(for item: HomeFavoriteItem) -> AppRoute {
        switch item {
        case .event(let id, _, _, _, _, _): return .eventDetail(id: id)
        case .indicator(let id, _, _, _, _, _): return .indicatorDetail(id: id)
        case .fxPair: return .homeCurrencyPairEditor
        }
    }

    private func importance(of item: HomeFavoriteItem) -> Importance {
        switch item {
        case .event(_, _, _, _, let importance, _), .indicator(_, _, _, _, let importance, _): return importance
        case .fxPair: return .low
        }
    }

    private func rowCard(_ importance: Importance) -> some View {
        let shape = RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius)
        return shape.fill(V5CardGradient.fill)
            .overlay(alignment: .leading) {
                Rectangle().fill(IndicatorsView.accentColor(importance)).frame(width: 3)
            }
            .clipShape(shape)
            .overlay(shape.stroke(SettingsCardStyle.cardBorder, lineWidth: 0.7))
    }

    @ViewBuilder private func row(_ item: HomeFavoriteItem) -> some View {
        switch item {
        case let .event(_, countryCode, _, name, importance, releaseDatetime):
            rowContent(label: "発表", date: releaseDatetime, countryCode: countryCode, name: name, importance: importance)
        case let .indicator(_, countryCode, _, name, importance, nextReleaseDatetime):
            rowContent(label: "次回", date: nextReleaseDatetime, countryCode: countryCode, name: name, importance: importance)
        case .fxPair:
            EmptyView()
        }
    }

    private func rowContent(label: String, date: Date?, countryCode: String, name: String, importance: Importance) -> some View {
        let colors = HomeView.importanceBadgeColors(importance)
        return HStack(spacing: 5) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 6) {
                    if let date {
                        NotoText.text(label, size: 7)
                        Text(Self.dateString(date))
                        Text(Self.timeString(date))
                    } else {
                        NotoText.text("予定なし", size: 7)
                    }
                }
                .font(.system(size: 7.5, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(SettingsCardStyle.subtitleColor)
                HStack(spacing: 7) {
                    CountryFlagView(countryCode: countryCode, diameter: 17)
                    VStack(alignment: .leading, spacing: 1) {
                        NotoText.text(name, size: 9.5)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                            .frame(height: 14, alignment: .leading)
                            .foregroundStyle(.white)
                        NotoText.text(CountryFlag.japaneseName(forCountry: countryCode), size: 7)
                            .foregroundStyle(SettingsCardStyle.subtitleColor)
                            .frame(height: 9, alignment: .leading)
                    }
                }
                .frame(height: 24)
            }
            Spacer(minLength: 4)
            NotoText.text(importance.rawValue, size: 6.5)
                .tracking(-0.3)
                .foregroundStyle(.white)
                .frame(width: 36, height: 14)
                .background(colors.fill, in: Capsule())
                .overlay(Capsule().stroke(colors.border, lineWidth: 0.6))
            Image(systemName: "chevron.right")
                .font(.system(size: 10.5, weight: .semibold))
                .foregroundStyle(V5P.muted)
        }
        .padding(.leading, 9)
        .padding(.trailing, 7)
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "MM/dd"
        return formatter
    }()

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    @MainActor private static func dateString(_ date: Date) -> String {
        // 表示設定の日付の形式(年なし)とタイムゾーン(HQ指示 2026-10-15)。
        AppPreferences.shared.shortDateString(date)
    }

    @MainActor private static func timeString(_ date: Date) -> String {
        // 表示設定の時刻の形式(24時間/12時間)とタイムゾーン(HQ指示 2026-10-15)。
        AppPreferences.shared.timeString(date)
    }
}
