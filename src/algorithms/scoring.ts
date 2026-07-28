/**
 * Routes all flight scoring through the active algorithm from the registry.
 */
import type { DailyWeather, HourlyWeather, WeatherData } from '../types';
import { hybridLiteratureV2Algorithm, nuptialHourlyPercentageV2 } from './nuptials-hybrid-v2';
import { getActiveAlgorithm } from './registry';

function percentageToInt(prob: number): number {
  return Math.round(prob * 100);
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
  if (algo.id === hybridLiteratureV2Algorithm.id) {
    return nuptialHourlyPercentageV2(lat, lon, hourly, tzOffsetSeconds);
  }
  return algo.nuptialHourlyPercentage(lat, lon, hourly);
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

export function scoreAllDays(lat: number, lon: number, daily: DailyWeather[]): number[] {
  const algo = getActiveAlgorithm();
  return daily.map((day, i) =>
    percentageToInt(
      algo.nuptialDailyPercentage(
        lat,
        lon,
        day,
        i + 1 < daily.length ? daily[i + 1].pop : undefined,
        i + 2 < daily.length ? daily[i + 2].pop : undefined,
      ),
    ),
  );
}

export function hasGreenTimeSlot(hourlyScores: number[]): boolean {
  return hourlyScores.some((s) => s >= getGreenThreshold());
}
