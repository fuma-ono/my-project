import SwiftUI

/// SCR-006 指標詳細の本体(HQ指示 2026-10-09の参考画像)。1枚のカードに、
/// 国旗・名前(日本語・英語)・国/通貨/重要度、概要、注目される理由、項目の表
/// (対象国・地域、通貨、重要度、発表頻度、次回発表予定)、過去の発表日を並べる。
/// お気に入りの星はカードの右上(HQ指示 2026-10-09)。文字の大きさは同日のHQ指定:
/// 名前10.5、英語名と印7、見出しと「過去の発表日」9.5、本文・表8.5。
struct IndicatorDetailCard: View {
    let indicator: IndicatorSummary
    let nextScheduledEvent: IndicatorEventSummary?
    /// 過去イベント比較(SCR-009)に使う通貨ペア(関連通貨ペアの先頭)。無ければ行を出さない。
    let comparisonPair: RelatedFxPairSummary?
    let isFavorite: Bool
    let onToggleFavorite: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .padding(.bottom, 8)
            if let description = indicator.description, !description.isEmpty {
                separator
                section("概要") {
                    NotoText.text(description, size: 8.5)
                        .foregroundStyle(.white.opacity(0.85))
                        .lineSpacing(1)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if let points = indicator.keyPoints, !points.isEmpty {
                separator
                section("注目される理由") {
                    VStack(alignment: .leading, spacing: 1.5) {
                        ForEach(points, id: \.self) { point in
                            HStack(alignment: .firstTextBaseline, spacing: 4) {
                                NotoText.text("•", size: 8.5).foregroundStyle(.white)
                                NotoText.text(point, size: 8.5)
                                    .foregroundStyle(.white.opacity(0.85))
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }
            }
            separator
            infoTable
            separator
            // HQ指示(2026-10-09)「過去イベント比較画面の遷移元は指標詳細」。「過去の発表日」の行は
            // 過去イベント比較で分かるので消した。
            // HQ指示(2026-10-09)「指標詳細には次回発表予定と過去イベント比較を」: どちらも移動用の行。
            // スクショのテストは「次回発表予定」からSCR-007へ進む。
            if let next = nextScheduledEvent {
                linkRow("次回発表予定", detail: "\(AppPreferences.shared.dateString(next.releaseDatetime)) \(AppPreferences.shared.timeString(next.releaseDatetime))",
                        value: AppRoute.eventDetail(id: next.id))
                if comparisonPair != nil { separator }
            }
            if let pair = comparisonPair {
                linkRow("過去イベント比較", value: AppRoute.historicalComparison(
                    indicatorId: indicator.id,
                    indicatorName: indicator.name,
                    fxPairId: pair.fxPairId,
                    fxPairSymbol: pair.symbol
                ))
            }
        }
        .padding(.horizontal, 10)
        .padding(.top, 10)
        .padding(.bottom, 2)
        .frame(width: 214)
        .background(AccountCardBackground())
    }

    private func linkRow(_ title: String, detail: String? = nil, value: AppRoute) -> some View {
        NavigationLink(value: value) {
            HStack {
                NotoText.text(title, size: 9.5).foregroundStyle(.white)
                Spacer()
                if let detail {
                    NotoText.text(detail, size: 8.5).foregroundStyle(SettingsCardStyle.subtitleColor)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(SettingsCardStyle.chevronColor)
            }
            .frame(height: 32)
            .contentShape(Rectangle())
        }
        .buttonStyle(SettingsRowPressStyle())
    }

    // MARK: - 名前・国・通貨・重要度

    private var header: some View {
        HStack(alignment: .top, spacing: 8) {
            CountryFlagView(countryCode: indicator.countryCode, diameter: 34)
            VStack(alignment: .leading, spacing: 2) {
                nameText
                if let nameEn = indicator.nameEn, !nameEn.isEmpty {
                    NotoText.text(nameEn, size: 7)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                }
                HStack(spacing: 4) {
                    chip {
                        HStack(spacing: 3) {
                            CountryFlagView(countryCode: indicator.countryCode, diameter: 10)
                            NotoText.text(CountryFlag.japaneseName(forCountry: indicator.countryCode), size: 7)
                        }
                    }
                    chip { NotoText.text(indicator.currencyCode, size: 7) }
                    importanceBadge(width: 32)
                }
                .padding(.top, 3)
            }
            Spacer(minLength: 0)
            Button(action: onToggleFavorite) {
                Image(systemName: isFavorite ? "star.fill" : "star")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(V5P.yellow)
                    .frame(width: 24, height: 24, alignment: .topTrailing)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isFavorite ? "お気に入りから外す" : "お気に入りに追加")
            .accessibilityIdentifier("indicatorFavoriteStar")
        }
    }

    /// HQ指示(2026-10-09)「名前を途中で折り返さないように、(で折り返すとか」: 1行に
    /// 入ればそのまま、入らなければカッコの前で改行する(「米国CPI」/「(消費者物価指数)」)。
    private var nameText: some View {
        let parts = Self.splitName(indicator.name)
        return ViewThatFits(in: .horizontal) {
            NotoText.text(indicator.name, size: 10.5).lineLimit(1).fixedSize()
            VStack(alignment: .leading, spacing: 1) {
                NotoText.text(parts.main, size: 10.5).lineLimit(1).minimumScaleFactor(0.8)
                if let paren = parts.paren {
                    NotoText.text(paren, size: 10.5).lineLimit(1).minimumScaleFactor(0.8)
                }
            }
        }
        .foregroundStyle(.white)
    }

    /// 「米国CPI(消費者物価指数)」→ ("米国CPI", "(消費者物価指数)")。カッコが無ければ全体を1行目に。
    static func splitName(_ name: String) -> (main: String, paren: String?) {
        guard let index = name.firstIndex(where: { $0 == "(" || $0 == "（" }), index != name.startIndex else {
            return (name, nil)
        }
        return (String(name[..<index]), String(name[index...]))
    }

    private func chip(@ViewBuilder _ content: () -> some View) -> some View {
        content()
            // 横幅が足りないと「米国」が「米」に切れていたので、文字の幅で固定する。
            .fixedSize()
            .foregroundStyle(.white)
            .padding(.horizontal, 6)
            .frame(height: 15)
            .background(Capsule().fill(Color.white.opacity(0.06)))
            .overlay(Capsule().stroke(SettingsCardStyle.cardBorder, lineWidth: 0.6))
    }

    private func importanceBadge(width: CGFloat) -> some View {
        let colors = HomeView.importanceBadgeColors(indicator.importance)
        return NotoText.text(indicator.importance.rawValue, size: 7)
            .tracking(-0.3)
            .foregroundStyle(.white)
            .frame(width: width, height: 15)
            .background(colors.fill, in: Capsule())
            .overlay(Capsule().stroke(colors.border, lineWidth: 0.6))
    }

    // MARK: - 概要・注目される理由

    private func section(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            NotoText.text(title, size: 9.5).foregroundStyle(.white)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 5)
    }

    private var separator: some View {
        Rectangle().fill(SettingsCardStyle.cardBorder).frame(height: 0.5)
    }

    // MARK: - 項目の表

    private var infoTable: some View {
        VStack(spacing: 0) {
            infoRow("対象国・地域") { value(CountryFlag.japaneseName(forCountry: indicator.countryCode)) }
            infoRow("通貨") { value(indicator.currencyCode) }
            infoRow("重要度") { importanceBadge(width: 34) }
            infoRow("発表頻度") { value(Self.frequencyLabel(indicator.frequency)) }
        }
        .padding(.vertical, 3)
    }

    private func infoRow(_ label: String, @ViewBuilder value: () -> some View) -> some View {
        HStack(spacing: 0) {
            NotoText.text(label, size: 8.5)
                .foregroundStyle(SettingsCardStyle.subtitleColor)
                .frame(width: 74, alignment: .leading)
            value()
            Spacer(minLength: 0)
        }
        .frame(height: 22)
    }

    private func value(_ text: String) -> some View {
        NotoText.text(text, size: 8.5).foregroundStyle(.white)
    }

    /// `economic_indicators.frequency` → 「月1回」など。
    static func frequencyLabel(_ frequency: String) -> String {
        switch frequency.uppercased() {
        case "DAILY": return "毎日"
        case "WEEKLY": return "週1回"
        case "MONTHLY": return "月1回"
        case "QUARTERLY": return "四半期に1回"
        case "SEMIANNUAL", "SEMI_ANNUAL": return "半年に1回"
        case "ANNUAL", "YEARLY": return "年1回"
        case "IRREGULAR": return "不定期"
        default: return frequency
        }
    }
}
