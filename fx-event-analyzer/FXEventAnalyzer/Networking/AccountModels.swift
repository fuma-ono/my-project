import Foundation

/// `GET/PATCH /api/v1/account` response shape (api-design.md §24) — the
/// Backend never returns a raw Profile row, only these fields.
struct AccountResponse: Decodable, Equatable {
    let userID: UUID
    let createdAt: Date
    let updatedAt: Date
    /// SCR-015 (v1.5): `null` until the user sets them in プロフィール編集.
    var displayName: String? = nil
    /// `YYYY-MM-DD` (a calendar date, no timezone) — see `BirthDate`.
    var birthDate: String? = nil

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case displayName = "display_name"
        case birthDate = "birth_date"
    }
}

/// `PATCH /api/v1/account` body (api-design.md §24.2). Both keys are always
/// sent — `null` clears the value — because プロフィール編集 saves the whole
/// form at once.
struct AccountUpdate: Encodable, Equatable {
    let displayName: String?
    let birthDate: String?

    enum CodingKeys: String, CodingKey {
        case displayName = "display_name"
        case birthDate = "birth_date"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(displayName, forKey: .displayName)
        try container.encode(birthDate, forKey: .birthDate)
    }
}

/// Converts the Backend's `YYYY-MM-DD` birth dates to and from `Date`.
/// Fixed to the Gregorian calendar in UTC so the day never shifts with the
/// device's calendar or timezone.
enum BirthDate {
    private static let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }

    static func date(from string: String) -> Date? { formatter.date(from: string) }
    static func string(from date: Date) -> String { formatter.string(from: date) }

    /// "1990年1月1日"
    static func display(_ string: String) -> String? {
        guard let date = date(from: string) else { return nil }
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return "\(parts.year!)年\(parts.month!)月\(parts.day!)日"
    }
}
