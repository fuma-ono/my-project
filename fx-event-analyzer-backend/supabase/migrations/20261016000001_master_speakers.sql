-- 本番データの取り込み(npm run ingest:speeches)が使う要人のマスタ(HQ指示 2026-10-16「要人発言の予定を取り込む」)。
--
-- 取り込みは speakers に無い要人を作らず飛ばす(SPEAKER_NOT_IN_DB)。これまでパウエル・植田・ラガルドは
-- seed.sql にしか無く、ウォラーはどこにも無かったため、新しいDB(seed を流さない社内確認用・本番)では
-- この4人の発言が取り込まれなかった。ここでマスタとして入れる。
-- id は seed.sql と同じ(seed のテスト用発言が参照する)。同じ id か、同じ名前・機関の要人がいれば入れない。
-- 写真は自由に使える公式写真だけ(FRB: パブリックドメイン、assets/speaker-photos/SOURCES.md)。

insert into speakers (id, name, title, organization, country_code, currency_code, photo_url)
select v.id::uuid, v.name, v.title, v.organization, v.country_code, v.currency_code, v.photo_url
from (values
  ('40000000-0000-0000-0000-000000000001', 'ジェローム・パウエル', 'FRB理事', 'FRB', 'US', 'USD', 'speaker-photos/powell.jpg'),
  ('40000000-0000-0000-0000-000000000002', '植田和男', '日本銀行総裁', '日本銀行', 'JP', 'JPY', null),
  ('40000000-0000-0000-0000-000000000003', 'クリスティーヌ・ラガルド', 'ECB総裁', 'ECB', 'EU', 'EUR', null),
  ('40000000-0000-0000-0000-000000000010', 'クリストファー・ウォラー', 'FRB理事', 'FRB', 'US', 'USD', 'speaker-photos/waller.jpg')
) as v(id, name, title, organization, country_code, currency_code, photo_url)
where not exists (select 1 from speakers s where s.id = v.id::uuid)
  and not exists (select 1 from speakers s where s.organization = v.organization and s.name = v.name);
