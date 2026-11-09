import Foundation
import os

/// HQ指示(2026-10-20)「初回起動時の読み込みが約30秒かかる原因調査」:
/// Renderのバックエンド側`[timing]`ログ(`duration_ms`は1〜2秒程度)だけでは
/// 実機で観測された約30秒を説明できないため、クライアント側(認証・
/// API通信)にも最小限の時間計測を追加する。リクエスト本文・トークン・
/// ユーザーIDは出力せず、ラベルと経過時間(ミリ秒)だけを記録する。
///
/// HQ指示(2026-10-20、2回目)「ログ出力先の修正」: `print()`はTestFlight
/// 配布のアプリを単体で実機起動した場合、統合ログ(Console.app)に乗らない
/// ため、`os.Logger`に置き換えた。ここで出す値(ラベル・経過時間)は秘匿
/// 情報を含まないため、デフォルトの`.private`(Console.appで`<private>`
/// に隠される)ではなく`.public`を明示している。
///
/// `[timing-ios]`で検索すればバックエンドの`[timing]`ログと区別できる。
/// 実機のConsole.app、またはXcodeのデバイスログで確認する。
enum ClientTiming {
    private static let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "FXEventAnalyzer", category: "timing")

    static func measure<T>(_ label: String, _ body: () async throws -> T) async rethrows -> T {
        let startedAt = ContinuousClock.now
        defer {
            let elapsedMs = (ContinuousClock.now - startedAt).milliseconds
            logger.log("[timing-ios] label=\(label, privacy: .public) duration_ms=\(elapsedMs, privacy: .public)")
        }
        return try await body()
    }

    /// `measure`で挟めない単発の計測ポイント(起動シーケンスの開始・
    /// 合計時間など)用。渡す`message`自体に秘匿情報を含めないこと。
    static func log(_ message: String) {
        logger.log("[timing-ios] \(message, privacy: .public)")
    }
}

extension Duration {
    /// 丸めたミリ秒(ログ用、`[timing]`の`duration_ms`と桁を揃える)。
    var milliseconds: Int64 {
        let (seconds, attoseconds) = (components.seconds, components.attoseconds)
        return seconds * 1000 + attoseconds / 1_000_000_000_000_000
    }
}
