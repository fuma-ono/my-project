import Combine
import Foundation

/// タブバーの「今選んでいるタブ」を再タップしたとき、そのタブの
/// NavigationStackをルートまで戻すための受け渡し(HQ指示 2026-10-24
/// 「全画面共通でタブ画面から他画面に遷移した場合にタブを押しても元に
/// 戻らない」)。`V5BottomBar`は画面を問わず同じ`tabSelection`に束縛されて
/// 各画面に埋め込まれているため、再タップ(`selected`の値が変わらない
/// タップ)はそのままでは`onChange(of: tabSelection)`等で検知できない。
/// `V5BottomBar`が再タップを検知した時点のタブindexをここに流し、各タブの
/// ルート画面(`MainTabView`・`CalendarTabView`・`SearchView`・
/// `SettingsView`)が自分の選択中のタブと一致するときだけpathを空に戻す
/// (`CalendarJump`と同じ、受け取ったら空に戻す使い捨ての値)。
@MainActor
final class TabBarReselection: ObservableObject {
    static let shared = TabBarReselection()
    @Published var tappedTab: Int?
}
