-- 要人の顔写真(HQ指示 2026-10-13「FRBは公式写真で、そのほかは頭文字と機関の色で」)。
-- 入れてよいのは、自由に使える公式写真だけ(FRBの理事の公式写真は米国政府の著作物で
-- パブリックドメイン)。それ以外の機関の要人は null のままにし、アプリが頭文字と機関の色で表示する。
alter table speakers add column photo_url text;

comment on column speakers.photo_url is
  '要人の公式写真のURL。自由に使える公式写真(FRB理事: federalreserve.gov、米国政府の著作物)だけ入れる。null ならアプリは頭文字と機関の色で表示する。';

update speakers
set photo_url = 'https://www.federalreserve.gov/aboutthefed/images/Powell_Jerome_Aug_16_22-674_8x10_rdax_130x162s.jpg'
where organization = 'FRB' and name = 'ジェローム・パウエル';
