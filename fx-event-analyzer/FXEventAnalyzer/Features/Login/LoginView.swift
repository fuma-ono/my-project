import SwiftUI

/// SCR-010 Login (ui-screens.md).
///
/// HQ UI Master v5 Frontend integration (2026-09-24): visual content is
/// HQ's `HQV5Screens.swift` `HQV5LoginView` (icon, wordmark,
/// `HQV5NeonCard`-framed fields, `HQV5PrimaryButton` CTA), reproduced as
/// given. Adaptations, all wiring, not redesign:
/// - HQ's fields are local `@State`; here they bind to the real
///   `LoginViewModel`'s `$email`/`$password`, and the button calls
///   `viewModel.submit()` instead of doing nothing, since Auth must stay
///   wired exactly as before (`RootView` still constructs this the same
///   way).
/// - HQ's "パスワードを忘れた"/"新規登録" buttons do nothing — no
///   password-reset or sign-up API exists to wire them to, so they keep
///   the existing "準備中" alert this screen already used.
/// - `sessionExpired`/`viewModel.state == .error` (not present in HQ's
///   file, which has no such states) keep their existing banner/message
///   treatment so those real states aren't silently dropped.
struct LoginView: View {
    @StateObject private var viewModel: LoginViewModel
    let sessionExpired: Bool
    @State private var pendingFeatureMessage: String?

    init(viewModel: @autoclosure @escaping () -> LoginViewModel, sessionExpired: Bool = false) {
        _viewModel = StateObject(wrappedValue: viewModel())
        self.sessionExpired = sessionExpired
    }

    var body: some View {
        ZStack {
            HQV5Background()
            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    Spacer(minLength: 55)
                    Image(systemName: "chart.line.uptrend.xyaxis").font(.system(size: 48, weight: .bold))
                        .foregroundStyle(LinearGradient(colors: [HQV5.blue, HQV5.cyan], startPoint: .bottomLeading, endPoint: .topTrailing))
                        .padding(.bottom, 8)
                    Text("FX Event Analyzer").font(.system(size: 22, weight: .medium)).foregroundStyle(.white)

                    if sessionExpired {
                        sessionExpiredBanner.padding(.top, 20)
                    }

                    HQV5NeonCard {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("メールアドレス").font(.system(size: 9)).foregroundStyle(HQV5.muted)
                            TextField("example@domain.com", text: $viewModel.email)
                                .textInputAutocapitalization(.never)
                                .keyboardType(.emailAddress)
                                .padding(10).background(HQV5.panel, in: Capsule()).foregroundStyle(.white)
                            Text("パスワード").font(.system(size: 9)).foregroundStyle(HQV5.muted)
                            SecureField("パスワードを入力", text: $viewModel.password)
                                .padding(10).background(HQV5.panel, in: Capsule()).foregroundStyle(.white)

                            if case .error(let message) = viewModel.state {
                                Text(message)
                                    .font(.system(size: 10))
                                    .foregroundStyle(HQV5.red)
                            }

                            Button {
                                viewModel.submit()
                            } label: {
                                if viewModel.state == .submitting {
                                    ProgressView().tint(.white)
                                } else {
                                    Text("ログイン")
                                }
                            }
                            .buttonStyle(HQV5PrimaryButton())
                            .disabled(!viewModel.canSubmit)
                            .opacity(viewModel.canSubmit ? 1 : 0.5)

                            Button("パスワードをお忘れの方") {
                                pendingFeatureMessage = "パスワードリセットは準備中です。もうしばらくお待ちください。"
                            }.font(.system(size: 10, weight: .semibold)).foregroundStyle(HQV5.cyan).frame(maxWidth: .infinity)

                            Text("アカウントをお持ちでない方").font(.system(size: 9)).foregroundStyle(HQV5.muted).frame(maxWidth: .infinity)

                            Button("新規登録") {
                                pendingFeatureMessage = "新規登録は準備中です。もうしばらくお待ちください。"
                            }.font(.system(size: 11, weight: .bold)).foregroundStyle(HQV5.cyan).frame(maxWidth: .infinity)
                        }
                    }
                    .padding(.top, 26)
                    Spacer(minLength: 30)
                }
                .padding(.horizontal, 18)
            }
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
        VStack(spacing: 6) {
            Text("セッションの有効期限が切れています")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
            Text("再度ログインしてください")
                .font(.system(size: 12))
                .foregroundStyle(HQV5.muted)
        }
        .padding(14)
        .frame(maxWidth: .infinity)
        .background(HQV5.red.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(HQV5.red.opacity(0.25)))
    }
}
