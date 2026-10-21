# measurement_guard.rb のテスト(確かめ専用のワークフローから実行する。HQ承認 2026-10-21)。
#
# - 鍵の判定はテスト用に組み立てた JWT だけで確かめる(本物の Secrets は使わない・出さない)
# - ipa の確認は、MEASUREMENT_APP_PATH(ワークフローが xcodebuild でシミュレーター向けに
#   作った本物の .app)を Payload/ に入れた zip を ipa の代わりにして確かめる。
#   未設定のとき(手元で純粋な部分だけ回すとき)は、その2つのテストを skip する
# - Fastfile が接続先を Secrets から読まず、MeasurementGuard の固定値を使っていることも確かめる
#
#   ruby fastlane/test/measurement_guard_test.rb

require "minitest/autorun"
require "base64"
require "fileutils"
require "json"
require "open3"
require "tmpdir"
require_relative "../measurement_guard"

def fake_jwt(payload)
  body = Base64.urlsafe_encode64(JSON.generate(payload)).delete("=")
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.#{body}.signature"
end

class SupabaseKeyTest < Minitest::Test
  def test_dev_project_key_passes
    key = fake_jwt("iss" => "supabase", "ref" => MeasurementGuard::DEV_SUPABASE_REF, "role" => "anon")
    assert MeasurementGuard.dev_supabase_key?(key)
    MeasurementGuard.ensure_dev_supabase_key!(key) # raises nothing
  end

  def test_other_project_key_is_rejected_without_revealing_it
    key = fake_jwt("ref" => "anotherprojectref0000", "role" => "anon")
    error = assert_raises(MeasurementGuard::Error) { MeasurementGuard.ensure_dev_supabase_key!(key) }
    refute_includes error.message, key
    refute_includes error.message, "anotherprojectref0000"
  end

  def test_unverifiable_keys_are_rejected
    [
      "sb_publishable_0123456789abcdef", # new key format: no ref to check → stop
      "",
      nil,
      "a.b.c",
      "only.two",
      fake_jwt("role" => "anon"), # JWT without ref
      "#{fake_jwt('ref' => MeasurementGuard::DEV_SUPABASE_REF)}.extra" # 4 parts
    ].each do |key|
      refute MeasurementGuard.dev_supabase_key?(key), "should not accept #{key.inspect[0, 20]}"
      assert_raises(MeasurementGuard::Error) { MeasurementGuard.ensure_dev_supabase_key!(key) }
    end
  end
end

class ConnectionSettingsTest < Minitest::Test
  def test_build_settings_are_the_fixed_dev_urls
    assert_equal(
      ["SUPABASE_URL=https://pbemckwnqmeaoveelihd.supabase.co",
       "API_BASE_URL=https://fx-event-analyzer-api-dev.onrender.com/api/v1"],
      MeasurementGuard.connection_build_settings
    )
  end

  def test_build_settings_ignore_the_secret_environment_variables
    ENV["FX_API_BASE_URL"] = "https://production.example.invalid/api/v1"
    ENV["FX_SUPABASE_URL"] = "https://production.supabase.invalid"
    settings = MeasurementGuard.connection_build_settings.join(" ")
    refute_includes settings, "production"
  ensure
    ENV.delete("FX_API_BASE_URL")
    ENV.delete("FX_SUPABASE_URL")
  end

  def test_fastfile_uses_the_guard_and_not_the_secret_urls
    fastfile = File.read(File.join(__dir__, "..", "Fastfile"))
    assert_includes fastfile, "*MeasurementGuard.connection_build_settings"
    assert_includes fastfile, "MeasurementGuard.ensure_dev_supabase_key!"
    assert_includes fastfile, "MeasurementGuard.verify_ipa!"
    refute_match(/ENV\.fetch\(['"]FX_API_BASE_URL/, fastfile)
    refute_match(/ENV\.fetch\(['"]FX_SUPABASE_URL/, fastfile)
    # The checks come before the upload: key check → build → ipa check → upload.
    order = %w[ensure_dev_supabase_key! build_app( verify_ipa! upload_to_testflight(].map { |s| fastfile.index(s) }
    assert order.all?, "all steps present"
    assert_equal order.sort, order, "key check → build → ipa check → upload"
  end
end

class VerifyIpaTest < Minitest::Test
  APP_PATH = ENV["MEASUREMENT_APP_PATH"]

  def setup
    @dir = Dir.mktmpdir
  end

  def teardown
    FileUtils.rm_rf(@dir)
  end

  # Payload/<app>.app を zip にして ipa の代わりにする。block で Info.plist を書き換えられる。
  def make_ipa(name)
    skip "MEASUREMENT_APP_PATH not set (needs the simulator .app built by the workflow)" unless APP_PATH && File.directory?(APP_PATH)
    root = File.join(@dir, name)
    payload = File.join(root, "Payload")
    FileUtils.mkdir_p(payload)
    FileUtils.cp_r(APP_PATH, payload)
    plist = File.join(payload, File.basename(APP_PATH), "Info.plist")
    yield plist if block_given?
    ipa = File.join(@dir, "#{name}.ipa")
    _out, status = Open3.capture2e("zip", "-qry", ipa, "Payload", chdir: root)
    assert status.success?, "zip failed"
    ipa
  end

  def plist_set(plist, key, value)
    _out, status = Open3.capture2e("/usr/libexec/PlistBuddy", "-c", "Set :#{key} #{value}", plist)
    assert status.success?, "PlistBuddy Set failed"
  end

  def plist_delete(plist, key)
    _out, status = Open3.capture2e("/usr/libexec/PlistBuddy", "-c", "Delete :#{key}", plist)
    assert status.success?, "PlistBuddy Delete failed"
  end

  def test_the_real_build_has_the_dev_urls_and_passes
    ipa = make_ipa("ok")
    assert_equal MeasurementGuard::EXPECTED_INFO_PLIST, MeasurementGuard.verify_ipa!(ipa)
  end

  def test_a_non_dev_api_url_is_rejected
    ipa = make_ipa("bad-api") { |plist| plist_set(plist, "API_BASE_URL", "https://production.example.invalid/api/v1") }
    error = assert_raises(MeasurementGuard::Error) { MeasurementGuard.verify_ipa!(ipa) }
    assert_includes error.message, "API_BASE_URL"
  end

  def test_a_non_dev_supabase_url_is_rejected
    ipa = make_ipa("bad-supabase") { |plist| plist_set(plist, "SUPABASE_URL", "https://production.supabase.invalid") }
    error = assert_raises(MeasurementGuard::Error) { MeasurementGuard.verify_ipa!(ipa) }
    assert_includes error.message, "SUPABASE_URL"
  end

  def test_a_missing_key_is_rejected
    ipa = make_ipa("missing") { |plist| plist_delete(plist, "API_BASE_URL") }
    assert_raises(MeasurementGuard::Error) { MeasurementGuard.verify_ipa!(ipa) }
  end

  def test_a_zip_without_an_app_is_rejected
    empty = File.join(@dir, "empty")
    FileUtils.mkdir_p(File.join(empty, "Payload"))
    File.write(File.join(empty, "Payload", "README"), "no app")
    ipa = File.join(@dir, "empty.ipa")
    _out, status = Open3.capture2e("zip", "-qry", ipa, "Payload", chdir: empty)
    assert status.success?
    assert_raises(MeasurementGuard::Error) { MeasurementGuard.verify_ipa!(ipa) }
  end

  def test_a_missing_ipa_is_rejected
    assert_raises(MeasurementGuard::Error) { MeasurementGuard.verify_ipa!(File.join(@dir, "nope.ipa")) }
    assert_raises(MeasurementGuard::Error) { MeasurementGuard.verify_ipa!(nil) }
  end
end
