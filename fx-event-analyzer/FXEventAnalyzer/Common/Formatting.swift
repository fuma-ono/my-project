import Foundation

/// Small display-formatting helpers shared by every screen that renders
/// Backend-computed numbers/dates. No calculation happens here — only
/// presentation of values the Backend already computed (api-design.md §8:
/// "iOS側でこれらを再計算して表示することを前提としない").
enum ValueFormat {
    /// 単位付きの値(ホームの「予想 18.0万人」「予想 2.9%」)。`千人`は読みやすい
    /// 万人にそろえる(180千人 → 18.0万人)。seedの雇用統計は`K`(千人)なので同じ扱い。
    /// 単位が無ければ数値だけ。
    static func withUnit(_ value: Double, unit: String?) -> String {
        switch unit?.trimmingCharacters(in: .whitespaces) {
        case nil, "": return number(value)
        case "千人", "K":
            let formatter = NumberFormatter()
            formatter.numberStyle = .decimal
            formatter.minimumFractionDigits = 1
            formatter.maximumFractionDigits = 1
            return (formatter.string(from: NSNumber(value: value / 10)) ?? number(value / 10)) + "万人"
        case let unit?: return number(value) + unit
        }
    }

    static func number(_ value: Double?, fractionDigits: Int = 2, signed: Bool = false) -> String {
        guard let value else { return "--" }
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = fractionDigits
        if signed {
            formatter.positivePrefix = "+"
        }
        return formatter.string(from: NSNumber(value: value)) ?? "--"
    }

    static func percent(_ value: Double?, fractionDigits: Int = 2, signed: Bool = false) -> String {
        guard value != nil else { return "--" }
        return "\(number(value, fractionDigits: fractionDigits, signed: signed))%"
    }

    static func pips(_ value: Double?, signed: Bool = true) -> String {
        guard value != nil else { return "--" }
        return "\(number(value, fractionDigits: 1, signed: signed)) pips"
    }

    static func time(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    static func dateTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    /// nil once the moment has passed — callers show "発表済み"/"発表前"
    /// from `status` instead, never a negative countdown.
    static func countdown(to date: Date, from now: Date = Date()) -> String? {
        let interval = date.timeIntervalSince(now)
        guard interval > 0 else { return nil }
        let totalMinutes = Int(interval) / 60
        let hours = totalMinutes / 60
        let minutes = totalMinutes % 60
        if hours > 0 { return "\(hours)時間\(minutes)分後" }
        return "\(minutes)分後"
    }

    /// Phase 4.5 UX audit: the existing POSITIVE/NEGATIVE/NEUTRAL label is
    /// `favorable_direction`-adjusted and doesn't say which way the raw
    /// numbers moved. This reads only the sign of `surprise` (already
    /// `actual - forecast`, api-design.md §9) — Backend data only, no
    /// inference, no trading implication.
    static func surpriseComparisonLabel(_ surprise: Double?) -> String? {
        guard let surprise else { return nil }
        if surprise > 0 { return "予想を上回る結果" }
        if surprise < 0 { return "予想を下回る結果" }
        return "予想通りの結果"
    }
}

enum CountryFlag {
    /// ISO 3166-1 alpha-2 → Regional Indicator Symbol flag emoji. Falls
    /// back to the raw code for anything that isn't a 2-letter code (never
    /// crashes on unexpected data).
    static func emoji(for countryCode: String) -> String {
        let code = countryCode.uppercased()
        guard code.unicodeScalars.count == 2 else { return code }
        let base: UInt32 = 127_397
        var view = String.UnicodeScalarView()
        for scalar in code.unicodeScalars {
            guard let flagScalar = Unicode.Scalar(base + scalar.value) else { return code }
            view.append(flagScalar)
        }
        return String(view)
    }

    /// HQ UI Master v5's "米) 消費者物価指数" country-abbreviation prefix
    /// (SCR-005/006/007 指標一覧/指標詳細/イベント詳細) — a single-kanji
    /// short form, not the full country name. Falls back to the raw country
    /// code for anything not in this common set rather than guessing an
    /// abbreviation.
    static func kanjiAbbreviation(for countryCode: String) -> String {
        switch countryCode.uppercased() {
        case "US": return "米"
        case "JP": return "日"
        case "GB": return "英"
        case "DE", "FR", "IT", "ES", "EA", "EU": return "欧"
        case "AU": return "豪"
        case "CA": return "加"
        case "CN": return "中"
        case "NZ": return "新"
        case "CH": return "瑞"
        default: return countryCode.uppercased()
        }
    }

    /// ISO 4217通貨コード → 日本語の通貨名。HQ指示(2026-10-06)「通貨ペア
    /// 内のUSD/JPYの下に米ドル/円と記載して」で追加。`representativeCountry
    /// (forCurrency:)`と同じ9通貨のみ対応し、対応が無ければ通貨コードを
    /// そのまま返す(存在しない名称を捏造しない)。
    static func japaneseName(forCurrency currencyCode: String) -> String {
        switch currencyCode.uppercased() {
        case "USD": return "米ドル"
        case "JPY": return "円"
        case "EUR": return "ユーロ"
        case "GBP": return "ポンド"
        case "AUD": return "豪ドル"
        case "CAD": return "加ドル"
        case "CNY": return "人民元"
        case "NZD": return "NZドル"
        case "CHF": return "スイスフラン"
        default: return currencyCode.uppercased()
        }
    }

    /// ISO 4217通貨コード → 代表国のISO 3166コードという客観的な対応表
    /// (通貨と国の標準的な関係であり、推測や捏造ではない)。`imageName
    /// (forCurrency:)`から再利用する。
    private static func representativeCountry(forCurrency currencyCode: String) -> String {
        switch currencyCode.uppercased() {
        case "USD": return "US"
        case "JPY": return "JP"
        case "EUR": return "EU"
        case "GBP": return "GB"
        case "AUD": return "AU"
        case "CAD": return "CA"
        case "CNY": return "CN"
        case "NZD": return "NZ"
        case "CHF": return "CH"
        default: return currencyCode
        }
    }

    /// HQ指示(2026-10-02、4回目)「国旗はUnicode絵文字ではなく画像アセット
    /// として扱ってください」: 絵文字フォントのレンダリング特性(字送りの
    /// 左右非対称・サイズごとの挙動不一致)に合わせてフォントサイズ/
    /// オフセットを個別調整し続けるアプローチを7回試しても国旗ごとに
    /// 結果が不安定だったため、Asset Catalogの正方形画像(`FlagXX`、
    /// `CountryFlagView`参照)に切り替えた。実装しているのは通貨ペア一覧
    /// (`emoji(forCurrency:)`時代と同じ9通貨)に対応する代表国のみ —
    /// 対応が無い国コードは`nil`を返し、呼び出し側(`CountryFlagView`)が
    /// 中立的なフォールバック表示にする(存在しない画像を補完・捏造しない)。
    static func imageName(for countryCode: String) -> String? {
        let supported: Set<String> = ["US", "JP", "EU", "GB", "AU", "CA", "CN", "NZ", "CH"]
        let code = countryCode.uppercased()
        guard supported.contains(code) else { return nil }
        return "Flag\(code)"
    }

    static func imageName(forCurrency currencyCode: String) -> String? {
        imageName(for: representativeCountry(forCurrency: currencyCode))
    }
}

extension Importance {
    var starDisplay: String {
        switch self {
        case .high: return "★★★"
        case .medium: return "★★☆"
        case .low: return "★☆☆"
        }
    }

    var label: String {
        switch self {
        case .high: return "重要度: 高"
        case .medium: return "重要度: 中"
        case .low: return "重要度: 低"
        }
    }
}

extension SurpriseDirection {
    var label: String {
        switch self {
        case .positive: return "ポジティブ・サプライズ"
        case .negative: return "ネガティブ・サプライズ"
        case .neutral: return "サプライズなし"
        }
    }
}

extension DataQualityStatus {
    var label: String {
        switch self {
        case .ready: return "READY"
        case .dataPending: return "データ取得中"
        case .dataUnavailable: return "データ未取得"
        case .notAnalyzable: return "分析対象外"
        }
    }
}
