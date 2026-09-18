import Foundation

/// Small display-formatting helpers shared by every screen that renders
/// Backend-computed numbers/dates. No calculation happens here — only
/// presentation of values the Backend already computed (api-design.md §8:
/// "iOS側でこれらを再計算して表示することを前提としない").
enum ValueFormat {
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
