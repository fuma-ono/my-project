/**
 * Number handling shared by adapters and validators: parsing provider
 * strings like "3.7%", "254K", "-0.1", and rounding that matches how
 * statistical agencies publish (round half away from zero at a fixed
 * number of decimals), done on decimal strings so 0.15 → 0.2 is not lost
 * to binary floating point.
 */
import type { MappedUnit, ProviderValue } from './types.js';

/**
 * Parses a provider value string. Accepts an optional magnitude/unit
 * suffix ("%", "K", "M", "B", "T"). Empty / "-" / "N/A" → null. Anything
 * else unparseable → undefined (the caller treats it as an error, not as
 * "no value").
 */
export function parseProviderValue(raw: unknown, unitHint: string | null = null): ProviderValue | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? { value: raw, unit: unitHint } : undefined;
  if (typeof raw !== 'string') return undefined;
  const text = raw.trim().replace(/,/g, '');
  if (text === '' || text === '-' || /^n\/?a$/i.test(text)) return null;
  const match = /^([+-]?\d+(?:\.\d+)?)\s*(%|[KMBT])?$/i.exec(text);
  if (!match) return undefined;
  const suffix = match[2] ? match[2].toUpperCase() : null;
  return { value: Number(match[1]), unit: suffix ?? unitHint };
}

const MAGNITUDE: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

/**
 * Converts a provider value to the mapping's unit. Returns null when the
 * provider's unit cannot be the mapped unit (UNIT_MISMATCH) — e.g. a "%"
 * value for an indicator stored in thousands. A missing provider unit is
 * accepted only when the mapping explicitly allows it.
 */
export function toMappedUnit(value: ProviderValue, unit: MappedUnit, allowMissingUnit: boolean): number | null {
  const providerUnit = value.unit?.trim().toUpperCase() ?? '';
  if (unit === 'PERCENT') {
    if (providerUnit === '%' || (providerUnit === '' && allowMissingUnit)) return value.value;
    return null;
  }
  // THOUSANDS
  if (providerUnit === '' && allowMissingUnit) return value.value;
  const factor = MAGNITUDE[providerUnit];
  if (factor === undefined) return null;
  return roundTo((value.value * factor) / 1e3, 6);
}

/** Display unit stored in event_snapshots.unit (matches economic_indicators.unit in seed: '%', 'K'). */
export function displayUnit(unit: MappedUnit): string {
  return unit === 'PERCENT' ? '%' : 'K';
}

/** Round half away from zero to `decimals`, computed on the decimal string. */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value;
  const sign = value < 0 ? -1 : 1;
  const [intPart, fracPart = ''] = Math.abs(value)
    .toFixed(Math.min(decimals + 6, 20))
    .split('.');
  const kept = fracPart.slice(0, decimals);
  const next = Number(fracPart.charAt(decimals) || '0');
  let scaled = BigInt(`${intPart}${kept}`);
  if (next >= 5) scaled += 1n;
  const text = scaled.toString().padStart(decimals + 1, '0');
  const result = decimals === 0 ? Number(text) : Number(`${text.slice(0, -decimals)}.${text.slice(-decimals)}`);
  return sign * result === 0 ? 0 : sign * result;
}

/** Number of decimals a value was published with ("3.70" → 2, "254" → 0). */
export function decimalsOf(raw: number): number {
  const text = String(raw);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}
