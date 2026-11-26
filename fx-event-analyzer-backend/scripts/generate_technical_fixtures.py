"""Generate golden reference vectors for src/domain/technical (independent of the TypeScript code).

Run:  python scripts/generate_technical_fixtures.py   (from fx-event-analyzer-backend/)
Needs pandas + numpy (not installed by this repo; nothing is pip-installed by this script).
Output: tests/fixtures/technical/reference.json  (deterministic: no RNG library, fixed LCG).

Conventions mirrored on purpose (they are definitions, the numbers come from pandas):
  EMA / Wilder: seeded with the SMA of the first `period` values, then pandas ewm(adjust=False)
  (alpha = 2/(n+1) for EMA/MACD signal, alpha = 1/n for RSI/ATR). Bollinger uses rolling std ddof=0.
  Resampling uses pandas resample(closed=left, label=left, origin=epoch) with first/max/min/last/sum.
NY17 FX-day resampling (1D / 4h) uses Python zoneinfo (IANA tz database, independent of the Intl/ICU
code used by the TypeScript implementation); the daily result is also cross-checked against native
pandas tz-aware resample(offset=17h) and the script aborts if they disagree.
Convention: FX day = 17:00 America/New_York to 17:00 (23h/24h/25h with DST); 4h bars on NY wall-clock
17,21,01,05,09,13 (six per day; a DST day has one 3h/5h bar).
"""
import json
import math
import pathlib
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

OUT = pathlib.Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "technical" / "reference.json"


def lcg(seed):
    state = seed
    while True:
        state = (state * 1103515245 + 12345) % (2**31)
        yield state / 2**31


def make_bars():
    """5-minute synthetic EURUSD-like series Wed 2024-01-03 00:00Z .. Mon 2024-01-08 with FX weekend + random gaps."""
    rnd = lcg(20261125)
    start = pd.Timestamp("2024-01-03 00:00:00", tz="UTC")
    end = pd.Timestamp("2024-01-08 12:00:00", tz="UTC")
    price = 1.1000
    rows = []
    for ts in pd.date_range(start, end, freq="5min", inclusive="left"):
        o = price
        drift = (next(rnd) - 0.5) * 0.0010 + 0.00015 * math.sin(len(rows) / 40.0)
        c = o + drift
        h = max(o, c) + next(rnd) * 0.0004
        l = min(o, c) - next(rnd) * 0.0004
        v = int(50 + next(rnd) * 200)
        price = c
        wd = ts.weekday()  # Mon=0
        in_weekend = (wd == 4 and ts.hour >= 22) or wd == 5 or (wd == 6 and ts.hour < 22)
        if in_weekend:
            continue
        if next(rnd) < 0.03:  # random feed gaps
            continue
        rows.append((ts, round(o, 6), round(h, 6), round(l, 6), round(c, 6), v))
    return pd.DataFrame(rows, columns=["t", "o", "h", "l", "c", "v"])


NY = ZoneInfo("America/New_York")
UTC = timezone.utc
H4_HOURS = [17, 21, 1, 5, 9, 13]


def fx_day_boundaries(d0: date):
    """7 UTC boundaries of the FX day that starts 17:00 NY on d0 (zoneinfo, fold=0 = first occurrence)."""
    d1 = d0 + timedelta(days=1)
    pts = []
    for h in H4_HOURS:
        dd = d0 if h >= 17 else d1
        pts.append(datetime(dd.year, dd.month, dd.day, h, tzinfo=NY).astimezone(UTC))
    pts.append(datetime(d1.year, d1.month, d1.day, 17, tzinfo=NY).astimezone(UTC))
    return pts


def fx_day_start_date(ts: pd.Timestamp) -> date:
    loc = ts.to_pydatetime().astimezone(NY)
    return loc.date() if loc.hour >= 17 else loc.date() - timedelta(days=1)


def ny17_resample(rows, src_ms, kind):
    """rows: list of dicts t(ms),o,h,l,c,v. kind '1D' or '4h'. Independent grouping via zoneinfo."""
    out = {}
    for r in rows:
        ts = pd.Timestamp(r["t"], unit="ms", tz="UTC")
        d0 = fx_day_start_date(ts)
        b = fx_day_boundaries(d0)
        t = ts.to_pydatetime()
        if kind == "1D":
            start, end = b[0], b[6]
        else:
            k = max(i for i in range(6) if b[i] <= t)
            start, end = b[k], b[k + 1]
        key = start
        if key not in out:
            out[key] = {"start": start, "end": end, "rows": []}
        out[key]["rows"].append(r)
    res = []
    for key in sorted(out):
        g = out[key]
        rs = g["rows"]
        res.append({
            "t": int(g["start"].timestamp() * 1000),
            "end": int(g["end"].timestamp() * 1000),
            "o": rs[0]["o"], "h": max(x["h"] for x in rs), "l": min(x["l"] for x in rs), "c": rs[-1]["c"],
            "v": int(sum(x["v"] for x in rs)), "n": len(rs),
            "expected": int(round((g["end"] - g["start"]).total_seconds() * 1000 / src_ms)),
        })
    return res


def make_continuous_dst_bars():
    """24/7 hourly bars (no weekend closure) across both DST changes so that 23h / 25h FX days contain data.
    Real FX weekends hide the DST change, so this dataset exists purely to exercise the algorithm."""
    rnd = lcg(4242)
    rows = []
    price = 1.1
    for a, b in ((datetime(2024, 3, 8, tzinfo=UTC), datetime(2024, 3, 13, tzinfo=UTC)), (datetime(2024, 11, 1, tzinfo=UTC), datetime(2024, 11, 6, tzinfo=UTC))):
        ts = a
        while ts < b:
            o = price
            c = o + (next(rnd) - 0.5) * 0.004
            rows.append({"t": int(ts.timestamp() * 1000), "o": round(o, 6), "h": round(max(o, c) + next(rnd) * 0.001, 6), "l": round(min(o, c) - next(rnd) * 0.001, 6), "c": round(c, 6), "v": int(100 + next(rnd) * 900)})
            price = c
            ts += timedelta(hours=1)
    return rows


def make_dst_bars():
    """1h bars around DST changes and the Christmas/New Year holidays, with FX weekend (Fri 17:00 NY -> Sun 17:00 NY),
    holiday closures/thin sessions and random feed gaps."""
    rnd = lcg(777)
    rows = []
    price = 1.2500
    for a, b in ((date(2024, 3, 4), date(2024, 3, 16)), (date(2024, 10, 28), date(2024, 11, 10)), (date(2024, 12, 18), date(2025, 1, 4))):
        ts = datetime(a.year, a.month, a.day, tzinfo=UTC)
        end = datetime(b.year, b.month, b.day, tzinfo=UTC)
        while ts < end:
            loc = ts.astimezone(NY)
            o = price
            c = o + (next(rnd) - 0.5) * 0.004
            h = max(o, c) + next(rnd) * 0.001
            l = min(o, c) - next(rnd) * 0.001
            v = int(100 + next(rnd) * 900)
            price = c
            wd = loc.weekday()
            weekend = (wd == 4 and loc.hour >= 17) or wd == 5 or (wd == 6 and loc.hour < 17)
            ld = loc.date()
            holiday = ld in (date(2024, 12, 25), date(2025, 1, 1)) or (ld in (date(2024, 12, 24), date(2024, 12, 31)) and loc.hour >= 13)
            gap = next(rnd) < 0.03
            if not (weekend or holiday or gap):
                rows.append({"t": int(ts.timestamp() * 1000), "o": round(o, 6), "h": round(h, 6), "l": round(l, 6), "c": round(c, 6), "v": v})
            ts += timedelta(hours=1)
    return rows


def seeded_ewm(s, n, alpha):
    """SMA-seeded recursive smoothing via pandas ewm(adjust=False); leading NaNs skipped."""
    first = s.first_valid_index()
    pos = s.index.get_loc(first)
    seed_pos = pos + n - 1
    if seed_pos >= len(s):
        return pd.Series(np.nan, index=s.index)
    x = s.copy()
    x.iloc[:seed_pos] = np.nan
    x.iloc[seed_pos] = s.iloc[pos : seed_pos + 1].mean()
    out = x.iloc[seed_pos:].ewm(alpha=alpha, adjust=False).mean()
    return out.reindex(s.index)


def lst(s):
    return [None if (v is None or (isinstance(v, float) and math.isnan(v))) else float(v) for v in s.tolist()]


def main():
    df = make_bars()
    N = 400
    d = df.iloc[:N].reset_index(drop=True)
    c, h, l = d["c"], d["h"], d["l"]
    ref = {}

    for n in (5, 20):
        ref[f"sma_{n}"] = lst(c.rolling(n).mean())
    for n in (5, 14):
        w = np.arange(1, n + 1, dtype=float)
        ref[f"wma_{n}"] = lst(c.rolling(n).apply(lambda x: float(np.dot(x, w) / w.sum()), raw=True))
    for n in (9, 21):
        ref[f"ema_{n}"] = lst(seeded_ewm(c, n, 2 / (n + 1)))

    delta = c.diff()
    gain = delta.clip(lower=0)
    loss = (-delta).clip(lower=0)

    def rsi(n):
        g = gain.copy()
        lo = loss.copy()
        g.iloc[:n] = np.nan
        lo.iloc[:n] = np.nan
        g.iloc[n] = gain.iloc[1 : n + 1].mean()
        lo.iloc[n] = loss.iloc[1 : n + 1].mean()
        ag = g.iloc[n:].ewm(alpha=1 / n, adjust=False).mean().reindex(c.index)
        al = lo.iloc[n:].ewm(alpha=1 / n, adjust=False).mean().reindex(c.index)
        return 100 - 100 / (1 + ag / al)

    ref["rsi_14"] = lst(rsi(14))
    ref["rsi_7"] = lst(rsi(7))

    macd_line = seeded_ewm(c, 12, 2 / 13) - seeded_ewm(c, 26, 2 / 27)
    sig = seeded_ewm(macd_line, 9, 2 / 10)
    ref["macd_12_26_9"] = {"macd": lst(macd_line), "signal": lst(sig), "histogram": lst(macd_line - sig)}

    mid = c.rolling(20).mean()
    sd = c.rolling(20).std(ddof=0)
    ref["bollinger_20_2"] = {"middle": lst(mid), "upper": lst(mid + 2 * sd), "lower": lst(mid - 2 * sd)}

    pc = c.shift(1)
    tr = pd.concat([h - l, (h - pc).abs(), (l - pc).abs()], axis=1).max(axis=1)
    tr.iloc[0] = np.nan
    ref["true_range"] = lst(tr)
    for n in (14, 5):
        t = tr.copy()
        t.iloc[:n] = np.nan
        t.iloc[n] = tr.iloc[1 : n + 1].mean()
        ref[f"atr_{n}"] = lst(t.iloc[n:].ewm(alpha=1 / n, adjust=False).mean().reindex(c.index))

    hh = h.rolling(14).max()
    ll = l.rolling(14).min()
    raw = 100 * (c - ll) / (hh - ll)
    k = raw.rolling(3).mean()
    ref["stoch_14_3_3"] = {"k": lst(k), "d": lst(k.rolling(3).mean())}

    ref["input"] = [
        {"t": int(r.t.timestamp() * 1000), "o": r.o, "h": r.h, "l": r.l, "c": r.c, "v": int(r.v)}
        for r in d.itertuples()
    ]

    # Resampler reference on the full gapped 5m series (weekend + random gaps).
    full = df.set_index("t")
    resampled = {}
    for rule, key in (("15min", "15m"), ("1h", "1h"), ("4h", "4h"), ("1D", "1D")):
        g = full.resample(rule, closed="left", label="left", origin="epoch")
        agg = g.agg({"o": "first", "h": "max", "l": "min", "c": "last", "v": "sum"})
        agg["n"] = g["c"].count()
        agg = agg[agg["n"] > 0]
        resampled[key] = [
            {"t": int(ix.timestamp() * 1000), "o": r.o, "h": r.h, "l": r.l, "c": r.c, "v": int(r.v), "n": int(r.n)}
            for ix, r in agg.iterrows()
        ]
    # NY17 FX-day references on the gapped 5m series.
    five = [{"t": int(r.t.timestamp() * 1000), "o": r.o, "h": r.h, "l": r.l, "c": r.c, "v": int(r.v)} for r in df.itertuples()]
    resampled["1D_ny17"] = ny17_resample(five, 300_000, "1D")
    resampled["4h_ny17"] = ny17_resample(five, 300_000, "4h")
    # cross-check the daily grouping against native pandas tz-aware resample (offset 17h)
    ny = full.tz_convert("America/New_York")
    pg = ny.resample("1D", offset="17h", closed="left", label="left")
    pagg = pg.agg({"o": "first", "h": "max", "l": "min", "c": "last", "v": "sum"})
    pagg["n"] = pg["c"].count()
    pagg = pagg[pagg["n"] > 0]
    mine = resampled["1D_ny17"]
    assert len(pagg) == len(mine), (len(pagg), len(mine))
    for (ix, r), m in zip(pagg.iterrows(), mine):
        assert int(ix.timestamp() * 1000) == m["t"] and r.o == m["o"] and r.h == m["h"] and r.l == m["l"] and r.c == m["c"] and int(r.n) == m["n"], (ix, m)
    ref["ny17_input_1h"] = make_dst_bars()
    ref["ny17_1h_to"] = {"1D": ny17_resample(ref["ny17_input_1h"], 3_600_000, "1D"), "4h": ny17_resample(ref["ny17_input_1h"], 3_600_000, "4h")}
    ref["ny17_input_continuous"] = make_continuous_dst_bars()
    ref["ny17_continuous_to"] = {"1D": ny17_resample(ref["ny17_input_continuous"], 3_600_000, "1D"), "4h": ny17_resample(ref["ny17_input_continuous"], 3_600_000, "4h")}
    ref["resample_input"] = [
        {"t": int(r.t.timestamp() * 1000), "o": r.o, "h": r.h, "l": r.l, "c": r.c, "v": int(r.v)}
        for r in df.itertuples()
    ]
    ref["resample_5m_to"] = resampled
    ref["_meta"] = {"pandas": pd.__version__, "numpy": np.__version__, "generator": "scripts/generate_technical_fixtures.py"}

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(ref, separators=(",", ":")), encoding="utf-8")
    print("wrote", OUT, OUT.stat().st_size, "bytes; bars", len(df))


if __name__ == "__main__":
    main()
