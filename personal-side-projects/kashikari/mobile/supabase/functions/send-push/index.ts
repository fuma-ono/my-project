// プッシュ通知(Expoのプッシュ通知サービス)の送信を担うEdge Function。
// 「誰かが記録してもアプリを開くまで気づけない」への対応。
//
// 呼び出し元(アプリ)は、entry作成・支払い報告・受取確認・催促のたびに、
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
// 既に成功しているため、この関数はほぼ常に200を返す(失敗の詳細はログ
// にのみ残す)。ただし「催促する」(kind:'remind')だけは、送信できたか
// どうかを呼び出し元(アプリ)がユーザーに表示するため、レスポンスボディ
// を`{ sent: boolean }`のJSONにしている(トークンが見つからず実際には
// 送っていない場合はsent:false)。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
// Expoのプッシュ送信APIは1リクエストあたり最大100件まで。グループの
// 人数を考えれば通常は1回で十分だが、念のため分割して送る。
const EXPO_PUSH_BATCH_SIZE = 100;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type PushKind =
  | 'entry_created'
  | 'marked_paid'
  | 'marked_confirmed'
  | 'remind'
  | 'entry_deleted'
  | 'entry_edited'
  | 'settled_manually'
  | 'unsettled_manually'
  | 'left_group';
type RemindTone = 'gentle' | 'normal' | 'funny' | 'strong';

type RequestBody = {
  group_id: string;
  kind: PushKind;
  recipient_ids: string[];
  amount?: number | null;
  currency?: string | null;
  description?: string | null;
  tone?: RemindTone | null;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

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

// 「催促する」の文面。旧src/lib/remind.tsが持っていた4トーンの文面と
// 同じ(共有シートでのテキスト送信をやめてプッシュ通知に一本化した際、
// 文面の組み立てをここに移した)。誰から届いた通知か分かるよう、
// 先頭にactorNameを付ける。
function remindMessage(lang: 'ja' | 'en', tone: RemindTone, actorName: string, amountText: string): string {
  if (lang === 'en') {
    switch (tone) {
      case 'gentle':
        return `${actorName}: Hey, no rush, but whenever you get a chance 🙏\n\nAmount: ${amountText}`;
      case 'normal':
        return `${actorName}: Quick one — ${amountText} from before, whenever works!`;
      case 'funny':
        return `${actorName}: Your ${amountText} has been on quite a journey 💸\n\nTime to bring it home?`;
      case 'strong':
        return `${actorName}: Hi, could you settle up the ${amountText}? Thanks.`;
    }
  }
  switch (tone) {
    case 'gentle':
      return `${actorName}: この前の精算、まだだったので時間のあるときお願いします🙏\n\n金額：${amountText}`;
    case 'normal':
      return `${actorName}: この前の分で${amountText}お願い!`;
    case 'funny':
      return `${actorName}: あなたの${amountText}がまだ旅を続けています💸\n\nそろそろ帰してあげてください。`;
    case 'strong':
      return `${actorName}: すみません、${amountText}の精算をお願いします!`;
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
      case 'remind':
        return { title: groupName, body: remindMessage('en', body.tone ?? 'normal', actorName, amountText ?? '') };
      case 'entry_deleted':
        return {
          title: groupName,
          body: body.description
            ? `${actorName} deleted "${body.description}"`
            : amountText
              ? `${actorName} deleted the ${amountText} entry`
              : `${actorName} deleted an entry`,
        };
      case 'entry_edited':
        return {
          title: groupName,
          body: body.description
            ? `${actorName} edited "${body.description}"`
            : amountText
              ? `${actorName} changed the amount to ${amountText}`
              : `${actorName} edited an entry`,
        };
      case 'settled_manually':
        return {
          title: groupName,
          body: body.description
            ? `${actorName} marked "${body.description}" as settled`
            : amountText
              ? `${actorName} marked ${amountText} as settled`
              : `${actorName} marked an entry as settled`,
        };
      case 'unsettled_manually':
        return {
          title: groupName,
          body: body.description
            ? `${actorName} marked "${body.description}" as unsettled`
            : `${actorName} marked an entry as unsettled`,
        };
      case 'left_group':
        return { title: groupName, body: `${actorName} left the group` };
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
    case 'remind':
      return { title: groupName, body: remindMessage('ja', body.tone ?? 'normal', actorName, amountText ?? '') };
    case 'entry_deleted':
      return {
        title: groupName,
        body: body.description
          ? `${actorName}さんが「${body.description}」の記録を削除しました`
          : amountText
            ? `${actorName}さんが${amountText}の記録を削除しました`
            : `${actorName}さんが記録を削除しました`,
      };
    case 'entry_edited':
      return {
        title: groupName,
        body: body.description
          ? `${actorName}さんが「${body.description}」を編集しました`
          : amountText
            ? `${actorName}さんが記録を${amountText}に変更しました`
            : `${actorName}さんが記録を編集しました`,
      };
    case 'settled_manually':
      return {
        title: groupName,
        body: body.description
          ? `${actorName}さんが「${body.description}」を精算済みにしました`
          : amountText
            ? `${actorName}さんが${amountText}を精算済みにしました`
            : `${actorName}さんが記録を精算済みにしました`,
      };
    case 'unsettled_manually':
      return {
        title: groupName,
        body: body.description
          ? `${actorName}さんが「${body.description}」を未精算に戻しました`
          : `${actorName}さんが記録を未精算に戻しました`,
      };
    case 'left_group':
      return { title: groupName, body: `${actorName}さんがグループを退出しました` };
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
    if (!groupRes.data || !actorRes.data) return jsonResponse({ sent: false });

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
    if (validRecipientIds.length === 0) return jsonResponse({ sent: false });

    // ここから先はpush_tokensを読む必要がある(SELECTポリシーが無い
    // テーブルのため、service_role権限に切り替える)。
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const tokensRes = await admin.from('push_tokens').select('token, user_id, lang').in('user_id', validRecipientIds);
    const tokens = tokensRes.data ?? [];

    // アプリ内の通知履歴(notification_log)には、実際にOSのプッシュ通知を
    // 送れたか(=通知トークンを持っているか)に関わらず、対象メンバー
    // 全員に1行ずつ記録する。トークンを持つ相手はその言語設定に合わせ、
    // 持たない相手は日本語をデフォルトにする。
    const langByUser = new Map<string, 'ja' | 'en'>();
    for (const row of tokens) langByUser.set(row.user_id as string, row.lang === 'en' ? 'en' : 'ja');
    const logRows = validRecipientIds.map((recipientId) => {
      const { title, body: messageBody } = buildMessage(langByUser.get(recipientId) ?? 'ja', actorName, groupName, body);
      return { user_id: recipientId, group_id: body.group_id, group_name: groupName, title, body: messageBody };
    });
    const { error: logError } = await admin.from('notification_log').insert(logRows);
    if (logError) console.error('notification_log insert failed', logError);

    if (tokens.length === 0) return jsonResponse({ sent: false });

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
      if (!res.ok) {
        console.error('expo push send failed', res.status, await res.text());
        continue;
      }
      // res.okでも、個々のメッセージ単位でエラーが返ることがある
      // (無効化されたトークン等)。「送ったつもりで実は届いていない」を
      // 追えるよう、そのチケットの内容をログに残す。
      const resultJson = (await res.json()) as { data?: Array<{ status: string; message?: string; details?: unknown }> };
      resultJson.data?.forEach((ticket, idx) => {
        if (ticket.status !== 'ok') {
          console.error('expo push ticket error', batch[idx]?.to, ticket.status, ticket.message, ticket.details);
        }
      });
    }

    return jsonResponse({ sent: true });
  } catch (e) {
    console.error('send-push failed', e);
    // ベストエフォートなので、失敗してもアプリ側には500を返さない。
    return jsonResponse({ sent: false });
  }
});
