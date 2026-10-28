/**
 * 出典と告知(HQ判断 2026-10-27「ECBの告知」、api-design v1.38・v1.39)。取得元の規約が出典の表示・告知を求める情報に、
 * API の項目として `attribution` を付ける。iOS はこれを情報の近くに表示する(表示の実装は A の担当、未実装)。
 *
 * - ECB(ecb.europa.eu/services/disclaimer): 出典の表示が必要。有料サービスでは、購入前と「利用のたびに」、ECB の
 *   サイトで無料で入手できることを知らせる必要がある(B は購読型アプリにも当てはまるものとして扱う)。→ notice を付ける
 * - FRB(federalreserve.gov/disclaimer.htm): パブリックドメイン。出典として FRB を示すよう求めている。→ 出典だけ
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

/** speakers.organization(要人発言)から。 */
export function attributionForOrganization(organization: string | null | undefined): Attribution | null {
  if (organization === 'ECB') return ECB_ATTRIBUTION;
  if (organization === 'FRB') return FRB_ATTRIBUTION;
  return null;
}
