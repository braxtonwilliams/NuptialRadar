/**
 * Nearby town flight-chance scan (US, <25 miles).
 * Cached for ~18 hours; refreshed on open when stale.
 *
 * Isolation: only reads the home forecast snapshot for homePeak comparison.
 * Does not mutate global weather, species selection, or main radar scores.
 * Loading a town’s forecast happens only when the user clicks a town in the UI.
 */
import type { WeatherData, WeatherPlace } from '../types';
import { fetchWeatherLite } from '../weather';
import { scoreHourlyForWeather } from '../algorithms/scoring';
import { getActiveAlgorithm } from '../algorithms/registry';
import { formatTimeLabel } from '../forecast-views';
import { getSelectedSpeciesId } from '../species/selection';
import { findNearbyTowns, isSamePlaceName, NEARBY_MAX_MILES } from './candidates';
import { localDayKey, readNearbyCache, writeNearbyCache } from './cache';

export interface NearbyTownScore {
  name: string;
  lat: number;
  lon: number;
  miles: number;
  peakPct: number;
  bestTimeLabel: string;
  deltaVsHome: number;
}

export interface NearbyScanResult {
  dayKey: string;
  originLat: number;
  originLon: number;
  /** Display name of the fixed home / starting location. */
  homeName?: string;
  usState: string;
  /** Algorithm + species at scan time (cache key). */
  algorithmId: string;
  speciesId: string | null;
  homePeak: number;
  towns: NearbyTownScore[];
  scannedAt: string;
}

function peakFromScores(
  weather: WeatherData,
  scores: number[],
): { peakPct: number; bestTimeLabel: string } {
  let peakPct = 0;
  let bestIdx = 0;
  scores.forEach((pct, i) => {
    if (pct > peakPct) {
      peakPct = pct;
      bestIdx = i;
    }
  });
  const h = weather.hourly[bestIdx];
  return {
    peakPct,
    bestTimeLabel: h ? formatTimeLabel(h.dt, weather.timezoneOffset) : '—',
  };
}

function townPlace(base: WeatherPlace, lat: number, lon: number, admin1: string | null): WeatherPlace {
  return {
    countryCode: base.countryCode,
    country: base.country,
    usState: base.usState,
    lat,
    lon,
    admin1: admin1 ?? base.admin1,
  };
}

/** True when this forecast location can run a nearby US town scan. */
export function canScanNearby(home: WeatherData): boolean {
  const cc = home.place.countryCode?.toUpperCase() ?? null;
  if (cc === 'US') return true;
  if (!cc && home.lat >= 24 && home.lat <= 50 && home.lon >= -125 && home.lon <= -66) return true;
  return false;
}

/** Remove the home city if it was incorrectly included as a nearby town. */
export function scrubHomeFromTowns(
  homeName: string,
  result: NearbyScanResult,
): NearbyScanResult {
  const towns = result.towns.filter((t) => !isSamePlaceName(t.name, homeName));
  if (towns.length === result.towns.length && result.homeName) return result;
  const cleaned = { ...result, homeName: result.homeName ?? homeName, towns };
  if (towns.length !== result.towns.length) writeNearbyCache(cleaned);
  return cleaned;
}

/**
 * Run or restore a fresh nearby scan for the current forecast location.
 * Returns null when not applicable (non-US).
 * Uses cache when scanned within NEARBY_CACHE_TTL_MS (~18h).
 */
export async function runNearbyScan(
  home: WeatherData,
  homeHourlyScores: number[],
): Promise<NearbyScanResult | null> {
  if (!canScanNearby(home)) return null;

  // Snapshot only — never write back into `home` / global weather
  const originLat = home.lat;
  const originLon = home.lon;
  const usState = home.place.usState;
  const homePlace: WeatherPlace = { ...home.place };
  const dayKey = localDayKey(home.timezoneOffset);
  const algorithmId = getActiveAlgorithm().id;
  const speciesId = getSelectedSpeciesId();
  const homePeak = homeHourlyScores.length > 0 ? Math.max(0, ...homeHourlyScores) : 0;

  const cached = readNearbyCache(originLat, originLon, usState, algorithmId, speciesId);
  if (cached) return scrubHomeFromTowns(home.locationName, cached);

  let towns: NearbyTownScore[] = [];
  try {
    const candidates = await findNearbyTowns(originLat, originLon, usState, [
      home.locationName,
    ]);

    for (const c of candidates) {
      try {
        // Lite fetch is independent of the on-screen forecast location
        const townWeather = await fetchWeatherLite(c.lat, c.lon, {
          locationName: `${c.name}, ${c.usState}`,
          place: townPlace(homePlace, c.lat, c.lon, c.admin1),
        });
        const scores = scoreHourlyForWeather(townWeather);
        const { peakPct, bestTimeLabel } = peakFromScores(townWeather, scores);
        towns.push({
          name: c.name,
          lat: c.lat,
          lon: c.lon,
          miles: Math.round(c.miles * 10) / 10,
          peakPct,
          bestTimeLabel,
          deltaVsHome: peakPct - homePeak,
        });
      } catch (err) {
        console.warn('Nearby town forecast skipped:', c.name, err);
      }
    }

    towns.sort((a, b) => b.peakPct - a.peakPct || a.miles - b.miles);
  } catch (err) {
    console.warn('Nearby town discovery failed:', err);
    towns = [];
  }

  const result: NearbyScanResult = {
    dayKey,
    originLat,
    originLon,
    homeName: home.locationName,
    usState: usState ?? 'US',
    algorithmId,
    speciesId,
    homePeak,
    towns,
    scannedAt: new Date().toISOString(),
  };
  writeNearbyCache(result);
  return result;
}

export { NEARBY_MAX_MILES };
export { NEARBY_CACHE_TTL_MS } from './cache';
