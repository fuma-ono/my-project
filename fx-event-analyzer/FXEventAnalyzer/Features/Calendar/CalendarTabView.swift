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
    @ObservedObject private var preferences = AppPreferences.shared
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
            .task {
                await viewModel.applyPreferences(timeZone: preferences.timeZone, firstWeekday: preferences.calendar.firstWeekday)
                await viewModel.load()
            }
            // 表示設定で週の開始曜日・タイムゾーンを変えたら作り直す(HQ指示 2026-10-15)。
            .onChange(of: preferences.display) { _, _ in
                Task { await viewModel.applyPreferences(timeZone: preferences.timeZone, firstWeekday: preferences.calendar.firstWeekday) }
            }
            // 購入・解約でプランが変わったら、見られる範囲で取り直す。
            .onChange(of: plan.plan) { _, _ in Task { await viewModel.load() } }
            // ホームの日付リンクから来たら、その日を選んで一覧の先頭へ戻る(HQ指示 2026-10-15)。
            .onReceive(CalendarJump.shared.$requestedDate) { date in
                guard let date else { return }
                path = NavigationPath()
                viewModel.select(date)
                CalendarJump.shared.requestedDate = nil
            }
            // HQ指示(2026-10-24)「タブを押しても元に戻らない」: カレンダー
            // タブ(index 2)を再タップしたらpathを戻す。
            .onReceive(TabBarReselection.shared.$tappedTab) { tapped in
                guard tapped == 2 else { return }
                path = NavigationPath()
                TabBarReselection.shared.tappedTab = nil
            }
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
                // HQ指示(2026-10-13、2回目)「参考画像をピクセル単位で確認して」:
                // 凡例(HIGH/MEDIUM/LOW)はカレンダーの外枠の中に含めたため、
                // `CalendarMonthCard`側へ移した。
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
    private var columns: [GridItem] { Array(repeating: GridItem(.flexible(), spacing: 0), count: 7) }

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 4) {
                HStack(spacing: 0) {
                    monthButton(systemName: "chevron.left.2", label: "前の年", value: -12)
                    monthButton(systemName: "chevron.left", label: "前の月", value: -1)
                    Spacer()
                    // HQ指示(2026-10-13)「2026年10月の文字サイズを1大きくして」: 10.5→11.5。
                    NotoText.text(viewModel.monthTitle, size: 11.5).foregroundStyle(.white)
                    Spacer()
                    monthButton(systemName: "chevron.right", label: "次の月", value: 1)
                    monthButton(systemName: "chevron.right.2", label: "次の年", value: 12)
                }
                .padding(.horizontal, 2)
                .frame(height: 20)
                HStack(spacing: 0) {
                    ForEach(Array(viewModel.weekdaySymbols.enumerated()), id: \.offset) { index, symbol in
                        NotoText.text(symbol, size: 8.5)
                            .foregroundStyle(Self.weekdayColor(weekday: (viewModel.calendar.firstWeekday - 1 + index) % 7 + 1))
                            .frame(maxWidth: .infinity)
                    }
                }
                LazyVGrid(columns: columns, spacing: 0) {
                    ForEach(viewModel.gridDays, id: \.self) { day in
                        dayCell(day)
                    }
                }
                // HQ指示(2026-10-27)「カレンダー部分を横スワイプで次の月に
                // 移動することはできる?」→追加。`‹ ›`ボタンと同じ
                // `moveAvailability`判定(プラン範囲外ならプランの案内)を
                // 使い、グリッド全体への横ドラッグで前後の月に移る。
                // `minimumDistance`を24ptにして、日付セルの`Button`タップ
                // (`onTapGesture`相当)と誤反応しないようにしている。縦方向の
                // 移動(スクロールしようとした等)の方が大きい場合は無視する。
                .gesture(
                    DragGesture(minimumDistance: 24)
                        .onEnded { drag in
                            let horizontal = drag.translation.width
                            let vertical = drag.translation.height
                            guard abs(horizontal) > abs(vertical) else { return }
                            requestMoveMonth(by: horizontal < 0 ? 1 : -1)
                        }
                )
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 5)
            // HQ指示(2026-10-13、2回目)「凡例をカレンダーの外枠に入る形に
            // して」: 凡例をこのカードの外に出さず、区切り線の下に同じ
            // カードの中へ続けて置いた。
            Rectangle().fill(SettingsCardStyle.cardBorder).frame(height: 0.5)
            legend
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
        }
        .frame(width: 214)
        // HQ指示(2026-10-13、2回目)「カレンダー内の背景は塗りつぶしではなく
        // グラデーションです」: 参考画像をピクセルサンプリングすると、
        // カード左上(明るい青)→右下(ほぼ黒の紺)へ暗くなるグラデーションに
        // なっていた。`AccountCardBackground`(単色塗り)の代わりに同じ
        // 色味のグラデーションを敷いた。
        .background(Self.cardGradient)
        .clipShape(RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius))
        .overlay(RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius).stroke(SettingsCardStyle.cardBorder, lineWidth: 0.7))
    }

    /// カレンダーのカードの背景。アプリ共通の`V5CardGradient`(データを見せるカードの背景)と同じ。
    static let cardGradient = V5CardGradient.fill

    /// HQ指示(2026-10-13、2回目)「赤丸はHIGH　黄色はMEDIUM　青丸LOWの
    /// 表記にして」: カレンダーの点と同じ色(`HomeView.importanceBadgeColors`)
    /// を使い、ラベルはバッジの表記(HIGH/MEDIUM/LOW)に揃えた。
    private var legend: some View {
        HStack(spacing: 10) {
            legendItem(label: "HIGH", color: HomeView.importanceBadgeColors(.high).border)
            legendItem(label: "MEDIUM", color: HomeView.importanceBadgeColors(.medium).border)
            legendItem(label: "LOW", color: HomeView.importanceBadgeColors(.low).border)
        }
    }

    private func legendItem(label: String, color: Color) -> some View {
        HStack(spacing: 3) {
            Circle().fill(color).frame(width: 6, height: 6)
            NotoText.text(label, size: 7.5).foregroundStyle(.white)
        }
    }

    /// `‹ ›`(±1)・`« »`(±12)ボタンと横スワイプ(±1)が共通して使う、プラン
    /// 範囲を考慮した月移動。範囲外(プレミアムなら見られる)は案内を出し、
    /// 完全に範囲外なら何もしない。
    private func requestMoveMonth(by value: Int) {
        switch viewModel.moveAvailability(by: value) {
        case .allowed: Task { await viewModel.moveMonth(by: value) }
        case .needsPro: onNeedsPro()
        case .unavailable: break
        }
    }

    /// 範囲の端では薄くして押せなくする。無料プランの範囲の外(プレミアムなら
    /// 見られる)は押せるままにして、押したらプランの案内を出す。
    private func monthButton(systemName: String, label: String, value: Int) -> some View {
        let availability = viewModel.moveAvailability(by: value)
        return Button {
            requestMoveMonth(by: value)
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
            // HQ指示(2026-10-08): 日付はマスの中心に置き、重要度の点は日付のすぐ下に
            // 寄せる。選んだ日はマスいっぱいの角丸四角で囲む。今日は同じ大きさの
            // 角丸四角の枠。
            // HQ指示(2026-10-13、3回目)「13日の選択グローを参考画像をピクセル単位で
            // 再現して。丸ではなく四角(角は丸く)。色はもう少し青く」: 参考画像を
            // ピクセルサンプリングすると、選択マーカーは正円ではなく角丸四角(角丸
            // 比率は1辺の約1/4)で、塗りはシアンより青寄りの色(概ねV5P.blueに近い)
            // だった。円から角丸四角(cornerRadius 6、continuousカーブ)に変更し、
            // 色もV5P.cyanからV5P.blueへ、周囲にうっすら光彩(shadow)も追加した。
            // HQ指示(2026-10-13、4回目)「もう少し広げて。13日の枠いっぱいに」:
            // 固定サイズ(cellHeight-2の正方形)ではなく、マスの幅いっぱい・高さ
            // いっぱい(ごく薄い余白のみ)に広げた。
            ZStack {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(isSelected ? V5P.blue : .clear)
                    .shadow(color: isSelected ? V5P.blue.opacity(0.7) : .clear, radius: 4)
                    .overlay(
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .stroke(V5P.blue.opacity(isToday && !isSelected ? 0.8 : 0), lineWidth: 0.8)
                    )
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(1)
                Text("\(calendar.component(.day, from: day))")
                    .font(.system(size: 8.5, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(isSelected ? .white : Self.weekdayColor(weekday: calendar.component(.weekday, from: day)))
                HStack(spacing: 1.5) {
                    ForEach(Array(dots.enumerated()), id: \.offset) { _, importance in
                        // 選んだ日は水色の円と重なって見えにくいので、白くふちどる(HQ指示 2026-10-08)。
                        Circle().fill(HomeView.importanceBadgeColors(importance).border)
                            .overlay(Circle().stroke(Color.white, lineWidth: isSelected ? 0.6 : 0))
                            .frame(width: 3, height: 3)
                    }
                }
                .offset(y: 7.5)
            }
            .frame(maxWidth: .infinity)
            .frame(height: Self.cellHeight)
            .opacity(availability != .allowed ? 0.15 : inMonth ? 1 : 0.35)
            // HQ指示(2026-10-08)「カレンダーのように縦線と横線を交わるように」: 各マスの
            // 枠を間を空けずに並べ、隣どうしの線を重ねて1本の罫線にする。薄くした
            // マスでも線の濃さは変えない(`opacity`の後に付ける)。
            .overlay(Rectangle().stroke(SettingsCardStyle.cardBorder, lineWidth: 0.5))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(calendar.component(.month, from: day))月\(calendar.component(.day, from: day))日、イベント\(viewModel.items(on: day).count)件")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    /// マスの高さ。週の数が月によって4〜6週に変わるので、6週でも収まる高さにする。
    static let cellHeight: CGFloat = 25

    /// 曜日(1=日曜〜7=土曜)の色。土曜は青、日曜は赤。週の開始曜日が変わっても曜日で決める。
    static func weekdayColor(weekday: Int) -> Color {
        switch weekday {
        case 7: return Color(red: 120.0 / 255, green: 170.0 / 255, blue: 1.0)
        case 1: return Color(red: 1.0, green: 110.0 / 255, blue: 130.0 / 255)
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
        // HQ指示(2026-10-13、2回目)「各イベントカードが全然違います。
        // 一つで1枠あり角は丸いです」: 1つの連続リスト(区切り線)ではなく、
        // イベントごとに独立した角丸カードにし、カード間に隙間を空けた。
        // HQ指示(2026-10-13、3回目)「各イベントの枠をもう少し短くして
        // 4つのカードは1画面で表示できるようにして」: カード間の隙間を詰めた。
        VStack(spacing: 4) {
            if items.isEmpty {
                NotoText.text("この日のイベントはありません。", size: 8)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .frame(minHeight: 40)
                    .frame(width: 214)
                    .background(AccountCardBackground())
                    .clipShape(RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius))
            }
            ForEach(items) { item in
                NavigationLink(value: item.route) { row(item) }
                    .buttonStyle(SettingsRowPressStyle())
            }
        }
        .frame(width: 214)
    }

    private func row(_ item: CalendarItem) -> some View {
        let colors = HomeView.importanceBadgeColors(item.importance)
        // HQ指示(2026-10-13、2回目)「時刻は少し小さめで、その下に赤丸が
        // あります」「JPYは国旗の下に表示し」: 時刻+色の点、国旗+通貨コード
        // を、それぞれ横並びではなく縦に積む構成に作り直した。
        return HStack(spacing: 0) {
            Rectangle().fill(colors.border).frame(width: 3)
            // HQ指摘(2026-10-15)「非農業部門雇用者数（NFP）はなんでこんなに小さいの？もう少し大きくしても
            // 1行に入る」: 名前に使える幅が約86ptしかなく0.75倍まで縮んでいた。部品の間(6→4)・
            // 名前と重要度の間の最小(2→0)・重要度の幅(32→30)を詰めて、名前の幅を約14pt広げた。
            HStack(spacing: 4) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.hasTime ? AppPreferences.shared.timeString(item.datetime) : "未定")
                        .font(.system(size: 9, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .fixedSize()
                    Circle().fill(colors.border).frame(width: 5, height: 5)
                }
                .frame(width: 28, alignment: .leading)
                // HQ指示(2026-10-13、3回目)「枠をもう少し短くして」: 国旗を
                // 16→14に縮め、カード全体の高さを決めている縦積み部分を詰めた。
                VStack(spacing: 1) {
                    CountryFlagView(countryCode: item.countryCode, diameter: 14)
                    NotoText.text(item.currencyCode, size: 6.5).foregroundStyle(.white)
                }
                // HQ指示(2026-10-13、2回目)「見出しの指標名が途切れることなく
                // 表示させてください」: lineLimit(1)のまま、収まらない場合は
                // 省略(…)ではなく縮小で対応するようminimumScaleFactorを
                // 0.5まで広げた。
                // 表示名は全画面統一(HQ指示 2026-10-13)。
                // HQ承認(2026-10-22 Task 3): 日時がまだ公式に確定していない予定(FOMCの
                // 先の会合など、`is_provisional`)は、名前の下に小さく「予定（暫定）」と出す。
                VStack(alignment: .leading, spacing: 1) {
                    NotoText.text(item.kind == .indicator ? CountryFlag.indicatorDisplayText(item.title, countryCode: item.countryCode, displayName: item.displayName) : item.title, size: 9)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                    if item.isProvisional {
                        NotoText.text("予定（暫定）", size: 6)
                            .foregroundStyle(SettingsCardStyle.subtitleColor)
                            .lineLimit(1)
                    }
                    // HQ指示(2026-10-29)「指標の状態表示」: result_type/data_status
                    // から「結果待ち」「公表済み」を出す(NONEの指標に実際には無い
                    // 数値を表示しないため、値そのものはここでは出さない)。
                    if let statusLabel = item.resultStatusLabel() {
                        NotoText.text(statusLabel, size: 6)
                            .foregroundStyle(SettingsCardStyle.subtitleColor)
                            .lineLimit(1)
                    }
                }
                .padding(.leading, 2)
                Spacer(minLength: 0)
                NotoText.text(item.importance.rawValue, size: 6.5)
                    .tracking(-0.4)
                    .foregroundStyle(.white)
                    .frame(width: 30)
                    .padding(.vertical, 2.5)
                    .background(colors.fill, in: Capsule())
                    .overlay(Capsule().stroke(colors.border, lineWidth: 0.6))
                Image(systemName: "chevron.right")
                    .font(.system(size: 7.5, weight: .semibold))
                    .foregroundStyle(SettingsCardStyle.chevronColor)
            }
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
        }
        .frame(width: 214)
        // HQ指示(2026-10-15)「カレンダーのグラデーションの背景を下のイベントの枠も同じに」:
        // カレンダーのカードと同じ`cardGradient`と枠線にした。
        .background(CalendarMonthCard.cardGradient)
        .clipShape(RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius))
        .overlay(RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius).stroke(SettingsCardStyle.cardBorder, lineWidth: 0.7))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}
