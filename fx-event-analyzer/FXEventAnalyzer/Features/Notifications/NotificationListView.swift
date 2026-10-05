import SwiftUI

/// 通知一覧。ホームの通知ベルから開く(HQ指示 2026-10-05「通知はホーム画面の
/// 通知マークを押したらそこで確認できる仕様にして」)。端末に届いた
/// ローカル通知(`NotificationsStore`)を新しい順に並べ、タップで指標の
/// イベント詳細・要人発言詳細へ進む。開いた時点で既読にし、ベルの赤バッジを
/// 消す(この画面を開いている間は、開く前に未読だった行に印を残す)。
struct NotificationListView: View {
    let apiClient: APIClient
    @Binding var tabSelection: Int
    @ObservedObject private var store = NotificationsStore.shared
    @State private var unreadIDs: Set<String> = []
    @State private var now = Date()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let delivered = store.delivered(now: now)
        V5Viewport {
            V5Header(title: "通知", back: true, onBack: { dismiss() })
            if delivered.isEmpty {
                FXEmptyState(
                    icon: "bell.slash",
                    title: "通知はまだありません",
                    message: "通知設定の条件に合う経済指標・要人発言の発表前にお知らせします。"
                )
                .frame(width: V5P.W, height: V5P.H - 92, alignment: .center)
                .padding(.top, 53)
            } else {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 6) {
                        ForEach(delivered) { entry in
                            NavigationLink(value: Self.route(for: entry)) {
                                NotificationRow(entry: entry, isUnread: unreadIDs.contains(entry.id))
                            }
                            .buttonStyle(SettingsRowPressStyle())
                        }
                    }
                    .padding(.vertical, 4)
                    .frame(width: V5P.W)
                }
                .frame(width: V5P.W, height: 396)
                .position(x: V5P.W / 2, y: 54 + 396 / 2)
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

    static func route(for entry: NotificationEntry) -> AppRoute {
        switch entry.kind {
        case .indicator: return .eventDetail(id: entry.targetID)
        case .speech: return .speechDetail(id: entry.targetID)
        }
    }
}

private struct NotificationRow: View {
    let entry: NotificationEntry
    let isUnread: Bool

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.dateFormat = "M/d H:mm"
        return formatter
    }()

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: entry.kind == .speech ? "person.wave.2.fill" : "chart.bar.fill")
                .font(.system(size: 9.5, weight: .semibold))
                .foregroundStyle(V5P.cyan)
                .frame(width: 20, height: 20)
                .background(RoundedRectangle(cornerRadius: 5).fill(SettingsCardStyle.cardFill))
                .overlay(RoundedRectangle(cornerRadius: 5).stroke(SettingsCardStyle.cardBorder, lineWidth: 0.6))
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 4) {
                    V5JPFont.text(entry.kind == .speech ? "要人発言" : "経済指標", size: 6, weight: .bold)
                        .foregroundStyle(V5P.cyan)
                    Spacer(minLength: 0)
                    V5JPFont.text(Self.timeFormatter.string(from: entry.notifyAt), size: 6, weight: .regular)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                }
                V5JPFont.text(entry.title, size: 8.5, weight: .bold)
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                V5JPFont.text(entry.body, size: 6.5, weight: .regular)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Image(systemName: "chevron.right")
                .font(.system(size: 7.5, weight: .semibold))
                .foregroundStyle(SettingsCardStyle.chevronColor)
                .frame(height: 20)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 8)
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
