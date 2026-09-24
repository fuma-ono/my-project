import SwiftUI

/// SCR-010 Login (ui-screens.md).
///
/// HQ "V5 Pixel Frontend" integration (2026-09-24): visual content is HQ's
/// `V5PixelFrontend.swift` `V5Login` (icon, wordmark, fixed-size field
/// panel), reproduced as given. Adaptations, all wiring, not redesign:
/// - HQ's fields are local `@State`; here they bind to the real
///   `LoginViewModel`'s `$email`/`$password`. Accessibility labels are
///   attached explicitly (`app.textFields["メールアドレス"]` etc.) since a
///   bare `TextField` next to an unrelated `Text` label isn't associated
///   automatically — the same fix the prior HQV5 integration needed.
/// - HQ's "ログイン" is a plain `Text` with no action; wrapped in a real
///   `Button` calling `viewModel.submit()`, swapping in a `ProgressView`
///   while submitting — same visual shape otherwise.
/// - HQ's "パスワードを忘れた"/"新規登録" are plain `Text` with no action —
///   wired to the existing "準備中" alert this screen already used, since
///   no password-reset or sign-up API exists.
/// - `sessionExpired`/`viewModel.state == .error` (states HQ's static
///   mock has no design for) are added as the minimum necessary: the
///   session-expired banner sits above the fixed field panel (pushes it
///   down within the same fixed 234×491 canvas, doesn't resize the panel);
///   the error message is anchored just below the panel via `.overlay(
///   alignment: .bottom)`, the same technique HQ's own `V5EventRow` uses
///   to place its metric row outside a fixed box — so the panel's own
///   204×139 frame and background are never resized to fit real content.
struct LoginView: View {
    @StateObject private var viewModel: LoginViewModel
    let sessionExpired: Bool
    @State private var pendingFeatureMessage: String?

    init(viewModel: @autoclosure @escaping () -> LoginViewModel, sessionExpired: Bool = false) {
        _viewModel = StateObject(wrappedValue: viewModel())
        self.sessionExpired = sessionExpired
    }

    var body: some View {
        V5Viewport {
            V5TopStatus()
            VStack(spacing: 0) {
                Spacer().frame(height: 92)
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.system(size: 47, weight: .bold))
                    .foregroundStyle(LinearGradient(colors: [V5P.blue, V5P.cyan], startPoint: .bottomLeading, endPoint: .topTrailing))
                Text("FX Event Analyzer").font(.system(size: 20, weight: .medium)).foregroundStyle(.white).padding(.top, 8)

                if sessionExpired {
                    sessionExpiredBanner.padding(.top, 10)
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("メールアドレス").font(.system(size: 7)).foregroundStyle(V5P.muted)
                    TextField("example@domain.com", text: $viewModel.email)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        .font(.system(size: 9))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10).frame(height: 27)
                        .background(V5P.bg0.opacity(0.8), in: Capsule())
                        .accessibilityLabel("メールアドレス")
                    Text("パスワード").font(.system(size: 7)).foregroundStyle(V5P.muted)
                    SecureField("パスワードを入力", text: $viewModel.password)
                        .font(.system(size: 9))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10).frame(height: 27)
                        .background(V5P.bg0.opacity(0.8), in: Capsule())
                        .accessibilityLabel("パスワード")
                    Button {
                        viewModel.submit()
                    } label: {
                        Group {
                            if viewModel.state == .submitting {
                                ProgressView().tint(.white)
                            } else {
                                Text("ログイン").font(.system(size: 9, weight: .bold)).foregroundStyle(.white)
                            }
                        }
                        .frame(maxWidth: .infinity).frame(height: 29)
                        .background(LinearGradient(colors: [V5P.blue, V5P.cyan.opacity(0.8)], startPoint: .leading, endPoint: .trailing), in: RoundedRectangle(cornerRadius: 7))
                    }
                    .buttonStyle(.plain)
                    .disabled(!viewModel.canSubmit)
                    .opacity(viewModel.canSubmit ? 1 : 0.5)
                    Button {
                        pendingFeatureMessage = "パスワードリセットは準備中です。もうしばらくお待ちください。"
                    } label: {
                        Text("パスワードをお忘れの方").font(.system(size: 7, weight: .semibold)).foregroundStyle(V5P.cyan).frame(maxWidth: .infinity)
                    }.buttonStyle(.plain)
                    Text("アカウントをお持ちでない方").font(.system(size: 7)).foregroundStyle(V5P.muted).frame(maxWidth: .infinity)
                    Button {
                        pendingFeatureMessage = "新規登録は準備中です。もうしばらくお待ちください。"
                    } label: {
                        Text("新規登録").font(.system(size: 8, weight: .bold)).foregroundStyle(V5P.cyan).frame(maxWidth: .infinity)
                    }.buttonStyle(.plain)
                }
                .padding(9)
                .frame(width: 204, height: 139)
                .background(V5P.panel.opacity(0.9), in: RoundedRectangle(cornerRadius: 9))
                .overlay(RoundedRectangle(cornerRadius: 9).stroke(V5P.line.opacity(0.7), lineWidth: 0.7))
                .overlay(alignment: .bottom) {
                    if case .error(let message) = viewModel.state {
                        Text(message)
                            .font(.system(size: 7))
                            .foregroundStyle(V5P.red)
                            .multilineTextAlignment(.center)
                            .frame(width: 204)
                            .offset(y: 16)
                    }
                }
                .padding(.top, 18)
                Spacer()
            }
            .frame(width: V5P.W, height: V5P.H)
        }
        .preferredColorScheme(.dark)
        .alert(
            "準備中の機能です",
            isPresented: Binding(
                get: { pendingFeatureMessage != nil },
                set: { isPresented in if !isPresented { pendingFeatureMessage = nil } }
            ),
            presenting: pendingFeatureMessage
        ) { _ in
            Button("OK", role: .cancel) {}
        } message: { message in
            Text(message)
        }
    }

    private var sessionExpiredBanner: some View {
        VStack(spacing: 3) {
            Text("セッションの有効期限が切れています")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(.white)
            Text("再度ログインしてください")
                .font(.system(size: 7))
                .foregroundStyle(V5P.muted)
        }
        .multilineTextAlignment(.center)
        .padding(8)
        .frame(width: 204)
        .background(V5P.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(V5P.red.opacity(0.3), lineWidth: 0.6))
    }
}
