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

    /// `text(_:size:)`と同じNotoSansJP-SemiBoldだが、`fixedSize:`(Dynamic
    /// Type非対応の固定サイズ)ではなく通常のスケーラブルな`size:`で
    /// `Font.custom`を作る。HQ指摘(2026-10-29)「通貨ペアが全体的に左側に
    /// 行ってて見切れてる」の根本原因調査で判明した制限への対応: `fixedSize:`
    /// を使う`Text`は`.frame(width:)`による幅の制約自体を無視し、
    /// `.minimumScaleFactor`も効かないまま常に文字列の自然な幅で描画されて
    /// しまう(`HomeView.pairRow`の通貨ペア名で実機キャプチャのpx比較により
    /// 確認済み — 幅指定を`minWidth`→`width`に変えても1pxも変化しなかった)。
    /// `.frame(width:)` + `.minimumScaleFactor`で幅を制約する必要がある
    /// 箇所ではこちらを使う。
    static func scalableText(_ string: String, size: CGFloat) -> Text {
        Text(verbatim: string).font(.custom(postScriptName, size: size * scale))
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
