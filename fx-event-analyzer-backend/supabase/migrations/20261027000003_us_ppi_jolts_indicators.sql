-- 米国 PPI・コアPPI・JOLTS の指標マスタ(HQ指示 2026-10-27「指標の追加: 米国PPI・コアPPI、JOLTS」)。
--
-- 3指標とも BLS の公式発表スケジュール経路(npm run ingest:official:bls-calendar)で取り込む。
-- この行が無い間は、ジョブはこの3指標を indicator_not_in_db として飛ばすだけ(既存の指標には影響しない)。
--
-- | code         | BLS 系列                                   | 値                                       | 発表                 |
-- |--------------|--------------------------------------------|------------------------------------------|----------------------|
-- | US_PPI       | WPSFD4(前年比は WPUFD4)                   | 前月比 %(季節調整済み)、前年比 %(季節調整なし) | PPI の発表 08:30 ET  |
-- | US_CORE_PPI  | WPSFD49104(前年比は WPUFD49104)           | 同上(食品・エネルギーを除く最終需要)     | 同上                 |
-- | US_JOLTS     | JTS000000000000000JOL                      | 求人件数の水準(千件、季節調整済み)      | JOLTS の発表 10:00 ET |
--
-- 表示名は indicator-display-names.md の表どおり(PPI は「生産者物価指数（PPI）」)。コアPPI・JOLTS は表に無いので、
-- 「コアCPI」と同じ書き方の「コアPPI」と、略称の定着した「JOLTS求人件数」とする(HQ の確認事項)。
-- 関連の通貨ペアは US_CPI・US_NFP と同じ(USDJPY 1、EURUSD 2)。ローカルでは seed.sql が入れる(fx_pairs が後のため)。
-- 何度流しても同じ結果になる(code・(indicator_id, fx_pair_id) の一意制約で、既にある行は変えない)。
-- 戻し方: この3指標の economic_events が無いことを確かめてから、indicator_fx_pairs → economic_indicators の順に消す。

insert into economic_indicators (code, name, name_en, display_name, country_code, currency_code, importance, description, key_points, frequency, unit, source, source_url, favorable_direction, market_view_above, market_view_below) values
  ('US_PPI', '米国生産者物価指数(PPI)', 'Producer Price Index', '生産者物価指数（PPI）', 'US', 'USD', 'MEDIUM',
    '生産者物価指数（PPI）は、企業が出荷する財やサービスの価格の変動を示す指標です。消費者物価に先行して動くことが多く、インフレの先行きを見る材料として注目されます。',
    array['企業段階の物価の動きを把握できる', '消費者物価の先行指標になりやすい', 'インフレの判断材料として注目される'],
    'MONTHLY', '%', 'U.S. Bureau of Labor Statistics', 'https://www.bls.gov/ppi/', 'HIGHER_IS_POSITIVE',
    '米国PPIが予想を上回ると、インフレ圧力の強まりから利下げが遠のくとの見方が強まり、ドルが買われやすいとされる。',
    '米国PPIが予想を下回ると、インフレ圧力の弱まりから利下げが意識され、ドルが売られやすいとされる。'),
  ('US_CORE_PPI', '米国コアPPI(食品・エネルギーを除く生産者物価指数)', 'Core Producer Price Index', 'コアPPI', 'US', 'USD', 'MEDIUM',
    'コアPPIは、生産者物価指数（PPI）から値動きの大きい食品とエネルギーを除いた指標です。企業段階の物価の基調的な動きを示します。',
    array['企業段階の物価の基調を把握できる', '一時的な要因に左右されにくい', 'インフレの判断材料として注目される'],
    'MONTHLY', '%', 'U.S. Bureau of Labor Statistics', 'https://www.bls.gov/ppi/', 'HIGHER_IS_POSITIVE',
    '米国コアPPIが予想を上回ると、物価の基調の強さから利下げが遠のくとの見方が強まり、ドルが買われやすいとされる。',
    '米国コアPPIが予想を下回ると、物価の基調の落ち着きから利下げが意識され、ドルが売られやすいとされる。'),
  ('US_JOLTS', '米国JOLTS求人件数', 'JOLTS Job Openings', 'JOLTS求人件数', 'US', 'USD', 'MEDIUM',
    'JOLTS求人件数は、米国の企業が募集している求人の件数を示す指標です。労働需要の強さを示し、雇用情勢を見る材料として注目されます。',
    array['労働需要の強さを把握できる', '雇用統計と並ぶ雇用の判断材料になる', 'FRBの金融政策判断に影響する'],
    'MONTHLY', 'K', 'U.S. Bureau of Labor Statistics', 'https://www.bls.gov/jlt/', 'HIGHER_IS_POSITIVE',
    '米国のJOLTS求人件数が予想を上回ると、労働需要の底堅さから利下げが遠のくとの見方が強まり、ドルが買われやすいとされる。',
    '米国のJOLTS求人件数が予想を下回ると、労働需要の弱まりから利下げが意識され、ドルが売られやすいとされる。')
on conflict (code) do nothing;

insert into indicator_fx_pairs (indicator_id, fx_pair_id, priority)
select i.id, p.id, v.priority
from (values
  ('US_PPI', 'USDJPY', 1), ('US_PPI', 'EURUSD', 2),
  ('US_CORE_PPI', 'USDJPY', 1), ('US_CORE_PPI', 'EURUSD', 2),
  ('US_JOLTS', 'USDJPY', 1), ('US_JOLTS', 'EURUSD', 2)
) as v(code, symbol, priority)
join economic_indicators i on i.code = v.code
join fx_pairs p on p.symbol = v.symbol
on conflict (indicator_id, fx_pair_id) do nothing;
