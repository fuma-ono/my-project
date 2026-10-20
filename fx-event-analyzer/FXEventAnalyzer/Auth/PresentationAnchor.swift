import UIKit

/// Shared by `AppleSignInCoordinator`/`GoogleSignInCoordinator` — both SDKs
/// need an explicit window/view controller to present their sign-in sheet
/// from, and SwiftUI's `App` lifecycle has no `UIApplicationDelegate` to
/// ask directly, so this walks `UIApplication.shared.connectedScenes`
/// instead.
@MainActor
enum PresentationAnchor {
    static func keyWindow() -> UIWindow? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }
    }
}
