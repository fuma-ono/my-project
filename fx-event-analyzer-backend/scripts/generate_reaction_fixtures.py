"""Generate cross-implementation vectors for src/domain/reactionClassification (independent of the TypeScript code).

Run:  python -B scripts/generate_reaction_fixtures.py   (from fx-event-analyzer-backend/)
Needs only the Python standard library (zoneinfo needs the IANA tz database: `pip install tzdata` on Windows).
Output: tests/fixtures/reaction-analysis/cross_impl.json

The reference implementation is scripts/reaction_reference_clf2.py: an UNMODIFIED copy of the analysis reference
(fx-dev-records/2026-11-27-strategy-spec/analysis/clf2.py, parameter set rx-v1). This script only feeds it
SYNTHETIC, deterministic data (random.Random with fixed seeds; made-up prices around 150.0). No real market data,
no provider data and no API call is involved; real event series must never be added here.

The output holds
  * classify_cases : closes c_0..c_60 (null = missing bar), a sigma and the reference label / numbers per window
                     for rx-v1 and for two changed parameter sets,
  * baseline_cases : synthetic 1-minute closes around the release (only the minutes the baseline can read), and the
                     reference sigma / source / sessions for release times chosen around US / EU DST changes.
"""
import datetime as dt
import json
import pathlib
import random
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import reaction_reference_clf2 as ref  # noqa: E402

OUT = pathlib.Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "reaction-analysis" / "cross_impl.json"
P = ref.PARAMS_V1
UTC = dt.timezone.utc
WINDOWS = [1, 5, 15, 30, 60]
LON = ref.ZoneInfo("Europe/London")

PARAM_VARIANTS = {
    "rx-v1": {},
    "w0-3": {"w0": 3},
    "k24-rho05": {"k_small": 2.4, "rho": 0.5},
}


def lin(points, n=60):
    out = []
    for m in range(n + 1):
        for (a, va), (b, vb) in zip(points, points[1:]):
            if a <= m <= b:
                out.append(va + (vb - va) * (m - a) / (b - a))
                break
    return out


GOLDEN_SHAPES = [
    [(0, 0), (2, 4), (10, 12), (60, 25)],
    [(0, 0), (2, 4), (5, 10), (20, 4), (60, 12)],
    [(0, 0), (2, 4), (5, 10), (40, -3), (60, 0.5)],
    [(0, 0), (2, 4), (5, 10), (60, -5)],
    [(0, 0), (2, 4), (5, 10), (40, -4), (60, -12)],
    [(0, 0), (2, 1), (10, 2), (60, -3)],
]


def params_for(over):
    p = dict(P)
    p["baseline"] = dict(P["baseline"])
    p.update(over)
    return p


def window_record(path, sigma, n, p, time_exact=True):
    o = ref.classify(path, sigma, n, p, time_exact)
    rec = {"label": o["label"], "reason": o["reason"]}
    for k in ("z0", "M", "F", "Rmax", "Rf", "Fz", "S0", "Sn", "borderline"):
        if k in o:
            rec[k] = o[k]
    return rec


def classify_cases():
    cases = []
    rng = random.Random(20261127)

    def add(case_id, path, sigma, time_exact=True):
        entry = {"id": case_id, "closes": path, "sigma": sigma, "time_exact": time_exact, "expected": {}}
        for name, over in PARAM_VARIANTS.items():
            p = params_for(over)
            entry["expected"][name] = {str(n): window_record(path, sigma, n, p, time_exact) for n in WINDOWS}
        cases.append(entry)

    # the six golden shapes (sigma 1.0, around 100) and some derived cases
    for i, shape in enumerate(GOLDEN_SHAPES):
        add("golden-%d" % i, [100 + v for v in lin(shape)], 1.0)
        add("golden-%d-mirror" % i, [100 - v for v in lin(shape)], 1.0)
    # noisy variants of the shapes at different scales
    for i in range(60):
        shape = GOLDEN_SHAPES[i % len(GOLDEN_SHAPES)]
        scale = rng.uniform(0.3, 3.0)
        sigma = rng.uniform(0.005, 0.05)
        noise = sigma * rng.uniform(0.2, 0.9)
        base = rng.uniform(100.0, 160.0)
        path = [base + v * scale * sigma + rng.gauss(0, noise) for v in lin(shape)]
        path = [round(v, 6) for v in path]
        path[0] = round(base, 6)
        add("shape-%02d" % i, path, sigma)
    # pure random walks (mostly small initial moves)
    for i in range(40):
        sigma = rng.uniform(0.005, 0.05)
        walk = [rng.uniform(100.0, 160.0)]
        for _ in range(60):
            walk.append(walk[-1] + rng.gauss(0, sigma))
        add("walk-%02d" % i, [round(v, 6) for v in walk], sigma)
    # strong trending walks (big initial move, decide by the rest)
    for i in range(20):
        sigma = rng.uniform(0.005, 0.05)
        drift = sigma * rng.uniform(-1.5, 1.5)
        walk = [rng.uniform(100.0, 160.0)]
        for k in range(60):
            walk.append(walk[-1] + (drift * 4 if k < 2 else drift * rng.uniform(-1.0, 1.0)) + rng.gauss(0, sigma))
        add("trend-%02d" % i, [round(v, 6) for v in walk], sigma)
    # failure reasons
    base = [100 + v for v in lin(GOLDEN_SHAPES[1])]
    missing_mid = list(base)
    missing_mid[40] = None
    add("missing-bar-40", missing_mid, 1.0)
    missing_p0 = list(base)
    missing_p0[0] = None
    add("missing-p0", missing_p0, 1.0)
    add("no-bars", [None] * 61, 1.0)
    add("no-sigma", base, None)
    add("time-not-exact", base, 1.0, time_exact=False)
    flat = [100.0] * 61
    add("flat-no-initial-move", flat, 1.0)
    # exactly at / just below the k_small boundary (z0 = x[w0] / (sigma * sqrt(w0)))
    edge = [(0, 0), (2, 2.0 * 2 ** 0.5), (60, 2.0 * 2 ** 0.5)]
    add("edge-z0-2.0", [100 + v for v in lin(edge)], 1.0)
    edge = [(0, 0), (2, 1.999 * 2 ** 0.5), (60, 1.999 * 2 ** 0.5)]
    add("edge-z0-1.999", [100 + v for v in lin(edge)], 1.0)
    return cases


def ny_wall_skip(utc_dt):
    """Synthetic FX week: closed from Friday 17:00 NY to Sunday 17:00 NY (not a data feature of any real source)."""
    ny = utc_dt.astimezone(ref.NY)
    wd = ny.weekday()
    return (wd == 4 and ny.hour >= 17) or wd == 5 or (wd == 6 and ny.hour < 17)


BASELINE_SCENARIOS = [
    ("us-after-fall-back", dt.datetime(2026, 11, 6, 13, 30, tzinfo=UTC), 0.0, 0),
    ("us-2d-after-fall-back", dt.datetime(2026, 11, 3, 13, 30, tzinfo=UTC), 0.0, 0),
    ("us-after-spring-forward", dt.datetime(2026, 3, 10, 12, 30, tzinfo=UTC), 0.0, 0),
    ("us-mismatch-week-us-event", dt.datetime(2026, 3, 18, 12, 30, tzinfo=UTC), 0.0, 0),
    ("uk-0700-mismatch-week-mar", dt.datetime(2026, 3, 18, 7, 0, tzinfo=UTC), 0.0, 0),
    ("uk-0700-mismatch-week-oct", dt.datetime(2026, 10, 28, 7, 0, tzinfo=UTC), 0.0, 0),
    ("uk-0700-3w-after-changes", dt.datetime(2026, 11, 20, 7, 0, tzinfo=UTC), 0.0, 0),
    ("monday-after-spring-forward-0330", dt.datetime(2026, 3, 9, 7, 30, tzinfo=UTC), 0.0, 0),
    ("monday-after-fall-back-0130", dt.datetime(2026, 11, 2, 6, 30, tzinfo=UTC), 0.0, 0),
    ("us-mismatch-week-2027", dt.datetime(2027, 3, 16, 12, 30, tzinfo=UTC), 0.0, 0),
    ("year-boundary", dt.datetime(2027, 1, 4, 13, 30, tzinfo=UTC), 0.0, 0),
    ("with-3pct-missing-bars", dt.datetime(2026, 11, 6, 13, 30, tzinfo=UTC), 0.03, 0),
    ("with-30pct-missing-bars", dt.datetime(2026, 11, 6, 13, 30, tzinfo=UTC), 0.30, 0),
    ("typical-sessions-unavailable", dt.datetime(2026, 11, 6, 13, 30, tzinfo=UTC), 0.0, 3),
    ("own-window-unavailable", dt.datetime(2026, 11, 6, 13, 30, tzinfo=UTC), 0.0, -1),
]


def baseline_case(idx, name, t_utc, missing_rate, keep_days):
    rng = random.Random(7000 + idx)
    t_min = int(t_utc.timestamp() // 60)
    sessions = ref.ny_sessions(t_min, P)
    lookback = P["baseline"]["lookback_minutes"]
    needed = set(range(t_min - 1, t_min + 61))
    for s in sessions + [t_min]:
        needed.update(range(s - lookback - 1, s))
    # a calm market with a volatility that changes by the hour of the (NY) day, so sessions differ
    bars = {}
    px = 150.0
    for m in range(min(needed), max(needed) + 1):
        utc = dt.datetime.fromtimestamp(m * 60, UTC)
        sd = 0.004 + 0.006 * ((utc.astimezone(ref.NY).hour % 6) / 5.0)
        px += rng.gauss(0, sd)
        if m in needed and not ny_wall_skip(utc):
            bars[m] = (round(px, 6),) * 4
    # the path after the release: a jump then a pull-back, plus noise (only its closes matter)
    c0 = bars[t_min - 1][3] if (t_min - 1) in bars else round(px, 6)
    for k in range(60):
        shape = lin([(0, 0), (2, 0.09), (6, 0.15), (25, 0.06), (60, 0.10)])[k + 1]
        bars[t_min + k] = (round(c0 + shape + rng.gauss(0, 0.004), 6),) * 4
    if missing_rate > 0:
        for m in sorted(bars):
            if m < t_min - 1 and rng.random() < missing_rate:
                del bars[m]
    if keep_days > 0:  # drop everything before the last `keep_days` calendar days (typical sessions unavailable)
        cutoff = t_min - keep_days * 1440
        for m in [m for m in bars if m < cutoff and m < t_min - lookback - 1]:
            del bars[m]
    if keep_days < 0:  # drop the own pre-release window
        for m in [m for m in bars if t_min - lookback - 1 <= m < t_min - 1]:
            del bars[m]
    sg = ref.sigma(bars, t_min, P, "NY")
    used = []
    for s in sessions:
        if len(used) >= P["baseline"]["typical_max_sessions"]:
            break
        v, _ = ref._changes(bars, s, lookback, P["baseline"]["min_valid_changes"])
        if v is not None:
            used.append(s)
    lon0 = dt.datetime.fromtimestamp(t_min * 60, UTC).astimezone(LON).strftime("%H:%M")
    mismatch = sum(
        1 for s in used if dt.datetime.fromtimestamp(s * 60, UTC).astimezone(LON).strftime("%H:%M") != lon0
    )
    path = ref.path_closes(bars, t_min)
    return {
        "id": name,
        "release_utc": t_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "t_min": t_min,
        "bars": [[m, bars[m][3]] for m in sorted(bars)],
        "sessions": sessions,
        "expected_baseline": {
            "sigma": sg["sigma"],
            "own": sg["own"],
            "typical": sg["typical"],
            "source": sg["source"],
            "sessions_used": sg["sessions_used"],
            "clock_mismatch_sessions": mismatch,
        },
        "expected_windows": {str(n): window_record(path, sg["sigma"], n, P) for n in WINDOWS},
    }


def main():
    data = {
        "note": "SYNTHETIC deterministic vectors produced by scripts/generate_reaction_fixtures.py from the unmodified "
        "Python reference (scripts/reaction_reference_clf2.py, parameter set rx-v1). No real market data.",
        "param_variants": PARAM_VARIANTS,
        "classify_cases": classify_cases(),
        "baseline_cases": [baseline_case(i, *s) for i, s in enumerate(BASELINE_SCENARIOS)],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, separators=(",", ":")) + "\n", encoding="utf-8")
    labels = {}
    for c in data["classify_cases"]:
        for n, w in c["expected"]["rx-v1"].items():
            labels[w["label"]] = labels.get(w["label"], 0) + 1
    print("classify cases:", len(data["classify_cases"]), "rx-v1 label counts:", labels)
    print("baseline cases:", len(data["baseline_cases"]), "bytes:", OUT.stat().st_size)


if __name__ == "__main__":
    main()
