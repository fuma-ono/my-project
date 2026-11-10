-- 最初の5指標の出典 URL(source_url)を入れる(HQ指示 2026-11-10「データ品質監査: source_url 欠落5件」)。
--
-- DEV の確認(2026-11-10、読み取りだけの SQL): 有効な指標のうち US_CPI・US_NFP・US_FOMC・JP_CPI・BOJ_RATE の5件だけ
-- source_url が空だった。原因は seed.sql の最初の insert が source_url の列を入れていなかったこと(source = 出典名はある)。
-- 後から足した指標(US_CORE_CPI など)と同じく、公表元の、その統計・決定のページを入れる:
--   US_CPI   → https://www.bls.gov/cpi/            (US_CORE_CPI と同じ)
--   US_NFP   → https://www.bls.gov/ces/            (US_AVG_HOURLY_EARNINGS と同じ。Current Employment Statistics)
--   US_FOMC  → https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm  (US_FOMC_MINUTES と同じ)
--   JP_CPI   → https://www.stat.go.jp/data/cpi/     (総務省統計局「消費者物価指数(CPI)」)
--   BOJ_RATE → https://www.boj.or.jp/mopo/mpmdeci/index.htm  (日本銀行「金融政策決定会合の決定内容」)
-- 2026-11-10 に開けることを確認(FRB・統計局・日銀は HTTP 200。BLS はスクリプトからの取得を 403 で断るが、同じ URL は
-- 既に US_CORE_CPI などで使っている)。
--
-- source_url が空の行だけを埋める(人が入れた値は上書きしない)。何度流しても同じ結果。値・イベントには触れない。
-- 注: BOJ_RATE の利用条件(商用利用は事前の相談が必要)は未解決のまま。URL を入れても、BOJ のデータを取り込むことにはならない。
-- ローカル・CI では migration が seed の前に流れ、この時点ではこの5行が無いので、seed.sql でも同じ update をする。
-- 戻す手順(この migration が入れた値のままの行だけを空に戻す):
--   update economic_indicators set source_url = null
--   where (code, source_url) in (('US_CPI', 'https://www.bls.gov/cpi/'), ('US_NFP', 'https://www.bls.gov/ces/'),
--     ('US_FOMC', 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'),
--     ('JP_CPI', 'https://www.stat.go.jp/data/cpi/'), ('BOJ_RATE', 'https://www.boj.or.jp/mopo/mpmdeci/index.htm'));

update economic_indicators set source_url = v.source_url
from (values
  ('US_CPI', 'https://www.bls.gov/cpi/'),
  ('US_NFP', 'https://www.bls.gov/ces/'),
  ('US_FOMC', 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'),
  ('JP_CPI', 'https://www.stat.go.jp/data/cpi/'),
  ('BOJ_RATE', 'https://www.boj.or.jp/mopo/mpmdeci/index.htm')
) as v(code, source_url)
where economic_indicators.code = v.code
  and (economic_indicators.source_url is null or btrim(economic_indicators.source_url) = '');
