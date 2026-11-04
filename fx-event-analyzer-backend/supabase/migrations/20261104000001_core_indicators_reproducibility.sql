-- 指標マスターの再現性対策(HQ指示 2026-11-04「指標マスター再現性確認・
-- FOMC議事要旨表示修正」優先タスク2)。
--
-- 背景: US_CPI・US_NFP・US_FOMC・JP_CPI・BOJ_RATEの5指標は、この
-- migrationが無い間、supabase/seed.sql(開発/テスト専用。ファイル冒頭
-- "Development/test seed data ONLY" と明記)の insert にしか存在しない。
-- dev-environment.md 2章は、新しい環境を作るとき「migrationsを名前順に
-- すべて流し、seed.sqlは1〜107行目(指標・通貨ペア・指標×通貨ペア、
-- 本物のデータ)だけ流す」という手順を明記しており、意図的にこの5指標の
-- マスタデータとして使われてきた(推測ではなく手順として確認済み)。
-- しかし `supabase db reset`(migrations + seed.sql全体)以外の方法で
-- 環境を作り直す場合や、migrationsだけを適用する運用では、この5指標の
-- 行は一切作られない — 本migrationはその差を埋める。
--
-- 値は supabase/seed.sql の19〜49行目(economic_indicators insert)・
-- 53〜61行目(display_name update)・85〜93行目(indicator_fx_pairs insert)
-- と文字単位で同一(推測で作った値ではない)。db-design.md v4.10/v4.11/v4.12
-- の変更履歴にも同じ5指標への適用が記録されている。
--
-- 冪等性: economic_indicators は `on conflict (code) do nothing` —
-- 既に行がある場合(seed.sql経由など)は一切触れない。既存の値を上書き
-- しない。indicator_fx_pairs も `on conflict (indicator_id, fx_pair_id)
-- do nothing`。fx_pairs の行は symbol で参照する(seed.sql固定の
-- id値には依存しない — fx_pairsの作られ方がseed.sql経由か別経路かに
-- 関わらず正しく動く)。
--
-- 適用時の既存DEV DBへの影響:
-- - 5指標が既に存在する環境(seed.sql実行済み): 完全な no-op。
--   `on conflict do nothing`によりeconomic_indicators・indicator_fx_pairs
--   とも一切書き込まれない。既存の economic_events・event_snapshots 等の
--   参照先(indicator_id)にも影響しない。
-- - 5指標が存在しない環境: 5行が新規作成される。economic_indicators.id
--   は `gen_random_uuid()` のデフォルトで生成される(seed.sql固定の
--   10000000-...-0001〜0005 は使わない — 他の環境のid値に依存させない
--   ための後発migrationの既存パターンに合わせた)。この場合、その環境に
--   米国CPI等のeconomic_eventsが既に存在する可能性は無い(指標マスタが
--   無ければ本番の取り込み処理はその指標をindicator_not_in_dbとして
--   飛ばしてeconomic_eventsを作らないため)。
--
-- seed.sqlとの役割分担: seed.sql は今後も開発/CI専用(1〜107行目の
-- 指標マスタ部分は本migrationと内容が重複するが、`on conflict do
-- nothing`があるため共存しても問題ない。108行目以降の架空のイベント・
-- 値動きデータは本migrationの対象外で、今後もseed.sql(dev/CI限定)の
-- ままにする)。本migrationは「実際の環境(DEV・将来の本番)でも
-- migration適用だけで指標マスタが揃う」ことを保証する役割を持つ。
--
-- 何度流しても同じ結果になる。戻し方: 新規作成された行がある場合は
-- economic_indicators から該当codeの行を削除(indicator_fx_pairsは
-- on delete restrictではなくcascadeの外部キー設定に従う。db-design.md
-- 参照)。

insert into economic_indicators (code, name, name_en, display_name, country_code, currency_code, importance, description, key_points, frequency, unit, source, favorable_direction, market_view_above, market_view_below) values
  ('US_CPI', '米国CPI(消費者物価指数)', 'Consumer Price Index', '消費者物価指数（CPI）', 'US', 'USD', 'HIGH',
    '消費者物価指数（CPI）は、消費者が購入するモノやサービスの価格の変動を測定する指標です。インフレの動向を示す重要な指標であり、金融政策の判断材料として注目されます。',
    array['インフレの動向を把握できる', '金融政策への影響が大きい', '為替や株式市場に大きな影響を与える'],
    'MONTHLY', '%', 'U.S. Bureau of Labor Statistics', 'HIGHER_IS_POSITIVE',
    '米国CPIが予想を上回ると、インフレの高止まりから利下げが遠のくとの見方が強まり、ドルが買われやすいとされる。',
    '米国CPIが予想を下回ると、インフレの落ち着きから利下げが意識され、ドルが売られやすいとされる。'),
  ('US_NFP', '米国雇用統計(非農業部門雇用者数)', 'Nonfarm Payrolls', '非農業部門雇用者数（NFP）', 'US', 'USD', 'HIGH',
    '非農業部門雇用者数（NFP）は、農業部門を除く米国の雇用者数が前月から何人増減したかを示す指標です。米国の景気や雇用の強さを測る代表的な指標として注目されます。',
    array['米国の景気の強さを把握できる', 'FRBの金融政策判断に影響する', '発表直後に為替が大きく動きやすい'],
    'MONTHLY', 'K', 'U.S. Bureau of Labor Statistics', 'HIGHER_IS_POSITIVE',
    '米国の非農業部門雇用者数が予想を上回ると、雇用の底堅さから利下げが遠のくとの見方が強まり、ドルが買われやすいとされる。',
    '米国の非農業部門雇用者数が予想を下回ると、雇用の減速から利下げが意識され、ドルが売られやすいとされる。'),
  ('US_FOMC', 'FOMC政策金利', 'FOMC Interest Rate Decision', 'FOMC政策金利', 'US', 'USD', 'HIGH',
    'FOMC（連邦公開市場委員会）が決定する、米国の政策金利（フェデラル・ファンド金利の誘導目標）です。米国の金融政策の方向性を示し、世界の金融市場に大きな影響を与えます。',
    array['米国の金融政策の方向性がわかる', '米ドルの金利水準を直接左右する', '声明や会見で今後の見通しが示される', '世界の株式・債券市場にも影響する'],
    'IRREGULAR', '%', 'Federal Reserve', 'NEUTRAL',
    'FOMCの政策金利が予想より高い水準に決まると、米国の金利が高止まりするとの見方が強まり、ドルが買われやすいとされる。',
    'FOMCの政策金利が予想より低い水準に決まると、米国の金融緩和が進むとの見方が強まり、ドルが売られやすいとされる。'),
  ('JP_CPI', '日本CPI(消費者物価指数)', 'Japan Consumer Price Index', '消費者物価指数（CPI）', 'JP', 'JPY', 'HIGH',
    '日本の消費者物価指数（CPI）は、国内の消費者が購入するモノやサービスの価格の変動を前年同月比で示す指標です。日本のインフレの動向を示し、日銀の金融政策の判断材料として注目されます。',
    array['日本のインフレの動向を把握できる', '日銀の金融政策の判断材料になる', '円相場の方向性に影響する'],
    'MONTHLY', '%', 'Statistics Bureau of Japan', 'HIGHER_IS_POSITIVE',
    '日本CPIが予想を上回ると、物価の上昇から日銀の利上げ観測が強まり、円が買われやすいとされる。',
    '日本CPIが予想を下回ると、物価の伸び悩みから日銀の利上げが遠のくとの見方が強まり、円が売られやすいとされる。'),
  ('BOJ_RATE', '日銀政策金利', 'BOJ Interest Rate Decision', '日銀政策金利', 'JP', 'JPY', 'HIGH',
    '日本銀行が金融政策決定会合で決定する政策金利です。日本の金融政策の方向性を示し、円の金利水準や為替相場に大きな影響を与えます。',
    array['日本の金融政策の方向性がわかる', '円の金利水準を直接左右する', '総裁会見の発言で相場が動きやすい'],
    'IRREGULAR', '%', 'Bank of Japan', 'NEUTRAL',
    '日銀の政策金利が予想より高い水準に決まると、金融引き締めが進むとの見方が強まり、円が買われやすいとされる。',
    '日銀の政策金利が予想より低い水準に決まると、金融緩和的な姿勢が続くとの見方が強まり、円が売られやすいとされる。')
on conflict (code) do nothing;

insert into indicator_fx_pairs (indicator_id, fx_pair_id, priority)
select i.id, p.id, v.priority
from (values
  ('US_CPI', 'USDJPY', 1), ('US_CPI', 'EURUSD', 2),
  ('US_NFP', 'USDJPY', 1), ('US_NFP', 'EURUSD', 2),
  ('US_FOMC', 'USDJPY', 1),
  ('JP_CPI', 'USDJPY', 1), ('JP_CPI', 'EURJPY', 2),
  ('BOJ_RATE', 'USDJPY', 1)
) as v(code, symbol, priority)
join economic_indicators i on i.code = v.code
join fx_pairs p on p.symbol = v.symbol
on conflict (indicator_id, fx_pair_id) do nothing;
