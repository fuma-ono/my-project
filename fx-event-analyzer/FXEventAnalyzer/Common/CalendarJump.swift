import Combine
import Foundation

/// ホームの「今週の重要イベント」の「すべて見る」リンク(HQ判断2026-11-04
/// 以前は「今日の重要イベント」の日付リンクだった)から、カレンダーのタブを
/// 開いて今日を選ぶための受け渡し。
/// ホームが日付を入れてタブを切り替え、`CalendarTabView`が受け取ったらその日を選んで空に戻す。
@MainActor
final class CalendarJump: ObservableObject {
    static let shared = CalendarJump()
    @Published var requestedDate: Date?
}
