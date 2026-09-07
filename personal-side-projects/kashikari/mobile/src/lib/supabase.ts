import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// EAS Buildでこの2つが未設定だと(.envはgit管理外なので、EAS側の
// Environment Variablesに登録し忘れていると起きる)、createClient()に
// 空文字列を渡すことになり`new URL('', '')`相当の内部処理が例外を投げて
// 起動直後に真っ白画面のままクラッシュする(本番ビルドはRedBoxが出ない
// ため原因が分からず、単なる「白い画面」にしか見えない)。それを防ぐため、
// 未設定でもcreateClient自体は落ちないダミーURLを渡し、代わりに
// isSupabaseConfiguredで呼び出し側(App.tsx)が分かりやすいエラー画面を
// 出せるようにしている。
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  // 起動時に分かりやすく気づけるように、握りつぶさず警告する。
  // .env の作り方は README.md を参照(EAS Buildの場合はEAS側の
  // Environment Variablesに登録する必要がある)。
  console.warn(
    '[kashikari] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY が未設定です。' +
      '.env.example を .env にコピーし、Supabaseプロジェクトの値を入れてください。' +
      '(EAS Buildの場合はEAS Environment Variablesにも登録すること)'
  );
}

export const supabase = createClient(supabaseUrl || 'https://placeholder.invalid', supabaseAnonKey || 'placeholder', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
