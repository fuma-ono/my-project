import SwiftUI

/// SCR-014 設定と、同じ見た目の参考画像で作るSCR-015 アカウント情報が共有する、
/// 角丸カード・区切り線・文字色(V5座標系)。値は参考画像v2
/// (`settings-screen-reference-v2.png`)の実測値で、アカウント情報の参考画像
/// (`account-screen-reference-v1.png`)も同じ色であることを実測で確認した。
enum SettingsCardStyle {
    static let cornerRadius: CGFloat = 7.5
    static let cardFill = Color(red: 0 / 255, green: 34 / 255, blue: 69 / 255) // #002245
    static let cardBorder = Color(red: 11 / 255, green: 76 / 255, blue: 142 / 255) // #0B4C8E
    static let separator = Color(red: 0 / 255, green: 67 / 255, blue: 129 / 255) // #004381
    static let chevronColor = Color(red: 170 / 255, green: 198 / 255, blue: 245 / 255) // #AAC6F5
    /// 行の補足文字(メールアドレス・生年月日の値など)の色。
    static let subtitleColor = Color(red: 176 / 255, green: 196 / 255, blue: 228 / 255) // #B0C4E4

    /// 塗り＋縁取りの角丸カード。
    static func card(width: CGFloat, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: cornerRadius)
            .fill(cardFill)
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius)
                    .stroke(cardBorder, lineWidth: 0.7)
                    .shadow(color: cardBorder.opacity(0.5), radius: 1.5)
            )
            .frame(width: width, height: height)
    }
}

/// 設定系の行を押している間だけ、参考画像v2の「ホーム通貨ペア編集」行と同じ
/// シアンの枠・明るい塗りで光らせる。HQ指示(2026-10-05): 参考画像の強調は
/// 選択時の表現と判断し、常時表示の強調をやめてタップ中の演出にした。
struct SettingsRowPressStyle: ButtonStyle {
    private static let border = Color(red: 0 / 255, green: 201 / 255, blue: 234 / 255) // #00C9EA
    private static let fill = Color(red: 0 / 255, green: 48 / 255, blue: 90 / 255) // #00305A

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background {
                if configuration.isPressed {
                    RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius)
                        .fill(Self.fill)
                        .overlay(
                            RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius)
                                .stroke(Self.border, lineWidth: 0.9)
                                .shadow(color: Self.border.opacity(0.8), radius: 2.5)
                        )
                }
            }
    }
}
