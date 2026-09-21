import SwiftUI

/// SCR-010 Login (ui-screens.md).
///
/// HQ Frontend integration (2026-09-21): visual content is HQ's
/// `FXEventAnalyzer_HQFrontend/LoginView.swift` (brand mark, "Welcome back"
/// header, card-framed fields, gradient CTA). Two adaptations from HQ's
/// standalone mockup, both wiring, not redesign:
/// - HQ's fields are local `@State`; here they bind to the real
///   `LoginViewModel`'s `$email`/`$password`, and the button calls
///   `viewModel.submit()` instead of an `onLogin` callback, since Auth must
///   stay wired exactly as before (`RootView` still constructs this the
///   same way).
/// - HQ's "パスワードを忘れた" opens a `PasswordResetView` sheet whose only
///   action button does nothing (`Button("再設定メールを送る") {}` in the
///   HQ file) — no password-reset API exists to wire it to, and shipping a
///   dead-end sheet would be worse than the existing "準備中" alert this
///   screen already used, so that existing alert-based behavior is kept
///   for both Password Reset and Sign Up, in HQ's own text styling.
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
            FXAppBackground()
            ScrollView {
                VStack(spacing: 28) {
                    Spacer(minLength: 38)
                    FXBrandMark()

                    if sessionExpired {
                        sessionExpiredBanner
                    }

                    VStack(spacing: 8) {
                        Text("Welcome back").font(.system(size: 28, weight: .bold, design: .rounded)).foregroundStyle(.white)
                        Text("Economic events, explained by the numbers.").font(.system(size: 14)).foregroundStyle(FXColor.secondaryText)
                    }

                    VStack(spacing: 14) {
                        FXTextField(title: "メールアドレス", text: $viewModel.email, icon: "envelope", keyboard: .emailAddress)
                        FXSecureField(title: "パスワード", text: $viewModel.password)

                        if case .error(let message) = viewModel.state {
                            Text(message)
                                .font(.system(size: 12))
                                .foregroundStyle(FXColor.red)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }

                        HStack {
                            Spacer()
                            Button("パスワードを忘れた") {
                                pendingFeatureMessage = "パスワードリセットは準備中です。もうしばらくお待ちください。"
                            }.font(.system(size: 12, weight: .semibold)).foregroundStyle(FXColor.cyan)
                        }

                        Button {
                            viewModel.submit()
                        } label: {
                            Group {
                                if viewModel.state == .submitting {
                                    ProgressView().tint(.white)
                                } else {
                                    Text("ログイン")
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 54)
                        }
                        .background(FXGradient.brand)
                        .foregroundStyle(.white)
                        .font(.system(size: 16, weight: .bold))
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                        .shadow(color: FXColor.cyan.opacity(0.2), radius: 16)
                        .buttonStyle(.plain)
                        .disabled(!viewModel.canSubmit)
                        .opacity(viewModel.canSubmit ? 1 : 0.5)
                    }.frame(maxWidth: 460).padding(20).fxCard()

                    HStack {
                        Rectangle().fill(FXColor.border).frame(height: 1)
                        Text("or").font(.system(size: 12)).foregroundStyle(FXColor.tertiaryText)
                        Rectangle().fill(FXColor.border).frame(height: 1)
                    }.frame(maxWidth: 460)

                    Button {
                        pendingFeatureMessage = "新規登録は準備中です。もうしばらくお待ちください。"
                    } label: {
                        Text("アカウントを作成").font(.system(size: 15, weight: .semibold)).foregroundStyle(.white).frame(maxWidth: 460).frame(height: 50).background(FXColor.card).clipShape(RoundedRectangle(cornerRadius: 15)).overlay(RoundedRectangle(cornerRadius: 15).stroke(FXColor.border))
                    }.buttonStyle(.plain)

                    Spacer(minLength: 30)
                }.padding(.horizontal, 20)
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
                .foregroundStyle(FXColor.secondaryText)
        }
        .padding(14)
        .frame(maxWidth: .infinity)
        .background(FXColor.red.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(FXColor.red.opacity(0.25)))
    }
}

struct FXTextField: View {
    let title: String
    @Binding var text: String
    let icon: String
    var keyboard: UIKeyboardType = .default
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title).font(.system(size: 12, weight: .semibold)).foregroundStyle(FXColor.secondaryText)
            HStack {
                Image(systemName: icon).foregroundStyle(FXColor.cyan)
                TextField(title, text: $text).keyboardType(keyboard).textInputAutocapitalization(.never).foregroundStyle(.white)
            }.padding(.horizontal, 14).frame(height: 50).background(FXColor.backgroundElevated).clipShape(RoundedRectangle(cornerRadius: 13))
        }
    }
}

struct FXSecureField: View {
    let title: String
    @Binding var text: String
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title).font(.system(size: 12, weight: .semibold)).foregroundStyle(FXColor.secondaryText)
            HStack {
                Image(systemName: "lock").foregroundStyle(FXColor.cyan)
                SecureField(title, text: $text).foregroundStyle(.white)
            }.padding(.horizontal, 14).frame(height: 50).background(FXColor.backgroundElevated).clipShape(RoundedRectangle(cornerRadius: 13))
        }
    }
}
