import SwiftUI

/// 指標一覧・要人発言一覧の並び順(HQ指示 2026-10-14「重要度順をつけて」)。
enum ListSortOrder: String, CaseIterable, Identifiable {
    /// 日付順(指標一覧は次回発表の近い順、要人発言一覧は見出しごとの近い順・新しい順)。
    case date
    /// 重要度の高い順(同じ重要度の中は日付順)。
    case importance

    var id: String { rawValue }

    var title: String {
        switch self {
        case .date: return "日付順"
        case .importance: return "重要度順"
        }
    }

    /// 日付順に並んだ一覧を、重要度順のときだけ HIGH → MEDIUM → LOW に並べ直す(同じ重要度の中は元の順)。
    func apply<T>(_ items: [T], importance: (T) -> Importance) -> [T] {
        guard self == .importance else { return items }
        return items.enumerated()
            .sorted { (importance($0.element).sortRank, $0.offset) < (importance($1.element).sortRank, $1.offset) }
            .map(\.element)
    }
}

extension Importance {
    /// 重要度順で並べるときの順番(HIGHが先)。
    var sortRank: Int {
        switch self {
        case .high: return 0
        case .medium: return 1
        case .low: return 2
        }
    }
}

/// 一覧の上の「N件」と並び順の切り替え(検索結果の「検索結果 N件 / 関連度順」と同じ見た目)。
struct ListSortBar: View {
    let countText: String
    @Binding var order: ListSortOrder

    var body: some View {
        HStack {
            NotoText.text(countText, size: 8)
                .foregroundStyle(SettingsCardStyle.subtitleColor)
            Spacer()
            Menu {
                ForEach(ListSortOrder.allCases) { option in
                    Button(option.title) { order = option }
                }
            } label: {
                HStack(spacing: 2) {
                    NotoText.text(order.title, size: 8)
                    Image(systemName: "chevron.down").font(.system(size: 6, weight: .bold))
                }
                .foregroundStyle(SettingsCardStyle.subtitleColor)
            }
            .accessibilityLabel("並び順 \(order.title)")
        }
        .padding(.horizontal, 2)
        .frame(height: 12)
    }
}
