/**
 * 公式の配信元が自動の取得を拒否している(HTTP 403)ことを表すエラー。
 *
 * 豪州準備銀行(RBA)の RSS は、Web Application Firewall で保護されており、自動の取得が 403 になりうる(RBA の
 * https://www.rba.gov.au/qa/rss.html に「The RSS feeds are protected by Web Application Firewall (WAF) controls」、
 * 問い合わせ先 rbainfo@rba.gov.au。2026-11-18 確認)。**この拒否を、ブラウザを装う・ヘッダを変える等で回避しない**。
 * 取れないことは記録して知らせ(ingestion_logs の skip_reasons・note)、他の取得元の実行を妨げない。
 */
import { HttpError } from './http.js';

export class SourceAccessDeniedError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
  ) {
    super(
      `${provider}: access denied by the source (HTTP ${status}). Not retried or worked around; ask the publisher.`,
    );
    this.name = 'SourceAccessDeniedError';
  }
}

/** 取得で HTTP 403 になったら SourceAccessDeniedError にして投げ直す。それ以外のエラーはそのまま。 */
export async function withAccessDeniedMapping<T>(provider: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HttpError && error.status === 403) throw new SourceAccessDeniedError(provider, 403);
    throw error;
  }
}
