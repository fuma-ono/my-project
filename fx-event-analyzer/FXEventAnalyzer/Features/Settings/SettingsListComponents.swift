import SwiftUI

/// SCR-016 / SCR-018 / SCR-019 の一覧型の設定画面の部品(HQ指示 2026-10-06の参考画像)。

/// HQ指示(2026-10-06)の参考画像: 見出しはカードの外に文字だけで置き、
/// カードの中は項目名と右端のスイッチ・値だけの行を並べる。SCR-016 通知設定・
/// SCR-018 表示・地域設定・SCR-019 チャート設定で共通。
enum SettingsListLayout {
    static let width: CGFloat = 214
    static let sectionTitleSize: CGFloat = 8.5
    static let rowTitleSize: CGFloat = 8.5
    static let valueSize: CGFloat = 8
    /// 通知しない時間帯をONにしても1画面に収まる高さ(HQ指示 2026-10-06)。
    static let rowHeight: CGFloat = 24
}

/// カードの上に見出しを置いたまとまり。
struct SettingsListSection<Rows: View>: View {
    let title: String
    @ViewBuilder let rows: () -> Rows

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            V5JPFont.text(title, size: SettingsListLayout.sectionTitleSize, weight: .bold)
                .foregroundStyle(.white)
                .padding(.leading, 4)
            VStack(spacing: 0) { rows() }
                .frame(width: SettingsListLayout.width)
                .background(AccountCardBackground())
        }
        .frame(width: SettingsListLayout.width, alignment: .leading)
    }
}

struct SettingsListSeparator: View {
    var body: some View {
        Rectangle().fill(SettingsCardStyle.separator).frame(height: 0.6).padding(.horizontal, 8)
    }
}

/// ON/OFFの行。標準Toggleは固定キャンバスに対して大きすぎるため、V5の
/// 寸法でスイッチを描き、VoiceOverには切り替えスイッチとして見せる。
struct SettingsListToggleRow: View {
    let title: String
    let isOn: Bool
    let onChange: (Bool) -> Void

    var body: some View {
        Button { onChange(!isOn) } label: {
            HStack(spacing: 6) {
                V5JPFont.text(title, size: SettingsListLayout.rowTitleSize, weight: .medium).foregroundStyle(.white)
                Spacer(minLength: 4)
                Capsule()
                    .fill(isOn ? V5P.blue : V5P.panel2)
                    .overlay(Capsule().stroke(isOn ? V5P.blue : V5P.line, lineWidth: 0.5))
                    .frame(width: 25, height: 13)
                    .overlay(alignment: isOn ? .trailing : .leading) {
                        Circle().fill(.white).frame(width: 11, height: 11).padding(1)
                    }
                    .animation(.easeInOut(duration: 0.15), value: isOn)
            }
            .padding(.horizontal, 10)
            .frame(height: SettingsListLayout.rowHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(isOn ? "オン" : "オフ")
        .accessibilityAddTraits(.isToggle)
    }
}

/// 現在の値とシェブロンを右端に出し、タップで選択シートを開く行。
struct SettingsListValueRow: View {
    let title: String
    let value: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                V5JPFont.text(title, size: SettingsListLayout.rowTitleSize, weight: .medium).foregroundStyle(.white)
                    .layoutPriority(1)
                Spacer(minLength: 4)
                // 「23:00」などの数字も日本語の値と同じ大きさに見えるよう、
                // 全体をNoto Sans JPで組む(HQ指示 2026-10-06)。
                NotoText.text(value, size: SettingsListLayout.valueSize)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 7.5, weight: .semibold))
                    .foregroundStyle(SettingsCardStyle.chevronColor)
            }
            .padding(.horizontal, 10)
            .frame(height: SettingsListLayout.rowHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(SettingsRowPressStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(value)
        .accessibilityAddTraits(.isButton)
    }
}

extension View {
    /// 前提のスイッチ(プッシュ通知など)がオフの間は、薄くして操作できなくする。
    func dimmed(_ isDimmed: Bool) -> some View {
        opacity(isDimmed ? 0.45 : 1).disabled(isDimmed)
    }
}

/// 選択肢のシート。固定キャンバスの拡大表示に入れず、通常サイズで出す。
struct SettingsListOptionSheet<Rows: View>: View {
    let title: String
    let footer: String?
    @ViewBuilder let rows: () -> Rows
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            Text(title)
                .font(.headline)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .overlay(alignment: .trailing) {
                    Button("完了") { dismiss() }
                        .fontWeight(.semibold)
                        .foregroundStyle(V5P.cyan)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)

            ScrollView {
                VStack(spacing: 0) { rows() }
                    .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.06)))
                    .padding(.horizontal, 16)
                if let footer {
                    Text(footer)
                        .font(.footnote)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 24)
                        .padding(.top, 8)
                }
            }
        }
        .presentationDetents([.medium])
        .presentationBackground(SettingsCardStyle.cardFill)
    }
}

struct SettingsListOptionRow: View {
    let label: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Text(label).foregroundStyle(.white)
                Spacer()
                Image(systemName: "checkmark")
                    .fontWeight(.semibold)
                    .foregroundStyle(V5P.cyan)
                    .opacity(isSelected ? 1 : 0)
            }
            .padding(.horizontal, 16)
            .frame(height: 46)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
