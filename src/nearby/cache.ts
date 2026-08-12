import { haversineMiles } from '../geo/distance';
import type { NearbyScanResult } from './scan';

const CACHE_KEY = 'nuptial-radar-nearby-scan';
const ORIGIN_TOLERANCE_MI = 3;

/** Refresh nearby comparison when older than this (18h within the 12–24h window). */
export const NEARBY_CACHE_TTL_MS = 18 * 60 * 60 * 1000;

export function localDayKey(tzOffsetSeconds: number): string {
  const local = new Date((Math.floor(Date.now() / 1000) + tzOffsetSeconds) * 1000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, '0');
  const d = String(local.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isNearbyCacheFresh(scannedAt: string, nowMs = Date.now()): boolean {
  const t = Date.parse(scannedAt);
  if (!Number.isFinite(t)) return false;
  return nowMs - t < NEARBY_CACHE_TTL_MS;
}

export function readNearbyCache(
  originLat: number,
  originLon: number,
  usState: string | null,
  algorithmId: string,
  speciesId: string | null,
): NearbyScanResult | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NearbyScanResult;
    if (!isNearbyCacheFresh(parsed.scannedAt)) return null;
    if ((parsed.usState ?? null) !== (usState ?? null)) return null;
    if (parsed.algorithmId !== algorithmId) return null;
    if ((parsed.speciesId ?? null) !== (speciesId ?? null)) return null;
    if (haversineMiles(originLat, originLon, parsed.originLat, parsed.originLon) > ORIGIN_TOLERANCE_MI) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeNearbyCache(result: NearbyScanResult): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(result));
  } catch {
    /* ignore quota */
  }
}
