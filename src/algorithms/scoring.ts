/**
 * Routes all flight scoring through the active algorithm from the registry,
 * then applies local calibration from logged sightings when enabled.
 */
import { getSightingsForCalibration } from '../db/sightings';
import { percentageToInt } from '../nuptials';
import type { DailyWeather, HourlyWeather, WeatherData } from '../types';
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
import { hybridLiteratureV2Algorithm, nuptialHourlyPercentageV2 } from './nuptials-hybrid-v2';
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
): number {
  const algo = getActiveAlgorithm();
  let base =
    algo.id === hybridLiteratureV2Algorithm.id
      ? nuptialHourlyPercentageV2(lat, lon, hourly, tzOffsetSeconds)
      : algo.nuptialHourlyPercentage(lat, lon, hourly);
  base = finalizeHourly(base, lat, lon, hourly, tzOffsetSeconds);
  return base;
}

export function scoreHourly(
  lat: number,
  lon: number,
  hourly: HourlyWeather[],
  tzOffsetSeconds = 0,
): number[] {
  return hourly.map((h) => percentageToInt(scoreHourlyProbability(lat, lon, h, tzOffsetSeconds)));
}

export function scoreHourlyForWeather(weather: WeatherData): number[] {
  return scoreHourly(weather.lat, weather.lon, weather.hourly, weather.timezoneOffset);
}

export function scoreDailyProbability(
  lat: number,
  lon: number,
  daily: DailyWeather,
  tzOffsetSeconds: number,
  pop1?: number,
  pop2?: number,
): number {
  const algo = getActiveAlgorithm();
  let base = algo.nuptialDailyPercentage(lat, lon, daily, pop1, pop2);
  base = finalizeDaily(base, lat, lon, daily, tzOffsetSeconds);
  return base;
}

export function scoreAllDays(lat: number, lon: number, daily: DailyWeather[], tzOffset = 0): number[] {
  const algo = getActiveAlgorithm();
  return daily.map((day, i) =>
    percentageToInt(
      finalizeDaily(
        algo.nuptialDailyPercentage(
          lat,
          lon,
          day,
          i + 1 < daily.length ? daily[i + 1].pop : undefined,
          i + 2 < daily.length ? daily[i + 2].pop : undefined,
        ),
        lat,
        lon,
        day,
        tzOffset,
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
