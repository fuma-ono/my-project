import SwiftUI

/// SCR-015 アカウント情報のサブ画面(プロフィール編集・メールアドレス変更・
/// パスワード変更・SCR-024 アカウント削除)の共通部品。専用の参考画像は
/// まだ無いため、SCR-015と同じカード(`SettingsCardStyle`)・文字
/// (`V5JPFont`)で揃えた暫定レイアウト。行は呼び出し側で`.position`する。

/// V5のヘッダー(戻る付き)と下部タブの間に`content`を置く外枠。
struct AccountFormScaffold<Content: View>: View {
    let title: String
    @Binding var tabSelection: Int
    let content: () -> Content
    @Environment(\.dismiss) private var dismiss

    init(title: String, tabSelection: Binding<Int>, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        _tabSelection = tabSelection
        self.content = content
    }

    var body: some View {
        V5Viewport {
            V5Header(title: title, back: true, onBack: { dismiss() })
            content()
            V5BottomBar(selected: $tabSelection)
        }
        .toolbar(.hidden, for: .navigationBar)
    }
}

/// 入力欄の上の小さな見出し。
struct AccountFieldCaption: View {
    let text: String
    var body: some View {
        V5JPFont.text(text, size: 7.5)
            .foregroundStyle(SettingsCardStyle.subtitleColor)
            .frame(width: 210, alignment: .leading)
    }
}

/// 補足説明(複数行可)。
struct AccountNote: View {
    let text: String
    var color: Color = V5P.muted
    var width: CGFloat = 206
    var body: some View {
        V5JPFont.text(text, size: 6.5, weight: .regular)
            .foregroundStyle(color)
            .lineSpacing(1.5)
            .frame(width: width, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// カードの中の1行入力欄(214×30)。
///
/// プレースホルダーはLoginViewと同じく、`TextField`の`prompt:`や`.overlay`
/// ではなく`ZStack`の兄弟要素として置く(固定キャンバスの拡大表示では
/// `prompt:`の文字色が効かず、`.overlay`はタップを奪うため)。
/// `accessibilityLabel`は外枠ではなく入力欄そのものに付け、XCUITestから
/// `textFields`/`secureTextFields`として見えるようにしている。
struct AccountTextField: View {
    let label: String
    let placeholder: String
    @Binding var text: String
    var isSecure = false
    var keyboard: UIKeyboardType = .default
    @FocusState private var focused: Bool

    init(label: String, placeholder: String, text: Binding<String>, isSecure: Bool = false, keyboard: UIKeyboardType = .default) {
        self.label = label
        self.placeholder = placeholder
        _text = text
        self.isSecure = isSecure
        self.keyboard = keyboard
    }

    var body: some View {
        ZStack(alignment: .leading) {
            if text.isEmpty {
                V5JPFont.text(placeholder, size: 8.5, weight: .regular)
                    .foregroundStyle(V5P.muted.opacity(0.75))
                    .allowsHitTesting(false)
            }
            Group {
                if isSecure {
                    SecureField("", text: $text)
                        .textContentType(.password)
                } else {
                    TextField("", text: $text)
                        .keyboardType(keyboard)
                        .textInputAutocapitalization(keyboard == .emailAddress ? .never : .sentences)
                        .autocorrectionDisabled(keyboard == .emailAddress)
                }
            }
            .font(.system(size: 8.5))
            .foregroundStyle(.white)
            .tint(V5P.cyan)
            .accessibilityLabel(label)
            .focused($focused)
        }
        .padding(.horizontal, 10)
        .frame(width: 214, height: 30)
        .background(SettingsCardStyle.card(width: 214, height: 30))
        .overlay(
            RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius)
                .stroke(V5P.cyan.opacity(focused ? 0.8 : 0), lineWidth: 0.8)
        )
        .contentShape(Rectangle())
        .onTapGesture { focused = true }
    }
}

/// 画面下の主ボタン。V5Buttonと同じ青→シアンのグラデーションで、日本語は
/// `V5JPFont`で描く。`destructive`はアカウント削除用の赤。
struct AccountPrimaryButton: View {
    let title: String
    var isLoading = false
    var isEnabled = true
    var destructive = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                if isLoading {
                    ProgressView().tint(.white).scaleEffect(0.6)
                } else {
                    V5JPFont.text(title, size: 9, weight: .bold).foregroundStyle(.white)
                }
            }
            .frame(width: 214, height: 29)
            .background(
                destructive
                    ? AnyShapeStyle(V5P.red.opacity(0.9))
                    : AnyShapeStyle(LinearGradient(colors: [V5P.blue, V5P.cyan.opacity(0.85)], startPoint: .leading, endPoint: .trailing)),
                in: RoundedRectangle(cornerRadius: 7)
            )
            .opacity(isEnabled || isLoading ? 1 : 0.4)
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled || isLoading)
    }
}

/// 送信結果・入力の注意を1か所に出す。入力の注意(`validation`)より
/// 送信結果を優先する。
struct AccountStatusText: View {
    let state: AccountFormState
    var validation: String?

    var body: some View {
        Group {
            switch state {
            case .done(let message): AccountNote(text: message, color: V5P.green)
            case .error(let message): AccountNote(text: message, color: V5P.red)
            case .idle, .submitting:
                if let validation { AccountNote(text: validation, color: V5P.red) }
            }
        }
        .multilineTextAlignment(.leading)
    }
}
