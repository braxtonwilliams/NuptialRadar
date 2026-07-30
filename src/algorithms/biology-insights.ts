/**
 * Biology insights — confidence, activity, rain context.
 * Display-only overlays; never alter the active algorithm's probability.
 */
import type { ConfidenceLevel } from '../forest-model';
import {
  nuptialDailyRfWithConfidence,
  nuptialHourlyRfWithConfidence,
} from '../nuptials';
import type { DailyWeather, HourlyWeather } from '../types';

export type ExpectedActivity = 'Very Low' | 'Low' | 'Moderate' | 'High' | 'Exceptional';

export interface BiologyInsights {
  /** Same % as the active scoring algorithm — not recomputed here. */
  displayPct: number;
  activity: ExpectedActivity;
  confidence: ConfidenceLevel;
  confidenceStdDev: number;
}

export function expectedActivityFromPct(displayPct: number): ExpectedActivity {
  if (displayPct >= 86) return 'Exceptional';
  if (displayPct >= 71) return 'High';
  if (displayPct >= 51) return 'Moderate';
  if (displayPct >= 31) return 'Low';
  return 'Very Low';
}

export function buildBiologyInsights(
  displayPct: number,
  confidence: ConfidenceLevel,
  confidenceStdDev: number,
): BiologyInsights {
  return {
    displayPct,
    activity: expectedActivityFromPct(displayPct),
    confidence,
    confidenceStdDev,
  };
}

export function hourlyRfConfidence(lat: number, lon: number, hourly: HourlyWeather) {
  return nuptialHourlyRfWithConfidence(lat, lon, hourly);
}

export function dailyRfConfidence(
  lat: number,
  lon: number,
  daily: DailyWeather,
  pop1?: number,
  pop2?: number,
) {
  return nuptialDailyRfWithConfidence(lat, lon, daily, pop1, pop2);
}

export function biologyInsightsFlightText(
  insights: BiologyInsights,
  greenThreshold: number,
  amberThreshold: number,
): string {
  const qualifier =
    insights.displayPct >= greenThreshold
      ? 'likely'
      : insights.displayPct >= amberThreshold
        ? 'possible'
        : 'unlikely';
  return `Flight ${qualifier} · activity ${insights.activity.toLowerCase()} · ${insights.confidence.toLowerCase()} confidence`;
}
