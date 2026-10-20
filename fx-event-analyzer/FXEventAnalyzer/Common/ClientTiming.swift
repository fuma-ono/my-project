import Foundation

/// HQ指示(2026-10-20)「初回起動時の読み込みが約30秒かかる原因調査」:
/// Renderのバックエンド側`[timing]`ログ(`duration_ms`は1〜2秒程度)だけでは
/// 実機で観測された約30秒を説明できないため、クライアント側(認証・
/// API通信)にも最小限の時間計測を追加する。リクエスト本文・トークン・
/// ユーザーIDは出力せず、ラベルと経過時間(ミリ秒)だけを記録する。
///
/// `[timing-ios]`で検索すればバックエンドの`[timing]`ログと区別できる。
/// 実機のConsole.app、またはXcodeのデバイスログで確認する。
enum ClientTiming {
    static func measure<T>(_ label: String, _ body: () async throws -> T) async rethrows -> T {
        let startedAt = ContinuousClock.now
        defer {
            let elapsedMs = (ContinuousClock.now - startedAt).milliseconds
            print("[timing-ios] label=\(label) duration_ms=\(elapsedMs)")
        }
        return try await body()
    }
}

extension Duration {
    /// 丸めたミリ秒(ログ用、`[timing]`の`duration_ms`と桁を揃える)。
    var milliseconds: Int64 {
        let (seconds, attoseconds) = (components.seconds, components.attoseconds)
        return seconds * 1000 + attoseconds / 1_000_000_000_000_000
    }
}
