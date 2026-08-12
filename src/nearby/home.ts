/**
 * Fixed “home” origin for nearby-town comparison.
 * Intentional location picks (search / GPS / approx) set home.
 * Clicking a nearby town only changes the viewed forecast — home stays put.
 */
import { haversineMiles } from '../geo/distance';
import type { WeatherData } from '../types';

const HOME_TOLERANCE_MI = 1.5;

export interface NearbyHomeAnchor {
  lat: number;
  lon: number;
  name: string;
  usState: string | null;
  countryCode: string | null;
}

let home: NearbyHomeAnchor | null = null;
/** Snapshot of home forecast used for nearby scans (independent of viewed hop). */
let homeWeather: WeatherData | null = null;
let homeHourlyScores: number[] = [];
/** True while the on-screen forecast is a nearby-town hop (not the home place). */
let viewingNearbyHop = false;

export function getNearbyHome(): NearbyHomeAnchor | null {
  return home;
}

export function getNearbyHomeWeather(): WeatherData | null {
  return homeWeather;
}

export function getNearbyHomeHourlyScores(): number[] {
  return homeHourlyScores;
}

export function setNearbyHomeFromWeather(
  weather: WeatherData,
  hourlyScores: number[],
): NearbyHomeAnchor {
  home = {
    lat: weather.lat,
    lon: weather.lon,
    name: weather.locationName,
    usState: weather.place.usState,
    countryCode: weather.place.countryCode,
  };
  // Keep an independent snapshot so town hops never become the scan origin
  homeWeather = {
    ...weather,
    place: { ...weather.place },
    daily: [...weather.daily],
    extendedDaily: [...weather.extendedDaily],
    hourly: [...weather.hourly],
  };
  homeHourlyScores = [...hourlyScores];
  viewingNearbyHop = false;
  return home;
}

export function clearNearbyHome(): void {
  home = null;
  homeWeather = null;
  homeHourlyScores = [];
  viewingNearbyHop = false;
}

export function updateNearbyHomeScores(scores: number[]): void {
  homeHourlyScores = [...scores];
}

export function isViewingNearbyHop(): boolean {
  return viewingNearbyHop;
}

export function setViewingNearbyHop(away: boolean): void {
  viewingNearbyHop = away;
}

export function isNearNearbyHome(lat: number, lon: number): boolean {
  if (!home) return false;
  return haversineMiles(lat, lon, home.lat, home.lon) <= HOME_TOLERANCE_MI;
}
