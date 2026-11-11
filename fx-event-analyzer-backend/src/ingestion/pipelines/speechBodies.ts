/**
 * 要人発言の公式ページの URL と本文を取り込む(HQ指示 2026-11-10「要人発言本文の取得・保存機能」)。
 *
 * 対象: 発言済み(DELIVERED)で、本文がまだ無い(body_status が PENDING / FAILED)、直近 pastDays 日の FRB・ECB の発言。
 * 1. URL: ECB は取り込みの時に press の RSS の link を source_url に入れてある。FRB は公式の講演の RSS を1回読み、
 *    姓と日付が1件だけ一致するときに結ぶ(speechBody.ts の matchFrbSpeechUrls)。結べなければ PENDING のまま(講演の RSS に
 *    まだ載っていない・直近15件から外れた、など。推測で結ばない)。
 * 2. 本文: 公式の URL(https・決まった場所)だけを読み、取り出す。取れれば FETCHED(本文・取得日時)、取れなければ FAILED
 *    (理由を body_error に)。本文を推測で補わない。1回の実行で読むページは maxFetches 件まで(公式サイトに負荷をかけない。
 *    HttpClient が取得元ごとに2秒あける)。
 * 外部の有料 API は使わない(公式サイトの公開ページだけ)。発言の行の発言者・日時・題名は変えない。
 *
 * 本文を保存してよい発言元(HQ指示 2026-11-11「公式データの権利が確認できない場合は保存・表示しない」):
 *   - FRB: 保存する。https://www.federalreserve.gov/disclaimer.htm「Unless otherwise indicated, information on Board's
 *     website is in the public domain and may be copied and distributed without permission.」「Please cite to the Board
 *     as the source of the information.」(2026-11-11 確認)
 *   - ECB: **保存しない**(source_url だけ残し、body_status = NOT_APPLICABLE、body_error = RIGHTS_UNCONFIRMED)。
 *     https://www.ecb.europa.eu/services/disclaimer/html/index.en.html は出典を示せば自由に使えるとする一方、「Any
 *     reproduction, publication or reprint, in whole or in part, of documents that bear the name of their authors …
 *     requires explicit prior written authorisation of the ECB or the authors」とあり、発言(発言者の名前の付いた文書)が
 *     この例外に当たるかを確認できていないため。ECB が認めたら storeBodyFor に足す。
 */
import { SPEAKER_ALIASES } from '../mappings/speakers.js';
import type { JobCounters } from '../runner.js';
import { wallClockParts } from '../time.js';
import {
  extractSpeechBody,
  frbSpeechJsonLinks,
  frbSpeechRssItems,
  isOfficialSpeechUrl,
  matchFrbSpeechUrls,
  type FrbSpeechRowForMatch,
} from '../speechBody.js';

export const FRB_SPEECHES_RSS_URL = 'https://www.federalreserve.gov/feeds/speeches.xml';
/** 講演の一覧(2017年以降のすべて)。RSS(直近の分だけ)で結べなかった、古い発言の URL を探すときだけ読む。 */
export const FRB_SPEECHES_JSON_URL = 'https://www.federalreserve.gov/json/ne-speeches.json';
const BODY_PROVIDERS = ['frb_calendar', 'ecb_press_rss'] as const;

export interface SpeechForBody {
  id: string;
  provider: string;
  provider_event_id: string;
  title: string;
  statement_datetime: string;
  status: string;
  source_url: string | null;
  body_status: string;
  /** speakers.name(日本語)。 */
  speaker_name: string;
  speaker_organization: string;
}

export interface SpeechBodyPatch {
  source_url?: string;
  speech_body?: string | null;
  body_fetched_at?: string | null;
  body_status: 'PENDING' | 'FETCHED' | 'FAILED' | 'NOT_APPLICABLE';
  body_error?: string | null;
}

export interface SpeechBodyStore {
  /** DELIVERED で body_status が PENDING / FAILED の、providers の発言(statement_datetime >= sinceIso、古い順)。 */
  listSpeechesNeedingBody(providers: readonly string[], sinceIso: string): Promise<SpeechForBody[]>;
  updateSpeechBody(id: string, patch: SpeechBodyPatch): Promise<void>;
}

export interface SpeechBodyFetcher {
  /** 公式ページの HTML(本文)。HTTP の失敗は例外(メッセージに状態コード)。 */
  getText(url: string): Promise<string>;
}

export interface SpeechBodySettings {
  /** null = 過去のすべての発言(過去の発言への適用、--all) */
  pastDays: number | null;
  /** 1回の実行で本文のページを読む上限。 */
  maxFetches: number;
  /** 本文を保存してよい provider(省略時は STORE_BODY_FOR)。ほかは URL だけ残して本文を取らない。 */
  storeBodyFor?: readonly string[];
  /**
   * true = dry-run(HQ指示 2026-11-11「実行前に対象件数を確認」): DB に書かない・本文のページを読まない。URL を探すための
   * FRB の講演の RSS・一覧の JSON(公開のページ)だけ読み、各発言で何をするはずかを返す。
   */
  dryRun?: boolean;
}

/** 1件ごとに、この実行で何をするか(dry-run の出力。本番の実行でも同じ判定)。処理の順は statement_datetime の古い順。 */
export type SpeechBodyAction =
  | 'FETCH' // 本文のページを読む(結果は FETCHED か FAILED)
  | 'NO_SOURCE_URL' // URL が見つからない → PENDING のまま
  | 'NOT_OFFICIAL_URL' // 公式サイトの URL でない → FAILED
  | 'RIGHTS_UNCONFIRMED' // 権利が未確認の発言元(ECB) → URL だけ残して NOT_APPLICABLE
  | 'RUN_CAP'; // この実行の上限(maxFetches)を超えた → 次の実行で読む

export interface SpeechBodyPlanItem {
  speech_id: string;
  provider: string;
  statement_datetime: string;
  action: SpeechBodyAction;
  source_url: string | null;
  /** URL をどこから得たか(stored = 既に DB にある)。 */
  url_from: 'stored' | 'rss' | 'json' | null;
}

/** 本文の再掲の権利を確認できた発言元(上の説明)。今は FRB だけ。 */
export const STORE_BODY_FOR: readonly string[] = ['frb_calendar'];

export const SPEECH_BODY_SETTINGS: SpeechBodySettings = { pastDays: 30, maxFetches: 20 };

/** 日本語の名前(speakers.name)→ 取り込みの対応表の英語の名前(最初の書き方)。無ければ null。 */
/** YYYY-MM-DD of `iso` in `timeZone`. */
function localDay(iso: string, timeZone: string): string {
  const wall = wallClockParts(new Date(iso), timeZone);
  return `${wall.year}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`;
}

function englishNameOf(organization: string, nameJa: string): string | null {
  return SPEAKER_ALIASES.find((a) => a.organization === organization && a.nameJa === nameJa)?.aliases[0] ?? null;
}

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const status = /\b([45]\d\d)\b/.exec(message)?.[1];
  return status ? `HTTP_${status}` : `FETCH_ERROR: ${message.slice(0, 200)}`;
}

export async function ingestSpeechBodies(
  store: SpeechBodyStore,
  fetchers: { frb: SpeechBodyFetcher; ecb: SpeechBodyFetcher },
  settings: SpeechBodySettings,
  now: Date,
  counters: JobCounters,
): Promise<{ plan: SpeechBodyPlanItem[] }> {
  const plan: SpeechBodyPlanItem[] = [];
  const urlFrom = new Map<string, 'rss' | 'json'>();
  const sinceIso =
    settings.pastDays === null
      ? '1970-01-01T00:00:00.000Z'
      : new Date(now.getTime() - settings.pastDays * 86_400_000).toISOString();
  const speeches = await store.listSpeechesNeedingBody(BODY_PROVIDERS, sinceIso);
  counters.fetched += speeches.length;

  // 1. FRB の URL(まだ無い行だけ)。講演の RSS は、必要なときに1回だけ読む。
  const frbWithoutUrl = speeches.filter((s) => s.provider === 'frb_calendar' && !s.source_url);
  const urlById = new Map<string, string>();
  if (frbWithoutUrl.length > 0) {
    const rows: FrbSpeechRowForMatch[] = frbWithoutUrl.map((s) => ({
      id: s.id,
      speakerNameEn: englishNameOf(s.speaker_organization, s.speaker_name),
      date: localDay(s.statement_datetime, 'America/New_York'),
    }));
    try {
      const xml = await fetchers.frb.getText(FRB_SPEECHES_RSS_URL);
      const links = [...xml.matchAll(/<link>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/link>/g)].map(
        (m) => m[1]!,
      );
      for (const [id, url] of matchFrbSpeechUrls(rows, frbSpeechRssItems(links))) {
        urlById.set(id, url);
        urlFrom.set(id, 'rss');
      }
    } catch (error) {
      counters.error(`frb speeches rss: ${error instanceof Error ? error.message : String(error)}`);
    }
    // RSS は直近の講演だけなので、結べなかった行(古い発言など)は講演の一覧の JSON で探す(同じ決まり: 姓と日付がちょうど1件)。
    const stillMissing = rows.filter((r) => !urlById.has(r.id));
    if (stillMissing.length > 0) {
      try {
        const text = await fetchers.frb.getText(FRB_SPEECHES_JSON_URL);
        const items = frbSpeechRssItems(frbSpeechJsonLinks(text));
        for (const [id, url] of matchFrbSpeechUrls(stillMissing, items)) {
          urlById.set(id, url);
          urlFrom.set(id, 'json');
        }
      } catch (error) {
        counters.error(`frb speeches json: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // 2. 本文
  let fetches = 0;
  for (const speech of speeches) {
    const url = speech.source_url ?? urlById.get(speech.id) ?? null;
    const record = (action: SpeechBodyAction) =>
      plan.push({
        speech_id: speech.id,
        provider: speech.provider,
        statement_datetime: speech.statement_datetime,
        action,
        source_url: url,
        url_from: speech.source_url ? 'stored' : (urlFrom.get(speech.id) ?? null),
      });
    if (!url) {
      counters.skip('NO_SOURCE_URL'); // PENDING のまま(次の実行でまた探す)
      record('NO_SOURCE_URL');
      continue;
    }
    if (!isOfficialSpeechUrl(speech.provider, url)) {
      counters.skip('NOT_OFFICIAL_URL');
      record('NOT_OFFICIAL_URL');
      if (settings.dryRun) continue;
      await store.updateSpeechBody(speech.id, { body_status: 'FAILED', body_error: 'NOT_OFFICIAL_URL' });
      continue;
    }
    if (!(settings.storeBodyFor ?? STORE_BODY_FOR).includes(speech.provider)) {
      // 再掲の権利を確認できていない発言元: 公式ページの URL(リンク)だけ残し、本文は取らない・保存しない
      counters.skip('RIGHTS_UNCONFIRMED');
      record('RIGHTS_UNCONFIRMED');
      if (settings.dryRun) continue;
      await store.updateSpeechBody(speech.id, {
        source_url: url,
        speech_body: null,
        body_fetched_at: null,
        body_status: 'NOT_APPLICABLE',
        body_error: 'RIGHTS_UNCONFIRMED',
      });
      continue;
    }
    if (fetches >= settings.maxFetches) {
      counters.skip('RUN_CAP'); // 次の実行で読む
      record('RUN_CAP');
      if (settings.dryRun) continue;
      if (!speech.source_url) await store.updateSpeechBody(speech.id, { source_url: url, body_status: 'PENDING' });
      continue;
    }
    fetches += 1;
    record('FETCH');
    if (settings.dryRun) continue;
    const fetcher = speech.provider === 'frb_calendar' ? fetchers.frb : fetchers.ecb;
    try {
      const html = await fetcher.getText(url);
      const body = extractSpeechBody(speech.provider, html);
      if (!body) {
        counters.skip('NO_BODY_FOUND');
        await store.updateSpeechBody(speech.id, {
          source_url: url,
          body_status: 'FAILED',
          body_error: 'NO_BODY_FOUND',
        });
        continue;
      }
      await store.updateSpeechBody(speech.id, {
        source_url: url,
        speech_body: body,
        body_fetched_at: now.toISOString(),
        body_status: 'FETCHED',
        body_error: null,
      });
      counters.success += 1;
      counters.note('fetched', { speech_id: speech.id, provider: speech.provider, url, characters: body.length });
    } catch (error) {
      const code = errorCode(error);
      counters.skip('FETCH_FAILED');
      counters.note('failed', { speech_id: speech.id, url, error: code });
      await store.updateSpeechBody(speech.id, { source_url: url, body_status: 'FAILED', body_error: code });
    }
  }
  return { plan };
}
