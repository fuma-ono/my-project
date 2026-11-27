"""Reference implementation v2 (parameter set 'rx-v1'): config-driven, NY-time baseline, strict missing-bar policy.
No magic numbers: every threshold lives in PARAMS (versioned). Analysis/validation tooling only."""
import math, statistics, datetime as dt
from zoneinfo import ZoneInfo
NY = ZoneInfo('America/New_York')
LABELS = ('CONTINUATION', 'PULLBACK', 'FULL_RETRACE', 'REVERSAL', 'UNDETERMINED')

PARAMS_V1 = dict(
    param_set_id='rx-v1', status='PROVISIONAL',
    windows=[1, 5, 15, 30, 60],
    w0=2, k_small=2.0, k_pb=2.0, r_push=0.5, r_full=0.85, rho=1.0, phi=0.25, end_median_bars=3,
    baseline=dict(kind='MAX_OWN_TYPICAL_NY', lookback_minutes=60, min_valid_changes=40,
                  typical_max_sessions=10, typical_min_sessions=5, typical_lookback_days=21),
    missing_bars_tolerated_in_window=0,
    eps=1e-9,
)


def merged(base, **over):
    p = dict(base)
    p['baseline'] = dict(base['baseline'])
    for k, v in over.items():
        if k in p['baseline']:
            p['baseline'][k] = v
        else:
            p[k] = v
    return p


def _changes(bars, t_end, L, minn):
    """close-to-close changes of the L bars ending at or before t_end (minute index)."""
    ch = []
    for k in range(t_end - L, t_end):
        if k in bars and (k - 1) in bars:
            ch.append(bars[k][3] - bars[k - 1][3])
    if len(ch) < minn:
        return None, len(ch)
    return math.sqrt(sum(c * c for c in ch) / len(ch)), len(ch)


def ny_sessions(T_min, P):
    """UTC minute indexes of the same New York wall-clock time on previous NY weekdays.
    Skips NY Sat/Sun and nonexistent/ambiguous local times (DST transition hours)."""
    b = P['baseline']
    t = dt.datetime.fromtimestamp(T_min * 60, dt.timezone.utc).astimezone(NY)
    out = []
    for d in range(1, b['typical_lookback_days'] + 1):
        day = (t - dt.timedelta(days=d)).date()
        if day.weekday() >= 5:
            continue
        naive = dt.datetime(day.year, day.month, day.day, t.hour, t.minute)
        a = naive.replace(tzinfo=NY, fold=0)
        c = naive.replace(tzinfo=NY, fold=1)
        if a.utcoffset() != c.utcoffset():
            continue  # ambiguous (fall-back hour)
        rt = a.astimezone(dt.timezone.utc).astimezone(NY).replace(tzinfo=None)
        if rt != naive:
            continue  # nonexistent (spring-forward hour)
        out.append(int(a.astimezone(dt.timezone.utc).timestamp() // 60))
    return out


def utc_sessions(T_min, P):
    b = P['baseline']
    return [T_min - 1440 * d for d in range(1, b['typical_lookback_days'] + 1) if ((T_min - 1440 * d) // 1440 + 3) % 7 < 5]


def sigma(bars, T_min, P, clock='NY'):
    """Baseline from bars that closed at or before T only (no look-ahead)."""
    b = P['baseline']
    own, _ = _changes(bars, T_min, b['lookback_minutes'], b['min_valid_changes'])
    vals = []
    sess = ny_sessions(T_min, P) if clock == 'NY' else utc_sessions(T_min, P)
    for s in sess:
        if len(vals) >= b['typical_max_sessions']:
            break
        v, _ = _changes(bars, s, b['lookback_minutes'], b['min_valid_changes'])
        if v is not None:
            vals.append(v)
    typ = math.sqrt(sum(v * v for v in vals) / len(vals)) if len(vals) >= b['typical_min_sessions'] else None
    if own is None:
        return dict(sigma=None, own=None, typical=typ, source='NONE', sessions_used=len(vals))
    if typ is None:
        return dict(sigma=own, own=own, typical=None, source='OWN_ONLY', sessions_used=len(vals))
    return dict(sigma=max(own, typ), own=own, typical=typ, source='MAX_OWN_TYPICAL', sessions_used=len(vals))


def path_closes(bars, T_min, n=60):
    """c_0..c_n with None where a bar is missing (never interpolated)."""
    p = [bars[T_min - 1][3] if (T_min - 1) in bars else None]
    for k in range(n):
        p.append(bars[T_min + k][3] if (T_min + k) in bars else None)
    return p


def classify(p, sig, n, P=PARAMS_V1, time_exact=True):
    out = dict(window=n, label='UNDETERMINED', reason=None)
    if not time_exact:
        out['reason'] = 'RELEASE_TIME_NOT_EXACT'
        return out
    if p is None or all(v is None for v in p):
        out['reason'] = 'NO_PRICE_DATA'
        return out
    seg = p[:n + 1]
    if len(seg) < n + 1 or any(v is None for v in seg):
        out['reason'] = 'MISSING_BARS'  # tolerance 0
        return out
    if sig is None or sig <= 0:
        out['reason'] = 'BASELINE_UNAVAILABLE'
        return out
    w0 = P['w0']
    e = P['eps']
    if n <= w0:
        out['reason'] = 'WINDOW_TOO_SHORT'
        return out
    c0 = seg[0]
    x = [v - c0 for v in seg]
    if abs(x[w0]) <= e * max(1.0, abs(c0)):
        out['reason'] = 'NO_INITIAL_MOVE'
        return out
    s = 1 if x[w0] > 0 else -1
    x = [s * v for v in x]
    S0 = sig * math.sqrt(w0)
    Sn = sig * math.sqrt(n)
    z0 = x[w0] / S0
    out.update(sign=s, z0=z0)
    if z0 < P['k_small'] - e:
        out['reason'] = 'SMALL_INITIAL'
        return out
    run = x[w0]
    M = x[w0]
    Rmax = 0.0
    kpk = w0
    ktr = w0
    for i in range(w0 + 1, n + 1):
        run = max(run, x[i])
        depth = run - x[i]
        dd = depth / run if depth >= P['k_pb'] * S0 - e else 0.0
        if dd > Rmax:
            Rmax = dd
            ktr = i
        if x[i] >= M:
            M = x[i]
            kpk = i
    m = min(P['end_median_bars'], n - w0 + 1)
    F = statistics.median(x[n - m + 1:n + 1])
    Rf = (M - F) / M if (M - F) >= P['k_pb'] * S0 - e else 0.0
    out.update(M=M, F=F, Rmax=Rmax, Rf=Rf, Fz=F / Sn, S0=S0, Sn=Sn, kpk=kpk, ktr=ktr)
    if F <= -max(P['rho'] * Sn, P['phi'] * M) + e:
        lab = 'REVERSAL'
    elif Rf >= P['r_full'] - e:
        lab = 'FULL_RETRACE'
    elif Rmax >= P['r_push'] - e:
        lab = 'PULLBACK'
    else:
        lab = 'CONTINUATION'
    out['label'] = lab
    thr = dict(k_small=(z0, P['k_small']), r_push=(Rmax, P['r_push']), r_full=(Rf, P['r_full']),
               rho=(-F, max(P['rho'] * Sn, P['phi'] * M)))
    out['borderline'] = any(abs(v / t - 1) <= 0.10 for v, t in thr.values() if t > 0 and v > 0)
    return out


def confounders(T_min, n, pair_ccys, items):
    """items: dicts(kind 'EVENT'|'SPEECH', t_min, ccy, importance, id). Items with importance >= MEDIUM,
    currency in the pair, time in (T, T+n]. Items at exactly T (same group) are excluded."""
    out = []
    for it in items:
        if it['importance'] not in ('MEDIUM', 'HIGH'):
            continue
        if it['ccy'] not in pair_ccys:
            continue
        if not (T_min < it['t_min'] <= T_min + n):
            continue
        out.append(it)
    return out
