// LINEログインが「Error getting user profile from external provider / failed to
// verify ID token: oidc: malformed jwt: unexpected signature algorithm "HS256";
// expected ["ES256"]」で失敗する問題への対応。
//
// 原因: LINEの通常のWebログインは、IDトークンをHS256(チャネルシークレットを鍵に
// 使う対称鍵方式)で署名して返す。Supabaseの「カスタムOIDCプロバイダー」機能は
// 汎用のOIDCライブラリを使っており、ES256(非対称鍵)を前提にしているため、
// LINEのIDトークンを検証できずに失敗する。これはLINE側・Supabase側どちらの
// 設定を変えても直せない、既知の非互換(他のOIDCライブラリでも同様の報告あり)。
//
// 対応方針: SupabaseのAuth機能(signInWithOAuth/カスタムOIDCプロバイダー)を
// 経由するのをやめ、LINEとのOAuthのやり取りをこの関数(Edge Function)で
// 自前で行う。
//   1. アプリ側がLINEの認可URLを直接開く(state引数にアプリの戻り先
//      exp://... のURLを入れておく)
//   2. LINEはこの関数の固定URL(Supabase Functionsの通常のURL)へcodeと
//      stateを付けてリダイレクトしてくる(この固定URLだけをLINE
//      Developersのコールバック先として登録すればよく、Expo Goの
//      exp://...がセッションごとに変わっても困らない)
//   3. この関数がcodeをLINEのトークンエンドポイントに送ってIDトークンを取得し、
//      HS256で自前検証する(Web Crypto APIのHMAC検証、JWKS不要)
//   4. 検証できたら、LINEのユーザーID(sub)から決まる仮のメールアドレスで
//      Supabaseのユーザーを探す/作る(admin.generateLinkは対象ユーザーが
//      いなければ自動的に作成してくれる)
//   5. 発行されたhashed_tokenを、アプリ側のexp://...のURLにクエリパラメータ
//      として付けてリダイレクトする(WebBrowser.openAuthSessionAsyncが
//      これを検知してアプリに戻ってくる)
//   6. アプリ側はそのhashed_tokenをsupabase.auth.verifyOtp()に渡して
//      実際のセッションを確立する
//
// 必要な環境変数(Supabaseダッシュボード → Edge Functions → line-signin →
// Secrets で設定する。SUPABASE_URLとSUPABASE_SERVICE_ROLE_KEYは
// Edge Functions実行時に自動で用意されるため設定不要):
//   LINE_CHANNEL_ID     — LINE Developersの「チャネル基本設定」にある値
//   LINE_CHANNEL_SECRET — 同上

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const LINE_TOKEN_ENDPOINT = 'https://api.line.me/oauth2/v2.1/token';
const LINE_ISSUER = 'https://access.line.me';
// このURLがLINE Developers側の「コールバックURL」として登録すべき、
// このEdge Function自身の固定URL(functions/v1/<関数名>の形になる)。
const CALLBACK_URL = 'https://ixtxrwlqrqyvlpvzroaq.supabase.co/functions/v1/line-signin';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function base64UrlToUint8Array(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeJson(b64url: string): Record<string, unknown> {
  const bytes = base64UrlToUint8Array(b64url);
  return JSON.parse(new TextDecoder().decode(bytes));
}

// LINEのIDトークン(HS256)をチャネルシークレットで検証する。JWKS(公開鍵)は
// 使わない(HS256は対称鍵方式のため、署名に使った鍵=検証に使う鍵で、
// それがチャネルシークレットそのもの)。
async function verifyLineIdToken(idToken: string, channelId: string, channelSecret: string): Promise<Record<string, unknown>> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('malformed id_token');
  const [headerB64, payloadB64, sigB64] = parts;

  const header = base64UrlDecodeJson(headerB64);
  if (header.alg !== 'HS256') throw new Error(`unexpected alg: ${header.alg}`);

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(channelSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const signature = base64UrlToUint8Array(sigB64);
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const valid = await crypto.subtle.verify('HMAC', key, signature, data);
  if (!valid) throw new Error('invalid signature');

  const payload = base64UrlDecodeJson(payloadB64);
  if (payload.iss !== LINE_ISSUER) throw new Error(`unexpected iss: ${payload.iss}`);
  if (payload.aud !== channelId) throw new Error(`unexpected aud: ${payload.aud}`);
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) throw new Error('id_token expired');

  return payload;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  // stateには、アプリ側が最初に付けた「戻り先(exp://...)」のURLをそのまま
  // 入れてもらう(詳細はsrc/lib/socialAuth.tsのbuildLineAuthorizeUrl参照)。
  const appRedirect = url.searchParams.get('state');

  if (!appRedirect) {
    // 戻り先が分からないと何もできないので、ここだけは普通のJSONエラーで返す。
    return new Response(JSON.stringify({ error: 'missing state (app redirect url)' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // Response.redirect()の代わりに、Locationヘッダーを直接持つResponseを
  // 手動で組み立てる。Response.redirect()はURLのスキームを検証しようと
  // することがあり、exp://のような通常のブラウザが使わないカスタム
  // スキームだと弾かれる可能性があるため(Denoでの既知の制限)、それを避ける。
  const redirectTo = (location: string) => new Response(null, { status: 302, headers: { ...CORS_HEADERS, Location: location } });

  const fail = (message: string) => {
    const dest = new URL(appRedirect);
    dest.searchParams.set('error', message);
    return redirectTo(dest.toString());
  };

  try {
    if (!code) return fail('missing code');

    const channelId = Deno.env.get('LINE_CHANNEL_ID');
    const channelSecret = Deno.env.get('LINE_CHANNEL_SECRET');
    if (!channelId || !channelSecret) return fail('server not configured (missing LINE secrets)');

    const bodyParams = new URLSearchParams();
    bodyParams.set('grant_type', 'authorization_code');
    bodyParams.set('code', code);
    bodyParams.set('redirect_uri', CALLBACK_URL);
    bodyParams.set('client_id', channelId);
    bodyParams.set('client_secret', channelSecret);

    const tokenRes = await fetch(LINE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: bodyParams.toString(),
    });
    if (!tokenRes.ok) {
      // 「400としか分からない」ではデバッグできないため、LINE側が返してくる
      // 実際のエラー内容(invalid_client等)をそのままアプリの画面まで返す。
      // 一時的な診断用に、client_id/secretが実際に読めていた長さも一緒に返す
      // (値そのものは含めない)。原因が分かったら消してよい。
      const bodyText = await tokenRes.text();
      return fail(
        `line token exchange failed (${tokenRes.status}): ${bodyText.slice(0, 300)} ` +
          `[debug: channelId.len=${channelId.length} channelSecret.len=${channelSecret.length} redirect_uri=${CALLBACK_URL}]`
      );
    }
    const tokenBody = (await tokenRes.json()) as { id_token?: string };
    if (!tokenBody.id_token) return fail('line response missing id_token');

    const claims = await verifyLineIdToken(tokenBody.id_token, channelId, channelSecret);
    const sub = claims.sub as string;
    if (!sub) return fail('id_token missing sub');

    // LINEはメールアドレスを返さないことが多い(別途審査が必要)ため、
    // LINEのユーザーID(sub)から決まる、本物のメールとは絶対に衝突しない
    // 仮のメールアドレスを使う。同じLINEアカウントなら毎回同じ値になるため、
    // 「既存なら再ログイン、無ければ新規作成」が自然に成立する。
    const pseudoEmail = `line-${sub}@line.kashikari.internal`;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: pseudoEmail });
    if (error || !data) return fail(`generateLink failed: ${error?.message ?? 'unknown'}`);

    const dest = new URL(appRedirect);
    dest.searchParams.set('email', pseudoEmail);
    dest.searchParams.set('token_hash', data.properties.hashed_token);
    return redirectTo(dest.toString());
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'unknown error');
  }
});
