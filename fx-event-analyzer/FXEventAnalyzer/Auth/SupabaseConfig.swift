import Foundation

/// Reads the Supabase project URL and anon key injected at build time (see
/// `project.yml`'s `SUPABASE_URL` / `SUPABASE_ANON_KEY` settings and
/// `.github/workflows/fx-event-analyzer-ios-build.yml`).
///
/// No real Supabase project exists yet (Phase 0 audit confirmed this), so
/// `isConfigured` is expected to be `false` for the whole of Phase 1. Every
/// caller of this type must treat that as a normal, non-crashing state —
/// HQ's explicit requirement: "環境変数未設定によってアプリ全体がクラッシュ
/// しない構造にする".
struct SupabaseConfig {
    let projectURL: URL
    let anonKey: String

    /// The Auth-specific endpoint under the Supabase project, per
    /// supabase-swift's documented usage (`<project>.supabase.co/auth/v1`).
    var authURL: URL {
        projectURL.appendingPathComponent("auth/v1")
    }

    /// Attempts to load configuration from Info.plist. Returns `nil` — not
    /// an error — when either value is missing or blank, which is the
    /// expected state until a real Supabase project is provisioned.
    static func loadFromInfoPlist(bundle: Bundle = .main) -> SupabaseConfig? {
        guard
            let rawURL = bundle.infoDictionary?["SUPABASE_URL"] as? String,
            !rawURL.isEmpty,
            let url = URL(string: rawURL),
            let anonKey = bundle.infoDictionary?["SUPABASE_ANON_KEY"] as? String,
            !anonKey.isEmpty
        else {
            return nil
        }
        return SupabaseConfig(projectURL: url, anonKey: anonKey)
    }
}
