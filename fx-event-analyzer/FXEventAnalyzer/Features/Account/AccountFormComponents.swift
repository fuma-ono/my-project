import SwiftUI

/// SCR-015 アカウント情報のサブ画面(プロフィール編集・メールアドレス変更・
/// パスワード変更・SCR-024 アカウント削除)の共通部品。HQ指示(2026-10-05)の
/// 4画面の参考画像に合わせ、SCR-015と同じカード(`SettingsCardStyle`)・文字
/// (`V5JPFont`)で描く。行は呼び出し側で`.position`する。

enum AccountPalette {
    /// 削除系の文字・アイコンの赤。HQ指示(2026-10-05)で「ぼやける」→明度を
    /// 上げた赤にしたところ「薄い」となったため、彩度の高い濃い赤にした。
    static let destructive = Color(red: 1.0, green: 0.17, blue: 0.33)
    /// 削除ボタンの塗り。
    static let destructiveFill = Color(red: 232 / 255, green: 28 / 255, blue: 84 / 255)
    /// SCR-024の注意カード(赤みのある背景と縁)。
    static let warningFill = Color(red: 58 / 255, green: 14 / 255, blue: 38 / 255)
    static let warningBorder = Color(red: 140 / 255, green: 32 / 255, blue: 64 / 255)
}

/// サブ画面共通の寸法。文字の大きさはSCR-015 アカウント情報に揃える
/// (HQ指示 2026-10-05「サブ画面の文字をアカウント情報画面と同じ大きさに」)。
enum AccountLayout {
    /// 見出し・入力・ボタン・リスト項目(SCR-015の行タイトルと同じ)。
    static let titleSize: CGFloat = 9.5
    /// 補足・箇条書き・結果メッセージ(SCR-015の行の値と同じ)。
    static let noteSize: CGFloat = 7.5
    /// アイコン下の案内文。
    static let leadSize: CGFloat = 8.5
    /// 入力欄の見出し・入力欄の文字・削除データの一覧(HQ指示 2026-10-05で
    /// 少し小さくした)。
    static let captionSize: CGFloat = 8.5
    /// メール・パスワード変更・アカウント削除の上部アイコンの中心と大きさ。
    /// 3画面で同じ位置に揃える。
    static let heroY: CGFloat = 86
    static let heroSize: CGFloat = 46
}

/// 画面上部の、角丸の四角に入ったアイコン(メール・鍵)。
struct AccountHeroIcon: View {
    let systemName: String
    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: 22, weight: .semibold))
            .foregroundStyle(V5P.cyan)
            .frame(width: AccountLayout.heroSize, height: AccountLayout.heroSize)
            .background(SettingsCardStyle.card(width: AccountLayout.heroSize, height: AccountLayout.heroSize))
    }
}

/// アイコン付きの見出し・本文・箇条書きの説明カード(幅214)。
struct AccountInfoCard: View {
    let icon: String
    var title: String?
    var text: String?
    var bullets: [String] = []
    var tint: Color = V5P.cyan
    var textColor: Color = SettingsCardStyle.subtitleColor
    var fill: Color = SettingsCardStyle.cardFill
    var border: Color = SettingsCardStyle.cardBorder
    /// 箇条書きの点をアイコンの下まで左に寄せ、カード幅いっぱいに使う
    /// (メールアドレス変更のみ。HQ指示 2026-10-05)。
    var flushBullets = false

    var body: some View {
        HStack(alignment: .top, spacing: 7) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 16, height: 16)
            VStack(alignment: .leading, spacing: 4) {
                if let title {
                    V5JPFont.text(title, size: AccountLayout.titleSize, weight: .bold).foregroundStyle(.white)
                        .frame(height: 16)
                }
                if let text {
                    AccountNote(text: text, color: textColor, width: 168)
                        .padding(.top, title == nil ? 2 : 0)
                }
                if !flushBullets {
                    ForEach(bullets, id: \.self) { bullet in
                        HStack(alignment: .top, spacing: 1) {
                            V5JPFont.text("・", size: AccountLayout.noteSize, weight: .regular).foregroundStyle(textColor)
                                .fixedSize()
                            AccountNote(text: bullet, color: textColor, width: 158)
                        }
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .padding(.top, 9)
        .padding(.bottom, flushBullets && !bullets.isEmpty ? 0 : 9)
        .modifier(BulletList(bullets: flushBullets ? bullets : [], color: textColor))
        .background(AccountCardBackground(fill: fill, border: border))
    }
}

extension View {
    /// 高さが中身で決まる要素を、V5座標の上端`top`に揃えて置く。
    func accountPinned(top: CGFloat, height: CGFloat = 160) -> some View {
        frame(width: V5P.W, height: height, alignment: .top)
            .position(x: V5P.W / 2, y: top + height / 2)
    }
}

/// SCR-015・プロフィール編集のアバター。明るい青の縁で光る丸に紺の人型。
/// 写真のアップロード機能はまだ無いため、常にこのシルエットを出す。
struct AccountAvatar: View {
    let diameter: CGFloat

    var body: some View {
        ZStack {
            Circle().fill(LinearGradient(
                colors: [Color(red: 92 / 255, green: 150 / 255, blue: 222 / 255), Color(red: 38 / 255, green: 92 / 255, blue: 168 / 255)],
                startPoint: .top, endPoint: .bottom
            ))
            // 肩が丸の下端で少し切れる程度まで人型を上げる(HQ指示 2026-10-05
            // 「人物が下過ぎる」)。
            Image(systemName: "person.fill")
                .resizable().scaledToFit()
                .frame(width: diameter * 0.66, height: diameter * 0.66)
                .foregroundStyle(Color(red: 14 / 255, green: 44 / 255, blue: 86 / 255))
                .offset(y: diameter * 0.07)
        }
        .frame(width: diameter, height: diameter)
        .clipShape(Circle())
        .overlay(Circle().stroke(Color(red: 96 / 255, green: 168 / 255, blue: 245 / 255), lineWidth: 1.2))
        .shadow(color: Color(red: 64 / 255, green: 150 / 255, blue: 245 / 255).opacity(0.7), radius: 3)
    }
}

/// 高さが中身で決まるカードの背景(`SettingsCardStyle.card`と同じ見た目)。
struct AccountCardBackground: View {
    var fill: Color = SettingsCardStyle.cardFill
    var border: Color = SettingsCardStyle.cardBorder
    var body: some View {
        RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius)
            .fill(fill)
            .overlay(RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius).stroke(border, lineWidth: 0.7))
    }
}

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

/// 情報カードの左寄せの箇条書き(`flushBullets`)。「入力したメールアドレス宛に確認メールを送信
/// します。」が1行に収まるよう、点をアイコンの下まで左に寄せ、カード幅
/// いっぱいに使う(HQ指示 2026-10-05)。
private struct BulletList: ViewModifier {
    let bullets: [String]
    let color: Color

    func body(content: Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            content
            if !bullets.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(bullets, id: \.self) { bullet in
                        HStack(alignment: .top, spacing: 2) {
                            Circle().fill(color)
                                .frame(width: 2.4, height: 2.4)
                                .frame(width: 4, height: 11)
                            AccountNote(text: bullet, color: color, width: 196, tracking: -0.2)
                        }
                    }
                }
                .padding(.leading, 8)
                .padding(.bottom, 9)
            }
        }
        .frame(width: 214, alignment: .leading)
    }
}

/// 入力欄の上の小さな見出し。
struct AccountFieldCaption: View {
    let text: String
    var body: some View {
        V5JPFont.text(text, size: AccountLayout.captionSize)
            .foregroundStyle(.white)
            .frame(width: 210, alignment: .leading)
    }
}

/// 補足説明(複数行可)。
struct AccountNote: View {
    let text: String
    var color: Color = V5P.muted
    var width: CGFloat = 206
    var tracking: CGFloat = 0
    var body: some View {
        V5JPFont.text(text, size: AccountLayout.noteSize, weight: .regular)
            .tracking(tracking)
            .foregroundStyle(color)
            .lineSpacing(2)
            .frame(width: width, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// カードの中の1行入力欄(214×30)。`isSecure`なら右端の目のアイコンで
/// 入力内容の表示/非表示を切り替えられる(パスワード変更の参考画像)。
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
    /// falseならカード背景を付けない(プロフィール編集の「名前」カード内で使う)。
    var framed = true
    @FocusState private var focused: Bool
    @State private var revealed = false

    init(label: String, placeholder: String, text: Binding<String>, isSecure: Bool = false, keyboard: UIKeyboardType = .default, framed: Bool = true) {
        self.label = label
        self.placeholder = placeholder
        _text = text
        self.isSecure = isSecure
        self.keyboard = keyboard
        self.framed = framed
    }

    var body: some View {
        HStack(spacing: 6) {
            field
            if isSecure {
                Button { revealed.toggle() } label: {
                    Image(systemName: revealed ? "eye" : "eye.slash")
                        .font(.system(size: 10))
                        .foregroundStyle(SettingsCardStyle.chevronColor)
                        .frame(width: 18, height: 24)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(revealed ? "\(label)を隠す" : "\(label)を表示")
            }
        }
        .padding(.horizontal, 10)
        .frame(width: 214, height: 30)
        .background { if framed { SettingsCardStyle.card(width: 214, height: 30) } }
        .overlay(
            RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius)
                .stroke(V5P.cyan.opacity(focused && framed ? 0.8 : 0), lineWidth: 0.8)
        )
        .contentShape(Rectangle())
        .onTapGesture { focused = true }
    }

    private var field: some View {
        ZStack(alignment: .leading) {
            if text.isEmpty {
                V5JPFont.text(placeholder, size: AccountLayout.captionSize, weight: .regular)
                    .foregroundStyle(V5P.muted.opacity(0.75))
                    .allowsHitTesting(false)
            }
            Group {
                if isSecure && !revealed {
                    SecureField("", text: $text)
                        .textContentType(.password)
                } else if isSecure {
                    TextField("", text: $text)
                        .textContentType(.password)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } else {
                    TextField("", text: $text)
                        .keyboardType(keyboard)
                        .textInputAutocapitalization(keyboard == .emailAddress ? .never : .sentences)
                        .autocorrectionDisabled(keyboard == .emailAddress)
                }
            }
            .font(.system(size: AccountLayout.captionSize))
            .foregroundStyle(.white)
            .tint(V5P.cyan)
            .accessibilityLabel(label)
            .focused($focused)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// 主ボタン(214×29)。参考画像どおりの青の塗りで、日本語は`V5JPFont`で
/// 描く。`destructive`はアカウント削除用の赤。
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
                    V5JPFont.text(title, size: AccountLayout.titleSize, weight: .bold).foregroundStyle(.white)
                }
            }
            .frame(width: 214, height: 29)
            .background(
                destructive ? AccountPalette.destructiveFill : V5P.blue,
                in: RoundedRectangle(cornerRadius: 7)
            )
            .opacity(isEnabled || isLoading ? 1 : 0.4)
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled || isLoading)
    }
}

/// 枠線付きカードの副ボタン(SCR-024の「キャンセル」)。
struct AccountSecondaryButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            V5JPFont.text(title, size: AccountLayout.titleSize, weight: .bold)
                .foregroundStyle(.white)
                .frame(width: 214, height: 29)
                .background(SettingsCardStyle.card(width: 214, height: 29))
                .contentShape(Rectangle())
        }
        .buttonStyle(SettingsRowPressStyle())
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
            case .error(let message): AccountNote(text: message, color: AccountPalette.destructive)
            case .idle, .submitting:
                if let validation { AccountNote(text: validation, color: AccountPalette.destructive) }
            }
        }
        .multilineTextAlignment(.leading)
    }
}
