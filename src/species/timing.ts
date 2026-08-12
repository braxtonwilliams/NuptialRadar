/**
 * Shared rain / season / hour timing layer + species multipliers for display scores.
 *
 * Forest / “All species” leaves RF (or hybrid) untouched so scores match nuptialflight.
 * Genus selection applies season ramps (peak / shoulder / off-season) plus hour & rain.
 */
import type { HourlyWeather, WeatherData } from '../types';
import {
  getSpeciesById,
  listSpecies,
  seasonFactor,
  type RainLagHours,
  type SpeciesProfile,
} from './catalog';
import { getSelectedSpeciesId } from './selection';
import type { LocationPlace } from './range';

/** Below this, genus is treated as out of season (near-zero score). */
export const SEASON_OUT_FLOOR = 0.05;
/** Tip rankings omit genera below this season activity. */
export const SEASON_TIP_FLOOR = 0.08;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function clampProb(p: number): number {
  return Math.max(0.01, Math.min(0.99, p));
}

function trapezoid(x: number, a: number, b: number, c: number, d: number): number {
  if (x <= a || x >= d) return 0;
  if (x >= b && x <= c) return 1;
  if (x < b) return (x - a) / (b - a);
  return (d - x) / (d - c);
}

function localParts(dt: number, tzOffsetSeconds: number): { monthIndex: number; localHour: number; date: Date } {
  const date = new Date((dt + tzOffsetSeconds) * 1000);
  return {
    monthIndex: date.getUTCMonth(),
    localHour: date.getUTCHours(),
    date,
  };
}

function hourWasWet(h: HourlyWeather): boolean {
  // Prefer measured rain; high pop alone is not treated as already-wet
  if ((h.rain ?? 0) >= 0.2) return true;
  return h.pop >= 0.75 && (h.rain ?? 0) > 0;
}

/**
 * Hours since the last wet hour at or before hourlyIndex.
 * Returns null when no prior rain is found in the series.
 */
export function hoursSinceRain(weather: WeatherData, hourlyIndex: number): number | null {
  const { hourly } = weather;
  if (hourlyIndex < 0 || hourlyIndex >= hourly.length) return null;

  for (let i = hourlyIndex; i >= 0; i--) {
    if (hourWasWet(hourly[i])) {
      return Math.max(0, Math.round((hourly[hourlyIndex].dt - hourly[i].dt) / 3600));
    }
  }
  return null;
}

/** Generic phenology gate (northern peak mid-year; southern shifted 6 months). */
export function genericMonthWeight(lat: number, monthIndex: number): number {
  const shifted = lat >= 0 ? monthIndex : (monthIndex + 6) % 12;
  const table = [0.25, 0.3, 0.45, 0.65, 0.85, 1, 1, 0.9, 0.65, 0.4, 0.28, 0.22];
  return table[shifted] ?? 0.5;
}

/** Broad diurnal windows for explanations (not applied to RF % when All species). */
export function genericHourWeight(localHour: number): number {
  if ((localHour >= 10 && localHour <= 14) || (localHour >= 16 && localHour <= 21)) return 1;
  if (localHour >= 8 && localHour <= 22) return 0.55;
  return 0.25;
}

const GENERIC_RAIN_LAG: RainLagHours = { softMin: 4, optimal: 24, softMax: 72 };

export function rainLagFactor(hours: number | null, lag: RainLagHours): number {
  // No rain in the loaded horizon — neutral (do not depress vs nuptialflight RF)
  if (hours == null) return 1;
  // Active rain hour — soft penalty only
  if (hours === 0) return 0.35;
  return clamp01(0.35 + 0.65 * trapezoid(hours, 0, lag.softMin, lag.optimal, lag.softMax + 24));
}

function speciesHourWeight(profile: SpeciesProfile, localHour: number): number {
  return profile.hourWeights[localHour] ?? 0.2;
}

export interface TimingContext {
  lat: number;
  dt: number;
  tzOffsetSeconds: number;
  hoursSinceRain: number | null;
  species: SpeciesProfile | null;
  /** Daily scores use peak hour of day rather than a specific hour. */
  mode: 'hourly' | 'daily';
}

export function buildHourlyTimingContext(
  weather: WeatherData,
  hourlyIndex: number,
  speciesId: string | null = getSelectedSpeciesId(),
): TimingContext {
  const h = weather.hourly[hourlyIndex];
  return {
    lat: weather.lat,
    dt: h.dt,
    tzOffsetSeconds: weather.timezoneOffset,
    hoursSinceRain: hoursSinceRain(weather, hourlyIndex),
    species: getSpeciesById(speciesId),
    mode: 'hourly',
  };
}

export function buildDailyTimingContext(
  weather: WeatherData,
  dailyIndex: number,
  speciesId: string | null = getSelectedSpeciesId(),
): TimingContext {
  const day = weather.daily[dailyIndex];
  const noon = day.dt;
  let bestIdx = -1;
  let bestDist = Infinity;
  weather.hourly.forEach((h, i) => {
    const dist = Math.abs(h.dt - noon);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  });
  return {
    lat: weather.lat,
    dt: day.dt,
    tzOffsetSeconds: weather.timezoneOffset,
    hoursSinceRain: bestIdx >= 0 ? hoursSinceRain(weather, bestIdx) : null,
    species: getSpeciesById(speciesId),
    mode: 'daily',
  };
}

/**
 * Apply genus timing to a base RF/hybrid probability.
 * “All species” (no genus) is identity — matches nuptialflight display %.
 * With a genus: strong season ramp (can near-zero off-season) + soft hour/rain.
 */
export function applyTimingAndSpecies(baseProb: number, ctx: TimingContext): number {
  if (baseProb <= 0.02) return clampProb(baseProb);

  const species = ctx.species;
  // Parity path: no genus selected → raw algorithm score
  if (!species) return clampProb(baseProb);

  const { localHour, date } = localParts(ctx.dt, ctx.tzOffsetSeconds);
  const season = seasonFactor(species, ctx.lat, date);

  // Hard off-season: no meaningful flights for this genus
  if (season < SEASON_OUT_FLOOR) return 0.01;

  const lag = species.rainLagHours;
  const rainFactor = rainLagFactor(ctx.hoursSinceRain, lag);
  const hourFactor =
    ctx.mode === 'daily'
      ? Math.max(...species.hourWeights, 0.5)
      : Math.max(0.2, speciesHourWeight(species, localHour));

  // Season can go near zero; peak ≈ RF. Hour/rain remain soft.
  const seasonBlend = 0.05 + 0.95 * season;
  const rainBlend = 0.72 + 0.28 * rainFactor;
  const hourBlend = 0.72 + 0.28 * hourFactor;

  return clampProb(baseProb * seasonBlend * rainBlend * hourBlend);
}

export interface FlightWindowReason {
  inSeason: boolean;
  hourOk: boolean;
  rainNote: string;
}

export function explainWindow(ctx: TimingContext): FlightWindowReason {
  const { localHour, date } = localParts(ctx.dt, ctx.tzOffsetSeconds);
  const species = ctx.species;
  const seasonW = species
    ? seasonFactor(species, ctx.lat, date)
    : genericMonthWeight(ctx.lat, date.getUTCMonth());
  const hourW = species ? speciesHourWeight(species, localHour) : genericHourWeight(localHour);
  const lag = species?.rainLagHours ?? GENERIC_RAIN_LAG;
  const hrs = ctx.hoursSinceRain;
  let rainNote = 'no recent rain in forecast';
  if (hrs === 0) rainNote = 'raining / wet hour';
  else if (hrs != null && hrs <= lag.softMax) rainNote = `~${hrs}h after rain`;
  else if (hrs != null) rainNote = `${hrs}h since rain`;

  return {
    inSeason: seasonW >= 0.55,
    hourOk: hourW >= 0.55,
    rainNote,
  };
}

export interface BestFlightWindow {
  hourlyIndex: number;
  dt: number;
  percentage: number;
  dayLabel: string;
  timeLabel: string;
  reason: string;
}

function formatDayLabel(dt: number, tzOffset: number): string {
  const d = new Date((dt + tzOffset) * 1000);
  const today = new Date((Math.floor(Date.now() / 1000) + tzOffset) * 1000);
  const sameDay =
    d.getUTCFullYear() === today.getUTCFullYear() &&
    d.getUTCMonth() === today.getUTCMonth() &&
    d.getUTCDate() === today.getUTCDate();
  if (sameDay) return 'Today';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function formatTimeLabel(dt: number, tzOffset: number): string {
  const d = new Date((dt + tzOffset) * 1000);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' });
}

/** Top hourly slots by adjusted percentage for the species outlook panel. */
export function bestFlightWindows(
  weather: WeatherData,
  hourlyScores: number[],
  limit = 5,
): BestFlightWindow[] {
  const scored = weather.hourly.map((h, i) => {
    const ctx = buildHourlyTimingContext(weather, i);
    const exp = explainWindow(ctx);
    const parts = [
      exp.inSeason ? 'in season' : 'off-peak season',
      exp.hourOk ? 'good hour' : 'off-peak hour',
      exp.rainNote,
    ];
    return {
      hourlyIndex: i,
      dt: h.dt,
      percentage: hourlyScores[i] ?? 0,
      dayLabel: formatDayLabel(h.dt, weather.timezoneOffset),
      timeLabel: formatTimeLabel(h.dt, weather.timezoneOffset),
      reason: parts.join(' · '),
    };
  });

  return scored
    .filter((w) => w.percentage >= 45)
    .sort((a, b) => b.percentage - a.percentage || a.dt - b.dt)
    .slice(0, limit);
}

export interface SpeciesOutlookBadge {
  id: string;
  peakPct: number;
  hasGreen: boolean;
}

export interface SpeciesHourRank {
  id: string;
  genus: string;
  commonName: string;
  percentage: number;
  seasonFactor: number;
}

/**
 * Rank location-present genera for a single hourly slot (base RF + genus timing).
 * Omits out-of-season genera. Independent of the currently selected species filter.
 */
export function rankSpeciesForHourlySlot(
  weather: WeatherData,
  baseHourlyProb: number,
  hourlyIndex: number,
  limit = 5,
  place?: LocationPlace | null,
): SpeciesHourRank[] {
  const h = weather.hourly[hourlyIndex];
  if (!h) return [];
  const localDate = new Date((h.dt + weather.timezoneOffset) * 1000);

  return listSpecies(place ?? weather.place)
    .map((species) => {
      const season = seasonFactor(species, weather.lat, localDate);
      const adjusted = applyTimingAndSpecies(
        baseHourlyProb,
        buildHourlyTimingContext(weather, hourlyIndex, species.id),
      );
      return {
        id: species.id,
        genus: species.genus,
        commonName: species.commonName,
        percentage: Math.trunc(adjusted * 100),
        seasonFactor: season,
      };
    })
    .filter((r) => r.seasonFactor >= SEASON_TIP_FLOOR)
    .sort((a, b) => b.percentage - a.percentage || a.genus.localeCompare(b.genus))
    .slice(0, limit);
}

/**
 * Rank genera present at the forecast place against RF base hourly probs.
 * Peak and green use species-specific season/hour/rain timing.
 */
export function rankSpeciesOutlook(
  weather: WeatherData,
  baseHourlyProbs: number[],
  greenThreshold: number,
  place?: LocationPlace | null,
): { byId: Map<string, SpeciesOutlookBadge>; topId: string | null } {
  const byId = new Map<string, SpeciesOutlookBadge>();
  let topId: string | null = null;
  let topPeak = -1;

  for (const species of listSpecies(place ?? weather.place)) {
    let peak = 0;
    let hasGreen = false;
    for (let i = 0; i < weather.hourly.length; i++) {
      const base = baseHourlyProbs[i] ?? 0.01;
      const adjusted = applyTimingAndSpecies(
        base,
        buildHourlyTimingContext(weather, i, species.id),
      );
      const pct = Math.trunc(adjusted * 100);
      if (pct > peak) peak = pct;
      if (pct >= greenThreshold) hasGreen = true;
    }
    byId.set(species.id, { id: species.id, peakPct: peak, hasGreen });
    if (peak > topPeak) {
      topPeak = peak;
      topId = species.id;
    }
  }

  return { byId, topId };
}
