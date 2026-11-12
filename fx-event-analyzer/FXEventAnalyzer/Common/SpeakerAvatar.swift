import SwiftUI

/// 要人の顔(HQ指示 2026-10-13「FRBは公式写真で、そのほかは頭文字と機関の色で」)。
///
/// - `photoURL`があれば公式写真を丸く切り抜いて出す(Backendが入れるのは、自由に使える
///   FRB理事の公式写真だけ)。読み込み中・失敗時は頭文字の丸を出す。
/// - 写真が無ければ、名前の頭文字を機関の色の丸に白で書き、右下に小さく国旗を付ける。
struct SpeakerAvatar: View {
    let name: String
    let organization: String
    let countryCode: String
    let photoURL: String?
    var size: CGFloat = 34

    /// 何を出すか。写真のURLが無い・正しくない → 頭文字。読み込み中・失敗 → 頭文字。
    enum Content: Equatable {
        case photo
        case initials
    }

    static func photoURL(from string: String?) -> URL? {
        guard let string, !string.isEmpty, let url = URL(string: string), url.scheme == "https" || url.scheme == "http" else { return nil }
        return url
    }

    static func content(photoURL: String?, phase: AsyncImagePhase?) -> Content {
        guard Self.photoURL(from: photoURL) != nil, let phase else { return .initials }
        if case .success = phase { return .photo }
        return .initials
    }

    /// 国旗の印は、頭文字が読める大きさのときだけ付ける。
    static func showsFlagBadge(size: CGFloat) -> Bool { size >= 24 }

    var body: some View {
        Group {
            if let url = Self.photoURL(from: photoURL) {
                AsyncImage(url: url) { phase in
                    if Self.content(photoURL: photoURL, phase: phase) == .photo, let image = phase.image {
                        image
                            .resizable()
                            .scaledToFill()
                            .frame(width: size, height: size, alignment: .top)
                            .clipShape(Circle())
                            .overlay(Circle().stroke(SettingsCardStyle.cardBorder, lineWidth: 0.7))
                    } else {
                        initialAvatar
                    }
                }
            } else {
                initialAvatar
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    private var initialAvatar: some View {
        ZStack(alignment: .bottomTrailing) {
            Circle()
                .fill(Self.organizationColor(organization))
                .overlay(Circle().stroke(Color.white.opacity(0.25), lineWidth: 0.7))
                .overlay(
                    NotoText.text(Self.initial(of: name), size: size * 0.42)
                        .foregroundStyle(.white)
                )
                .frame(width: size, height: size)
            if Self.showsFlagBadge(size: size) {
                CountryFlagView(countryCode: countryCode, diameter: size * 0.38)
                    .overlay(Circle().stroke(V5P.bg0, lineWidth: 1))
                    .offset(x: size * 0.04, y: size * 0.04)
            }
        }
    }

    /// 頭文字。「クリストファー・ウォラー」のように「・」で区切られた名前は姓(最後の部分)の1文字目、
    /// 「植田和男」のような名前は1文字目。
    static func initial(of name: String) -> String {
        let family = name.split(separator: "・").last.map(String.init) ?? name
        let trimmed = family.trimmingCharacters(in: .whitespaces)
        return trimmed.first.map { String($0) } ?? "?"
    }

    /// 機関ごとの色(公式サイトの基調色に近い、白文字が読める濃さ)。
    static func organizationColor(_ organization: String) -> Color {
        switch organization {
        case "FRB": return Color(red: 0.07, green: 0.20, blue: 0.40)
        case "日本銀行", "日銀": return Color(red: 0.55, green: 0.10, blue: 0.18)
        case "ECB": return Color(red: 0.00, green: 0.24, blue: 0.56)
        case "BOE": return Color(red: 0.35, green: 0.12, blue: 0.40)
        case "RBA": return Color(red: 0.05, green: 0.38, blue: 0.33)
        case "BOC": return Color(red: 0.62, green: 0.14, blue: 0.14)
        case "SNB": return Color(red: 0.70, green: 0.10, blue: 0.10)
        case "RBNZ": return Color(red: 0.10, green: 0.30, blue: 0.30)
        default: return Color(red: 0.12, green: 0.30, blue: 0.45)
        }
    }
}
