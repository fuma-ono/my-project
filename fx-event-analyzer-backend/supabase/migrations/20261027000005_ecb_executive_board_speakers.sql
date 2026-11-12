-- ECB の役員会の役員を、要人のマスタに入れる(HQ判断 2026-10-27「ECB役員の話者登録」)。
--
-- 監査(2026-10-27)で、ECB の RSS にラガルド総裁のほか、レーン・チポローネ・エルダーソンの講演・インタビューが
-- 出ていたが、話者の表(src/ingestion/mappings/speakers.ts)にもマスタにも無かった(SPEAKER_UNKNOWN になる)。
-- HQ の指示どおり、シュナーベルも入れる。重要度(MEDIUM)は話者の表で持つ(speakers には列が無い)。
--
-- 注意: ECB の発言は、時刻の正確な取得元(週間予定のページ、設計中)ができるまでは、RSS の時刻が原稿の公開時刻
-- のため TIME_NOT_EXACT で取り込まれない。この migration だけでは発言の件数は増えない。
--
-- 既存のルールどおり、同じ機関・同じ名前の行があれば入れない(2回流しても同じ)。id は既定の gen_random_uuid()。
-- 写真は入れない(自由に使える公式写真を確かめていない。画面は頭文字で表示する)。
-- 戻し方: この4人の speech_events が無いことを確かめてから、organization = 'ECB' かつ name がこの4つの行を消す。

insert into speakers (name, title, organization, country_code, currency_code, photo_url)
select v.name, v.title, 'ECB', 'EU', 'EUR', null
from (values
  ('フィリップ・レーン', 'ECB理事（チーフエコノミスト）'),
  ('イザベル・シュナーベル', 'ECB理事'),
  ('ピエロ・チポローネ', 'ECB理事'),
  ('フランク・エルダーソン', 'ECB理事')
) as v(name, title)
where not exists (select 1 from speakers s where s.organization = 'ECB' and s.name = v.name);
