import SwiftUI

/// ui-screens.md §5.0's iPad rule ("画面が大きいことを理由に…過度に巨大化
/// させない") generalized to the detail screens: caps reading width so
/// cards don't stretch edge-to-edge on iPad, while staying a no-op on
/// iPhone (whose width is always under the cap).
struct AdaptiveContentWidth: ViewModifier {
    func body(content: Content) -> some View {
        content
            .frame(maxWidth: 700)
            .frame(maxWidth: .infinity)
    }
}

extension View {
    func adaptiveContentWidth() -> some View {
        modifier(AdaptiveContentWidth())
    }
}
