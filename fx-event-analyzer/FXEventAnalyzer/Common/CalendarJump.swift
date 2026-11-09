import Combine
import Foundation

/// ホームの「今日の重要イベント」の日付リンクから、カレンダーのタブを開いてその日を選ぶための受け渡し。
/// ホームが日付を入れてタブを切り替え、`CalendarTabView`が受け取ったらその日を選んで空に戻す。
@MainActor
final class CalendarJump: ObservableObject {
    static let shared = CalendarJump()
    @Published var requestedDate: Date?
}
