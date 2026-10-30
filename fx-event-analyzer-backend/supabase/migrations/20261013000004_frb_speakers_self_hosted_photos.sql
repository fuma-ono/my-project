-- FRB理事会の現メンバーと、自前で配信する公式写真(2026-10-13、federalreserve.gov で確認)。
--
-- 1. パウエル氏は議長を退任し理事のため、役職を「FRB理事」に直す。
-- 2. 議長・副議長・理事の5人を追加する。同じ名前・機関の要人がいれば追加しない(何度流しても重複しない)。
-- 3. 写真は federalreserve.gov への直リンクをやめ、Backend が配信するファイルの key
--    'speaker-photos/<file>' にする(GET /api/v1/speaker-photos/{file}。APIは絶対URLに直して返す)。
--    ファイルは assets/speaker-photos/(出典・利用条件は同じ場所の SOURCES.md)。
--    FRBのサイトの情報は特に断りがなければパブリックドメインで、許可なく複製・配布できる
--    (出典: 米国連邦準備制度理事会(FRB) と示す)。フレーム内表示は不可のため自前で配信する。
--    FRB以外の要人の写真は利用条件を確かめていないので入れない(null のまま、アプリは頭文字で表示)。
--
-- 新しいDBでは seed.sql より先にこのファイルが流れるため、5人の追加はここで行い seed.sql では行わない。

update speakers
set title = 'FRB理事'
where organization = 'FRB' and name = 'ジェローム・パウエル';

insert into speakers (name, title, organization, country_code, currency_code)
select v.name, v.title, 'FRB', 'US', 'USD'
from (values
  ('ケビン・ウォーシュ', 'FRB議長'),
  ('フィリップ・ジェファーソン', 'FRB副議長'),
  ('ミシェル・ボウマン', 'FRB副議長（金融監督担当）'),
  ('マイケル・バー', 'FRB理事'),
  ('リサ・クック', 'FRB理事')
) as v(name, title)
where not exists (
  select 1 from speakers s where s.organization = 'FRB' and s.name = v.name
);

update speakers s
set photo_url = v.photo_key
from (values
  ('ケビン・ウォーシュ', 'speaker-photos/warsh.png'),
  ('フィリップ・ジェファーソン', 'speaker-photos/jefferson.jpg'),
  ('ミシェル・ボウマン', 'speaker-photos/bowman.jpg'),
  ('マイケル・バー', 'speaker-photos/barr.jpg'),
  ('リサ・クック', 'speaker-photos/cook.jpg'),
  ('ジェローム・パウエル', 'speaker-photos/powell.jpg'),
  ('クリストファー・ウォラー', 'speaker-photos/waller.jpg')
) as v(name, photo_key)
where s.organization = 'FRB' and s.name = v.name;

comment on column speakers.photo_url is
  '要人の公式写真。null / 絶対URL(https) / Backendが配信するファイルのkey ''speaker-photos/<file>''(APIが絶対URLに直して返す)。入れてよいのは自由に使える公式写真だけ(FRB理事: パブリックドメイン、出典 FRB)。null ならアプリは頭文字と機関の色で表示する。';
