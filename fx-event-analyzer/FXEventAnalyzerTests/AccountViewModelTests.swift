import XCTest
@testable import FXEventAnalyzer

private func waitUntil(_ condition: @escaping () -> Bool) async {
    for _ in 0..<100 {
        if condition() { return }
        try? await Task.sleep(nanoseconds: 10_000_000)
    }
}

private func jsonObject(_ data: Data?) throws -> [String: Any] {
    let data = try XCTUnwrap(data)
    return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
}

private let userID = UUID(uuidString: "00000000-0000-0000-0000-000000000001")!
private let sampleAccount = AccountResponse(
    userID: userID, createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0),
    displayName: "山田 太郎", birthDate: "1990-01-01"
)
private let sampleSettings = SettingsResponse(
    notifications: .defaults,
    display: DisplaySettings(language: "ja", region: "US", timezone: "Asia/Tokyo"),
    chart: .defaults
)
private let sampleSession = UserSession(
    userID: userID, accessToken: "token",
    expiresAt: Date(timeIntervalSinceNow: 3600), email: "taro@example.com"
)

// MARK: - Models / Service (api-design.md §24.1–24.3)

final class AccountProfileModelsTests: XCTestCase {
    func testDecodesDisplayNameAndBirthDate() throws {
        let json = """
        {
          "user_id": "00000000-0000-0000-0000-000000000001",
          "display_name": "山田 太郎",
          "birth_date": "1990-01-01",
          "created_at": "2026-09-10T12:30:00Z",
          "updated_at": "2026-09-10T12:30:00Z"
        }
        """.data(using: .utf8)!
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let account = try decoder.decode(AccountResponse.self, from: json)

        XCTAssertEqual(account.displayName, "山田 太郎")
        XCTAssertEqual(account.birthDate, "1990-01-01")
    }

    func testUpdateAlwaysSendsBothKeysWithNullForUnset() throws {
        let body = try jsonObject(JSONEncoder().encode(AccountUpdate(displayName: nil, birthDate: "2000-02-29")))

        XCTAssertEqual(Set(body.keys), ["display_name", "birth_date"])
        XCTAssertTrue(body["display_name"] is NSNull)
        XCTAssertEqual(body["birth_date"] as? String, "2000-02-29")
    }

    func testBirthDateRoundTripsAndFormatsInJapanese() throws {
        let date = try XCTUnwrap(BirthDate.date(from: "1990-01-01"))
        XCTAssertEqual(BirthDate.string(from: date), "1990-01-01")
        XCTAssertEqual(BirthDate.display("1990-01-01"), "1990年1月1日")
        XCTAssertNil(BirthDate.display("not-a-date"))
    }
}

final class AccountServiceWriteTests: XCTestCase {
    func testUpdateAccountPatchesTheAccountPath() async throws {
        let apiClient = MockAPIClient()
        apiClient.result = .success(sampleAccount)

        let result = try await AccountService(apiClient: apiClient).updateAccount(AccountUpdate(displayName: "山田 太郎", birthDate: nil))

        XCTAssertEqual(apiClient.lastEndpoint?.path, "account")
        XCTAssertEqual(apiClient.lastEndpoint?.method, .patch)
        XCTAssertEqual(try jsonObject(apiClient.lastEndpoint?.body)["display_name"] as? String, "山田 太郎")
        XCTAssertEqual(result, sampleAccount)
    }

    func testDeleteAccountSendsDelete() async throws {
        let apiClient = MockAPIClient()
        apiClient.result = .success(EmptyResponse())

        try await AccountService(apiClient: apiClient).deleteAccount()

        XCTAssertEqual(apiClient.lastEndpoint?.path, "account")
        XCTAssertEqual(apiClient.lastEndpoint?.method, .delete)
    }
}

// MARK: - SCR-015 アカウント情報

@MainActor
final class AccountViewModelTests: XCTestCase {
    func testLoadCombinesAccountSessionEmailAndRegion() async {
        let apiClient = MockAPIClient()
        apiClient.results = ["account": .success(sampleAccount), "settings": .success(sampleSettings)]
        let auth = MockAuthService(isConfigured: true)
        auth.sessionResult = .success(sampleSession)
        let viewModel = AccountViewModel(apiClient: apiClient, authService: auth)

        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        XCTAssertEqual(viewModel.state, .loaded(AccountInfo(account: sampleAccount, email: "taro@example.com", regionCode: "US")))
    }

    func testSettingsFailureOnlyBlanksTheRegion() async {
        let apiClient = MockAPIClient()
        apiClient.results = [
            "account": .success(sampleAccount),
            "settings": .failure(APIError.transport("offline")),
        ]
        let viewModel = AccountViewModel(apiClient: apiClient)

        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        XCTAssertEqual(viewModel.state, .loaded(AccountInfo(account: sampleAccount, email: nil, regionCode: nil)))
    }

    func testAccountFailureShowsError() async {
        let apiClient = MockAPIClient()
        apiClient.results = ["account": .failure(APIError.transport("offline")), "settings": .success(sampleSettings)]
        let viewModel = AccountViewModel(apiClient: apiClient)

        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        XCTAssertEqual(viewModel.state, .error("アカウント情報の取得に失敗しました。"))
    }

    func testUnconfiguredBackend() async {
        let viewModel = AccountViewModel(apiClient: MockAPIClient())

        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        XCTAssertEqual(viewModel.state, .backendNotConfigured)
    }

    func testApplyReplacesTheShownAccount() async {
        let apiClient = MockAPIClient()
        apiClient.results = ["account": .success(sampleAccount), "settings": .success(sampleSettings)]
        let viewModel = AccountViewModel(apiClient: apiClient)
        viewModel.load()
        await waitUntil { viewModel.state != .loading }

        var updated = sampleAccount
        updated.displayName = "佐藤 花子"
        viewModel.apply(updated)

        guard case .loaded(let info) = viewModel.state else { return XCTFail("Expected .loaded") }
        XCTAssertEqual(info.account.displayName, "佐藤 花子")
        XCTAssertEqual(info.regionCode, "US")
    }
}

// MARK: - プロフィール編集

@MainActor
final class ProfileEditViewModelTests: XCTestCase {
    func testStartsFromTheCurrentValuesWithNothingToSave() {
        let viewModel = ProfileEditViewModel(apiClient: MockAPIClient(), account: sampleAccount)

        XCTAssertEqual(viewModel.displayName, "山田 太郎")
        XCTAssertEqual(viewModel.birthDate.map(BirthDate.string(from:)), "1990-01-01")
        XCTAssertFalse(viewModel.canSave)
    }

    func testBlankNameAndClearedDateAreSavedAsNull() async throws {
        let apiClient = MockAPIClient()
        var cleared = sampleAccount
        cleared.displayName = nil
        cleared.birthDate = nil
        apiClient.result = .success(cleared)
        let viewModel = ProfileEditViewModel(apiClient: apiClient, account: sampleAccount)

        viewModel.displayName = "   "
        viewModel.birthDate = nil
        let saved = await viewModel.save()

        XCTAssertEqual(saved, cleared)
        let body = try jsonObject(apiClient.lastEndpoint?.body)
        XCTAssertTrue(body["display_name"] is NSNull)
        XCTAssertTrue(body["birth_date"] is NSNull)
    }

    func testSavesTrimmedNameAndNewDate() async throws {
        let apiClient = MockAPIClient()
        apiClient.result = .success(sampleAccount)
        let viewModel = ProfileEditViewModel(apiClient: apiClient, account: sampleAccount)

        viewModel.displayName = "  佐藤 花子 "
        viewModel.birthDate = BirthDate.date(from: "2000-02-29")
        _ = await viewModel.save()

        let body = try jsonObject(apiClient.lastEndpoint?.body)
        XCTAssertEqual(body["display_name"] as? String, "佐藤 花子")
        XCTAssertEqual(body["birth_date"] as? String, "2000-02-29")
    }

    func testFailureKeepsTheFormAndShowsError() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(APIError.transport("offline"))
        let viewModel = ProfileEditViewModel(apiClient: apiClient, account: sampleAccount)

        viewModel.displayName = "佐藤 花子"
        let saved = await viewModel.save()

        XCTAssertNil(saved)
        XCTAssertEqual(viewModel.displayName, "佐藤 花子")
        guard case .error = viewModel.state else { return XCTFail("Expected .error, got \(viewModel.state)") }
    }
}

// MARK: - メールアドレス変更

@MainActor
final class EmailChangeViewModelTests: XCTestCase {
    func testValidation() {
        let viewModel = EmailChangeViewModel(authService: MockAuthService(isConfigured: true), currentEmail: "taro@example.com")

        XCTAssertNil(viewModel.validationMessage)
        XCTAssertFalse(viewModel.canSubmit)
        viewModel.email = "taro@"
        XCTAssertEqual(viewModel.validationMessage, "メールアドレスの形式が正しくありません。")
        viewModel.email = "TARO@example.com"
        XCTAssertEqual(viewModel.validationMessage, "現在のメールアドレスと同じです。")
        viewModel.email = "hanako@example.com"
        XCTAssertTrue(viewModel.canSubmit)
    }

    func testSubmitRequestsTheChange() async {
        let auth = MockAuthService(isConfigured: true)
        let viewModel = EmailChangeViewModel(authService: auth, currentEmail: "taro@example.com")

        viewModel.email = " hanako@example.com "
        await viewModel.submit()

        XCTAssertEqual(auth.updatedEmail, "hanako@example.com")
        guard case .done = viewModel.state else { return XCTFail("Expected .done, got \(viewModel.state)") }
    }

    func testSubmitFailureShowsError() async {
        let auth = MockAuthService(isConfigured: true)
        auth.updateEmailError = AuthServiceError.network("offline")
        let viewModel = EmailChangeViewModel(authService: auth, currentEmail: nil)

        viewModel.email = "hanako@example.com"
        await viewModel.submit()

        guard case .error = viewModel.state else { return XCTFail("Expected .error, got \(viewModel.state)") }
    }
}

// MARK: - パスワード変更

@MainActor
final class PasswordChangeViewModelTests: XCTestCase {
    func testValidation() {
        let viewModel = PasswordChangeViewModel(authService: MockAuthService(isConfigured: true))

        viewModel.currentPassword = "OldPass12"
        viewModel.newPassword = "short"
        XCTAssertEqual(viewModel.validationMessage, "新しいパスワードは8文字以上にしてください。")
        viewModel.newPassword = "newpass12"
        XCTAssertEqual(viewModel.validationMessage, "英字の大文字・小文字と数字をそれぞれ含めてください。")
        viewModel.newPassword = "NEWPASS12"
        XCTAssertEqual(viewModel.validationMessage, "英字の大文字・小文字と数字をそれぞれ含めてください。")
        viewModel.newPassword = "NewPassword"
        XCTAssertEqual(viewModel.validationMessage, "英字の大文字・小文字と数字をそれぞれ含めてください。")
        viewModel.newPassword = "OldPass12"
        XCTAssertEqual(viewModel.validationMessage, "現在のパスワードと異なるものにしてください。")
        viewModel.newPassword = "NewPass12"
        viewModel.confirmation = "NewPass13"
        XCTAssertEqual(viewModel.validationMessage, "確認用のパスワードが一致しません。")
        viewModel.confirmation = "NewPass12"
        XCTAssertNil(viewModel.validationMessage)
        XCTAssertTrue(viewModel.canSubmit)
    }

    func testSubmitChangesAndClearsTheFields() async {
        let auth = MockAuthService(isConfigured: true)
        let viewModel = PasswordChangeViewModel(authService: auth)
        viewModel.currentPassword = "OldPass12"
        viewModel.newPassword = "NewPass12"
        viewModel.confirmation = "NewPass12"

        await viewModel.submit()

        XCTAssertEqual(auth.updatedPassword?.current, "OldPass12")
        XCTAssertEqual(auth.updatedPassword?.new, "NewPass12")
        XCTAssertEqual(viewModel.currentPassword, "")
        XCTAssertEqual(viewModel.state, .done("パスワードを変更しました。"))
    }

    func testWrongCurrentPassword() async {
        let auth = MockAuthService(isConfigured: true)
        auth.updatePasswordError = AuthServiceError.invalidCredentials
        let viewModel = PasswordChangeViewModel(authService: auth)
        viewModel.currentPassword = "wrongpass"
        viewModel.newPassword = "NewPass12"
        viewModel.confirmation = "NewPass12"

        await viewModel.submit()

        XCTAssertEqual(viewModel.state, .error("現在のパスワードが正しくありません。"))
        XCTAssertEqual(viewModel.newPassword, "NewPass12")
    }
}

// MARK: - SCR-024 アカウント削除

@MainActor
final class AccountDeletionViewModelTests: XCTestCase {
    func testDeleteSignsOutAndReturnsToLogin() async {
        let apiClient = MockAPIClient()
        apiClient.result = .success(EmptyResponse())
        let auth = MockAuthService(isConfigured: true)
        var signOutCallCount = 0
        let viewModel = AccountDeletionViewModel(apiClient: apiClient, authService: auth) { signOutCallCount += 1 }

        await viewModel.delete()

        XCTAssertEqual(apiClient.lastEndpoint?.method, .delete)
        XCTAssertEqual(signOutCallCount, 1)
    }

    func testLocalSignOutFailureStillReturnsToLogin() async {
        let apiClient = MockAPIClient()
        apiClient.result = .success(EmptyResponse())
        let auth = MockAuthService(isConfigured: true)
        auth.signOutError = AuthServiceError.network("offline")
        var signOutCallCount = 0
        let viewModel = AccountDeletionViewModel(apiClient: apiClient, authService: auth) { signOutCallCount += 1 }

        await viewModel.delete()

        XCTAssertEqual(signOutCallCount, 1)
    }

    func testDeleteFailureStaysSignedIn() async {
        let apiClient = MockAPIClient()
        apiClient.result = .failure(APIError.server(code: .internalError, message: "boom", httpStatus: 500))
        var signOutCallCount = 0
        let viewModel = AccountDeletionViewModel(apiClient: apiClient, authService: MockAuthService(isConfigured: true)) { signOutCallCount += 1 }

        await viewModel.delete()

        XCTAssertEqual(signOutCallCount, 0)
        guard case .error = viewModel.state else { return XCTFail("Expected .error, got \(viewModel.state)") }
    }
}
