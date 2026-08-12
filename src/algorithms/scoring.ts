/**
 * Routes all flight scoring through Forest v1 (production),
 * then optional genus timing. All species = raw RF (nuptialflight parity).
 */
import { getSightingsForCalibration } from '../db/sightings';
import { percentageToInt } from '../nuptials';
import type { DailyWeather, HourlyWeather, WeatherData } from '../types';
import {
  applyTimingAndSpecies,
  buildDailyTimingContext,
  buildHourlyTimingContext,
} from '../species/timing';
import { getSelectedSpecies } from '../species/selection';
import {
  buildBiologyInsights,
  dailyRfConfidence,
  hourlyRfConfidence,
  type BiologyInsights,
} from './biology-insights';
import {
  applyLocalCalibration,
  calibrationContextFromDaily,
  calibrationContextFromHourly,
  computeLocalBoost,
} from './local-calibration';
import { forestV1Algorithm } from './nuptials-forest-v1';
import { getActiveAlgorithm } from './registry';
import {
  computeBiologyV3DerivedFeatures,
  formatLocalHourWindow,
  formatRainStatus,
} from './biology-v3-features';

export type { BiologyInsights, ExpectedActivity } from './biology-insights';
export { biologyInsightsFlightText } from './biology-insights';
export type { BiologyV3DerivedFeatures } from './biology-v3-features';

function localDateKey(dt: number, tzOffset: number): string {
  const d = new Date((dt + tzOffset) * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dailyIndexForHourly(weather: WeatherData, hourly: HourlyWeather): number {
  const key = localDateKey(hourly.dt, weather.timezoneOffset);
  const idx = weather.daily.findIndex((d) => localDateKey(d.dt, weather.timezoneOffset) === key);
  return idx >= 0 ? idx : 0;
}

/** Reserved for non-Forest algorithms; Forest v1 skips local calibration. */
function usesLocalCalibration(): boolean {
  return getActiveAlgorithm().id !== forestV1Algorithm.id;
}

function finalizeHourly(
  baseProb: number,
  lat: number,
  lon: number,
  hourly: HourlyWeather,
  tzOffsetSeconds: number,
): number {
  if (!usesLocalCalibration()) return baseProb;
  const sightings = getSightingsForCalibration();
  const ctx = calibrationContextFromHourly(
    hourly.temp,
    hourly.humidity,
    hourly.windSpeed,
    hourly.pop,
    hourly.dt,
    tzOffsetSeconds,
  );
  const { boost, matchCount } = computeLocalBoost(lat, lon, ctx, sightings);
  return applyLocalCalibration(baseProb, boost, matchCount);
}

function finalizeDaily(
  baseProb: number,
  lat: number,
  lon: number,
  daily: DailyWeather,
  tzOffsetSeconds: number,
): number {
  if (!usesLocalCalibration()) return baseProb;
  const sightings = getSightingsForCalibration();
  const ctx = calibrationContextFromDaily(daily, tzOffsetSeconds);
  const { boost, matchCount } = computeLocalBoost(lat, lon, ctx, sightings);
  return applyLocalCalibration(baseProb, boost, matchCount);
}

function applyStandaloneTiming(
  base: number,
  lat: number,
  dt: number,
  tzOffsetSeconds: number,
  mode: 'hourly' | 'daily',
): number {
  return applyTimingAndSpecies(base, {
    lat,
    dt,
    tzOffsetSeconds,
    hoursSinceRain: null,
    species: getSelectedSpecies(),
    mode,
  });
}

export function getGreenThreshold(): number {
  return getActiveAlgorithm().greenThreshold;
}

export function getAmberThreshold(): number {
  return getActiveAlgorithm().amberThreshold;
}

export function getScoreColor(pct: number): string {
  const amber = getAmberThreshold();
  const green = getGreenThreshold();
  if (pct < amber) return '#b71c1c';
  if (pct < green) return '#e65100';
  return '#2e7d32';
}

export function getScoreBgColor(pct: number): string {
  const amber = getAmberThreshold();
  const green = getGreenThreshold();
  if (pct < amber) return 'rgba(183, 28, 28, 0.12)';
  if (pct < green) return 'rgba(230, 81, 0, 0.12)';
  return 'rgba(46, 125, 50, 0.12)';
}

export function getHourlyBiologyInsights(
  weather: WeatherData,
  hourlyIndex: number,
  displayPct: number,
): BiologyInsights {
  const hourly = weather.hourly[hourlyIndex];
  const rf = hourlyRfConfidence(weather.lat, weather.lon, hourly);
  return buildBiologyInsights(displayPct, rf.confidence, rf.stdDev);
}

export function getDailyBiologyInsights(
  weather: WeatherData,
  dailyIndex: number,
  displayPct: number,
): BiologyInsights {
  const daily = weather.daily[dailyIndex];
  const rf = dailyRfConfidence(
    weather.lat,
    weather.lon,
    daily,
    dailyIndex + 1 < weather.daily.length ? weather.daily[dailyIndex + 1].pop : undefined,
    dailyIndex + 2 < weather.daily.length ? weather.daily[dailyIndex + 2].pop : undefined,
  );
  return buildBiologyInsights(displayPct, rf.confidence, rf.stdDev);
}

export interface BiologyInsightsContext {
  rainStatus: string;
  timeWindow: string;
  derivedFeatures: ReturnType<typeof computeBiologyV3DerivedFeatures>;
}

export function getBiologyInsightsContext(
  weather: WeatherData,
  hourlyIndex: number,
): BiologyInsightsContext {
  const dailyIndex = dailyIndexForHourly(weather, weather.hourly[hourlyIndex]);
  return {
    rainStatus: formatRainStatus(weather.hourly, hourlyIndex),
    timeWindow: formatLocalHourWindow(weather.hourly[hourlyIndex].dt, weather.timezoneOffset),
    derivedFeatures: computeBiologyV3DerivedFeatures(weather, hourlyIndex, dailyIndex),
  };
}

export function scoreHourlyProbability(
  lat: number,
  lon: number,
  hourly: HourlyWeather,
  tzOffsetSeconds = 0,
  weather?: WeatherData,
  hourlyIndex?: number,
): number {
  const algo = getActiveAlgorithm();
  let base = algo.nuptialHourlyPercentage(lat, lon, hourly);
  base = finalizeHourly(base, lat, lon, hourly, tzOffsetSeconds);

  if (weather && hourlyIndex != null) {
    return applyTimingAndSpecies(base, buildHourlyTimingContext(weather, hourlyIndex));
  }
  return applyStandaloneTiming(base, lat, hourly.dt, tzOffsetSeconds, 'hourly');
}

/** RF + calibration only — used to rank genera without the selected-species layer. */
export function scoreHourlyBaseProbability(
  lat: number,
  lon: number,
  hourly: HourlyWeather,
  tzOffsetSeconds = 0,
): number {
  const algo = getActiveAlgorithm();
  const base = algo.nuptialHourlyPercentage(lat, lon, hourly);
  return finalizeHourly(base, lat, lon, hourly, tzOffsetSeconds);
}

export function scoreHourlyBaseForWeather(weather: WeatherData): number[] {
  return weather.hourly.map((h) =>
    scoreHourlyBaseProbability(weather.lat, weather.lon, h, weather.timezoneOffset),
  );
}

export function scoreHourly(
  lat: number,
  lon: number,
  hourly: HourlyWeather[],
  tzOffsetSeconds = 0,
): number[] {
  return hourly.map((h) =>
    percentageToInt(scoreHourlyProbability(lat, lon, h, tzOffsetSeconds)),
  );
}

export function scoreHourlyForWeather(weather: WeatherData): number[] {
  return weather.hourly.map((h, i) =>
    percentageToInt(
      scoreHourlyProbability(weather.lat, weather.lon, h, weather.timezoneOffset, weather, i),
    ),
  );
}

export function scoreDailyProbability(
  lat: number,
  lon: number,
  daily: DailyWeather,
  tzOffsetSeconds: number,
  pop1?: number,
  pop2?: number,
  weather?: WeatherData,
  dailyIndex?: number,
): number {
  const algo = getActiveAlgorithm();
  let base = algo.nuptialDailyPercentage(lat, lon, daily, pop1, pop2);
  base = finalizeDaily(base, lat, lon, daily, tzOffsetSeconds);

  if (weather && dailyIndex != null) {
    return applyTimingAndSpecies(base, buildDailyTimingContext(weather, dailyIndex));
  }
  return applyStandaloneTiming(base, lat, daily.dt, tzOffsetSeconds, 'daily');
}

export function scoreAllDays(
  lat: number,
  lon: number,
  daily: DailyWeather[],
  tzOffset = 0,
  weather?: WeatherData,
): number[] {
  return daily.map((day, i) =>
    percentageToInt(
      scoreDailyProbability(
        lat,
        lon,
        day,
        tzOffset,
        i + 1 < daily.length ? daily[i + 1].pop : undefined,
        i + 2 < daily.length ? daily[i + 2].pop : undefined,
        weather,
        weather ? i : undefined,
      ),
    ),
  );
}

export function hasGreenTimeSlot(hourlyScores: number[]): boolean {
  return hourlyScores.some((s) => s >= getGreenThreshold());
}

export function getLocalCalibrationSummary(lat: number, lon: number): {
  count: number;
  nearestKm: number | null;
} {
  const sightings = getSightingsForCalibration();
  if (sightings.length === 0) return { count: 0, nearestKm: null };
  const { matchCount, nearestKm } = computeLocalBoost(
    lat,
    lon,
    { tempC: 20, humidityPct: 70, windMs: 3, pop: 0.1, month: new Date().getMonth() + 1 },
    sightings,
  );
  return { count: matchCount, nearestKm };
}
