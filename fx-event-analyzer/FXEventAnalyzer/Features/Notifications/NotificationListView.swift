import SwiftUI

/// 通知一覧。ホームの通知ベルから開く(HQ指示 2026-10-05「通知はホーム画面の
/// 通知マークを押したらそこで確認できる仕様にして」)。端末に届いた
/// ローカル通知(`NotificationsStore`)を新しい順に並べ、タップで指標の
/// イベント詳細・要人発言詳細・通知設定へ進む。開いた時点で既読にし、ベルの
/// 赤バッジを消す(この画面を開いている間は、開く前に未読だった行に印を残す)。
///
/// HQ指示(2026-10-06)の参考画像に合わせ、上部に種類の絞り込み、各行に種類の
/// バッジ・発表時刻(日本時間)・受信日時を出す。
struct NotificationListView: View {
    let apiClient: APIClient
    @Binding var tabSelection: Int
    @ObservedObject private var store = NotificationsStore.shared
    @State private var unreadIDs: Set<String> = []
    @State private var now = Date()
    /// `nil`は「すべて」。
    @State private var filter: NotificationEntry.Kind?
    @Environment(\.dismiss) private var dismiss

    private static let listTop: CGFloat = 80

    var body: some View {
        let delivered = store.delivered(now: now).filter { filter == nil || $0.kind == filter }
        V5Viewport {
            V5Header(title: "通知", back: true, onBack: { dismiss() })
            filterBar
                .position(x: V5P.W / 2, y: 67)
            if delivered.isEmpty {
                FXEmptyState(
                    icon: "bell.slash",
                    title: "通知はまだありません",
                    message: "通知設定の条件に合う経済指標・要人発言の発表前にお知らせします。"
                )
                .frame(width: V5P.W, height: 452 - Self.listTop, alignment: .center)
                .position(x: V5P.W / 2, y: (Self.listTop + 452) / 2)
            } else {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 4) {
                        ForEach(delivered) { entry in
                            NavigationLink(value: Self.route(for: entry)) {
                                NotificationRow(entry: entry, isUnread: unreadIDs.contains(entry.id))
                            }
                            .buttonStyle(SettingsRowPressStyle())
                        }
                    }
                    .padding(.bottom, 4)
                    .frame(width: V5P.W)
                }
                .frame(width: V5P.W, height: 452 - Self.listTop)
                .position(x: V5P.W / 2, y: (Self.listTop + 452) / 2)
            }
            V5BottomBar(selected: $tabSelection)
        }
        .toolbar(.hidden, for: .navigationBar)
        .onAppear {
            now = Date()
            unreadIDs = Set(store.delivered(now: now).filter { store.isUnread($0) }.map(\.id))
            store.markAllRead(now: now)
        }
        .task {
            // 開いている間に一覧を取り直す(新しく届いた分も並べる)。
            await LocalNotificationScheduler(apiClient: apiClient).refresh()
            now = Date()
            store.markAllRead(now: now)
        }
    }

    private var filterBar: some View {
        HStack(spacing: 4) {
            filterChip(label: "すべて", kind: nil)
            ForEach(NotificationEntry.Kind.allCases, id: \.self) { kind in
                filterChip(label: kind.label, kind: kind)
            }
        }
        .frame(width: 214)
    }

    private func filterChip(label: String, kind: NotificationEntry.Kind?) -> some View {
        let isSelected = filter == kind
        return Button { filter = kind } label: {
            V5JPFont.text(label, size: 7, weight: isSelected ? .bold : .medium)
                .foregroundStyle(isSelected ? .white : SettingsCardStyle.subtitleColor)
                .frame(maxWidth: .infinity)
                .frame(height: 16)
                .background(
                    Capsule().fill(isSelected ? V5P.blue : SettingsCardStyle.cardFill)
                )
                .overlay(
                    Capsule().stroke(isSelected ? V5P.blue : SettingsCardStyle.cardBorder, lineWidth: 0.6)
                )
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    static func route(for entry: NotificationEntry) -> AppRoute {
        switch entry.kind {
        case .indicator: return .eventDetail(id: entry.targetID)
        case .speech: return .speechDetail(id: entry.targetID)
        case .system: return .notificationSettings
        }
    }
}

private struct NotificationRow: View {
    let entry: NotificationEntry
    let isUnread: Bool

    private static let receivedFormatter = formatter("MM/dd HH:mm")
    /// 参考画像の「発表時刻：21:30（日本時間）」。端末の地域によらず日本時間。
    private static let japanTimeFormatter = formatter("H:mm", timeZone: TimeZone(identifier: "Asia/Tokyo"))

    private static func formatter(_ format: String, timeZone: TimeZone? = nil) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        if let timeZone { formatter.timeZone = timeZone }
        formatter.dateFormat = format
        return formatter
    }

    /// 参考画像の「米) CPI」の国の略記。
    private static let countryPrefixes: [String: String] = [
        "US": "米", "JP": "日", "EU": "ユーロ圏", "EA": "ユーロ圏", "GB": "英", "UK": "英",
        "AU": "豪", "NZ": "NZ", "CA": "加", "CH": "スイス", "CN": "中", "DE": "独",
    ]

    private var icon: String {
        switch entry.kind {
        case .indicator: return "calendar"
        case .speech: return "person.fill"
        case .system: return "bell.fill"
        }
    }

    private var badgeColor: Color {
        switch entry.kind {
        case .indicator: return V5P.blue
        case .speech: return Color(red: 0.42, green: 0.30, blue: 0.92)
        case .system: return Color(red: 0.05, green: 0.58, blue: 0.42)
        }
    }

    private var headline: String {
        switch entry.kind {
        case .indicator:
            let name = entry.subject ?? entry.title
            guard let code = entry.countryCode, let prefix = Self.countryPrefixes[code] else { return name }
            return "\(prefix)) \(name)"
        case .speech:
            return entry.speakerName.map { "\($0) 発言" } ?? entry.title
        case .system:
            return entry.title
        }
    }

    /// 2行に収まらないときだけ使う短い表示名(詳細画面は正式名称のまま)。
    private var shortHeadline: String {
        entry.kind == .indicator ? IndicatorShortName.shorten(headline) : headline
    }

    private var importance: String { NotificationImportance.label(entry.importance) }

    /// 発表の何分前に届いたか(「発表の5分前です」)。
    private var timing: String {
        let noun = entry.kind == .speech ? "発言" : "発表"
        let minutes = Int((entry.scheduledAt.timeIntervalSince(entry.notifyAt) / 60).rounded())
        return minutes <= 0 ? "まもなく\(noun)です" : "\(noun)の\(minutes)分前です"
    }

    private var lines: [String] {
        let time = Self.japanTimeFormatter.string(from: entry.scheduledAt)
        switch entry.kind {
        case .indicator:
            return ["発表時刻：\(time)（日本時間）", "\(timing)（重要度 \(importance)）"]
        case .speech:
            return ["「\(entry.subject ?? entry.title)」", "発言時刻：\(time)（日本時間）"]
        case .system:
            return [entry.body]
        }
    }

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(V5P.cyan)
                .frame(width: 24, height: 24)
                .background(RoundedRectangle(cornerRadius: 6).fill(SettingsCardStyle.cardFill))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(SettingsCardStyle.cardBorder, lineWidth: 0.6))
            VStack(alignment: .leading, spacing: 1.5) {
                HStack(spacing: 4) {
                    V5JPFont.text(entry.kind.label, size: 5.5, weight: .bold)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1.5)
                        .background(Capsule().fill(badgeColor))
                    Spacer(minLength: 0)
                    V5JPFont.text(Self.receivedFormatter.string(from: entry.notifyAt), size: 7, weight: .regular)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                }
                NotificationHeadline(full: headline, short: shortHeadline)
                ForEach(lines, id: \.self) { line in
                    V5JPFont.text(line, size: 6.5, weight: .regular)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                        .lineLimit(1)
                }
            }
            Image(systemName: "chevron.right")
                .font(.system(size: 7.5, weight: .semibold))
                .foregroundStyle(SettingsCardStyle.chevronColor)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 5)
        .frame(width: 214, alignment: .leading)
        .background(AccountCardBackground())
        .overlay(alignment: .topLeading) {
            if isUnread {
                Circle().fill(V5P.red).frame(width: 5, height: 5).offset(x: 4, y: 4)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint(isUnread ? "未読" : "")
    }
}

/// 指標名などの見出し。HQ指示(2026-10-06)「最大2行・省略しない。2行でも
/// 収まらない極端に長い名称だけ短い表示名に変換。…で途中を切るのは原則なし」。
private struct NotificationHeadline: View {
    let full: String
    let short: String

    private static let size: CGFloat = 8.5
    /// 2行分の高さ(Noto Sans JPの行の高さは文字の約1.45倍)。
    private static let twoLines: CGFloat = 26

    var body: some View {
        ViewThatFits(in: .vertical) {
            line(full)
            if short != full { line(short) }
            // 短い表示名でも収まらない場合だけ、少し縮めて2行に収める。
            line(short).lineLimit(2).minimumScaleFactor(0.8)
        }
        .frame(maxHeight: Self.twoLines, alignment: .topLeading)
    }

    private func line(_ text: String) -> some View {
        V5JPFont.text(text, size: Self.size, weight: .bold)
            .foregroundStyle(.white)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// 長い指標の正式名称を、一般的な略称に置き換える。
enum IndicatorShortName {
    private static let replacements: [(String, String)] = [
        ("Consumer Price Index", "CPI"),
        ("Producer Price Index", "PPI"),
        ("Gross Domestic Product", "GDP"),
        ("Purchasing Managers' Index", "PMI"),
        ("Purchasing Managers Index", "PMI"),
        ("Personal Consumption Expenditures", "PCE"),
        ("Nonfarm Payrolls", "NFP"),
        ("Non-Farm Payrolls", "NFP"),
        ("Federal Open Market Committee", "FOMC"),
        ("Interest Rate Decision", "Rate Decision"),
        ("Year over Year", "YoY"),
        ("Month over Month", "MoM"),
        ("消費者物価指数", "CPI"),
        ("生産者物価指数", "PPI"),
        ("国内総生産", "GDP"),
        ("購買担当者景気指数", "PMI"),
        ("個人消費支出", "PCE"),
        ("非農業部門雇用者数", "雇用統計"),
        ("政策金利発表", "政策金利"),
    ]

    static func shorten(_ name: String) -> String {
        replacements.reduce(name) { result, pair in
            result.replacingOccurrences(of: pair.0, with: pair.1, options: .caseInsensitive)
        }
    }
}
