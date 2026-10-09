import SwiftUI

/// SCR-007 イベント詳細の本体(HQ指示 2026-10-09の参考画像)。上から、指標の
/// カード(国旗・名前・国|通貨・発表日時・重要度)、結果/予想/前回のカード、
/// 「主要通貨ペアの値動き(pips)」の表(1分・5分・15分)、通貨ペアを選んで
/// SCR-008 相場反応詳細へ進む。HQ指示(2026-10-09)で、ボタンをなくして表の各行
/// (`NavigationLink(value:)`)から直接進む形にした。
struct EventDetailCards: View {
    let response: EventDetailResponse

    static let timeframes = ["1m", "5m", "15m"]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            results
            NotoText.text("主要通貨ペアの値動き（pips）", size: 11)
                .foregroundStyle(.white)
                .padding(.horizontal, 4)
                .padding(.top, 2)
            reactionTable
            if !pairs.isEmpty {
                NotoText.text("通貨ペアを押すと、相場反応の詳細を表示します。", size: 7.5)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .padding(.horizontal, 4)
            }
        }
        .frame(width: 214)
    }

    // MARK: - 指標のカード

    private var header: some View {
        let event = response.event
        return HStack(alignment: .top, spacing: 8) {
            CountryFlagView(countryCode: event.countryCode, diameter: 28)
            VStack(alignment: .leading, spacing: 3) {
                ViewThatFits(in: .horizontal) {
                    NotoText.text(event.indicatorName, size: 10.5).lineLimit(1).fixedSize()
                    VStack(alignment: .leading, spacing: 1) {
                        let parts = IndicatorDetailCard.splitName(event.indicatorName)
                        NotoText.text(parts.main, size: 10.5).lineLimit(1).minimumScaleFactor(0.8)
                        if let paren = parts.paren {
                            NotoText.text(paren, size: 10.5).lineLimit(1).minimumScaleFactor(0.8)
                        }
                    }
                }
                .foregroundStyle(.white)
                NotoText.text("\(CountryFlag.japaneseName(forCountry: event.countryCode))　|　\(event.currencyCode)", size: 8.5)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 5) {
                NotoText.text("\(AppPreferences.shared.dateString(event.releaseDatetime)) \(AppPreferences.shared.timeString(event.releaseDatetime))", size: 7)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .fixedSize()
                let colors = HomeView.importanceBadgeColors(event.importance)
                NotoText.text(event.importance.rawValue, size: 7)
                    .tracking(-0.3)
                    .foregroundStyle(.white)
                    .frame(width: 34, height: 15)
                    .background(colors.fill, in: Capsule())
                    .overlay(Capsule().stroke(colors.border, lineWidth: 0.6))
            }
        }
        .padding(10)
        .frame(width: 214, alignment: .leading)
        .background(AccountCardBackground())
    }

    // MARK: - 結果・予想・前回

    private var results: some View {
        let snapshot = response.snapshot
        let unit = snapshot?.unit
        let released = response.event.status == .released
        let actual = released ? snapshot?.actual : nil
        return HStack(spacing: 0) {
            resultColumn("結果", value: actual, unit: unit, note: nil)
            divider
            resultColumn("予想", value: snapshot?.forecast, unit: unit, note: nil)
            divider
            resultColumn("前回", value: snapshot?.previous, unit: unit, note: Self.changeFromPrevious(actual: actual, previous: snapshot?.previous, unit: unit))
        }
        .padding(.vertical, 8)
        .frame(width: 214)
        .background(AccountCardBackground())
    }

    private var divider: some View {
        Rectangle().fill(SettingsCardStyle.cardBorder).frame(width: 0.5, height: 50)
    }

    private func resultColumn(_ title: String, value: Double?, unit: String?, note: String?) -> some View {
        // HQ指示(2026-10-09)「結果、予想、前回と数字、前回比を大きく中央に」。
        VStack(alignment: .center, spacing: 3) {
            NotoText.text(title, size: 9.5).foregroundStyle(SettingsCardStyle.subtitleColor)
            Text(value.map { ValueFormat.withUnit($0, unit: unit) } ?? "--")
                .font(.system(size: 17, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            NotoText.text(note ?? " ", size: 8)
                .foregroundStyle(SettingsListLayout.sectionTitleColor)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(.horizontal, 4)
        .frame(maxWidth: .infinity, alignment: .center)
    }

    /// 「(前回比 -0.2%)」。結果と前回がそろっているときだけ。
    static func changeFromPrevious(actual: Double?, previous: Double?, unit: String?) -> String? {
        guard let actual, let previous else { return nil }
        let diff = actual - previous
        let text = ValueFormat.withUnit(abs(diff), unit: unit)
        let sign = diff > 0 ? "+" : diff < 0 ? "-" : "±"
        return "(前回比 \(sign)\(text))"
    }

    // MARK: - 主要通貨ペアの値動き

    /// 表に出す通貨ペア。Backendの`major_fx_reactions`(v1.17)を使い、無い古いBackendでは
    /// 関連通貨ペアの5分の値だけで作る。
    var pairs: [EventMajorFxReaction] {
        if let major = response.majorFxReactions, !major.isEmpty { return major }
        return response.relatedFxPairs.map { EventMajorFxReaction(fxPairId: $0.fxPairId, symbol: $0.symbol, reactions: [$0.reaction]) }
    }

    /// HQ指示(2026-10-09)「縦線と横線を交わらせたきれいな表に」: どのマスも同じ幅・
    /// 高さの枠で囲み、隣どうしの線を重ねて1本の罫線にする(経済カレンダーと同じ作り)。
    private var reactionTable: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                cell(width: Self.pairColumnWidth) { Color.clear }
                ForEach(["1分", "5分", "15分"], id: \.self) { label in
                    cell(width: Self.valueColumnWidth) {
                        NotoText.text(label, size: 9.5).foregroundStyle(SettingsCardStyle.subtitleColor)
                    }
                }
            }
            .frame(height: Self.headerHeight)
            // HQ指示(2026-10-09)「見出し行だけ少し濃く」: 見出しの行は本文より少し濃い一色。
            .background(Self.headerFill)
            ForEach(pairs) { pair in
                NavigationLink(value: AppRoute.movementDetail(
                    eventId: response.event.id,
                    indicatorId: response.event.indicatorId,
                    fxPairId: pair.fxPairId,
                    symbol: pair.symbol,
                    indicatorName: response.event.indicatorName,
                    releaseDatetime: response.event.releaseDatetime
                )) {
                HStack(spacing: 0) {
                    cell(width: Self.pairColumnWidth, alignment: .leading) {
                        HStack(spacing: 5) {
                            HStack(spacing: -3) {
                                CountryFlagView(currencyCode: String(pair.symbol.prefix(3)), diameter: 12)
                                CountryFlagView(currencyCode: String(pair.symbol.suffix(3)), diameter: 12)
                            }
                            NotoText.text(FXPairSymbol.displayName(pair.symbol), size: 9.5)
                                .foregroundStyle(.white)
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                        }
                        .padding(.leading, 7)
                    }
                    ForEach(Self.timeframes, id: \.self) { timeframe in
                        cell(width: Self.valueColumnWidth) { pipsText(pair.reaction(for: timeframe)) }
                    }
                }
                .frame(height: Self.rowHeight)
                .contentShape(Rectangle())
                }
                .buttonStyle(SettingsRowPressStyle())
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(FXPairSymbol.displayName(pair.symbol))の相場反応を見る")
                .accessibilityAddTraits(.isButton)
            }
            if pairs.isEmpty {
                NotoText.text("値動きのデータはまだありません。", size: 8.5)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .frame(width: 214, height: 34)
                    .overlay(Rectangle().stroke(SettingsCardStyle.cardBorder, lineWidth: 0.5))
            }
        }
        .frame(width: 214)
        .background(Self.bodyGradient)
        .clipShape(RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius))
        .overlay(RoundedRectangle(cornerRadius: SettingsCardStyle.cornerRadius).stroke(SettingsCardStyle.cardBorder, lineWidth: 0.7))
    }

    /// 見出しの行: 本文と見分けがつく、少し明るい青(HQ指示 2026-10-09「もう少し明るく」)。
    private static let headerFill = Color(red: 0.04, green: 0.18, blue: 0.36)
    /// 本文: カードの色から少し明るい青へ、上から下へのゆるいグラデーション。
    private static let bodyGradient = LinearGradient(
        colors: [SettingsCardStyle.cardFill, Color(red: 0.03, green: 0.14, blue: 0.27)],
        startPoint: .top, endPoint: .bottom
    )

    private static let pairColumnWidth: CGFloat = 80
    private static let valueColumnWidth: CGFloat = (214 - 80) / 3
    private static let headerHeight: CGFloat = 22
    private static let rowHeight: CGFloat = 28

    private func cell(width: CGFloat, alignment: Alignment = .center, @ViewBuilder _ content: () -> some View) -> some View {
        content()
            .frame(width: width, alignment: alignment)
            .frame(maxHeight: .infinity)
            .overlay(Rectangle().stroke(SettingsCardStyle.cardBorder, lineWidth: 0.5))
    }

    @ViewBuilder private func pipsText(_ reaction: EventReactionSummary?) -> some View {
        if let reaction, reaction.analysisStatus == .ready, let pips = reaction.pips {
            Text(ValueFormat.number(pips, fractionDigits: 1, signed: true))
                .font(.system(size: 10, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(.white)
        } else {
            Text("--")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(SettingsCardStyle.subtitleColor)
        }
    }
}
