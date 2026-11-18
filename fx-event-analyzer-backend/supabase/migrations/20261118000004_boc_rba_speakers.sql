-- BoC(カナダ銀行)・RBA(豪州準備銀行)の要人を、要人のマスタに入れる(HQ指示 2026-11-18「要人発言 Backend」)。
-- **この migration は作成のみで、どの DB にも適用していない。適用は HQ の個別承認が要る(TEST・DEV・PROD とも)。**
--
-- 根拠(公式ページ。2026-11-18 に確認):
--   BoC 総裁会議 https://www.bankofcanada.ca/about/governing-council/(掲載は 2026-10-12 時点)
--     Tiff Macklem(Governor)・Carolyn Rogers(Senior Deputy Governor)・Toni Gravelle(Deputy Governor)・
--     Marc-André Gosselin(Deputy Governor)・Nicolas Vincent(Deputy Governor)・Michelle Alexopoulos(External Deputy Governor)
--     総裁 Macklem は 2027-06 に退任する発表(2026-11-16)があるが、現職。
--   RBA 金融政策会合 https://www.rba.gov.au/about-rba/boards/monetary-policy-board/ ・各人のページ /about-rba/people/…
--     Michele Bullock(Governor。議長)・Andrew Hauser(Deputy Governor。副議長)・Sarah Hunter(Assistant Governor (Economic)。
--     Chief Economist。RBA の発言の RSS に実際に出ていた)。他の総裁補佐・非常勤メンバーは氏名を確認していないので入れない。
-- 名前(speakers.name)は**公式の英語表記**(BoC・RBA に公式の日本語表記はない。HQ決定 2026-11-18)。役職(title)は日本語のまま。
-- src/ingestion/mappings/speakers.ts の name と同じ(テストで一致を確認)。表示は src/domain/homeSpeeches.ts の speakerDisplayName が
-- 「姓 + 半角スペース + 役職」(例: Macklem BoC総裁)にする。FRB・ECB の既存の行(日本語名)は変更しない。
-- organization は 'BoC'・'RBA'(既存の 'FRB'・'ECB' と同じ英字の略称。src/domain/attribution.ts の出典・告知がこの値で決まる)。
--
-- 既存のルールどおり、同じ機関・同じ名前の行があれば入れない(2回流しても同じ)。id は既定の gen_random_uuid()。
-- 写真は入れない(自由に使える公式写真を確かめていない。画面は頭文字で表示する)。
-- 戻し方: この9人の speech_events が無いことを確かめてから、organization が 'BoC'・'RBA' で name がこの名前の行を消す。

insert into speakers (name, title, organization, country_code, currency_code, photo_url)
select v.name, v.title, v.organization, v.country_code, v.currency_code, null
from (values
  ('Tiff Macklem', 'BoC総裁', 'BoC', 'CA', 'CAD'),
  ('Carolyn Rogers', 'BoC上級副総裁', 'BoC', 'CA', 'CAD'),
  ('Toni Gravelle', 'BoC副総裁', 'BoC', 'CA', 'CAD'),
  ('Marc-André Gosselin', 'BoC副総裁', 'BoC', 'CA', 'CAD'),
  ('Nicolas Vincent', 'BoC副総裁', 'BoC', 'CA', 'CAD'),
  ('Michelle Alexopoulos', 'BoC外部副総裁', 'BoC', 'CA', 'CAD'),
  ('Michele Bullock', 'RBA総裁', 'RBA', 'AU', 'AUD'),
  ('Andrew Hauser', 'RBA副総裁', 'RBA', 'AU', 'AUD'),
  ('Sarah Hunter', 'RBA総裁補佐（経済担当・チーフエコノミスト）', 'RBA', 'AU', 'AUD')
) as v(name, title, organization, country_code, currency_code)
where not exists (select 1 from speakers s where s.organization = v.organization and s.name = v.name);
