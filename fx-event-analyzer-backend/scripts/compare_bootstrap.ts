/**
 * Synthetic comparison of iid vs block bootstrap CIs for autocorrelated PnL.
 * Run: npx tsx scripts/compare_bootstrap.ts   (synthetic data only; no market data, no I/O)
 */
import {
  bootstrapExpectancy,
  bootstrapStationary,
  conservativeInterval,
  selectBlockLength,
} from '../src/domain/backtest/index.js';

function ar1(n: number, rho: number, seed: number): number[] {
  let s = seed;
  const rnd = (): number => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const out: number[] = [];
  let x = 0;
  for (let i = 0; i < n; i++) {
    x = rho * x + (rnd() - 0.5) * 2;
    out.push(x);
  }
  return out;
}

const fmt = (x: number): string => x.toFixed(3);
const n = 60;
const reps = 300;
const B = 500;
console.log(`True mean is exactly 0; n=${n} trades, ${reps} replications, ${B} resamples, 95% intervals.`);
for (const rho of [0, 0.3, 0.6, 0.8]) {
  let covIid = 0;
  let covBlock = 0;
  let covCons = 0;
  let wIid = 0;
  let wBlock = 0;
  let bSum = 0;
  for (let r = 0; r < reps; r++) {
    const x = ar1(n, rho, 1000 + r * 7919);
    const iid = bootstrapExpectancy(x, { seed: r + 1, resamples: B })!;
    const b = selectBlockLength(x);
    const blk = bootstrapStationary(x, { seed: r + 100003, resamples: B, blockLength: b })!;
    const cons = conservativeInterval([iid, blk])!;
    covIid += iid.lower <= 0 && 0 <= iid.upper ? 1 : 0;
    covBlock += blk.lower <= 0 && 0 <= blk.upper ? 1 : 0;
    covCons += cons.lower <= 0 && 0 <= cons.upper ? 1 : 0;
    wIid += iid.upper - iid.lower;
    wBlock += blk.upper - blk.lower;
    bSum += b;
  }
  console.log(
    `rho=${rho}: coverage iid=${fmt(covIid / reps)} stationary=${fmt(covBlock / reps)} conservative=${fmt(covCons / reps)}` +
      ` | mean width iid=${fmt(wIid / reps)} stationary=${fmt(wBlock / reps)} | mean block length=${fmt(bSum / reps)}`,
  );
}

const x = ar1(n, 0.6, 424242);
const iid = bootstrapExpectancy(x, { seed: 1, resamples: 2000 })!;
const b = selectBlockLength(x);
const blk = bootstrapStationary(x, { seed: 2, resamples: 2000, blockLength: b })!;
const cons = conservativeInterval([iid, blk])!;
console.log(`Single example (rho=0.6, n=${n}, block length chosen=${b}, sample mean=${fmt(iid.meanPips)}):`);
for (const r of [iid, blk, cons]) {
  console.log(
    `  ${r.method.padEnd(12)} CI [${fmt(r.lower)}, ${fmt(r.upper)}] width ${fmt(r.upper - r.lower)} p=${fmt(r.pValue)}`,
  );
}
