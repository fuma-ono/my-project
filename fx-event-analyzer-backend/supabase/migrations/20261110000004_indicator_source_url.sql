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
--   - 変更前の値を残す: indicator_source_url_backfills に、変えた行だけ「変更前の値(null か空白の文字列をそのまま)・入れた値・
--     そのときの updated_at」を記録する(HQ レビュー 2026-11-10 2回目: 空白の文字列も実値で残し、そのまま戻す)。
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
--   drop function backfill_indicator_source_urls(text, jsonb, numeric);
--   drop function rollback_indicator_source_url_backfill(text, numeric);
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

-- HQ レビュー(2026-11-10 4回目): バックフィルとロールバックの同時実行によるデッドロックを防ぐ。
-- ロックの順は backfill が economic_indicators → indicator_source_url_backfills、rollback がその逆なので、同じ指標・同じ batch を
-- 同時に処理すると(例: 記録が残ったまま人が source_url を空に戻した行)、互いに相手の行を待ってデッドロックになりうる。
-- そこで両方の関数の最初に、同じキーの transaction 単位のアドバイザリーロック(pg_advisory_xact_lock)を取り、この2つの関数を
-- 1つずつしか動かないようにする(後から来た方は、先の transaction が終わるまで待つ)。ほかの処理(人の更新・取り込み)は
-- indicator_source_url_backfills に触れないので、このロックの対象にしなくてもロックの順の逆転は起きない。
-- キー: hashtext('indicator_source_url_backfills')(1つの値。batch をまたいでも直列にする — 管理用の、まれな操作のため)。

-- p_urls: [{"code": "...", "source_url": "https://..."}]。空の行だけを埋め、変えた行を記録する。戻り値 = 変えた行の数。
-- p_hold_seconds: 検証用(結合テストで同時実行を確実に起こすため)。最初の行をロックして変えた後、記録する前に待つ秒数。
-- 既定 0、上限 5。
create or replace function backfill_indicator_source_urls(p_batch text, p_urls jsonb, p_hold_seconds numeric default 0)
returns integer
language plpgsql
as $$
declare
  changed integer := 0;
  r record;
  applied_at timestamptz;
begin
  if p_hold_seconds is null or p_hold_seconds < 0 or p_hold_seconds > 5 then
    raise exception 'p_hold_seconds must be between 0 and 5' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('indicator_source_url_backfills'));
  -- 変える前の値(null か、空白だけの文字列)をそのまま読む。行は for update で押さえ、読んでから変えるまでの間に
  -- ほかの更新が入らないようにする。
  for r in
    select i.id, i.code, i.source_url as previous_source_url, t.source_url as applied_source_url
    from economic_indicators i
    join jsonb_to_recordset(p_urls) as t(code text, source_url text) on t.code = i.code
    where (i.source_url is null or btrim(i.source_url) = '')
      and t.source_url ~ '^https://'
    order by i.code
    for update of i
  loop
    update economic_indicators i
    set source_url = r.applied_source_url
    where i.id = r.id
    returning i.updated_at into applied_at;
    if changed = 0 and p_hold_seconds > 0 then
      perform pg_sleep(p_hold_seconds);
    end if;

    insert into indicator_source_url_backfills (batch, code, previous_source_url, applied_source_url, applied_updated_at)
    values (p_batch, r.code, r.previous_source_url, r.applied_source_url, applied_at)
    -- 同じ batch で、戻した後(または人が空に戻した後)に流し直したときは、その回の値で記録を置き換える
    on conflict (batch, code) do update
      set previous_source_url = excluded.previous_source_url,
          applied_source_url = excluded.applied_source_url,
          applied_updated_at = excluded.applied_updated_at,
          rolled_back_at = null;
    changed := changed + 1;
  end loop;
  return changed;
end;
$$;

-- migration が入れた値だけを戻す。戻り値: 対象の行ごとに reverted(true/false)と、戻さなかった理由。
-- HQ レビュー(2026-11-10 3回目): 比較から復元までの間に別の処理が同じ行を変えないよう、economic_indicators の行を
-- FOR UPDATE でロックしてから source_url・updated_at を比べる(ロックはこの関数の transaction が終わるまで続く。
-- 同時の更新はロックが外れるまで待ち、その後に適用される — 復元で上書きされて消えることはない)。
-- p_hold_seconds: 検証用(結合テストで同時の更新を確実に起こすため)。ロックを取った後、比べる前に待つ秒数。既定 0、上限 5。
create or replace function rollback_indicator_source_url_backfill(p_batch text, p_hold_seconds numeric default 0)
returns table (code text, reverted boolean, reason text)
language plpgsql
as $$
declare
  r record;
  cur record;
  row_found boolean;
begin
  if p_hold_seconds is null or p_hold_seconds < 0 or p_hold_seconds > 5 then
    raise exception 'p_hold_seconds must be between 0 and 5' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('indicator_source_url_backfills')); -- backfill と同じキー(上の説明)
  for r in
    select b.code, b.previous_source_url, b.applied_source_url, b.applied_updated_at
    from indicator_source_url_backfills b
    where b.batch = p_batch and b.rolled_back_at is null
    order by b.code
    for update of b
  loop
    select i.source_url, i.updated_at into cur from economic_indicators i where i.code = r.code for update of i;
    row_found := found;
    if row_found and p_hold_seconds > 0 then
      perform pg_sleep(p_hold_seconds);
    end if;
    if not row_found then
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

revoke all on function backfill_indicator_source_urls(text, jsonb, numeric) from public, anon, authenticated;
grant execute on function backfill_indicator_source_urls(text, jsonb, numeric) to service_role;
revoke all on function rollback_indicator_source_url_backfill(text, numeric) from public, anon, authenticated;
grant execute on function rollback_indicator_source_url_backfill(text, numeric) to service_role;

select backfill_indicator_source_urls('20261110000004', '[
  {"code": "US_CPI", "source_url": "https://www.bls.gov/cpi/"},
  {"code": "US_NFP", "source_url": "https://www.bls.gov/ces/"},
  {"code": "US_FOMC", "source_url": "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"},
  {"code": "JP_CPI", "source_url": "https://www.stat.go.jp/data/cpi/"},
  {"code": "BOJ_RATE", "source_url": "https://www.boj.or.jp/mopo/mpmdeci/index.htm"}
]'::jsonb);
