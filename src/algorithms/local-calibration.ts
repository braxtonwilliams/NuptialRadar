/**
 * Adjusts base model scores using locally logged nuptial sightings and queen captures.
 */
import type { CalibrationContext, SightingRecord, WeatherSnapshot } from '../db/types';
import { sightingWeatherSnapshot } from '../db/sightings';

const MAX_DISTANCE_KM = 120;
const DISTANCE_SCALE_KM = 45;

function clampProb(p: number): number {
  return Math.max(0.01, Math.min(0.99, p));
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function gaussianSim(a: number, b: number, sigma: number): number {
  const z = (a - b) / sigma;
  return Math.exp(-0.5 * z * z);
}

function weatherSimilarity(ctx: CalibrationContext, snap: WeatherSnapshot, observedAt: string): number {
  const obs = new Date(observedAt);
  const monthSim = gaussianSim(ctx.month, obs.getUTCMonth() + 1, 1.8);
  const hourSim = ctx.hour != null ? gaussianSim(ctx.hour, obs.getUTCHours(), 3.5) : 0.75;

  const tempSim = gaussianSim(ctx.tempC, snap.tempC, 4.5);
  const humidSim = gaussianSim(ctx.humidityPct, snap.humidityPct, 18);
  const windSim = gaussianSim(ctx.windMs, snap.windMs, 3.5);
  const rainSim = gaussianSim(ctx.pop, snap.pop, 0.22);

  return (
    tempSim * 0.28 +
    humidSim * 0.22 +
    windSim * 0.22 +
    rainSim * 0.1 +
    monthSim * 0.1 +
    hourSim * 0.08
  );
}

export interface LocalBoostResult {
  boost: number;
  matchCount: number;
  nearestKm: number | null;
}

export function computeLocalBoost(
  lat: number,
  lon: number,
  context: CalibrationContext,
  sightings: SightingRecord[],
): LocalBoostResult {
  let weighted = 0;
  let weightSum = 0;
  let matchCount = 0;
  let nearestKm: number | null = null;

  for (const s of sightings) {
    const snap = sightingWeatherSnapshot(s);
    if (!snap) continue;

    const dist = haversineKm(lat, lon, s.latitude, s.longitude);
    if (dist > MAX_DISTANCE_KM) continue;

    nearestKm = nearestKm == null ? dist : Math.min(nearestKm, dist);
    matchCount++;

    const distW = Math.exp(-dist / DISTANCE_SCALE_KM);
    const kindW = s.kind === 'queen_capture' ? 1.25 : 1;
    const sizeW = s.sizeMm != null && s.sizeMm >= 8 ? 1.05 : 1;
    const sim = weatherSimilarity(context, snap, s.observedAt);

    weighted += sim * distW * kindW * sizeW;
    weightSum += distW * kindW * sizeW;
  }

  if (weightSum === 0) {
    return { boost: 0, matchCount: 0, nearestKm: null };
  }

  return {
    boost: weighted / weightSum,
    matchCount,
    nearestKm,
  };
}

export function applyLocalCalibration(
  baseProb: number,
  boost: number,
  matchCount: number,
): number {
  if (matchCount === 0 || boost <= 0.05) return baseProb;

  const strength = Math.min(0.4, 0.1 + matchCount * 0.05);
  const localFlightPrior = 0.52 + boost * 0.45;
  const blended = baseProb * (1 - strength) + localFlightPrior * strength * boost;
  return clampProb(blended);
}

export function calibrationContextFromHourly(
  tempC: number,
  humidityPct: number,
  windMs: number,
  pop: number,
  dtUnix: number,
  tzOffset: number,
): CalibrationContext {
  const local = new Date((dtUnix + tzOffset) * 1000);
  return {
    tempC,
    humidityPct,
    windMs,
    pop,
    month: local.getUTCMonth() + 1,
    hour: local.getUTCHours(),
  };
}

export function calibrationContextFromDaily(
  daily: { temp: { day: number }; humidity: number; windSpeed: number; pop: number; dt: number },
  tzOffset: number,
): CalibrationContext {
  const local = new Date((daily.dt + tzOffset) * 1000);
  return {
    tempC: daily.temp.day,
    humidityPct: daily.humidity,
    windMs: daily.windSpeed,
    pop: daily.pop,
    month: local.getUTCMonth() + 1,
  };
}
