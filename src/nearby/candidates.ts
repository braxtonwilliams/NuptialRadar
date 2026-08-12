/**
 * Discover named places near the origin for nearby-town comparison.
 * Uses BigDataCloud reverse geocode at ring sample points (Open-Meteo has no reverse API).
 */
import { reverseGeocodeCoords } from '../geo/reverse-geocode';
import { destinationPoint, haversineMiles } from '../geo/distance';

export const NEARBY_MAX_MILES = 25;
export const NEARBY_MIN_MILES = 2.5;
export const NEARBY_MAX_TOWNS = 6;

export interface NearbyCandidate {
  name: string;
  lat: number;
  lon: number;
  miles: number;
  admin1: string | null;
  usState: string;
}

/** Compare locality labels ("Sallisaw, OK" vs "Sallisaw"). */
export function normalizePlaceName(name: string): string {
  return name
    .split(',')[0]!
    .trim()
    .toLowerCase()
    .replace(/^(city of|town of|village of)\s+/i, '')
    .replace(/\s+/g, ' ');
}

export function isSamePlaceName(a: string, b: string): boolean {
  const na = normalizePlaceName(a);
  const nb = normalizePlaceName(b);
  return na.length > 0 && na === nb;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R | null>,
): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  async function worker(): Promise<void> {
    while (i < items.length) {
      const idx = i++;
      try {
        const v = await fn(items[idx]!);
        if (v) out.push(v);
      } catch {
        /* skip */
      }
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

/**
 * Find up to NEARBY_MAX_TOWNS unique US places within 25 miles.
 * When `usState` is set, prefer same-state hits; otherwise any US town in range.
 * `excludeNames` drops the home locality so it is not listed twice.
 */
export async function findNearbyTowns(
  originLat: number,
  originLon: number,
  usState: string | null,
  excludeNames: string[] = [],
): Promise<NearbyCandidate[]> {
  // Ring samples only — origin reverse-geocode is almost always the home city itself
  const samplePoints: Array<{ lat: number; lon: number }> = [];

  for (const miles of [8, 14, 22]) {
    for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315]) {
      samplePoints.push(destinationPoint(originLat, originLon, bearing, miles));
    }
  }

  const hits = await mapPool(samplePoints, 4, async (p) => {
    const hit = await reverseGeocodeCoords(p.lat, p.lon);
    if (!hit?.localityName) return null;
    if (hit.place.countryCode !== 'US') return null;

    // Skip home city (BigDataCloud often returns the same locality for nearby ring points)
    if (excludeNames.some((n) => isSamePlaceName(n, hit.localityName!))) return null;

    const state = hit.place.usState;
    if (usState && state && state !== usState) return null;
    if (usState && !state) return null;

    const miles = haversineMiles(originLat, originLon, hit.place.lat, hit.place.lon);
    if (miles < NEARBY_MIN_MILES || miles > NEARBY_MAX_MILES) return null;

    return {
      name: hit.localityName,
      lat: hit.place.lat,
      lon: hit.place.lon,
      miles,
      admin1: hit.place.admin1,
      usState: state ?? usState ?? 'US',
    } satisfies NearbyCandidate;
  });

  const byKey = new Map<string, NearbyCandidate>();
  for (const c of hits) {
    if (excludeNames.some((n) => isSamePlaceName(n, c.name))) continue;
    const key = `${normalizePlaceName(c.name)}|${c.usState}`;
    const prev = byKey.get(key);
    if (!prev || c.miles < prev.miles) byKey.set(key, c);
  }

  return [...byKey.values()]
    .sort((a, b) => a.miles - b.miles || a.name.localeCompare(b.name))
    .slice(0, NEARBY_MAX_TOWNS);
}
