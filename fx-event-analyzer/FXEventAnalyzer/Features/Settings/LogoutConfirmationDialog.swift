import SwiftUI

/// ログアウトの確認(HQ指示 2026-10-07の参考画像)。iOS標準の確認シートの代わりに、
/// 画面を暗くして中央にカードを出す。V5キャンバスの中に置くので、他の画面と同じ
/// 比率で拡大される。背景をタップするとキャンセル。
struct LogoutConfirmationDialog: View {
    let onLogout: () -> Void
    let onCancel: () -> Void

    var body: some View {
        ZStack {
            // V5キャンバスの上下の余白(レターボックス)まで暗くするため、大きめに敷く。
            Color.black.opacity(0.6)
                .frame(width: V5P.W * 3, height: V5P.H * 3)
                .contentShape(Rectangle())
                .onTapGesture(perform: onCancel)
                .accessibilityHidden(true)

            VStack(spacing: 0) {
                NotoText.text("ログアウトしますか？", size: 12.5)
                    .foregroundStyle(.white)
                NotoText.text("ログアウトすると、再度ログインが\n必要となります。", size: 8.5)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
                    .padding(.top, 8)
                VStack(spacing: 9) {
                    dialogButton("ログアウト", fill: AccountPalette.destructiveFill, border: AccountPalette.destructive, action: onLogout)
                    dialogButton("キャンセル", fill: SettingsCardStyle.cardFill, border: SettingsCardStyle.cardBorder, action: onCancel)
                }
                .padding(.top, 14)
            }
            .padding(.horizontal, 14)
            .padding(.top, 16)
            .padding(.bottom, 14)
            .frame(width: 200)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(SettingsCardStyle.cardFill)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(V5P.blue.opacity(0.85), lineWidth: 0.8))
                    .shadow(color: V5P.blue.opacity(0.45), radius: 8)
            )
            .accessibilityElement(children: .contain)
            .accessibilityAddTraits(.isModal)
        }
        .position(x: V5P.W / 2, y: V5P.H / 2)
    }

    private func dialogButton(_ title: String, fill: Color, border: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            NotoText.text(title, size: 9.5)
                .foregroundStyle(.white)
                .frame(width: 172, height: 28)
                .background(RoundedRectangle(cornerRadius: 7).fill(fill))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(border, lineWidth: 0.8))
                .contentShape(Rectangle())
        }
        .buttonStyle(SettingsRowPressStyle())
        .accessibilityLabel(title)
    }
}
