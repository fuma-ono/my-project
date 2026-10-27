import SwiftUI

/// SCR-006 指標詳細の本体(HQ指示 2026-10-09の参考画像)。カードに国旗・名前(日本語・英語)・
/// 国/通貨/重要度、概要、項目の表(対象国・地域、通貨、重要度、発表頻度)を並べ、その下に
/// 「次回発表予定」と「過去イベント比較」の移動用のカードを置く。
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
        VStack(alignment: .leading, spacing: 8) {
            mainCard
            // HQ指示(2026-10-09)の1枚目の参考画像: カードの下に「次回発表予定 ›」と
            // 「過去イベント比較 ›」の見出しと、それぞれの小さなカード。
            if let next = nextScheduledEvent {
                linkSection(title: "次回発表予定", route: .eventDetail(id: next.id)) {
                    HStack(spacing: 8) {
                        Image(systemName: "calendar")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(V5P.cyan)
                        VStack(alignment: .leading, spacing: 2) {
                            NotoText.text(Self.releaseLabel(next.releaseDatetime), size: 9.5).foregroundStyle(.white)
                            NotoText.text("\(CountryFlag.indicatorDisplayText(indicator.name, countryCode: indicator.countryCode, displayName: indicator.displayName))　|　\(CountryFlag.japaneseName(forCountry: indicator.countryCode))", size: 7)
                                .foregroundStyle(SettingsCardStyle.subtitleColor)
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                        }
                        Spacer(minLength: 4)
                        importanceBadge(width: 32)
                        linkChevron
                    }
                }
            }
            if let pair = comparisonPair {
                linkSection(title: "過去イベント比較", route: .historicalComparison(
                    indicatorId: indicator.id,
                    indicatorName: indicator.name,
                    fxPairId: pair.fxPairId,
                    fxPairSymbol: pair.symbol
                )) {
                    HStack(spacing: 8) {
                        Image(systemName: "clock")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(V5P.cyan)
                        VStack(alignment: .leading, spacing: 2) {
                            NotoText.text("過去\(PlanStore.shared.limits.historyEventsMax)回のデータを表示", size: 9.5).foregroundStyle(.white)
                            NotoText.text("過去の結果・予想・前回と為替の動きを比較できます", size: 7)
                                .foregroundStyle(SettingsCardStyle.subtitleColor)
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                        }
                        Spacer(minLength: 4)
                        linkChevron
                    }
                }
            }
        }
        .frame(width: 214)
    }

    /// 名前・国/通貨/重要度、概要、項目の表のカード。「注目される理由」はHQ指示(2026-10-09)で外した。
    private var mainCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .padding(.bottom, 8)
            if let description = indicator.description, !description.isEmpty {
                separator
                section("概要") {
                    // HQ指示(2026-10-13)「概要の文字の色を対象国・地域と
                    // 同じ色にして」: `.white.opacity(0.85)`から、infoTableの
                    // `value()`(対象国・地域など)と同じ`.white`に揃えた。
                    NotoText.text(description, size: 8.5)
                        .foregroundStyle(.white)
                        .lineSpacing(1)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            separator
            infoTable
        }
        .padding(.horizontal, 10)
        .padding(.top, 10)
        .padding(.bottom, 4)
        .frame(width: 214)
        .background(GradientCardBackground())
        // HQ指示(2026-10-13、3回目)「消費者物価指数（CPI）は折り返さないで」
        // がまだ直っていない件: 星をヘッダーのHStackの兄弟(Spacer越しに
        // 右端へ寄せる形)に置いていたため、名前の横幅が星の分(24pt+spacing)
        // だけ狭いままだった。星を`mainCard`全体へのoverlayに変え(HQ指示
        // 2026-10-09の原指示「星マークは指標枠の右上に」にも合う)、
        // `header`のHStackから完全に外すことで、名前の列が使える横幅を
        // 大きく広げた。
        .overlay(alignment: .topTrailing) {
            favoriteStar
                .padding(.top, 10)
                .padding(.trailing, 10)
        }
    }

    private var favoriteStar: some View {
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

    /// 見出し(「次回発表予定」)とその下の小さなカード。カードだけがボタン
    /// (`NavigationLink`)。
    /// HQ指示(2026-10-13、4回目)「次回発表予定と過去イベント比較の＞は
    /// 枠内の右側にして」: 見出し行(枠の外)にあった「＞」を外し、枠(カード)
    /// の中、右端に移した(`linkChevron`、各カードのHStackの末尾)。
    /// HQ指摘(2026-10-27)「選択して光る枠がはみ出ている」: 以前は見出しの
    /// 文字を含むVStack全体をNavigationLinkのlabelにしていたため、
    /// `SettingsRowPressStyle`が押下中に敷く光る枠(`configuration.label`と
    /// 同じ大きさ)が、実際に見えているカード(`content()`だけ)より見出しの
    /// 文字の高さ分だけ大きくなり、カードの角丸からはみ出して見えていた。
    /// ボタンのlabelをカード本体(`content()`)だけにし、見出しの文字は
    /// ボタンの外(兄弟要素)に出すことで、光る枠とカードの外形を一致させた。
    private func linkSection(title: String, route: AppRoute, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            // HQ指示(2026-10-13、5回目)「見出しの文字サイズは10にして」: 10.5→10。
            NotoText.text(title, size: 10).foregroundStyle(.white)
                .padding(.horizontal, 4)
            NavigationLink(value: route) {
                content()
                    .padding(.horizontal, 10)
                    .frame(width: 214, height: 38, alignment: .leading)
                    .background(GradientCardBackground())
            }
            .buttonStyle(SettingsRowPressStyle())
        }
    }

    private var linkChevron: some View {
        // HQ指示(2026-10-13、5回目)「＞の文字サイズは10にして」: 9→10。
        // HQ指示(2026-10-13)「＞は10.5pt・少し明るめのグレー」(指標一覧・検索結果と同じ)。
        Image(systemName: "chevron.right")
            .font(.system(size: 10.5, weight: .semibold))
            .foregroundStyle(V5P.muted)
    }

    /// 「2025/10/15(水) 21:30」。
    @MainActor static func releaseLabel(_ date: Date) -> String {
        let preferences = AppPreferences.shared
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = preferences.timeZone
        calendar.locale = Locale(identifier: "ja_JP")
        let weekday = calendar.shortWeekdaySymbols[calendar.component(.weekday, from: date) - 1]
        return "\(preferences.dateString(date))(\(weekday)) \(preferences.timeString(date))"
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
                    .font(.system(size: 10.5, weight: .semibold))
                    .foregroundStyle(V5P.muted)
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
                // 星は`mainCard`のoverlayに移したため、ここでは右上の星と
                // 重ならないよう名前の行だけ軽く余白を確保する(下のnameEn・
                // chipsの行は星の高さより下にあるため全幅を使える)。
                nameText
                    .padding(.trailing, 26)
                if let nameEn = indicator.nameEn, !nameEn.isEmpty {
                    // HQ指示(2026-10-13、2回目)「英語も同じ(折り返さない)」。
                    NotoText.text(nameEn, size: 7)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
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
        }
    }

    /// HQ指示(2026-10-13)「指標名が米国CPIのままになっているから修正して」:
    /// 国名接頭辞を残したまま括弧で割るだけの独自ロジックだったため「米国CPI」が
    /// 消えていなかった。Home/検索/イベント詳細と同じ`CountryFlag.
    /// indicatorDisplayName`(国名接頭辞を取り除く)に揃えた。
    /// HQ指示(2026-10-13、2回目)「消費者物価指数（CPI）は折り返さないで。
    /// 文字サイズは11にして」: イベント詳細/要人発言詳細と違い、この画面は
    /// お気に入り星の分だけ横幅が狭く、2行フォールバック(`ViewThatFits`)
    /// だと折り返りが発生していた。折り返さない方針が明示されたため、常に
    /// 1行(`lineLimit(1)`)にし、収まらない場合だけ`minimumScaleFactor`で
    /// 縮小するようにした。
    private var nameText: some View {
        let combinedName = CountryFlag.indicatorDisplayText(indicator.name, countryCode: indicator.countryCode, displayName: indicator.displayName)
        // `minimumScaleFactor`は指定した下限まで縮小しても入りきらない場合は
        // 「…」で省略してしまう(CI screenshotで確認、「消費者物価指数…」と
        // なり「(CPI)」が消えていた)。星マークの分だけ横幅が狭いこの画面
        // では0.75では不十分だったため、省略が発生しないよう0.5まで縮小を
        // 許容するようにした。
        return NotoText.text(combinedName, size: 11)
            .lineLimit(1)
            .minimumScaleFactor(0.5)
            .foregroundStyle(.white)
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
