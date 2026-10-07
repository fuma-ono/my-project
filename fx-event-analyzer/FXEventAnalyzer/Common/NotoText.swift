import SwiftUI

/// 数字・英字も含めて全体をNoto Sans JPで組んだ文字。`V5JPFont.text`は
/// 日本語だけをNotoにし、数字はシステムのフォントになるため、「14:12」
/// 「23:00」のような数字が日本語より小さく浮いて見える(HQ指示 2026-10-06
/// 「大きさフォントを揃えて」)。時刻など、数字と日本語が並ぶ行に使う。
enum NotoText {
    private static let postScriptName = "NotoSansJP-SemiBold"

    static func text(_ string: String, size: CGFloat) -> Text {
        // 端末・アプリの文字サイズ設定で大きくならないよう固定の大きさにする
        // (V5の画面は固定キャンバスで、拡大すると枠からはみ出すため)。
        Text(verbatim: string).font(.custom(postScriptName, fixedSize: size))
    }
}
