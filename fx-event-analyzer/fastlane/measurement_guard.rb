# 計測用ビルド(claude/fx-ios-network-metrics)の接続先の守り。HQ指示(2026-10-21)
# 「計測用ビルドの接続先を DEV に固定」「Fastfile の確認をアップロードせずに検証する」。
#
# Fastfile から読み込んで使い、確かめ専用のワークフロー
# (.github/workflows/fx-event-analyzer-measurement-fastfile-check.yml)のテスト
# (fastlane/test/measurement_guard_test.rb)からも同じコードを呼ぶ。fastlane に
# 依存しない素の Ruby(標準ライブラリだけ)にしてある。
#
# 鍵・プロジェクト番号は、どの戻り値・エラーメッセージにも含めない。

require "base64"
require "json"
require "open3"
require "tmpdir"

module MeasurementGuard
  DEV_API_BASE_URL = "https://fx-event-analyzer-api-dev.onrender.com/api/v1"
  DEV_SUPABASE_URL = "https://pbemckwnqmeaoveelihd.supabase.co"
  DEV_SUPABASE_REF = "pbemckwnqmeaoveelihd"

  # ipa の Info.plist で確かめる項目と、期待する値。
  EXPECTED_INFO_PLIST = {
    "API_BASE_URL" => DEV_API_BASE_URL,
    "SUPABASE_URL" => DEV_SUPABASE_URL
  }.freeze

  class Error < StandardError; end

  module_function

  # Supabase の鍵(JWT)のペイロードの "ref"。JWT でない・読めない場合は nil。
  def supabase_key_ref(key)
    parts = key.to_s.split(".")
    return nil unless parts.length == 3

    payload = parts[1].tr("-_", "+/")
    payload += "=" * ((4 - payload.length % 4) % 4)
    JSON.parse(Base64.decode64(payload))["ref"]
  rescue StandardError
    nil
  end

  def dev_supabase_key?(key)
    supabase_key_ref(key) == DEV_SUPABASE_REF
  end

  # 鍵が DEV のプロジェクトのものでなければ Error(鍵の値は出さない)。
  def ensure_dev_supabase_key!(key)
    return if dev_supabase_key?(key)

    raise Error, "計測用ビルド: FX_SUPABASE_ANON_KEY が DEV の Supabase プロジェクトの鍵だと確認できないため中止します(鍵の値は表示しません)"
  end

  # xcodebuild に渡す接続先の build setting(Secrets を使わない固定値)。
  def connection_build_settings
    ["SUPABASE_URL=#{DEV_SUPABASE_URL}", "API_BASE_URL=#{DEV_API_BASE_URL}"]
  end

  # ipa の Payload/*.app/Info.plist を読み、EXPECTED_INFO_PLIST と完全に一致しなければ Error。
  # 戻り値は確かめた値(DEV の URL だけ)。
  def verify_ipa!(ipa_path)
    raise Error, "計測用ビルド: ipa が見つからないため中止します" unless ipa_path && File.file?(ipa_path)

    Dir.mktmpdir do |dir|
      _out, status = Open3.capture2e("unzip", "-q", "-o", ipa_path, "Payload/*.app/Info.plist", "-d", dir)
      raise Error, "計測用ビルド: ipa から Info.plist を取り出せないため中止します" unless status.success?

      plist = Dir.glob(File.join(dir, "Payload", "*.app", "Info.plist")).first
      raise Error, "計測用ビルド: ipa の Info.plist が見つからないため中止します" if plist.nil?

      EXPECTED_INFO_PLIST.to_h do |key, expected|
        actual, read_status = Open3.capture2e("/usr/libexec/PlistBuddy", "-c", "Print :#{key}", plist)
        actual = actual.strip
        unless read_status.success? && actual == expected
          raise Error, "計測用ビルド: Info.plist の #{key} が DEV ではないため中止します"
        end

        [key, actual]
      end
    end
  end
end
