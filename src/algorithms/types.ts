import type { DailyWeather, HourlyWeather } from '../types';

/** Shared contract for swappable flight-prediction algorithms. */
export interface FlightAlgorithm {
  id: string;
  name: string;
  description: string;
  version: string;
  /** Short citation keys — see `references.ts` for full bibliography. */
  referenceIds: string[];

  greenThreshold: number;
  amberThreshold: number;

  nuptialDailyPercentage(
    lat: number,
    lon: number,
    daily: DailyWeather,
    pop1?: number,
    pop2?: number,
  ): number;

  nuptialHourlyPercentage(lat: number, lon: number, hourly: HourlyWeather): number;
}

export interface LiteratureStudy {
  id: string;
  authors: string;
  year: number;
  title: string;
  journal?: string;
  url?: string;
  /** Weather variables and thresholds derived from the paper or meta-analyses. */
  findings: string[];
}
