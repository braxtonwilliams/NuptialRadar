/**
 * Derived environmental features for future Biology v4 retraining.
 * Computed at score time but NOT fed into the current RF JSON models.
 */
import type { DailyWeather, HourlyWeather, WeatherData } from '../types';

export interface BiologyV3DerivedFeatures {
  pressureDelta1Hour: number | null;
  pressureDelta3Hours: number | null;
  pressureDelta6Hours: number | null;
  pressureDelta24Hours: number | null;
  temperatureDelta1Hour: number | null;
  temperatureDelta3Hours: number | null;
  temperatureDelta6Hours: number | null;
  dailyTemperatureRange: number | null;
  rainPast1Hour: number;
  rainPast3Hours: number;
  rainPast6Hours: number;
  rainPast24Hours: number;
  hoursSinceRain: number;
  estimatedSoilMoisture: number;
  growingDegreeDays: number | null;
  rolling7DayAverageTemp: number | null;
  rolling30DayAverageTemp: number | null;
}

function deltaAt(hourly: HourlyWeather[], index: number, hoursBack: number, field: keyof HourlyWeather): number | null {
  const prev = hourly[index - hoursBack];
  const cur = hourly[index];
  if (!prev || !cur) return null;
  const a = cur[field];
  const b = prev[field];
  if (typeof a !== 'number' || typeof b !== 'number') return null;
  return a - b;
}

function sumPop(hourly: HourlyWeather[], index: number, hours: number): number {
  let sum = 0;
  for (let i = Math.max(0, index - hours + 1); i <= index; i++) {
    sum += hourly[i]?.pop ?? 0;
  }
  return sum;
}

/** Hours since the most recent hour with meaningful precipitation signal. */
export function hoursSinceWetHour(hourly: HourlyWeather[], index: number): number {
  for (let i = index; i >= 0; i--) {
    const h = hourly[i];
    if ((h.pop ?? 0) >= 0.35) {
      return index - i;
    }
  }
  return 48;
}

export function formatRainStatus(hourly: HourlyWeather[], index: number): string {
  const hrs = hoursSinceWetHour(hourly, index);
  const pop = hourly[index]?.pop ?? 0;
  if (pop >= 0.5) return 'Rain likely this hour';
  if (hrs === 0) return 'Wet conditions now';
  if (hrs <= 2) return 'Recent rain — still drying';
  if (hrs <= 8) return `Last rain ~${hrs}h ago`;
  if (hrs <= 24) return 'Dry for most of the day';
  return 'Dry past 24h+';
}

function estimateSoilMoisture(hourly: HourlyWeather[], index: number): number {
  let moisture = 0.35;
  const start = Math.max(0, index - 48);
  for (let i = start; i <= index; i++) {
    const rainSignal = (hourly[i].pop ?? 0) * 0.06;
    moisture = moisture * 0.94 + rainSignal;
  }
  return Math.max(0, Math.min(1, moisture));
}

function meanDailyTemp(daily: DailyWeather[], endIndex: number, days: number): number | null {
  if (endIndex < 0) return null;
  const start = Math.max(0, endIndex - days + 1);
  const slice = daily.slice(start, endIndex + 1);
  if (slice.length === 0) return null;
  return slice.reduce((s, d) => s + d.temp.day, 0) / slice.length;
}

function growingDegreeDays(daily: DailyWeather[], endIndex: number, base = 10): number | null {
  if (endIndex < 0) return null;
  let gdd = 0;
  for (let i = 0; i <= endIndex; i++) {
    gdd += Math.max(0, daily[i].temp.day - base);
  }
  return gdd;
}

export function computeBiologyV3DerivedFeatures(
  weather: WeatherData,
  hourlyIndex: number,
  dailyIndex: number,
): BiologyV3DerivedFeatures {
  const hourly = weather.hourly;
  const h = hourly[hourlyIndex];
  const daily = weather.daily[dailyIndex];

  return {
    pressureDelta1Hour: deltaAt(hourly, hourlyIndex, 1, 'pressure'),
    pressureDelta3Hours: deltaAt(hourly, hourlyIndex, 3, 'pressure'),
    pressureDelta6Hours: deltaAt(hourly, hourlyIndex, 6, 'pressure'),
    pressureDelta24Hours: deltaAt(hourly, hourlyIndex, 24, 'pressure'),
    temperatureDelta1Hour: deltaAt(hourly, hourlyIndex, 1, 'temp'),
    temperatureDelta3Hours: deltaAt(hourly, hourlyIndex, 3, 'temp'),
    temperatureDelta6Hours: deltaAt(hourly, hourlyIndex, 6, 'temp'),
    dailyTemperatureRange:
      daily != null ? daily.temp.max - daily.temp.min : h != null ? null : null,
    rainPast1Hour: sumPop(hourly, hourlyIndex, 1),
    rainPast3Hours: sumPop(hourly, hourlyIndex, 3),
    rainPast6Hours: sumPop(hourly, hourlyIndex, 6),
    rainPast24Hours: sumPop(hourly, hourlyIndex, 24),
    hoursSinceRain: hoursSinceWetHour(hourly, hourlyIndex),
    estimatedSoilMoisture: estimateSoilMoisture(hourly, hourlyIndex),
    growingDegreeDays: growingDegreeDays(weather.daily, dailyIndex),
    rolling7DayAverageTemp: meanDailyTemp(weather.daily, dailyIndex, 7),
    rolling30DayAverageTemp: meanDailyTemp(weather.daily, dailyIndex, 30),
  };
}

export function formatLocalHourWindow(dt: number, tzOffsetSeconds: number): string {
  const local = new Date((dt + tzOffsetSeconds) * 1000);
  const hour = local.getUTCHours();
  if (hour >= 5 && hour < 11) return 'Morning window';
  if (hour >= 11 && hour < 16) return 'Midday window';
  if (hour >= 16 && hour < 21) return 'Evening window';
  return 'Night window';
}
