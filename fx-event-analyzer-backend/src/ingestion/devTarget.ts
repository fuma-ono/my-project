/**
 * 接続先が DEV の Supabase であることを、処理を始める前に確かめる(HQ承認 2026-11-11「DEV以外では処理が開始されない」)。
 *
 * ワークフローの確認(service_role の鍵の中の project ref = DEV_PROJECT_REF)に加えて、ジョブの中でも同じことを確かめる
 * 二重の守り。次のどれか1つでも満たさなければ、DB に触る前に止める(例外):
 *   1. DEV_PROJECT_REF がある(ワークフローの env。英小文字・数字の20文字)
 *   2. SUPABASE_URL が https://<DEV_PROJECT_REF>.supabase.co
 *   3. SUPABASE_SERVICE_ROLE_KEY(JWT)の ref が DEV_PROJECT_REF
 * エラーの文には鍵・URL の値を入れない(どの条件に合わなかったかだけ)。
 */

export class NotDevTargetError extends Error {
  constructor(reason: string) {
    super(`not the DEV database: ${reason}. Nothing was read or written.`);
    this.name = 'NotDevTargetError';
  }
}

function jwtRef(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as {
      ref?: unknown;
    };
    return typeof payload.ref === 'string' ? payload.ref : null;
  } catch {
    return null;
  }
}

export function assertDevTarget(env: Readonly<Record<string, string | undefined>>): { ref: string } {
  const ref = env.DEV_PROJECT_REF?.trim() ?? '';
  if (!/^[a-z0-9]{20}$/.test(ref)) throw new NotDevTargetError('DEV_PROJECT_REF is missing or malformed');
  const url = (env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  if (url !== `https://${ref}.supabase.co`) throw new NotDevTargetError('SUPABASE_URL is not the DEV project');
  if (jwtRef(env.SUPABASE_SERVICE_ROLE_KEY ?? '') !== ref) {
    throw new NotDevTargetError('the service role key is not for the DEV project');
  }
  return { ref };
}
