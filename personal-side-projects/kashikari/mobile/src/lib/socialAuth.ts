// 「Google/Apple/LINE/メールでログインできるようにした方がいい」という
// 提案への対応。今までは匿名サインイン(端末に紐づくだけの仮アカウント)
// のみで、端末を失う・アプリを消す等で二度とアクセスできなくなる
// リスクがあった。この仕組みで「今の(匿名の)アカウントに、あとから
// 本物のログイン方法を後付けする」(=データは失わない)ことができる。
//
// 実装方針:
// - Google/Facebook: Supabaseのブラウザ経由OAuth(signInWithOAuth/
//   linkIdentity)。Expo Go上でも動く(expo-auth-sessionのmakeRedirectUriが、
//   Expo Go内では自動的にexp://の一時URLを、スタンドアロンビルドでは
//   kashikari://を使うよう出し分けてくれるため)。
// - LINE: SupabaseのAuthを経由せず、自前のEdge Function
//   (supabase/functions/line-signin)を介した独自実装。LINEの通常の
//   Webログインが返すIDトークンはHS256署名(チャネルシークレットを
//   鍵にする対称鍵方式)だが、SupabaseのOIDC検証はES256(非対称鍵)を
//   前提にしており、この組み合わせだと「failed to verify ID token:
//   unexpected signature algorithm "HS256"; expected ["ES256"]」で
//   必ず失敗する(LINE側・Supabase側どちらの設定でも直せない既知の
//   非互換)。そのため、LINEとのやり取りとIDトークン検証は自前の
//   Edge Functionで行い、検証できたらSupabaseの管理者APIで
//   マジックリンクのトークンを発行してもらい、それをアプリ側で
//   verifyOtpに渡してセッションを確立する。詳細はEdge Function内の
//   コメント参照。この仕組み上、「今のセッションにLINEを追加連携する」
//   (mode:'link')には対応していない(常にLINE側のアカウントに
//   紐づく別セッションへのサインインになる)。
// - Apple: expo-apple-authentication(Expo公式パッケージなのでExpo Go内でも
//   動く)のネイティブSign in with Appleボタンを使い、そこで得られる
//   identityTokenをsupabase.auth.signInWithIdTokenに渡す方式(ブラウザ
//   のOAuth往復が不要でよりシンプル・確実)。iOSのみ。
// - メール: マジックリンク(ディープリンクの受け取りが必要で、Expo Go上
//   では不安定になりがち)ではなく、6桁のコードをメールで送るOTP方式。
//   ディープリンクを一切使わないため、Expo Go・スタンドアロンどちらでも
//   同じ確実さで動く。
import * as AppleAuthentication from 'expo-apple-authentication';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { supabase } from './supabase';

// LINEログイン専用Edge Functionの固定URL。LINE Developers側の
// 「コールバックURL」にはこれを登録する(Supabase自身のauth/v1/callback
// ではない)。詳細はsupabase/functions/line-signin/index.tsのコメント参照。
const LINE_SIGNIN_FUNCTION_URL = 'https://ixtxrwlqrqyvlpvzroaq.supabase.co/functions/v1/line-signin';

// signInWithOAuthが返すブラウザ用URLを開いたあと、ExpoアプリのURLへ
// リダイレクトが戻ってきたときに、開いたままのブラウザセッションを
// 閉じて呼び出し元に結果を返せるようにするおまじない(モジュール読み込み
// 時に1度だけ呼べばよい)。
WebBrowser.maybeCompleteAuthSession();

// 'apple'はGoogleとは別経路(ネイティブSign in with Apple、下記
// signInWithApple参照)を主に使うが、linkIdentityにはApple用の口が
// 無いため、そのケースだけこのブラウザ経由OAuthにフォールバックする。
// 'facebook'はSupabaseの組み込みプロバイダーなので、Googleと
// 全く同じブラウザ経由OAuthで動く。LINEはSupabaseを経由しない
// 別実装(下記signInWithLine参照)のため、ここには含めない。
export type OAuthProvider = 'google' | 'apple' | 'facebook';
// 「今の(匿名の)アカウントに後付けする」か、「(別の端末等で)本来の
// アカウントとしてサインインし直す」かで、呼ぶSupabaseのAPIが違う。
export type AuthMode = 'link' | 'signin';

// 「Googleでログインしようとしてログインページを閉じたら、そのまま
// 次に進めてしまう」というバグへの対応。以前は「キャンセルされた」場合も
// { error: null }を返しており、呼び出し元(AuthMethods.tsxのrun())は
// 「errorが無い=成功」としてonDone(次のステップへ進む処理)を呼んで
// しまっていた。キャンセルと成功を区別するため、cancelledフラグを
// 追加した(呼び出し元はcancelled===trueなら何もせず静かに戻る)。
async function runOAuthFlow(provider: OAuthProvider, mode: AuthMode): Promise<{ error: string | null; cancelled?: boolean }> {
  // Expo Go内ではexp://の一時URLに、スタンドアロン/開発ビルドでは
  // kashikari://に、自動的に出し分けられる。
  const redirectTo = AuthSession.makeRedirectUri();
  const options = { redirectTo, skipBrowserRedirect: true };
  const { data, error } =
    mode === 'link' ? await supabase.auth.linkIdentity({ provider, options }) : await supabase.auth.signInWithOAuth({ provider, options });
  if (error) return { error: error.message };
  if (!data?.url) return { error: 'failed to start oauth' };

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type === 'cancel' || result.type === 'dismiss') return { error: null, cancelled: true }; // ユーザーが自分でキャンセルしただけ
  if (result.type !== 'success' || !result.url) return { error: 'oauth failed' };

  // SupabaseはPKCEフローで「?code=...」を付けて返す(実装によっては
  // 「#access_token=...」の場合もあるため両方に対応する)。
  const url = new URL(result.url.replace('#', '?'));
  const code = url.searchParams.get('code');
  if (code) {
    const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
    if (exErr) return { error: exErr.message };
    return { error: null };
  }
  const accessToken = url.searchParams.get('access_token');
  const refreshToken = url.searchParams.get('refresh_token');
  if (accessToken && refreshToken) {
    const { error: setErr } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (setErr) return { error: setErr.message };
    return { error: null };
  }
  return { error: url.searchParams.get('error_description') ?? 'oauth failed' };
}

export function signInWithGoogle(mode: AuthMode) {
  return runOAuthFlow('google', mode);
}

// LINEはSupabaseのOAuthを経由しない独自実装(冒頭のコメント参照)。
// 上のrunOAuthFlowとは別の、専用のロジック。
export async function signInWithLine(mode: AuthMode): Promise<{ error: string | null; cancelled?: boolean }> {
  if (mode === 'link') {
    // Edge Function側の仕組み上、常に「LINEのアカウントに紐づく
    // (既存 or 新規の)セッションへサインインし直す」形になり、今の
    // セッションに追加連携することができない。誤って今のアカウントの
    // データを見失わせないよう、ここでは対応しない。
    return { error: 'LINEでの追加連携には対応していません(サインインのみ利用できます)' };
  }
  const channelId = process.env.EXPO_PUBLIC_LINE_CHANNEL_ID;
  if (!channelId) return { error: 'LINEログインが設定されていません(EXPO_PUBLIC_LINE_CHANNEL_ID未設定)' };

  // アプリの戻り先(exp://...、セッションごとに変わる)をstateに載せて
  // Edge Functionまで運んでもらう。Edge Function自身のURLは固定なので、
  // LINE Developers側にはそちらを登録すればよい。
  const redirectTo = AuthSession.makeRedirectUri();
  const authUrl =
    `https://access.line.me/oauth2/v2.1/authorize?response_type=code` +
    `&client_id=${encodeURIComponent(channelId)}` +
    `&redirect_uri=${encodeURIComponent(LINE_SIGNIN_FUNCTION_URL)}` +
    `&state=${encodeURIComponent(redirectTo)}` +
    `&scope=openid`;

  const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectTo);
  if (result.type === 'cancel' || result.type === 'dismiss') return { error: null, cancelled: true };
  if (result.type !== 'success' || !result.url) return { error: 'line sign-in failed' };

  const url = new URL(result.url.replace('#', '?'));
  const errorParam = url.searchParams.get('error');
  if (errorParam) return { error: errorParam };

  const email = url.searchParams.get('email');
  const tokenHash = url.searchParams.get('token_hash');
  if (!email || !tokenHash) return { error: 'line sign-in failed (missing token)' };

  const { error } = await supabase.auth.verifyOtp({ email, token_hash: tokenHash, type: 'email' });
  return { error: error?.message ?? null };
}

export function signInWithFacebook(mode: AuthMode) {
  return runOAuthFlow('facebook', mode);
}

// Appleは公式パッケージのネイティブボタン経由(iOSのみ)。ブラウザの
// 往復が要らないため、Google/LINEよりシンプルかつ確実。
// 「なんでAppleが無い?」という指摘への対応。isAvailableAsync()自体が
// 何らかの理由(ネイティブモジュールが見つからない等)で例外を投げると、
// 呼び出し元(AuthMethods.tsx)はawaitしているだけなので、これまでは
// catchされずにボタンがただ静かに出ない状態になっていた(エラーの手掛かりが
// 一切残らない)。try/catchで確実にfalseへ倒し、開発中に原因を追えるよう
// console.warnも残す。
export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch (e) {
    console.warn('[socialAuth] isAppleSignInAvailable failed:', e);
    return false;
  }
}

export async function signInWithApple(mode: AuthMode): Promise<{ error: string | null; cancelled?: boolean }> {
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
    });
    if (!credential.identityToken) return { error: 'apple sign-in failed' };
    if (mode === 'link') {
      // linkIdentityはOAuthの往復(URL)を前提にしたAPIのため、Appleの
      // ネイティブトークンを直接渡す口が無い。今の匿名アカウントを
      // 保護する目的では、Google/LINE同様にブラウザ経由のOAuthに
      // フォールバックする。
      return runOAuthFlow('apple', mode);
    }
    const { error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken });
    return { error: error?.message ?? null };
  } catch (e) {
    const err = e as { code?: string };
    // 「キャンセルしたら次に進めてしまう」バグへの対応(runOAuthFlowと
    // 同じ理由)。cancelled:trueを返し、成功と区別できるようにする。
    if (err.code === 'ERR_REQUEST_CANCELED') return { error: null, cancelled: true };
    return { error: 'apple sign-in failed' };
  }
}

// メールは6桁コードのOTP方式(ディープリンク不要)。「今のアカウントに
// 後付け」(link)と「サインイン/新規登録」(signin)で、送信・検証それぞれ
// 呼ぶAPIとtypeが異なる(Supabaseの仕様)。
//   - signin: signInWithOtp → verifyOtp(type:'email')
//   - link  : updateUser({ email }) → verifyOtp(type:'email_change')
export async function sendEmailCode(email: string, mode: AuthMode): Promise<{ error: string | null }> {
  if (mode === 'link') {
    const { error } = await supabase.auth.updateUser({ email });
    return { error: error?.message ?? null };
  }
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  return { error: error?.message ?? null };
}

export async function verifyEmailCode(email: string, token: string, mode: AuthMode): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.verifyOtp({ email, token, type: mode === 'link' ? 'email_change' : 'email' });
  return { error: error?.message ?? null };
}

// 「ログアウト機能」への対応。匿名サインインのみのアカウントでログアウト
// すると、次回起動時に作られる新しい匿名アカウントは全くの別人扱いになり、
// 今のグループのデータに二度とアクセスできなくなる。ログアウト前にこれを
// 判定して警告文を出し分けるため、Google/Apple/LINE/メールのいずれかが
// 連携済み(=サインインし直せば元のアカウントに戻れる)かどうかを返す。
export async function hasLinkedIdentity(): Promise<boolean> {
  const { data } = await supabase.auth.getUserIdentities();
  return (data?.identities.length ?? 0) > 0;
}
