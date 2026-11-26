import SwiftUI

/// Generic loading indicator. On Splash this is captioned to mean "app
/// initializing", never "data fetching" (ui-screens.md SCR-000 UI仕様) —
/// callers pass their own caption rather than this view assuming one.
struct LoadingView: View {
    var caption: String?

    var body: some View {
        VStack(spacing: DesignTokens.Spacing.sm) {
            ProgressView()
                .tint(DesignTokens.Colors.accentPrimary)
            if let caption {
                Text(caption)
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(DesignTokens.Spacing.xl)
    }
}

/// 読み込み中の表示。一定時間(既定8秒)たっても終わらないとき、サーバー起動待ちの説明を足す
/// (Render無料枠のコールドスタート対策)。View が消えると`.task`が取り消され、タイマーも止まる。
struct SlowLoadHintLoadingView: View {
    var caption: String = "読み込み中..."
    var hintDelaySeconds: UInt64 = 8
    @State private var showsHint = false

    var body: some View {
        VStack(spacing: DesignTokens.Spacing.sm) {
            LoadingView(caption: caption)
            if showsHint {
                Text("サーバーに接続しています。初回は1分ほどかかることがあります。")
                    .font(DesignTokens.Typography.caption)
                    .foregroundStyle(DesignTokens.Colors.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, DesignTokens.Spacing.xl)
            }
        }
        .task {
            try? await Task.sleep(nanoseconds: hintDelaySeconds * 1_000_000_000)
            if !Task.isCancelled {
                showsHint = true
            }
        }
    }
}
