import SwiftUI

/// SCR-007 イベント詳細の本体(HQ指示 2026-10-09の参考画像)。上から、指標の
/// カード(国旗・名前・国|通貨・発表日時・重要度)、結果/予想/前回のカード、
/// 「主要通貨ペアの値動き(pips)」の表(1分・5分・15分)、通貨ペアを選んで
/// SCR-008 相場反応詳細へ進むボタン。
struct EventDetailCards: View {
    let response: EventDetailResponse
    let onSelectPairs: () -> Void

    static let timeframes = ["1m", "5m", "15m"]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            results
            NotoText.text("主要通貨ペアの値動き（pips）", size: 9.5)
                .foregroundStyle(.white)
                .padding(.horizontal, 4)
                .padding(.top, 2)
            reactionTable
            Button(action: onSelectPairs) {
                NotoText.text("通貨ペアを選択して詳細を見る", size: 8.5)
                    .foregroundStyle(.white)
                    .frame(width: 214, height: 29)
                    .background(
                        RoundedRectangle(cornerRadius: 7)
                            .fill(SettingsCardStyle.cardFill)
                            .overlay(RoundedRectangle(cornerRadius: 7).stroke(V5P.cyan.opacity(0.7), lineWidth: 0.8))
                    )
                    .contentShape(Rectangle())
            }
            .buttonStyle(SettingsRowPressStyle())
            .disabled(pairs.isEmpty)
            .opacity(pairs.isEmpty ? 0.4 : 1)
            .padding(.top, 4)
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
                NotoText.text("\(CountryFlag.japaneseName(forCountry: event.countryCode))　|　\(event.currencyCode)", size: 7.5)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 5) {
                NotoText.text("\(AppPreferences.shared.dateString(event.releaseDatetime)) \(AppPreferences.shared.timeString(event.releaseDatetime))", size: 6.5)
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
        Rectangle().fill(SettingsCardStyle.cardBorder).frame(width: 0.5, height: 38)
    }

    private func resultColumn(_ title: String, value: Double?, unit: String?, note: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            NotoText.text(title, size: 7.5).foregroundStyle(SettingsCardStyle.subtitleColor)
            Text(value.map { ValueFormat.withUnit($0, unit: unit) } ?? "--")
                .font(.system(size: 14, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            NotoText.text(note ?? " ", size: 6)
                .foregroundStyle(SettingsListLayout.sectionTitleColor)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(.horizontal, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
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

    private var reactionTable: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                Color.clear.frame(width: Self.pairColumnWidth)
                ForEach(["1分", "5分", "15分"], id: \.self) { label in
                    NotoText.text(label, size: 7.5)
                        .foregroundStyle(SettingsCardStyle.subtitleColor)
                        .frame(maxWidth: .infinity)
                        .overlay(alignment: .leading) { gridLine }
                }
            }
            .frame(height: 20)
            ForEach(pairs) { pair in
                Rectangle().fill(SettingsCardStyle.cardBorder).frame(height: 0.5)
                HStack(spacing: 0) {
                    HStack(spacing: 5) {
                        HStack(spacing: -3) {
                            CountryFlagView(currencyCode: String(pair.symbol.prefix(3)), diameter: 11)
                            CountryFlagView(currencyCode: String(pair.symbol.suffix(3)), diameter: 11)
                        }
                        NotoText.text(FXPairSymbol.displayName(pair.symbol), size: 8)
                            .foregroundStyle(.white)
                            .lineLimit(1)
                            .fixedSize()
                    }
                    .frame(width: Self.pairColumnWidth, alignment: .leading)
                    .padding(.leading, 8)
                    ForEach(Self.timeframes, id: \.self) { timeframe in
                        pipsText(pair.reaction(for: timeframe))
                            .frame(maxWidth: .infinity)
                            .overlay(alignment: .leading) { gridLine }
                    }
                }
                .frame(height: 25)
            }
            if pairs.isEmpty {
                Rectangle().fill(SettingsCardStyle.cardBorder).frame(height: 0.5)
                NotoText.text("値動きのデータはまだありません。", size: 8)
                    .foregroundStyle(SettingsCardStyle.subtitleColor)
                    .frame(maxWidth: .infinity, minHeight: 32)
            }
        }
        .frame(width: 214)
        .background(AccountCardBackground())
    }

    private static let pairColumnWidth: CGFloat = 70

    private var gridLine: some View {
        Rectangle().fill(SettingsCardStyle.cardBorder).frame(width: 0.5).frame(maxHeight: .infinity)
    }

    @ViewBuilder private func pipsText(_ reaction: EventReactionSummary?) -> some View {
        if let reaction, reaction.analysisStatus == .ready, let pips = reaction.pips {
            Text(ValueFormat.number(pips, fractionDigits: 1, signed: true))
                .font(.system(size: 8.5, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(.white)
        } else {
            Text("--")
                .font(.system(size: 8.5, weight: .semibold))
                .foregroundStyle(SettingsCardStyle.subtitleColor)
        }
    }
}
