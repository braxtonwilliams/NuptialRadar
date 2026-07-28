/**
 * Routes all flight scoring through the active algorithm from the registry,
 * then applies local calibration from logged sightings (SQLite).
 */
import { getSightingsForCalibration } from '../db/sightings';
import type { DailyWeather, HourlyWeather, WeatherData } from '../types';
import {
  applyLocalCalibration,
  calibrationContextFromDaily,
  calibrationContextFromHourly,
  computeLocalBoost,
} from './local-calibration';
import { hybridLiteratureV2Algorithm, nuptialHourlyPercentageV2 } from './nuptials-hybrid-v2';
import { getActiveAlgorithm } from './registry';

function percentageToInt(prob: number): number {
  return Math.round(prob * 100);
}

function finalizeHourly(
  baseProb: number,
  lat: number,
  lon: number,
  hourly: HourlyWeather,
  tzOffsetSeconds: number,
): number {
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
