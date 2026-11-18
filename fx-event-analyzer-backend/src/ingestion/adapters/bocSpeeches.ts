/**
 * カナダ銀行(BoC)の発言の RSS — ④(発言・議会の冒頭陳述・記者会見)。
 * 公式の RSS: https://www.bankofcanada.ca/content_type/speeches/feed/(「Speeches and appearances」。RSS-CB 1.2 の RDF 形式)。
 * ページ: https://www.bankofcanada.ca/rss-feeds/
 *
 * 利用条件(確認済み。https://www.bankofcanada.ca/terms/ — 2026-11-18): サイトの内容は自由に使用・複製・配布・送信できる。
 * 条件: ① カナダ銀行を出典として示し、変更したことを示す ② 再現する内容の正確さに注意する ③ 有料のサービスで提供する場合は、
 * 買い手に、内容が同サイトで無料で入手できることを事前に伝える ④ ロゴ・紙幣の画像・第三者の内容は別(再利用しない)
 * ⑤ Valet API 等のリクエストの制限・頻度の制限を回避しない・サイトに過大な負荷をかけない。
 * RSS・発言について個別の定めはなく、上の一般の許可の範囲(項目ごとに、第三者の内容の記載がないか確認が要る)。
 *
 * 時刻(HQ指示 2026-11-18 P2-1): `dc:date` は「ページの日時」で、**発言の予定時刻としては扱わない**。**予定の項目では、説明に書かれた現地の
 * 時刻(例 "12:45 (ET) approx.")が、`dc:date` では UTC の表記のままの数字(12:45+00:00)になっていた**(2026-11-18 の実フィードで、
 * 同様の例が記者会見の項目にもあり、他の項目も同じ疑いがある。BoC に未確認)。**ET から UTC への変換の推測はしない**。
 * そのため、すべて PUBLICATION_TIME(反応の計算の起点にしない。ECB の RSS と同じ扱い)で、**時刻の数字だけでは「行われた」と
 * しない**: 取り込むのは、原稿のページがある(`cb:speech`)か、公式の発言日(日付)が2日以上前の項目だけ(`deliveryEvidence`)。
 * 予定の段階の項目(動画ページだけで、まだ原稿が無い・日付が近い)は取り込まない。したがって BoC の予定時刻は画面に出ない。
 *
 * 発言者: `cb:person` の名前(発言の項目)、無ければ説明の「<役職> <名前>」の形から読む。読めない項目(外部の講演者など
 * 当行の役職者でない人の項目)は取り込まない(出典・発言者を確認できない発言は登録しない)。
 */
import { PROVIDER_HTTP_SETTINGS } from '../config.js';
import { HttpClient, type HttpClientDeps } from '../http.js';
import { normalizeSpeakerName } from '../mappings/speakers.js';
import type { SpeechScheduleProvider } from '../providers.js';
import { withAccessDeniedMapping } from '../sourceAccess.js';
import { assertValidCbFeed, parseCbRdfItems, parseIsoInstant, type CbRdfItem } from '../rssCb.js';
import type { NormalizedSpeech, SpeechKind } from '../types.js';

export const BOC_SPEECHES_RSS_URL = 'https://www.bankofcanada.ca/content_type/speeches/feed/';
export const BOC_PROVIDER = 'boc_speeches_rss';
/** speakers.organization の表記は、話者の行を作る migration(HQ の承認待ち)で確定する。確定までは DB に行が無いので取り込みは行われない。 */
export const BOC_ORGANIZATION = 'BoC';

const ROLE_NAME =
  /\b(?:Senior Deputy Governor|Deputy Governor|Governor)\s+((?:[A-Z][\p{L}'’.-]*)(?:\s+[A-Z][\p{L}'’.-]*){1,3})/u;

/** 説明の「Deputy Governor Toni Gravelle speaks …」から発言者の名前だけを読む(役職は付けない)。 */
export function speakerFromDescription(description: string | null): string | null {
  if (!description) return null;
  // 安全側(HQ指示 2026-11-18 P3): 「<役職> <名前>」の候補が**ちょうど1人**のときだけ読む。複数人(記者会見に総裁と副総裁など)・
  // 0人は null(誰の発言か決められない項目は取り込まない)。
  const names = new Set(
    [...description.matchAll(new RegExp(ROLE_NAME.source, 'gu'))].map((m) =>
      m[1]!
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/[.'’-]+$/u, ''),
    ),
  );
  return names.size === 1 ? [...names][0]! : null;
}

function kindOf(item: CbRdfItem): SpeechKind {
  if (/press conference/i.test(item.title)) return 'PRESS_CONFERENCE';
  if (/(opening statement|appearance before|testimony)/i.test(item.title) && /committee/i.test(item.title))
    return 'TESTIMONY';
  if (item.cbKind === 'speech' || /^speech\b/i.test(item.title)) return 'SPEECH';
  return 'OTHER';
}

/** `https://www.bankofcanada.ca/<path>/` の path を、重複しない固定の ID にする(同じ公式ページは同じ ID)。 */
export function bocEventId(link: string): string | null {
  try {
    const url = new URL(link);
    if (url.protocol !== 'https:' || url.hostname !== 'www.bankofcanada.ca') return null;
    const path = url.pathname.replace(/^\/+|\/+$/g, '');
    return path ? path : null;
  } catch {
    return null;
  }
}

interface Candidate {
  item: CbRdfItem;
  speech: NormalizedSpeech;
}

const DAY_MS = 86_400_000;

/**
 * 「行われた」と言える証拠(時刻の推測なし)。原稿のページ(`cb:speech`)があれば TEXT_PAGE。無ければ、公式の発言日(`cb:occurrenceDate`、
 * 日付だけ)が、今日(UTC の日付)より2日以上前なら EVENT_DATE_PASSED(どのタイムゾーンでも終わっている)。それ以外は証拠なし。
 */
export function deliveryEvidenceFor(item: CbRdfItem, now: Date): NormalizedSpeech['deliveryEvidence'] {
  if (item.cbKind === 'speech') return 'TEXT_PAGE';
  const day =
    item.occurrenceDate && /^\d{4}-\d{2}-\d{2}$/.test(item.occurrenceDate)
      ? Date.parse(`${item.occurrenceDate}T00:00:00Z`)
      : Number.NaN;
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(day) && today - day >= 2 * DAY_MS ? 'EVENT_DATE_PASSED' : undefined;
}

const MAX_PAIR_GAP_MS = 3 * 86_400_000;

/**
 * 同じ発言の「動画ページ」と「テキストページ」を、**安全な条件がすべてそろったときだけ**1件にまとめる(HQ指示 2026-11-18)。
 * BoC は同じ講演・記者会見について、`multimedia/…`(動画。お知らせの項目 `cb:news`。予定の段階から出る)と、`YYYY/MM/…`
 * (原稿のテキスト。発言の項目 `cb:speech`)を別々のページで出す。**題名の一致だけでは統合しない**(題名は両者で違う)。
 *
 * まとめる条件(すべて):
 *  ① 動画ページ(`multimedia/` の `cb:news`)がちょうど1件、テキストページ(`cb:speech`)がちょうど1件 —
 *     **同じキー(発言者 + `cb:occurrenceDate` の日付)の中で**。2件以上あれば、どれがどれか決められないので統合しない
 *  ② 種別が一致し、講演(SPEECH)か記者会見(PRESS_CONFERENCE)のどちらか(議会の冒頭陳述・その他は統合しない)
 *  ③ 公開の時刻の差が3日以内
 * まとめたときの形: providerEventId は**動画ページの ID**(予定の段階から出ており、行の ID が後から変わらない)、
 * 題名・URL・時刻は**テキストページ**のもの(実際の発言の題名・原稿・公開時刻)。条件を満たさなければ、別々の発言として両方残す
 * (同じ日の別の発言を誤って統合するより、重複が残るほうを選ぶ)。
 * 限界: フィードは新しい10件程度しか載せない。片方がフィードから消えた後は、まとめられず別の行になる(取り込みの対象は
 * 直近14日で、通常は両方がフィードにある間に収まる)。まとめる前に動画ページだけで保存された行は、ID が同じなので更新される。
 */
export function mergeWebcastAndText(candidates: readonly Candidate[]): NormalizedSpeech[] {
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const day = c.item.occurrenceDate;
    if (!day) continue;
    const key = `${normalizeSpeakerName(c.speech.speakerName)}|${day}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const replaced = new Map<Candidate, NormalizedSpeech>();
  const dropped = new Set<Candidate>();
  for (const group of groups.values()) {
    const webcasts = group.filter(
      (c) => c.item.cbKind === 'news' && c.speech.providerEventId.startsWith('multimedia/'),
    );
    const texts = group.filter((c) => c.item.cbKind === 'speech');
    if (webcasts.length !== 1 || texts.length !== 1) continue;
    const web = webcasts[0]!;
    const text = texts[0]!;
    const sameKind = web.speech.kind === text.speech.kind;
    const mergeable = web.speech.kind === 'SPEECH' || web.speech.kind === 'PRESS_CONFERENCE';
    const gap = Math.abs(Date.parse(web.speech.startsAt) - Date.parse(text.speech.startsAt));
    if (!sameKind || !mergeable || !(gap <= MAX_PAIR_GAP_MS)) continue;
    replaced.set(web, { ...text.speech, providerEventId: web.speech.providerEventId, deliveryEvidence: 'TEXT_PAGE' });
    dropped.add(text);
  }
  return candidates.filter((c) => !dropped.has(c)).map((c) => replaced.get(c) ?? c.speech);
}

export function parseBocSpeechesFeed(xml: string, now: Date = new Date()): NormalizedSpeech[] {
  const candidates: Candidate[] = [];
  for (const item of parseCbRdfItems(xml)) {
    const id = bocEventId(item.link);
    const startsAt = parseIsoInstant(item.date);
    const speakerName = item.speakerName ?? speakerFromDescription(item.description);
    if (!id || !startsAt || !speakerName) continue;
    candidates.push({
      item,
      speech: {
        provider: BOC_PROVIDER,
        providerEventId: id,
        speakerName,
        organization: BOC_ORGANIZATION,
        kind: kindOf(item),
        topic: item.title,
        startsAt,
        timePrecision: 'PUBLICATION_TIME',
        url: item.link,
        ...(deliveryEvidenceFor(item, now) ? { deliveryEvidence: deliveryEvidenceFor(item, now)! } : {}),
      },
    });
  }
  return mergeWebcastAndText(candidates);
}

export class BocSpeechesAdapter implements SpeechScheduleProvider {
  readonly name = BOC_PROVIDER;
  private readonly http: HttpClient;
  private readonly clock: () => number;

  constructor(deps: HttpClientDeps = {}) {
    this.http = new HttpClient('boc', PROVIDER_HTTP_SETTINGS.boc, deps);
    this.clock = deps.now ?? Date.now;
  }

  async fetchSpeeches(): Promise<NormalizedSpeech[]> {
    const xml = await withAccessDeniedMapping(BOC_PROVIDER, () => this.http.getText(BOC_SPEECHES_RSS_URL));
    // 構造を確かめる(HTML の 200・空の本文・途中で切れた/壊れた XML・形の変更はエラー。正常な空のフィードは通す)。
    assertValidCbFeed(BOC_PROVIDER, xml);
    return parseBocSpeechesFeed(xml, new Date(this.clock()));
  }
}
