// プッシュ通知(Expoのプッシュ通知サービス)の送信を担うEdge Function。
// 「誰かが記録してもアプリを開くまで気づけない」への対応。
//
// 呼び出し元(アプリ)は、entry作成・支払い報告・受取確認のたびに、
// group_id・kind(通知の種類)・recipient_ids(通知したい相手のID)
// だけを渡す。実際の通知文言(誰が・どのグループで)は、なりすまし
// 防止のためクライアントの自己申告を信用せず、この関数がSupabaseの
// データを見て組み立てる:
//   - actorの表示名は、呼び出したユーザー自身(Authorizationヘッダーの
//     JWTから分かるauth.uid())のprofilesから引く
//   - グループ名・「本当にそのグループのメンバーか」は、呼び出したユーザー
//     自身の権限で動くSupabaseクライアント(RLSが効く)で引く。権限の
//     無いgroup_idを渡されても、クエリが0件になるだけで安全に失敗する
//   - recipient_idsも同様に、実際にそのグループのメンバーであるIDだけに
//     絞り込む(呼び出し元の自己申告を鵜呑みにしない)
// push_tokens自体はSELECTポリシーを持たないテーブルなので、絞り込んだ
// 相手のトークンを読む部分だけservice_role権限のクライアントに切り替える。
//
// 通知はベストエフォート: 失敗してもアプリ側の操作(entry作成等)自体は
// 既に成功しているため、この関数はほぼ常に200 okを返す(失敗の詳細は
// ログにのみ残す)。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
// Expoのプッシュ送信APIは1リクエストあたり最大100件まで。グループの
// 人数を考えれば通常は1回で十分だが、念のため分割して送る。
const EXPO_PUSH_BATCH_SIZE = 100;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type PushKind = 'entry_created' | 'marked_paid' | 'marked_confirmed';

type RequestBody = {
  group_id: string;
  kind: PushKind;
  recipient_ids: string[];
  amount?: number | null;
  currency?: string | null;
  description?: string | null;
};

// src/lib/currency.tsのformatMoneyと考え方は同じ(Deno側は別ランタイム
// のため、小さいのでここに複製している)。
function formatMoney(amount: number, code: string | null | undefined): string {
  const c = code || 'JPY';
  try {
    const formatted = new Intl.NumberFormat(undefined, { style: 'currency', currency: c }).format(amount);
    return c === 'JPY' ? formatted : `${formatted} ${c}`;
  } catch {
    return `¥${Math.round(amount).toLocaleString('ja-JP')}`;
  }
}

function buildMessage(
  lang: 'ja' | 'en',
  actorName: string,
  groupName: string,
  body: RequestBody
): { title: string; body: string } {
  const amountText = body.amount != null ? formatMoney(body.amount, body.currency) : null;
  if (lang === 'en') {
    switch (body.kind) {
      case 'entry_created':
        return {
          title: groupName,
          body: body.description
            ? `${actorName}: ${body.description}`
            : amountText
              ? `${actorName} added ${amountText}`
              : `${actorName} added a new entry`,
        };
      case 'marked_paid':
        return { title: groupName, body: `${actorName} marked a payment as sent. Please confirm.` };
      case 'marked_confirmed':
        return { title: groupName, body: `${actorName} confirmed your payment.` };
    }
  }
  switch (body.kind) {
    case 'entry_created':
      return {
        title: groupName,
        body: body.description
          ? `${actorName}さんが「${body.description}」を記録しました`
          : amountText
            ? `${actorName}さんが${amountText}を記録しました`
            : `${actorName}さんが記録を追加しました`,
      };
    case 'marked_paid':
      return { title: groupName, body: `${actorName}さんが支払ったと報告しました。確認をお願いします` };
    case 'marked_confirmed':
      return { title: groupName, body: `${actorName}さんへの支払いが確認されました` };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response('missing authorization', { status: 401, headers: CORS_HEADERS });

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) return new Response('unauthorized', { status: 401, headers: CORS_HEADERS });

    const body = (await req.json()) as RequestBody;
    if (!body.group_id || !body.kind || !Array.isArray(body.recipient_ids) || body.recipient_ids.length === 0) {
      return new Response('bad request', { status: 400, headers: CORS_HEADERS });
    }

    const [groupRes, actorRes] = await Promise.all([
      callerClient.from('groups').select('name').eq('id', body.group_id).maybeSingle(),
      callerClient.from('profiles').select('display_name').eq('id', userData.user.id).maybeSingle(),
    ]);
    // groupRes.dataがnull = RLS的にこのグループが見えない(=メンバーで
    // ない)ということなので、静かに終了する。
    if (!groupRes.data || !actorRes.data) return new Response('ok', { headers: CORS_HEADERS });

    const groupName = groupRes.data.name as string;
    const actorName = actorRes.data.display_name as string;

    // recipient_idsを「本当にこのグループのメンバーか」で絞り込む。
    const membersRes = await callerClient
      .from('group_members')
      .select('user_id')
      .eq('group_id', body.group_id)
      .in('user_id', body.recipient_ids);
    const validRecipientIds = (membersRes.data ?? [])
      .map((r) => r.user_id as string)
      .filter((id) => id !== userData.user.id);
    if (validRecipientIds.length === 0) return new Response('ok', { headers: CORS_HEADERS });

    // ここから先はpush_tokensを読む必要がある(SELECTポリシーが無い
    // テーブルのため、service_role権限に切り替える)。
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const tokensRes = await admin.from('push_tokens').select('token, lang').in('user_id', validRecipientIds);
    const tokens = tokensRes.data ?? [];
    if (tokens.length === 0) return new Response('ok', { headers: CORS_HEADERS });

    const messages = tokens.map((row) => {
      const lang = row.lang === 'en' ? 'en' : 'ja';
      const { title, body: messageBody } = buildMessage(lang, actorName, groupName, body);
      return {
        to: row.token as string,
        title,
        body: messageBody,
        data: { group_id: body.group_id },
        sound: 'default',
      };
    });

    for (let i = 0; i < messages.length; i += EXPO_PUSH_BATCH_SIZE) {
      const batch = messages.slice(i, i + EXPO_PUSH_BATCH_SIZE);
      const res = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(batch),
      });
      if (!res.ok) console.error('expo push send failed', res.status, await res.text());
    }

    return new Response('ok', { headers: CORS_HEADERS });
  } catch (e) {
    console.error('send-push failed', e);
    // ベストエフォートなので、失敗してもアプリ側には500を返さない。
    return new Response('ok', { headers: CORS_HEADERS });
  }
});
