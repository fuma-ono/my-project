-- カナダのコア CPI(CPI-trim・CPI-median)を経済指標として追加する(設計書 ca-cpi-detailed-design.md 第5版 §15.6・§2.2・§11、
-- §16.15.3 工程 1)。**この migration はまだ適用しない**(DEV への適用は HQ の別の承認が先)。何度流しても同じ結果
-- (on conflict do nothing)。既存の指標・イベント・通貨ペア(CA_CPI を含む)には触れない。
--
-- 取得元: Statistics Canada の表 18-10-0256-01。定義の説明は StatCan の表4の注記(Table note 7 = trim、6 = median)の意味だけで書く
-- (カナダ銀行のページにしか無い具体的な数字は書かない。2つの優劣・どちらが主かも書かない。設計書 §2.2・§14.4)。
-- 予想値は取得元に無いため、market_view は一般論の形にとどめる(既存の GB/AU/CA と同じ)。
-- 表示名は indicator-display-names.md の決まり(略称は併記・カッコは全角・国名は入れない)に合わせ、ヘッドラインの
-- 「消費者物価指数（CPI）」と一覧で見分けられるよう trim / median を明記する。
-- 説明文・key_points・market_view の文言は案(設計書 §15.6: HQ 確認を受ける)。
--
-- 関連の通貨ペアは CADJPY(priority 1。CA_CPI と同じ)。ローカル・CI では migration が seed の前に流れ、その時点では
-- fx_pairs が空なので、seed.sql でも同じ行を入れる(20261110000002 と同じ)。
-- イベント(公表予定 5回 × 2 = 10件)は migration ではなく ingest:gb-au-ca-schedules で入れる(dry-run → 承認 → 実行)。
-- 戻す手順(イベントが無いうちだけ):
--   delete from indicator_fx_pairs where indicator_id in (select id from economic_indicators where code in ('CA_CPI_TRIM','CA_CPI_MEDIAN'));
--   delete from economic_indicators where code in ('CA_CPI_TRIM','CA_CPI_MEDIAN');

insert into economic_indicators (code, name, name_en, display_name, country_code, currency_code, importance, description, key_points, frequency, unit, source, source_url, favorable_direction, market_view_above, market_view_below) values
  ('CA_CPI_TRIM', 'カナダ CPI-trim(トリム平均、前年比)', 'Canada CPI-trim (trimmed mean), 12-month change', 'コアCPI（CPI-trim）', 'CA', 'CAD', 'MEDIUM',
    'カナダのコア CPI の指標の一つ、CPI-trim(前年比)です。CPI の構成品目のうち、その月の価格変動の分布の両端に当たる品目を除いて求める、基調的な物価の動きを見る指標です。カナダ統計局(Statistics Canada)が毎月公表します。',
    array['一時的な価格変動の影響を抑えた、基調的な物価の動きを把握できる', 'カナダ銀行の金融政策判断の材料になる', '毎月 Statistics Canada が公表する'],
    'MONTHLY', '%', 'Statistics Canada', 'https://www.statcan.gc.ca', 'HIGHER_IS_POSITIVE',
    'カナダのコアCPIが予想を上回ると、基調的な物価の強さから利下げが遠のくとの見方が強まり、カナダドルが買われやすいとされる。',
    'カナダのコアCPIが予想を下回ると、基調的な物価の落ち着きから利下げが意識され、カナダドルが売られやすいとされる。'),
  ('CA_CPI_MEDIAN', 'カナダ CPI-median(中央値、前年比)', 'Canada CPI-median (weighted median), 12-month change', 'コアCPI（CPI-median）', 'CA', 'CAD', 'MEDIUM',
    'カナダのコア CPI の指標の一つ、CPI-median(前年比)です。その月の価格変動を CPI の構成品目のウェイトで並べたときの、ちょうど真ん中(50パーセンタイル)にあたる価格変動を使う、基調的な物価の動きを見る指標です。カナダ統計局(Statistics Canada)が毎月公表します。',
    array['極端な価格変動の影響を抑えた、基調的な物価の動きを把握できる', 'カナダ銀行の金融政策判断の材料になる', '毎月 Statistics Canada が公表する'],
    'MONTHLY', '%', 'Statistics Canada', 'https://www.statcan.gc.ca', 'HIGHER_IS_POSITIVE',
    'カナダのコアCPIが予想を上回ると、基調的な物価の強さから利下げが遠のくとの見方が強まり、カナダドルが買われやすいとされる。',
    'カナダのコアCPIが予想を下回ると、基調的な物価の落ち着きから利下げが意識され、カナダドルが売られやすいとされる。')
on conflict (code) do nothing;

insert into indicator_fx_pairs (indicator_id, fx_pair_id, priority)
select i.id, p.id, v.priority
from (values
  ('CA_CPI_TRIM', 'CADJPY', 1),
  ('CA_CPI_MEDIAN', 'CADJPY', 1)
) as v(code, symbol, priority)
join economic_indicators i on i.code = v.code
join fx_pairs p on p.symbol = v.symbol
on conflict (indicator_id, fx_pair_id) do nothing;
