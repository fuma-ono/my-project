/**
 * DEV の要人発言の読み取り専用の確認(HQ指示 2026-11-12「Actions の既存 Secrets を利用する読み取り専用確認 target」)。
 * 判定・集計・出力の形だけ(DB・HTTP は読まない — 読むのは jobs/verifySpeechesDev.ts)。
 *
 * 出力してよいもの: 件数・状態別の内訳・指紋(md5)・発言の id・公式ページの URL・日時・回数・API の HTTP の状態コード。
 * 出力しないもの: 本文・要約の中身、鍵・接続情報(このファイルは受け取らない)。
 *
 * 指紋は、DEV の SQL Editor で流してきた確認の SQL と同じ値になるように作る:
 *   md5(string_agg(concat_ws('|', id, status, body_status, coalesce(source_url,''), coalesce(md5(speech_body),''),
 *       coalesce(md5(summary),''), coalesce(summary_method,''), coalesce(summary_error,''), coalesce(body_error,''),
 *       coalesce(body_fetched_at::text,''), coalesce(summary_generated_at::text,''), body_attempts::text,
 *       coalesce(body_last_attempt_at::text,'')), ',' order by id))   … provider ごと
 * timestamptz::text は UTC のセッションで 'YYYY-MM-DD HH:MM:SS[.ffffff]+00'。PostgREST の JSON は
 * 'YYYY-MM-DDTHH:MM:SS[.ffffff]+00:00' なので、その形に直してから使う(pgTimestampText)。
 */
import { createHash } from 'node:crypto';

export interface VerifySpeechRow {
  id: string;
  provider: string;
  status: string;
  body_status: string;
  body_error: string | null;
  source_url: string | null;
  body_attempts: number;
  body_last_attempt_at: string | null;
  body_fetched_at: string | null;
  summary_method: string | null;
  summary_error: string | null;
  summary_generated_at: string | null;
  statement_datetime: string;
  speech_body: string | null;
  summary: string | null;
  /** 発言の題名(公開情報)。本文が公式の一覧に無い行の見分けに使う(2026-11-13 追加)。 */
  title?: string | null;
}

export interface VerifyRunRow {
  job: string;
  started_at: string;
  status: string;
  fetched_count: number | null;
  success_count: number | null;
  error_count: number | null;
  details: unknown;
}

export const md5 = (text: string): string => createHash('md5').update(text, 'utf8').digest('hex');

/** PostgREST の timestamptz(JSON)→ Postgres の timestamptz::text(UTC のセッション)。null は null。 */
export function pgTimestampText(value: string | null): string | null {
  if (value === null) return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)(?:\+00:00|Z)$/.exec(value);
  if (!m) throw new Error(`unexpected timestamp format: ${value.slice(0, 40)}`);
  return `${m[1]} ${m[2]}+00`;
}

function rowFingerprintPart(r: VerifySpeechRow): string {
  return [
    r.id,
    r.status,
    r.body_status,
    r.source_url ?? '',
    r.speech_body === null ? '' : md5(r.speech_body),
    r.summary === null ? '' : md5(r.summary),
    r.summary_method ?? '',
    r.summary_error ?? '',
    r.body_error ?? '',
    pgTimestampText(r.body_fetched_at) ?? '',
    pgTimestampText(r.summary_generated_at) ?? '',
    String(r.body_attempts),
    pgTimestampText(r.body_last_attempt_at) ?? '',
  ].join('|');
}

/** provider ごとの指紋(SQL の確認と同じ式)。 */
export function fingerprints(rows: readonly VerifySpeechRow[]): Record<string, { n: number; fingerprint: string }> {
  const out: Record<string, { n: number; fingerprint: string }> = {};
  for (const provider of [...new Set(rows.map((r) => r.provider))].sort()) {
    const mine = rows.filter((r) => r.provider === provider).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    out[provider] = { n: mine.length, fingerprint: md5(mine.map(rowFingerprintPart).join(',')) };
  }
  return out;
}

const tail = (url: string | null) => (url ? url.split('/').at(-1)! : null);
const short = (hash: string | null) => (hash ? hash.slice(0, 8) : null);

export interface SpeechDevReport {
  at: string;
  total: number;
  byState: Record<string, number>;
  attempts: Record<string, number>;
  attempted: number;
  fingerprints: Record<string, { n: number; fingerprint: string }>;
  ecb: {
    n: number;
    notApplicableRightsUnconfirmed: number;
    bodyNull: number;
    summaryNull: number;
    attemptsNonZero: number;
    other: { id: string; status: string; body_status: string; body_error: string | null }[];
  };
  frbFuture: {
    n: number;
    withBodyOrAttempt: number;
    rows: { id: string; at: string; status: string; body_status: string; attempts: number }[];
  };
  frbRows: (string | number | null)[][];
}

/** 22件などの行 → 確認の結果(本文・要約の中身は入れない)。 */
export function buildSpeechDevReport(rows: readonly VerifySpeechRow[], now: Date): SpeechDevReport {
  const byState: Record<string, number> = {};
  const attempts: Record<string, number> = {};
  for (const r of rows) {
    const key = `${r.provider}/${r.status}/${r.body_status}`;
    byState[key] = (byState[key] ?? 0) + 1;
    attempts[String(r.body_attempts)] = (attempts[String(r.body_attempts)] ?? 0) + 1;
  }
  const ecbRows = rows.filter((r) => r.provider === 'ecb_press_rss');
  const frb = rows
    .filter((r) => r.provider === 'frb_calendar')
    .sort((a, b) => a.statement_datetime.localeCompare(b.statement_datetime));
  const future = frb.filter((r) => Date.parse(r.statement_datetime) > now.getTime());
  return {
    at: now.toISOString(),
    total: rows.length,
    byState,
    attempts,
    attempted: rows.filter((r) => r.body_last_attempt_at !== null).length,
    fingerprints: fingerprints(rows),
    ecb: {
      n: ecbRows.length,
      notApplicableRightsUnconfirmed: ecbRows.filter(
        (r) => r.body_status === 'NOT_APPLICABLE' && r.body_error === 'RIGHTS_UNCONFIRMED',
      ).length,
      bodyNull: ecbRows.filter((r) => r.speech_body === null).length,
      summaryNull: ecbRows.filter((r) => r.summary === null && r.summary_method === null).length,
      attemptsNonZero: ecbRows.filter((r) => r.body_attempts !== 0).length,
      other: ecbRows
        .filter((r) => !(r.body_status === 'NOT_APPLICABLE' && r.body_error === 'RIGHTS_UNCONFIRMED'))
        .map((r) => ({ id: r.id, status: r.status, body_status: r.body_status, body_error: r.body_error })),
    },
    frbFuture: {
      n: future.length,
      withBodyOrAttempt: future.filter(
        (r) => r.speech_body !== null || r.body_attempts !== 0 || r.body_status !== 'PENDING',
      ).length,
      rows: future.map((r) => ({
        id: r.id,
        at: r.statement_datetime,
        status: r.status,
        body_status: r.body_status,
        attempts: r.body_attempts,
      })),
    },
    // [id の先頭8文字, 発言日時, status, body_status, 回数, URL の末尾, 本文の md5 の先頭8文字, 要約の md5 の先頭8文字,
    //  取得日時, 要約の作り方, 要約の理由, 本文の理由, 題名(60字まで)]
    frbRows: frb.map((r) => [
      r.id.slice(0, 8),
      r.statement_datetime,
      r.status,
      r.body_status,
      r.body_attempts,
      tail(r.source_url),
      short(r.speech_body === null ? null : md5(r.speech_body)),
      short(r.summary === null ? null : md5(r.summary)),
      r.body_fetched_at,
      r.summary_method,
      r.summary_error,
      r.body_error,
      r.title ? r.title.slice(0, 60) : null,
    ]),
  };
}

/** 本文・要約の工程の最近の実行(件数と飛ばした理由だけ)。 */
export function summarizeRuns(runs: readonly VerifyRunRow[]) {
  return runs.map((r) => {
    const details = (r.details ?? {}) as { skip_reasons?: unknown; ready?: unknown; failed?: unknown };
    return {
      job: r.job,
      started_at: r.started_at,
      status: r.status,
      fetched: r.fetched_count,
      success: r.success_count,
      errors: r.error_count,
      skip_reasons: details.skip_reasons ?? null,
      ready: typeof details.ready === 'number' ? details.ready : null,
      failed: Array.isArray(details.failed)
        ? details.failed.length
        : typeof details.failed === 'number'
          ? details.failed
          : null,
    };
  });
}

/** GitHub Actions の注記(::notice)。公開リポジトリでも読める。改行・% はエスケープする。 */
export function annotation(title: string, value: unknown): string {
  const body = JSON.stringify(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const safeTitle = title.replace(/[,:\r\n%]/g, ' ');
  return `::notice title=${safeTitle}::${body}`;
}
