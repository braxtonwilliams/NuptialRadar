/**
 * Hybrid literature + random-forest algorithm (v2).
 *
 * Combines:
 *   1. The proven nuptialflight RF models (data-driven, global)
 *   2. Published species-level weather triggers (mechanistic, interpretable)
 *
 * Fusion:
 *   p_v2 = clamp( w_rf * p_rf + w_lit * p_lit + w_cross * p_rf * p_lit )
 *
 * Hard gates match v1 (temp, wind, gust).
 *
 * Bibliography: see `references.ts` and LITERATURE_STUDIES.
 */
import {
  AMBER_THRESHOLD,
  GREEN_THRESHOLD,
  nuptialDailyPercentageModel,
  nuptialHourlyPercentageModel,
} from '../nuptials';
import type { DailyWeather, HourlyWeather } from '../types';
import { literatureDailyScore, literatureHourlyScore } from './literature-scoring';
import { LITERATURE_STUDIES } from './references';
import type { FlightAlgorithm } from './types';

const W_RF_DAILY = 0.52;
const W_LIT_DAILY = 0.38;
const W_CROSS_DAILY = 0.1;

const W_RF_HOURLY = 0.48;
const W_LIT_HOURLY = 0.42;
const W_CROSS_HOURLY = 0.1;

function clampProb(p: number): number {
  return Math.max(0.01, Math.min(0.99, p));
}

function hardGate(temp: number, wind: number, gust: number): boolean {
  return temp < 5 || wind > 15 || gust > 20;
}

function fuse(rf: number, lit: number, wRf: number, wLit: number, wCross: number): number {
  return clampProb(wRf * rf + wLit * lit + wCross * rf * lit);
}

function localHourFromUnix(dt: number, tzOffsetSeconds: number): number {
  return new Date((dt + tzOffsetSeconds) * 1000).getUTCHours();
}

export const hybridLiteratureV2Algorithm: FlightAlgorithm = {
  id: 'hybrid-literature-v2',
  name: 'Literature + RF hybrid',
  description:
    'Blends nuptialflight random forests with published nuptial-flight weather triggers (Boomsma 1981, Depa 2006, Sobczak 2017, post-rain timing, diurnal windows).',
  version: '2.0.0',
  referenceIds: LITERATURE_STUDIES.map((s) => s.id),

  greenThreshold: GREEN_THRESHOLD,
  amberThreshold: AMBER_THRESHOLD,

  nuptialDailyPercentage(lat, lon, daily, pop1, pop2) {
    const temp = daily.temp.day;
    const wind = daily.windSpeed;
    const gust = daily.windGust;
    if (hardGate(temp, wind, gust)) return 0.01;

    const rf = nuptialDailyPercentageModel(lat, lon, daily, pop1, pop2);
    const lit = literatureDailyScore(
      {
        tempC: temp,
        humidityPct: daily.humidity,
        windMs: wind,
        gustMs: gust,
        dewPointC: daily.dewPoint,
        cloudPct: daily.clouds,
        pressureHpa: daily.pressure,
        pop: daily.pop,
        rainMm: daily.rain ?? 0,
        popNext1: pop1,
        popNext2: pop2,
      },
      lat,
      new Date(daily.dt * 1000),
    );

    return fuse(rf, lit, W_RF_DAILY, W_LIT_DAILY, W_CROSS_DAILY);
  },

  nuptialHourlyPercentage(lat, lon, hourly) {
    return nuptialHourlyPercentageV2(lat, lon, hourly, 0);
  },
};

export function nuptialHourlyPercentageV2(
  lat: number,
  lon: number,
  hourly: HourlyWeather,
  tzOffsetSeconds: number,
): number {
  const temp = hourly.temp;
  const wind = hourly.windSpeed;
  const gust = hourly.windGust;
  if (hardGate(temp, wind, gust)) return 0.01;

  const rf = nuptialHourlyPercentageModel(lat, lon, hourly);
  const lit = literatureHourlyScore(
    {
      tempC: temp,
      humidityPct: hourly.humidity,
      windMs: wind,
      gustMs: gust,
      dewPointC: hourly.dewPoint,
      cloudPct: hourly.clouds,
      pressureHpa: hourly.pressure,
      pop: hourly.pop,
      rainMm: 0,
      localHour: localHourFromUnix(hourly.dt, tzOffsetSeconds),
    },
    lat,
    new Date(hourly.dt * 1000),
  );

  return fuse(rf, lit, W_RF_HOURLY, W_LIT_HOURLY, W_CROSS_HOURLY);
}

export function nuptialDailyPercentageV2(
  lat: number,
  lon: number,
  daily: DailyWeather,
  pop1?: number,
  pop2?: number,
): number {
  return hybridLiteratureV2Algorithm.nuptialDailyPercentage(lat, lon, daily, pop1, pop2);
}

export function scoreAllDaysV2(lat: number, lon: number, daily: DailyWeather[]): number[] {
  return daily.map((day, i) =>
    Math.round(
      nuptialDailyPercentageV2(
        lat,
        lon,
        day,
        i + 1 < daily.length ? daily[i + 1].pop : undefined,
        i + 2 < daily.length ? daily[i + 2].pop : undefined,
      ) * 100,
    ),
  );
}

export function scoreHourlyV2(
  lat: number,
  lon: number,
  hourly: HourlyWeather[],
  tzOffsetSeconds: number,
): number[] {
  return hourly.map((h) =>
    Math.round(nuptialHourlyPercentageV2(lat, lon, h, tzOffsetSeconds) * 100),
  );
}
