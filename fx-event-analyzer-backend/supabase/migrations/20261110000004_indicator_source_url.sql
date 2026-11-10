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
-- 既に US_CORE_CPI などで使っている)。BOJ_RATE の URL を入れることと、BOJ のデータの商用利用の許可は別の問題(未解決のまま)。
--
-- HQ レビュー(2026-11-10)の指摘への対応:
--   - 変更前の値を残す: indicator_source_url_backfills に、変えた行だけ「変更前の値・入れた値・そのときの updated_at」を記録する。
--   - 既存の値を上書きしない: source_url が空(null か空白だけ)の行だけを変える。2回目以降の実行では何も変えない。
--   - 戻すときは migration が入れた値だけ: source_url が入れた値のまま **かつ** updated_at が記録と同じ行だけを戻す
--     (economic_indicators の updated_at はどの列の更新でもトリガーで変わる。後から人が同じ URL を入れ直した・ほかの列を
--     直した行は戻さない)。戻せなかった行は関数の戻り値で分かる。
-- 何度流しても同じ結果。値・イベントには触れない。
-- ローカル・CI では migration が seed の前に流れ、この時点ではこの5行が無いので、seed.sql でも同じ関数を呼ぶ。
--
-- 戻す手順(DEV で、service_role で):
--   select * from rollback_indicator_source_url_backfill('20261110000004');   -- 戻した行・戻さなかった行(理由つき)
--   -- 戻さなかった行が無いことを確かめてから(あれば人が判断):
--   drop function backfill_indicator_source_urls(text, jsonb);
--   drop function rollback_indicator_source_url_backfill(text);
--   drop table indicator_source_url_backfills;

create table indicator_source_url_backfills (
  batch text not null,
  code text not null,
  previous_source_url text,
  applied_source_url text not null check (applied_source_url ~ '^https://'),
  applied_updated_at timestamptz not null,
  rolled_back_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (batch, code)
);

alter table indicator_source_url_backfills enable row level security;
revoke all on table indicator_source_url_backfills from public, anon, authenticated;

-- p_urls: [{"code": "...", "source_url": "https://..."}]。空の行だけを埋め、変えた行を記録する。戻り値 = 変えた行の数。
create or replace function backfill_indicator_source_urls(p_batch text, p_urls jsonb)
returns integer
language plpgsql
as $$
declare
  changed integer;
begin
  with targets as (
    select v.code, v.source_url
    from jsonb_to_recordset(p_urls) as v(code text, source_url text)
  ),
  updated as (
    update economic_indicators i
    set source_url = t.source_url
    from targets t
    where i.code = t.code
      and (i.source_url is null or btrim(i.source_url) = '')
      and t.source_url ~ '^https://'
    returning i.code, i.source_url, i.updated_at
  ),
  recorded as (
    insert into indicator_source_url_backfills (batch, code, previous_source_url, applied_source_url, applied_updated_at)
    -- 変える前は空(null か空白)だけ。空白だけの値も null として記録する(元の空白は表示に意味がない)
    select p_batch, u.code, null, u.source_url, u.updated_at
    from updated u
    on conflict (batch, code) do nothing
    returning 1
  )
  select count(*) into changed from recorded;
  return changed;
end;
$$;

-- migration が入れた値だけを戻す。戻り値: 対象の行ごとに reverted(true/false)と、戻さなかった理由。
create or replace function rollback_indicator_source_url_backfill(p_batch text)
returns table (code text, reverted boolean, reason text)
language plpgsql
as $$
declare
  r record;
  cur record;
begin
  for r in
    select b.code, b.previous_source_url, b.applied_source_url, b.applied_updated_at
    from indicator_source_url_backfills b
    where b.batch = p_batch and b.rolled_back_at is null
    order by b.code
  loop
    select i.source_url, i.updated_at into cur from economic_indicators i where i.code = r.code;
    if not found then
      code := r.code; reverted := false; reason := 'INDICATOR_NOT_FOUND';
    elsif cur.source_url is distinct from r.applied_source_url then
      code := r.code; reverted := false; reason := 'SOURCE_URL_CHANGED_AFTER_BACKFILL';
    elsif cur.updated_at is distinct from r.applied_updated_at then
      code := r.code; reverted := false; reason := 'ROW_UPDATED_AFTER_BACKFILL';
    else
      update economic_indicators i set source_url = r.previous_source_url where i.code = r.code;
      update indicator_source_url_backfills b set rolled_back_at = now() where b.batch = p_batch and b.code = r.code;
      code := r.code; reverted := true; reason := null;
    end if;
    return next;
  end loop;
end;
$$;

revoke all on function backfill_indicator_source_urls(text, jsonb) from public, anon, authenticated;
grant execute on function backfill_indicator_source_urls(text, jsonb) to service_role;
revoke all on function rollback_indicator_source_url_backfill(text) from public, anon, authenticated;
grant execute on function rollback_indicator_source_url_backfill(text) to service_role;

select backfill_indicator_source_urls('20261110000004', '[
  {"code": "US_CPI", "source_url": "https://www.bls.gov/cpi/"},
  {"code": "US_NFP", "source_url": "https://www.bls.gov/ces/"},
  {"code": "US_FOMC", "source_url": "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"},
  {"code": "JP_CPI", "source_url": "https://www.stat.go.jp/data/cpi/"},
  {"code": "BOJ_RATE", "source_url": "https://www.boj.or.jp/mopo/mpmdeci/index.htm"}
]'::jsonb);
