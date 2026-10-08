import SwiftUI

/// SCR-010 経済カレンダー(タブ3番目のルート)。HQ指示(2026-10-08)の参考画像
/// どおり、上に月のカレンダー(月曜始まり、日付の下に重要度の点)、下に選んだ
/// 日の経済指標・要人発言の一覧(時刻・国旗・通貨・名前・重要度)を並べる。
/// 行をタップすると指標はSCR-007 イベント詳細、発言は要人発言詳細へ移る。
///
/// SCR-005 指標一覧(指標そのものを探す画面)とは役割が違い、「いつ何が
/// 発表されるか」を日付から確認する画面(HQ指示の区別に従う)。
struct CalendarTabView: View {
    let apiClient: APIClient
    @Binding var tabSelection: Int
    @State private var path = NavigationPath()
    @StateObject private var viewModel: CalendarViewModel
    @ObservedObject private var plan = PlanStore.shared
    @State private var planPrompt: String?

    init(apiClient: APIClient, tabSelection: Binding<Int>) {
        self.apiClient = apiClient
        _tabSelection = tabSelection
        _viewModel = StateObject(wrappedValue: CalendarViewModel(apiClient: apiClient))
    }

    var body: some View {
        NavigationStack(path: $path) {
            V5Viewport {
                // 他のタブルートと同じ「メインタブ扱い」のヘッダー(戻るボタンなし)。
                V5Header(title: "経済カレンダー", back: false)
                content
                V5BottomBar(selected: $tabSelection)
            }
            .toolbar(.hidden, for: .navigationBar)
            .task { await viewModel.load() }
            // 購入・解約でプランが変わったら、見られる範囲で取り直す。
            .onChange(of: plan.plan) { _, _ in Task { await viewModel.load() } }
            .planLimitPrompt($planPrompt, apiClient: apiClient, tabSelection: $tabSelection)
            .navigationDestination(for: AppRoute.self) { route in
                AppRouteDestinationView(route: route, apiClient: apiClient, tabSelection: $tabSelection)
            }
        }
    }

    @ViewBuilder private var content: some View {
        switch viewModel.loadState {
        case .loading:
            centered { LoadingView(caption: "読み込み中...") }
        case .backendNotConfigured:
            centered { FXEmptyState(icon: "server.rack", title: "Backendは準備中です", message: "カレンダーはまだ利用できません。") }
        case .error(let message):
            centered { ErrorView(title: "読み込みに失敗しました", message: message, onRetry: { Task { await viewModel.load() } }) }
        case .loaded:
            VStack(alignment: .leading, spacing: 8) {
                CalendarMonthCard(viewModel: viewModel) { planPrompt = CalendarViewModel.needsProMessage }
                NotoText.text(viewModel.selectedTitle, size: 10)
                    .foregroundStyle(SettingsListLayout.sectionTitleColor)
                    .padding(.horizontal, 4)
                ScrollView(showsIndicators: false) {
                    CalendarDayList(items: viewModel.selectedItems)
                        .padding(.bottom, 6)
                }
            }
            .frame(width: 214)
            .padding(.top, 6)
            .frame(width: V5P.W, height: 398, alignment: .top)
            .position(x: V5P.W / 2, y: 54 + 398 / 2)
        }
    }

    private func centered(@ViewBuilder _ content: () -> some View) -> some View {
        content()
            .frame(width: V5P.W, height: V5P.H - 92, alignment: .center)
            .padding(.top, 53)
    }
}

// MARK: - 月のカレンダー

/// 「« ‹ 2026年10月 › »」、曜日、6週分の日付。«»は1年、‹›は1か月移動する
/// (HQ指示 2026-10-08)。日付は参考画像どおり1日ずつ細い枠で区切る。選んだ日は
/// 水色の丸、今日は水色の枠。
private struct CalendarMonthCard: View {
    @ObservedObject var viewModel: CalendarViewModel
    /// 無料プランの範囲の外を押したとき。
    let onNeedsPro: () -> Void
    // 保存プロパティを`private`にすると自動の`init(viewModel:)`も`private`になり、
    // 外から作れなくなるので計算プロパティにしている。
    private var columns: [GridItem] { Array(repeating: GridItem(.flexible(), spacing: 2), count: 7) }

    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 0) {
                monthButton(systemName: "chevron.left.2", label: "前の年", value: -12)
                monthButton(systemName: "chevron.left", label: "前の月", value: -1)
                Spacer()
                NotoText.text(viewModel.monthTitle, size: 10.5).foregroundStyle(.white)
                Spacer()
                monthButton(systemName: "chevron.right", label: "次の月", value: 1)
                monthButton(systemName: "chevron.right.2", label: "次の年", value: 12)
            }
            .padding(.horizontal, 2)
            .frame(height: 20)
            HStack(spacing: 0) {
                ForEach(Array(viewModel.weekdaySymbols.enumerated()), id: \.offset) { index, symbol in
                    NotoText.text(symbol, size: 7)
                        .foregroundStyle(Self.weekdayColor(column: index))
                        .frame(maxWidth: .infinity)
                }
            }
            LazyVGrid(columns: columns, spacing: 2) {
                ForEach(viewModel.gridDays, id: \.self) { day in
                    dayCell(day)
                }
            }
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 5)
        .frame(width: 214)
        .background(AccountCardBackground())
    }

    /// 範囲の端では薄くして押せなくする。無料プランの範囲の外(プレミアムなら
    /// 見られる)は押せるままにして、押したらプランの案内を出す。
    private func monthButton(systemName: String, label: String, value: Int) -> some View {
        let availability = viewModel.moveAvailability(by: value)
        return Button {
            switch availability {
            case .allowed: Task { await viewModel.moveMonth(by: value) }
            case .needsPro: onNeedsPro()
            case .unavailable: break
            }
        } label: {
            Image(systemName: systemName)
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(V5P.cyan)
                .frame(width: 24, height: 20)
                .contentShape(Rectangle())
                .opacity(availability == .allowed ? 1 : 0.3)
        }
        .buttonStyle(.plain)
        .disabled(availability == .unavailable)
        .accessibilityLabel(label)
    }

    private func dayCell(_ day: Date) -> some View {
        let calendar = viewModel.calendar
        let isSelected = calendar.isDate(day, inSameDayAs: viewModel.selectedDate)
        let isToday = calendar.isDateInToday(day)
        let inMonth = viewModel.isInMonth(day)
        let column = (calendar.component(.weekday, from: day) - calendar.firstWeekday + 7) % 7
        let dots = viewModel.dots(on: day)
        let availability = viewModel.availability(of: day)
        return Button {
            switch availability {
            case .allowed: viewModel.select(day)
            case .needsPro: onNeedsPro()
            case .unavailable: break
            }
        } label: {
            VStack(spacing: 2) {
                Text("\(calendar.component(.day, from: day))")
                    .font(.system(size: 8.5, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(isSelected ? .white : Self.weekdayColor(column: column))
                    .frame(width: 17, height: 17)
                    .background(Circle().fill(isSelected ? V5P.cyan.opacity(0.85) : .clear))
                    .overlay(Circle().stroke(V5P.cyan.opacity(isToday && !isSelected ? 0.8 : 0), lineWidth: 0.8))
                HStack(spacing: 1.5) {
                    ForEach(Array(dots.enumerated()), id: \.offset) { _, importance in
                        Circle().fill(HomeView.importanceBadgeColors(importance).border).frame(width: 3, height: 3)
                    }
                }
                .frame(height: 3)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 23)
            .background(
                RoundedRectangle(cornerRadius: 3)
                    .fill(Color.white.opacity(0.03))
                    .overlay(RoundedRectangle(cornerRadius: 3).stroke(SettingsCardStyle.cardBorder, lineWidth: 0.5))
            )
            .opacity(availability != .allowed ? 0.15 : inMonth ? 1 : 0.35)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(calendar.component(.month, from: day))月\(calendar.component(.day, from: day))日、イベント\(viewModel.items(on: day).count)件")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    /// 月曜始まりの列番号(0〜6)。土曜は青、日曜は赤。
    static func weekdayColor(column: Int) -> Color {
        switch column {
        case 5: return Color(red: 120.0 / 255, green: 170.0 / 255, blue: 1.0)
        case 6: return Color(red: 1.0, green: 110.0 / 255, blue: 130.0 / 255)
        default: return .white
        }
    }
}

// MARK: - 選んだ日の一覧

private struct CalendarDayList: View {
    let items: [CalendarItem]

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        formatter.timeZone = .current
        return formatter
    }()

    var body: some View {
        VStack(spacing: 0) {
            if items.isEmpty {
                NotoText.text("この日のイベントはありません。", size: 8)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .frame(maxWidth: .infinity, minHeight: 40)
            }
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                if index > 0 { SettingsListSeparator() }
                NavigationLink(value: item.route) { row(item) }
                    .buttonStyle(SettingsRowPressStyle())
            }
        }
        .frame(width: 214)
        .background(AccountCardBackground())
    }

    private func row(_ item: CalendarItem) -> some View {
        HStack(spacing: 6) {
            Text(item.hasTime ? Self.timeFormatter.string(from: item.datetime) : "未定")
                .font(.system(size: 8.5, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(.white)
                // 幅26では「08:5／0」と折り返していたので、1行に固定して幅を広げた。
                .lineLimit(1)
                .fixedSize()
                .frame(width: 28, alignment: .leading)
            CountryFlagView(countryCode: item.countryCode, diameter: 14)
            NotoText.text(item.currencyCode, size: 7)
                .foregroundStyle(.white)
                .frame(width: 20, alignment: .leading)
            // 指標名はホームと同じくカッコの前まで(正式名は詳細画面)。
            NotoText.text(item.kind == .indicator ? HomeView.shortIndicatorName(item.title) : item.title, size: 8)
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            Spacer(minLength: 4)
            let colors = HomeView.importanceBadgeColors(item.importance)
            NotoText.text(item.importance.rawValue, size: 6.5)
                .tracking(-0.4)
                .foregroundStyle(.white)
                .frame(width: 34)
                .padding(.vertical, 2.5)
                .background(colors.fill, in: Capsule())
                .overlay(Capsule().stroke(colors.border, lineWidth: 0.6))
        }
        .padding(.horizontal, 9)
        .frame(height: 28)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}
