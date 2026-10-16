import SwiftUI

/// データを見せるカードの背景のグラデーション(HQ指示 2026-10-15「他の画面もグラデーションに」)。
/// 経済カレンダーのカードと同じ色: 左上が明るい青、右下に向かって暗くなる。
///
/// 使う画面(HQ確認済み): ホームの4枚のカード、指標一覧・要人発言一覧・検索結果・通知一覧のカード、
/// 指標詳細・イベント詳細・要人発言詳細・相場反応詳細・過去イベント比較のカードと表の外枠、
/// イベント詳細・要人発言詳細の「相場反応詳細」「過去イベント比較」のボタン。
/// 設定まわり・利用規約・ログインなどの入力画面・確認画面は平たい色のまま。
enum V5CardGradient {
    static let fill = LinearGradient(
        colors: [
            Color(red: 10.0 / 255, green: 70.0 / 255, blue: 145.0 / 255),
            Color(red: 2.0 / 255, green: 24.0 / 255, blue: 54.0 / 255),
            Color(red: 0, green: 8.0 / 255, blue: 22.0 / 255)
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )
}

/// `AccountCardBackground`(平たい色+枠線)のグラデーション版。
struct GradientCardBackground: View {
    var cornerRadius: CGFloat = SettingsCardStyle.cornerRadius
    var border: Color = SettingsCardStyle.cardBorder

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius)
            .fill(V5CardGradient.fill)
            .overlay(RoundedRectangle(cornerRadius: cornerRadius).stroke(border, lineWidth: 0.7))
    }
}
