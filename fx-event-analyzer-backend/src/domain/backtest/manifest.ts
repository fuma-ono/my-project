import { createHash } from 'node:crypto';
import { toEpochMs, type Bar } from '../technical/index.js';
import type { EventFeature } from './types.js';

/** SHA-256 over a canonical text form of the bars (t as epoch ms, o,h,l,c,v). Same data => same hash. */
export function fingerprintBars(bars: readonly Bar[]): string {
  const h = createHash('sha256');
  for (const b of bars) h.update(`${toEpochMs(b.t)},${b.o},${b.h},${b.l},${b.c},${b.v ?? ''}\n`);
  return h.digest('hex');
}

export function fingerprintEvents(events: readonly EventFeature[]): string {
  const h = createHash('sha256');
  for (const e of events) {
    const keys = Object.keys(e).sort();
    h.update(JSON.stringify(keys.map((k) => [k, e[k]])) + '\n');
  }
  return h.digest('hex');
}

/** Deterministic PRNG (mulberry32). Returns floats in [0,1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
