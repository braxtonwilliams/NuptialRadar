import {
  flightLikelihoodText,
  sizeSeasonalPercentages,
} from './nuptials';
import {
  getGreenThreshold,
  scoreAllDays,
  scoreHourlyForWeather,
  hasGreenTimeSlot as scoringHasGreenTimeSlot,
} from './algorithms/scoring';
import { getHourlyWindow } from './weather';
import type { DayForecast, WeatherData } from './types';

export { getGreenThreshold } from './algorithms/scoring';

export type ForecastView = '24h' | '7d' | 'month';

export interface HourlySlot {
  dt: number;
  local: Date;
  timeLabel: string;
  percentage: number;
  temp: number;
  wind: number;
}

export interface MonthDayCell {
  day: number;
  dateKey: string;
  inMonth: boolean;
  isToday: boolean;
  hasForecast: boolean;
  isEstimate: boolean;
  dailyIndex: number | null;
  extendedIndex: number | null;
  peakPercentage: number | null;
  dailyPercentage: number | null;
  hasGreenSlot: boolean;
}

function localDateFromDt(dt: number, tzOffset: number): Date {
  return new Date((dt + tzOffset) * 1000);
}

export function localDateKey(dt: number, tzOffset: number): string {
  const d = localDateFromDt(dt, tzOffset);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatTimeLabel(dt: number, tzOffset: number): string {
  const d = localDateFromDt(dt, tzOffset);
  return d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  });
}

export function formatDate(date: Date, opts: Intl.DateTimeFormatOptions): string {
  return date.toLocaleDateString(undefined, opts);
}

export function computeHourlyScores(weather: WeatherData): number[] {
  return scoreHourlyForWeather(weather);
}

export function hasGreenTimeSlot(hourlyScores: number[]): boolean {
  return scoringHasGreenTimeSlot(hourlyScores);
}

export function getNext24HourSlots(
  weather: WeatherData,
  hourlyScores: number[],
  anchor: 'midnight' | 'now' = 'now',
): HourlySlot[] {
  const dayIndex = 0;
  const { hourly, indices } =
    anchor === 'midnight'
      ? getHourlyWindow(weather, 'midnight', { dayIndex })
      : getHourlyWindow(weather, 'now', { limit: 24 });

  return hourly.map((h, i) => ({
    dt: h.dt,
    local: localDateFromDt(h.dt, weather.timezoneOffset),
    timeLabel: formatTimeLabel(h.dt, weather.timezoneOffset),
    percentage: hourlyScores[indices[i]] ?? 0,
    temp: h.temp,
    wind: h.windSpeed,
  }));
}

export function buildDayForecasts(
  weather: WeatherData,
  hourlyScores: number[],
): {
  dailyForecasts: DayForecast[];
  dailyPercentages: number[];
  extendedForecasts: DayForecast[];
  extendedPercentages: number[];
} {
  const hourlyPeaks = hourlyPeakByDateKey(weather, hourlyScores);
  const dailyPercentages = scoreAllDays(
    weather.lat,
    weather.lon,
    weather.daily,
    weather.timezoneOffset,
  );

  const dailyForecasts = weather.daily.map((day, index) => {
    const date = localDateFromDt(day.dt, weather.timezoneOffset);
    const dateKey = localDateKey(day.dt, weather.timezoneOffset);
    const peak = hourlyPeaks.get(dateKey);
    const dailyModelPct = dailyPercentages[index] ?? 0;
    return {
      index,
      date,
      label: index === 0 ? 'Today' : formatDate(date, { month: 'short', day: 'numeric' }),
      weekday: formatDate(date, { weekday: 'short' }),
      percentage: dailyModelPct,
      dailyModelPercentage: dailyModelPct,
      peakHourlyPercentage: peak?.peak ?? dailyModelPct,
      weather: day,
      sizePercentages: sizeSeasonalPercentages(dailyModelPct, weather.lat, new Date(day.dt * 1000)),
      flightText: flightLikelihoodText(dailyModelPct, weather.lat, new Date(day.dt * 1000)),
      hasGreenSlot: peak?.hasGreen ?? false,
      isEstimate: false,
    };
  });

  const extendedPercentages = scoreAllDays(
    weather.lat,
    weather.lon,
    weather.extendedDaily,
    weather.timezoneOffset,
  );
  const extendedForecasts = weather.extendedDaily.map((day, index) => {
    const date = localDateFromDt(day.dt, weather.timezoneOffset);
    const pct = extendedPercentages[index] ?? 0;
    return {
      index: weather.daily.length + index,
      date,
      label: formatDate(date, { month: 'short', day: 'numeric' }),
      weekday: formatDate(date, { weekday: 'short' }),
      percentage: pct,
      weather: day,
      sizePercentages: sizeSeasonalPercentages(pct, weather.lat, new Date(day.dt * 1000)),
      flightText: flightLikelihoodText(pct, weather.lat, new Date(day.dt * 1000)),
      hasGreenSlot: false,
      isEstimate: true,
    };
  });

  return { dailyForecasts, dailyPercentages, extendedForecasts, extendedPercentages };
}

export function dailyIndexByDateKey(weather: WeatherData): Map<string, number> {
  const map = new Map<string, number>();
  weather.daily.forEach((day, i) => {
    map.set(localDateKey(day.dt, weather.timezoneOffset), i);
  });
  return map;
}

export function hourlyPeakByDateKey(
  weather: WeatherData,
  hourlyScores: number[],
): Map<string, { peak: number; hasGreen: boolean }> {
  const map = new Map<string, { peak: number; hasGreen: boolean }>();

  weather.hourly.forEach((h, i) => {
    const key = localDateKey(h.dt, weather.timezoneOffset);
    const pct = hourlyScores[i];
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { peak: pct, hasGreen: pct >= getGreenThreshold() });
    } else {
      map.set(key, {
        peak: Math.max(existing.peak, pct),
        hasGreen: existing.hasGreen || pct >= getGreenThreshold(),
      });
    }
  });

  return map;
}

export function buildMonthCalendar(
  weather: WeatherData,
  hourlyScores: number[],
  dailyPercentages: number[],
  extendedPercentages: number[],
): { monthLabel: string; weeks: MonthDayCell[][]; forecastDays: number; estimateDays: number } {
  const tz = weather.timezoneOffset;
  const todayKey = localDateKey(Math.floor(Date.now() / 1000), tz);
  const forecastIndex = dailyIndexByDateKey(weather);
  const hourlyPeaks = hourlyPeakByDateKey(weather, hourlyScores);

  const extendedIndex = new Map<string, number>();
  weather.extendedDaily.forEach((day, i) => {
    extendedIndex.set(localDateKey(day.dt, tz), i);
  });

  const localNow = localDateFromDt(Math.floor(Date.now() / 1000), tz);
  const year = localNow.getUTCFullYear();
  const month = localNow.getUTCMonth();
  const monthLabel = formatDate(new Date(Date.UTC(year, month, 1)), { month: 'long', year: 'numeric' });

  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const startPad = firstOfMonth.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  let forecastDays = 0;
  let estimateDays = 0;
  const cells: MonthDayCell[] = [];

  for (let i = 0; i < startPad; i++) {
    cells.push(emptyMonthCell());
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const fIdx = forecastIndex.get(dateKey) ?? null;
    const eIdx = extendedIndex.get(dateKey) ?? null;
    const peakInfo = hourlyPeaks.get(dateKey);
    const hasForecast = fIdx != null || eIdx != null;
    const isEstimate = fIdx == null && eIdx != null;

    if (fIdx != null) forecastDays++;
    if (eIdx != null) estimateDays++;

    const dailyPct =
      fIdx != null ? (dailyPercentages[fIdx] ?? null) : eIdx != null ? (extendedPercentages[eIdx] ?? null) : null;

    cells.push({
      day: d,
      dateKey,
      inMonth: true,
      isToday: dateKey === todayKey,
      hasForecast,
      isEstimate,
      dailyIndex: fIdx,
      extendedIndex: eIdx,
      peakPercentage: peakInfo?.peak ?? dailyPct,
      dailyPercentage: dailyPct,
      hasGreenSlot: peakInfo?.hasGreen ?? false,
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push(emptyMonthCell());
  }

  const weeks: MonthDayCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  return { monthLabel, weeks, forecastDays, estimateDays };
}

function emptyMonthCell(): MonthDayCell {
  return {
    day: 0,
    dateKey: '',
    inMonth: false,
    isToday: false,
    hasForecast: false,
    isEstimate: false,
    dailyIndex: null,
    extendedIndex: null,
    peakPercentage: null,
    dailyPercentage: null,
    hasGreenSlot: false,
  };
}
