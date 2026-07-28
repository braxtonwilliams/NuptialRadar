/**
 * Production algorithm — wraps the shipped nuptialflight random-forest models
 * in `src/nuptials.ts` without modification.
 */
import {
  AMBER_THRESHOLD,
  GREEN_THRESHOLD,
  nuptialDailyPercentageModel,
  nuptialHourlyPercentageModel,
} from '../nuptials';
import type { DailyWeather, HourlyWeather } from '../types';
import type { FlightAlgorithm } from './types';

export const forestV1Algorithm: FlightAlgorithm = {
  id: 'forest-v1',
  name: 'Nuptialflight RF (production)',
  description:
    'Random-forest models bundled from bradrushworth/nuptialflight, trained on crowd-sourced sightings.',
  version: '1.0.0',
  referenceIds: ['nuptialflight2026', 'boomsma1981', 'sobczak2017'],

  greenThreshold: GREEN_THRESHOLD,
  amberThreshold: AMBER_THRESHOLD,

  nuptialDailyPercentage(lat, lon, daily, pop1, pop2) {
    return nuptialDailyPercentageModel(lat, lon, daily, pop1, pop2);
  },

  nuptialHourlyPercentage(lat, lon, hourly) {
    return nuptialHourlyPercentageModel(lat, lon, hourly);
  },
};

export function scoreDailyV1(
  lat: number,
  lon: number,
  daily: DailyWeather,
  pop1?: number,
  pop2?: number,
): number {
  return forestV1Algorithm.nuptialDailyPercentage(lat, lon, daily, pop1, pop2);
}

export function scoreHourlyV1(lat: number, lon: number, hourly: HourlyWeather): number {
  return forestV1Algorithm.nuptialHourlyPercentage(lat, lon, hourly);
}
