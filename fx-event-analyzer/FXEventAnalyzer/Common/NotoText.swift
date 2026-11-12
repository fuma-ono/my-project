import SwiftUI

/// 数字・英字も含めて全体をNoto Sans JPで組んだ文字。`V5JPFont.text`は
/// 日本語だけをNotoにし、数字はシステムのフォントになるため、「14:12」
/// 「23:00」のような数字が日本語より小さく浮いて見える(HQ指示 2026-10-06
/// 「大きさフォントを揃えて」)。時刻など、数字と日本語が並ぶ行に使う。
enum NotoText {
    private static let postScriptName = "NotoSansJP-SemiBold"

    /// 表示設定の文字サイズ(小・標準・大)の倍率(HQ指示 2026-10-15「文字サイズの仕組みを作成」)。
    /// `AppPreferences`が設定を受け取ったときに入れる。端末の文字サイズ設定には連動させない
    /// (V5の画面は固定キャンバスで、端末側で大きくすると枠からはみ出すため)。
    static var scale: CGFloat = 1

    static func text(_ string: String, size: CGFloat) -> Text {
        Text(verbatim: string).font(.custom(postScriptName, fixedSize: size * scale))
    }

    /// 表示設定の`text_size`(SMALL / STANDARD / LARGE)→ 倍率。
    static func scale(forTextSize textSize: String) -> CGFloat {
        switch textSize {
        case "SMALL": return 0.92
        case "LARGE": return 1.1
        default: return 1
        }
    }
}
