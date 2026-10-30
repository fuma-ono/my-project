/**
 * 出典と告知(HQ判断 2026-10-27「ECBの告知」、api-design v1.38・v1.39)。取得元の規約が出典の表示・告知を求める情報に、
 * API の項目として `attribution` を付ける。iOS はこれを情報の近くに表示する(表示の実装は A の担当、未実装)。
 *
 * - ECB(ecb.europa.eu/services/disclaimer): 出典の表示が必要。有料サービスでは、購入前と「利用のたびに」、ECB の
 *   サイトで無料で入手できることを知らせる必要がある(B は購読型アプリにも当てはまるものとして扱う)。→ notice を付ける
 * - FRB(federalreserve.gov/disclaimer.htm): パブリックドメイン。出典として FRB を示すよう求めている。→ 出典だけ
 * - Eurostat(ec.europa.eu/eurostat/web/main/help/copyright-notice、2026-10-30 確認): 商用の再利用は出典を示せば可。
 *   加工したらその旨を明示し、Eurostat が責任を負わない旨の免責文を含める。→ notice に免責文(HQ判断 2026-10-30 3。
 *   文言は実装候補で、規約の要件を満たすかは未確定)。経済指標(EU_HICP・EU_UNEMPLOYMENT_RATE)に付ける
 * - それ以外: null(付けない)
 *
 * 加工した値(変化幅・相場反応など)の注記は、画面ごとに iOS が出す(この項目は「元の情報の出典」だけを表す)。
 */
export interface Attribution {
  /** 出典の機関名(表示用)。 */
  source: string;
  source_url: string;
  /** 取得元の規約が求める告知文。null = 告知の義務なし(出典の表示だけ)。 */
  notice: string | null;
}

export const ECB_ATTRIBUTION: Attribution = {
  source: '欧州中央銀行（ECB）',
  source_url: 'https://www.ecb.europa.eu',
  notice: 'この情報は ECB のウェブサイト（www.ecb.europa.eu）で無料で入手できます。',
};

export const FRB_ATTRIBUTION: Attribution = {
  source: '米国連邦準備制度理事会（FRB）',
  source_url: 'https://www.federalreserve.gov',
  notice: null,
};

/** Eurostat の値から作る経済指標(HQ承認 2026-10-30「ユーロ圏経済指標 第1弾」)。文言は実装候補(HQ判断 2026-10-30 3)。 */
export const EUROSTAT_ATTRIBUTION: Attribution = {
  source: 'Eurostat（欧州連合統計局）',
  source_url: 'https://ec.europa.eu/eurostat',
  notice: 'Eurostat の公表データをもとに作成しています。Eurostat は本アプリでの利用について責任を負いません。',
};

/** Eurostat の値から作る経済指標の code(ingestion の eurostat_schedule の指標と同じ)。 */
const EUROSTAT_INDICATOR_CODES: ReadonlySet<string> = new Set(['EU_HICP', 'EU_UNEMPLOYMENT_RATE']);

/** economic_indicators.code(経済指標)から。Eurostat の指標だけ。それ以外は null(api-design v1.43)。 */
export function attributionForIndicator(code: string | null | undefined): Attribution | null {
  return code != null && EUROSTAT_INDICATOR_CODES.has(code) ? EUROSTAT_ATTRIBUTION : null;
}

/**
 * 受信箱の本文の末尾に付ける短い出典(HQ判断 2026-10-28「告知API」4)。告知の義務がある取得元(今は ECB だけ)のときだけ
 * 「（出典：ECB）」を返す。告知の全文は通知先の詳細の画面で出す(本文に全文が必要かは未確認)。FRB・経済指標は null(本文を変えない)。
 */
export function inboxSourceNote(attribution: Attribution | null | undefined): string | null {
  return attribution?.source === ECB_ATTRIBUTION.source ? '（出典：ECB）' : null;
}

/** speakers.organization(要人発言)から。 */
export function attributionForOrganization(organization: string | null | undefined): Attribution | null {
  if (organization === 'ECB') return ECB_ATTRIBUTION;
  if (organization === 'FRB') return FRB_ATTRIBUTION;
  return null;
}
