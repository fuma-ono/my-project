import SwiftUI

/// SCR-012 要人発言一覧。HQ指示(2026-10-14)「指標一覧とデザインは同じに」:
/// 検索欄・絞り込み・1件ずつのカード(左端に重要度の色の帯、右に重要度と＞)は指標一覧
/// (`IndicatorsView`)と同じ。中身だけ要人発言に合わせ、
/// - 左端は国旗の代わりに要人の顔(`SpeakerAvatar`。FRB理事は公式写真、それ以外は頭文字)
/// - 名前の行は「名前　肩書き」、その下は国名の代わりに発言の題名
/// - 絞り込みは「すべて／重要度／機関／状態(予定・発言済み)」
/// ホームの「直近の要人発言」の「すべて見る」から開く。行を押すと要人発言詳細へ。
struct SpeechListView: View {
    @StateObject private var viewModel: SpeechListViewModel
    @Binding var tabSelection: Int
    @Environment(\.dismiss) private var dismiss

    /// `preview`はHQ指示(2026-10-21)「要人発言一覧の初回表示改善」対応。
    /// `AppRoute.speechList(preview:)`のドキュメントコメント参照。
    init(apiClient: APIClient, preview: [HomeSpeechSummary] = [], tabSelection: Binding<Int>) {
        _viewModel = StateObject(wrappedValue: SpeechListViewModel(apiClient: apiClient, preview: preview))
        _tabSelection = tabSelection
    }

    var body: some View {
        content
            .toolbar(.hidden, for: .navigationBar)
            .task { viewModel.load() }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .loading:
            loadingScaffold { LoadingView(caption: "読み込み中...") }
        case .loadingWithPreview(let preview):
            previewScreen(preview)
        case .backendNotConfigured:
            loadingScaffold { FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "要人発言データはまだ利用できません。") }
        case .loaded:
            V5Viewport {
                V5Header(title: "要人発言一覧", back: true, onBack: { dismiss() })
                VStack(alignment: .leading, spacing: 7) {
                    HelpSearchField(text: $viewModel.searchText, placeholder: "要人名・機関・通貨で検索")
                    filterBar
                    ListSortBar(countText: "\(viewModel.sections.upcoming.count + viewModel.sections.past.count)件", order: $viewModel.sortOrder)
                    list
                }
                .frame(width: 214)
                .padding(.top, 6)
                .frame(width: V5P.W, height: 398, alignment: .top)
                .position(x: V5P.W / 2, y: 54 + 398 / 2)
                V5BottomBar(selected: $tabSelection)
            }
        case .error(let message):
            loadingScaffold { ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { viewModel.load() }) }
        }
    }

    @ViewBuilder private func loadingScaffold(@ViewBuilder content: @escaping () -> some View) -> some View {
        V5Viewport {
            V5Header(title: "要人発言一覧", back: true, onBack: { dismiss() })
            content()
                .frame(width: V5P.W, height: V5P.H - 92, alignment: .center)
                .padding(.top, 53)
            V5BottomBar(selected: $tabSelection)
        }
    }

    // MARK: - プレビュー表示(HQ指示 2026-10-21「要人発言一覧の初回表示改善」)

    /// `/speeches`の全件取得が終わるまでの間、ホームが既に取得済みの直近の
    /// 要人発言(最大3件)を先に表示する。検索欄・絞り込み・並べ替えのUIは
    /// 出さない(`HomeSpeechSummary`には重要度・状態・機関等、絞り込みに
    /// 必要な項目が揃っていないため)。プレビュー中であることが分かるよう、
    /// 読み込み中インジケーターと案内文を常に添える。
    @ViewBuilder private func previewScreen(_ preview: [HomeSpeechSummary]) -> some View {
        V5Viewport {
            V5Header(title: "要人発言一覧", back: true, onBack: { dismiss() })
            VStack(alignment: .leading, spacing: 7) {
                previewBanner
                if preview.isEmpty {
                    // ホーム側が0件(空状態)だった場合もプレビュー表示自体は
                    // 維持し、案内文だけで全件取得を待つ(空のスピナーより
                    // 「読み込み中」である旨が伝わる)。
                    NotoText.text("最新の一覧を読み込んでいます。", size: 8)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                        .frame(maxWidth: .infinity, minHeight: 40)
                        .background(AccountCardBackground())
                } else {
                    ScrollView(showsIndicators: false) {
                        VStack(alignment: .leading, spacing: 5) {
                            ForEach(preview) { previewRow($0) }
                        }
                        .frame(width: 214)
                        .padding(.bottom, 6)
                    }
                }
            }
            .frame(width: 214)
            .padding(.top, 6)
            .frame(width: V5P.W, height: 398, alignment: .top)
            .position(x: V5P.W / 2, y: 54 + 398 / 2)
            V5BottomBar(selected: $tabSelection)
        }
    }

    private var previewBanner: some View {
        HStack(spacing: 6) {
            ProgressView()
                .tint(V5P.cyan)
                .scaleEffect(0.7)
            NotoText.text("最新の一覧を読み込み中です。下はホームの直近の要人発言です。", size: 7)
                .foregroundStyle(SettingsCardStyle.subtitleColor)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// プレビュー専用の簡易行。`HomeSpeechSummary`には重要度・状態が無い
    /// ため、`row(_:SpeechDetailResponse)`の重要度バッジ・左端の色帯は
    /// 出さない(実際には無い情報を出さないため)。タップ遷移先
    /// (`AppRoute.speechDetail`)は`HomeView.speechRow`と同じ。
    private func previewRow(_ speech: HomeSpeechSummary) -> some View {
        NavigationLink(value: AppRoute.speechDetail(id: speech.id)) {
            HStack(spacing: 7) {
                SpeakerAvatar(name: speech.speakerName, organization: speech.organization ?? "", countryCode: speech.countryCode, photoURL: speech.speakerPhotoURL, size: 17)
                VStack(alignment: .leading, spacing: 1) {
                    NotoText.text(speech.speakerName, size: 9.5).foregroundStyle(.white).lineLimit(1)
                    NotoText.text(speech.headline, size: 7).foregroundStyle(SettingsCardStyle.subtitleColor).lineLimit(1)
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").font(.system(size: 10.5, weight: .semibold)).foregroundStyle(V5P.muted)
            }
            .padding(.leading, 9)
            .padding(.trailing, 7)
            .padding(.vertical, 6)
            .background(AccountCardBackground())
            .contentShape(Rectangle())
        }
        .buttonStyle(SettingsRowPressStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(speech.speakerName) \(speech.headline)")
        .accessibilityAddTraits(.isButton)
    }

    // MARK: - 絞り込み(指標一覧と同じカプセル)

    private var filterBar: some View {
        HStack(spacing: 4) {
            Button { viewModel.clearFilters() } label: {
                chip("すべて", active: !viewModel.hasFilters, dropdown: false)
            }
            .buttonStyle(.plain)
            Menu {
                Button("すべて") { viewModel.importanceFilter = nil }
                Button("HIGH") { viewModel.importanceFilter = .high }
                Button("MEDIUM") { viewModel.importanceFilter = .medium }
                Button("LOW") { viewModel.importanceFilter = .low }
            } label: {
                chip(viewModel.importanceFilter?.rawValue ?? "重要度", active: viewModel.importanceFilter != nil, dropdown: true)
            }
            Menu {
                Button("すべて") { viewModel.organizationFilter = nil }
                ForEach(viewModel.organizations, id: \.self) { organization in
                    Button(organization) { viewModel.organizationFilter = organization }
                }
            } label: {
                chip(viewModel.organizationFilter ?? "機関", active: viewModel.organizationFilter != nil, dropdown: true)
            }
            Menu {
                Button("すべて") { viewModel.statusFilter = nil }
                ForEach(SpeechListViewModel.StatusFilter.allCases) { status in
                    Button(status.label) { viewModel.statusFilter = status }
                }
            } label: {
                chip(viewModel.statusFilter?.label ?? "状態", active: viewModel.statusFilter != nil, dropdown: true)
            }
        }
    }

    private func chip(_ title: String, active: Bool, dropdown: Bool) -> some View {
        HStack(spacing: 2) {
            NotoText.text(title, size: 7.5)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            if dropdown {
                Image(systemName: "chevron.down").font(.system(size: 5.5, weight: .bold))
            }
        }
        .foregroundStyle(active ? .white : SettingsCardStyle.subtitleColor)
        .frame(maxWidth: .infinity)
        .frame(height: 20)
        .background(Capsule().fill(active ? V5P.blue : SettingsCardStyle.cardFill))
        .overlay(Capsule().stroke(active ? V5P.blue : SettingsCardStyle.cardBorder, lineWidth: 0.6))
    }

    // MARK: - 一覧

    private var list: some View {
        let sections = viewModel.sections
        return ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 5) {
                if sections.upcoming.isEmpty && sections.past.isEmpty {
                    NotoText.text("条件に合う要人発言はありません。", size: 8)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                        .frame(maxWidth: .infinity, minHeight: 40)
                        .background(AccountCardBackground())
                }
                // HQ指示(2026-10-14)「発言前と発言後を分けた方がいい」: 1つの一覧の中に見出しを入れて分ける。
                // これからの発言は近い順、発言済み(と中止)は新しい順。
                if !sections.upcoming.isEmpty {
                    sectionTitle("これからの発言")
                    ForEach(sections.upcoming, id: \.speechId) { speechLink($0) }
                }
                if !sections.past.isEmpty {
                    sectionTitle("発言済み")
                        .padding(.top, sections.upcoming.isEmpty ? 0 : 5)
                    ForEach(sections.past, id: \.speechId) { speechLink($0) }
                }
            }
            .frame(width: 214)
            .padding(.bottom, 6)
        }
    }

    private func sectionTitle(_ title: String) -> some View {
        NotoText.text(title, size: 8.5)
            .foregroundStyle(SettingsListLayout.sectionTitleColor)
            .padding(.leading, 2)
    }

    private func speechLink(_ speech: SpeechDetailResponse) -> some View {
        NavigationLink(value: AppRoute.speechDetail(id: speech.speechId)) {
            row(speech)
                .background(rowCard(speech.importance))
        }
        .buttonStyle(SettingsRowPressStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(speech.speaker.name) \(speech.title)")
        .accessibilityAddTraits(.isButton)
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

    /// 指標一覧の行と同じ並び(1行目に日時、2行目に左端の顔・名前・題名、右に重要度と＞)。
    private func row(_ speech: SpeechDetailResponse) -> some View {
        let speaker = speech.speaker
        let isUpcoming = speech.status == .scheduled
        let colors = HomeView.importanceBadgeColors(speech.importance)
        return HStack(spacing: 5) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 6) {
                    Text(Self.dateString(speech.statementDatetime))
                    Text(Self.timeString(speech.statementDatetime))
                    if speech.status == .cancelled {
                        NotoText.text("中止", size: 6.5)
                    }
                }
                .font(.system(size: 7.5, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(isUpcoming ? SettingsCardStyle.subtitleColor : SettingsCardStyle.subtitleColor.opacity(0.6))
                HStack(spacing: 7) {
                    SpeakerAvatar(name: speaker.name, organization: speaker.organization, countryCode: speaker.countryCode, photoURL: speaker.photoURL, size: 17)
                    VStack(alignment: .leading, spacing: 1) {
                        // HQ指示(2026-10-14)「入りきらない場合は名前を姓だけにする」: フルネーム+肩書きが
                        // 1行に入ればそのまま、入らなければ姓+肩書き(それでも入らなければ少し縮める)。
                        ViewThatFits(in: .horizontal) {
                            NotoText.text("\(speaker.name)　\(speaker.title)", size: 9.5)
                                .lineLimit(1)
                                .fixedSize()
                            NotoText.text("\(Self.familyName(speaker.name))　\(speaker.title)", size: 9.5)
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                        }
                        .frame(height: 14, alignment: .leading)
                        .foregroundStyle(.white)
                        NotoText.text(speech.title, size: 7)
                            .lineLimit(1)
                            .foregroundStyle(SettingsCardStyle.subtitleColor)
                            .frame(height: 9, alignment: .leading)
                    }
                }
                .frame(height: 24)
            }
            Spacer(minLength: 4)
            NotoText.text(speech.importance.rawValue, size: 6.5)
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

    /// 姓。「ジェローム・パウエル」→「パウエル」。「・」の無い名前(「植田和男」)はそのまま。
    static func familyName(_ name: String) -> String {
        name.split(separator: "・").last.map(String.init) ?? name
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

    @MainActor private static func timeString(_ date: Date) -> String {
        // 表示設定の時刻の形式(24時間/12時間)とタイムゾーン(HQ指示 2026-10-15)。
        AppPreferences.shared.timeString(date)
    }

    @MainActor private static func dateString(_ date: Date) -> String {
        // 表示設定の日付の形式(年なし)とタイムゾーン(HQ指示 2026-10-15)。
        AppPreferences.shared.shortDateString(date)
    }
}
