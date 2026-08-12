import type { DailyWeather, GeocodeResult, HourlyWeather, WeatherData, WeatherPlace } from './types';
import type { WeatherSnapshot } from './db/types';
import { FORECAST_DAY_LIMIT } from './types';
import { buildGeocodingCandidates } from './geocoding-query';
import { buildLocationPlace } from './species/range';
import { reverseGeocodeCoords } from './geo/reverse-geocode';

const WEATHER_CODES: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  80: 'Rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  95: 'Thunderstorm',
};

function weatherDescription(code: number): string {
  return WEATHER_CODES[code] ?? 'Unknown';
}

/**
 * Open-Meteo returns wall-clock times in the location timezone when timezone=auto.
 * Convert to Unix UTC to match OpenWeatherMap-style `dt` used by nuptialflight models.
 */
export function parseOpenMeteoLocalTime(timeStr: string, tzOffsetSeconds: number): number {
  const match = timeStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return Math.floor(new Date(timeStr).getTime() / 1000);
  const y = Number(match[1]);
  const m = Number(match[2]) - 1;
  const d = Number(match[3]);
  const h = Number(match[4]);
  const min = Number(match[5]);
  const sec = Number(match[6] ?? 0);
  const localAsUtcMs = Date.UTC(y, m, d, h, min, sec);
  return Math.floor((localAsUtcMs - tzOffsetSeconds * 1000) / 1000);
}

/** Approximate OWM `temp.day` from Open-Meteo daily max/min (fallback when no hourly data). */
function owmStyleDayTemp(max: number, min: number, mean?: number | null): number {
  if (max != null && min != null) return (max + min) / 2;
  return mean ?? max ?? min ?? 0;
}

export function localDateKeyFromDt(dt: number, tzOffsetSeconds: number): string {
  const d = new Date((dt + tzOffsetSeconds) * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Replace Open-Meteo daily means with statistics derived from hourly readings
 * (hourly averages for temp/humidity/pressure/etc.; hourly max for wind/gust/uvi/pop).
 */
export function enrichDailyFromHourly(
  daily: DailyWeather[],
  hourly: HourlyWeather[],
  tzOffsetSeconds: number,
): DailyWeather[] {
  const byDate = new Map<string, HourlyWeather[]>();
  for (const h of hourly) {
    const key = localDateKeyFromDt(h.dt, tzOffsetSeconds);
    const bucket = byDate.get(key) ?? [];
    bucket.push(h);
    byDate.set(key, bucket);
  }

  return daily.map((day) => {
    const hours = byDate.get(localDateKeyFromDt(day.dt, tzOffsetSeconds));
    if (!hours?.length) return day;

    const temps = hours.map((h) => h.temp);
    return {
      ...day,
      temp: {
        day: mean(temps),
        min: Math.min(...temps),
        max: Math.max(...temps),
      },
      humidity: mean(hours.map((h) => h.humidity)),
      dewPoint: mean(hours.map((h) => h.dewPoint)),
      pressure: mean(hours.map((h) => h.pressure)),
      windSpeed: Math.max(...hours.map((h) => h.windSpeed)),
      windGust: Math.max(...hours.map((h) => h.windGust)),
      clouds: mean(hours.map((h) => h.clouds)),
      pop: Math.max(...hours.map((h) => h.pop)),
      uvi: Math.max(...hours.map((h) => h.uvi)),
    };
  });
}

function moonPhaseFromDate(date: Date): number {
  const synodic = 29.53058867;
  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14);
  const days = (date.getTime() - knownNewMoon) / 86400000;
  return ((days % synodic) + synodic) % synodic / synodic;
}

async function fetchGeocodeResults(name: string, countryCode?: string): Promise<GeocodeResult[]> {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', name);
  url.searchParams.set('count', '8');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');
  if (countryCode) url.searchParams.set('countryCode', countryCode);

  const res = await fetch(url);
  if (!res.ok) throw new Error('Location search failed');
  const data = await res.json();
  return (data.results ?? []).map(
    (r: {
      name: string;
      latitude: number;
      longitude: number;
      country: string;
      country_code?: string;
      admin1?: string;
    }) => ({
      name: r.name,
      lat: r.latitude,
      lon: r.longitude,
      country: r.country,
      countryCode: r.country_code,
      admin1: r.admin1,
    }),
  );
}

export async function searchLocations(query: string): Promise<GeocodeResult[]> {
  if (!query.trim()) return [];

  const candidates = buildGeocodingCandidates(query);
  const tried = new Set<string>();

  for (const { query: candidateQuery, countryCode } of candidates) {
    const key = `${candidateQuery.toLowerCase()}|${countryCode ?? ''}`;
    if (tried.has(key)) continue;
    tried.add(key);

    const results = await fetchGeocodeResults(candidateQuery, countryCode);
    if (results.length > 0) return results;
  }

  return [];
}

export interface ReverseGeocodeResult {
  displayName: string;
  place: WeatherPlace;
}

function fallbackPlace(lat: number, lon: number): WeatherPlace {
  return buildLocationPlace({ lat, lon });
}

export async function reverseGeocode(lat: number, lon: number): Promise<ReverseGeocodeResult> {
  const fallbackName = `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
  const hit = await reverseGeocodeCoords(lat, lon);
  if (!hit) {
    return { displayName: fallbackName, place: fallbackPlace(lat, lon) };
  }
  return {
    displayName: hit.displayName || fallbackName,
    place: hit.place,
  };
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function endOfMonthYmd(tzOffsetSeconds: number): string {
  const local = new Date((Math.floor(Date.now() / 1000) + tzOffsetSeconds) * 1000);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const last = new Date(Date.UTC(year, month + 1, 0));
  return last.toISOString().slice(0, 10);
}

async function fetchClimateDaily(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string,
  tzOffsetSeconds: number,
): Promise<DailyWeather[]> {
  const url = new URL('https://climate-api.open-meteo.com/v1/climate');
  url.searchParams.set('latitude', lat.toString());
  url.searchParams.set('longitude', lon.toString());
  url.searchParams.set('start_date', startDate);
  url.searchParams.set('end_date', endDate);
  url.searchParams.set(
    'daily',
    [
      'temperature_2m_mean',
      'temperature_2m_max',
      'temperature_2m_min',
      'relative_humidity_2m_mean',
      'dew_point_2m_mean',
      'surface_pressure_mean',
      'cloud_cover_mean',
      'precipitation_probability_max',
      'precipitation_sum',
      'wind_speed_10m_max',
      'wind_gusts_10m_max',
      'uv_index_max',
    ].join(','),
  );
  url.searchParams.set('wind_speed_unit', 'ms');

  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  if (!data.daily?.time?.length) return [];

  return data.daily.time.map((dateStr: string, i: number) => {
    const dt = parseOpenMeteoLocalTime(`${dateStr}T12:00:00`, tzOffsetSeconds);
    const max = data.daily.temperature_2m_max[i];
    const min = data.daily.temperature_2m_min[i];
    const mean = data.daily.temperature_2m_mean[i];
    return {
      dt,
      temp: {
        day: owmStyleDayTemp(max, min, mean),
        min,
        max,
      },
      humidity: data.daily.relative_humidity_2m_mean[i] ?? 70,
      dewPoint: data.daily.dew_point_2m_mean[i] ?? 10,
      pressure: data.daily.surface_pressure_mean[i] ?? 1013,
      windSpeed: data.daily.wind_speed_10m_max[i] ?? 0,
      windGust: data.daily.wind_gusts_10m_max[i] ?? data.daily.wind_speed_10m_max[i] ?? 0,
      clouds: data.daily.cloud_cover_mean[i] ?? 50,
      pop: (data.daily.precipitation_probability_max[i] ?? 0) / 100,
      uvi: data.daily.uv_index_max[i] ?? 0,
      rain: data.daily.precipitation_sum[i] ?? 0,
      moonPhase: moonPhaseFromDate(new Date(dt * 1000)),
      description: 'Climate average',
      isEstimate: true,
    };
  });
}

export async function fetchWeather(lat: number, lon: number, locationName?: string): Promise<WeatherData> {
  return fetchWeatherFromOpenMeteo(lat, lon, locationName);
}

async function fetchWeatherFromOpenMeteo(
  lat: number,
  lon: number,
  locationName?: string,
): Promise<WeatherData> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', lat.toString());
  url.searchParams.set('longitude', lon.toString());
  url.searchParams.set(
    'hourly',
    [
      'temperature_2m',
      'relative_humidity_2m',
      'dew_point_2m',
      'pressure_msl',
      'cloud_cover',
      'precipitation_probability',
      'rain',
      'wind_speed_10m',
      'wind_gusts_10m',
      'uv_index',
    ].join(','),
  );
  url.searchParams.set(
    'daily',
    [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'temperature_2m_mean',
      'relative_humidity_2m_mean',
      'dew_point_2m_mean',
      'pressure_msl_mean',
      'cloud_cover_mean',
      'precipitation_probability_max',
      'precipitation_sum',
      'wind_speed_10m_max',
      'wind_gusts_10m_max',
      'uv_index_max',
      'sunrise',
      'sunset',
    ].join(','),
  );
  url.searchParams.set('wind_speed_unit', 'ms');
  url.searchParams.set('forecast_days', String(FORECAST_DAY_LIMIT));
  url.searchParams.set('timezone', 'auto');

  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch weather forecast');

  const data = await res.json();
  const tzOffsetSeconds = data.utc_offset_seconds ?? 0;

  const daily: DailyWeather[] = data.daily.time.map((dateStr: string, i: number) => {
    const dt = parseOpenMeteoLocalTime(`${dateStr}T12:00:00`, tzOffsetSeconds);
    const sunrise = data.daily.sunrise?.[i]
      ? parseOpenMeteoLocalTime(data.daily.sunrise[i], tzOffsetSeconds)
      : undefined;
    const sunset = data.daily.sunset?.[i]
      ? parseOpenMeteoLocalTime(data.daily.sunset[i], tzOffsetSeconds)
      : undefined;
    const max = data.daily.temperature_2m_max[i];
    const min = data.daily.temperature_2m_min[i];
    const mean = data.daily.temperature_2m_mean[i];

    return {
      dt,
      sunrise,
      sunset,
      temp: {
        day: owmStyleDayTemp(max, min, mean),
        min,
        max,
      },
      humidity: data.daily.relative_humidity_2m_mean[i] ?? 70,
      dewPoint: data.daily.dew_point_2m_mean[i] ?? 10,
      // MSL pressure matches OpenWeatherMap `pressure` used to train the RF
      pressure: data.daily.pressure_msl_mean[i] ?? 1013,
      windSpeed: data.daily.wind_speed_10m_max[i] ?? 0,
      windGust: data.daily.wind_gusts_10m_max[i] ?? data.daily.wind_speed_10m_max[i] ?? 0,
      clouds: data.daily.cloud_cover_mean[i] ?? 50,
      pop: (data.daily.precipitation_probability_max[i] ?? 0) / 100,
      uvi: data.daily.uv_index_max[i] ?? 0,
      rain: data.daily.precipitation_sum[i] ?? 0,
      moonPhase: moonPhaseFromDate(new Date(dt * 1000)),
      description: weatherDescription(data.daily.weather_code[i]),
      isEstimate: false,
    };
  });

  const lastForecastDate = data.daily.time[data.daily.time.length - 1] as string;
  const monthEnd = endOfMonthYmd(tzOffsetSeconds);
  let extendedDaily: DailyWeather[] = [];

  if (lastForecastDate < monthEnd) {
    const climateStart = addDaysYmd(lastForecastDate, 1);
    extendedDaily = await fetchClimateDaily(lat, lon, climateStart, monthEnd, tzOffsetSeconds);
  }

  let hourly: HourlyWeather[] = data.hourly.time.map((timeStr: string, i: number) => ({
    dt: parseOpenMeteoLocalTime(timeStr, tzOffsetSeconds),
    temp: data.hourly.temperature_2m[i],
    humidity: data.hourly.relative_humidity_2m[i],
    dewPoint: data.hourly.dew_point_2m[i],
    // Sea-level pressure matches OWM One Call / training features
    pressure: data.hourly.pressure_msl[i] ?? data.hourly.surface_pressure?.[i] ?? 1013,
    windSpeed: data.hourly.wind_speed_10m[i],
    windGust: data.hourly.wind_gusts_10m[i] ?? data.hourly.wind_speed_10m[i],
    clouds: data.hourly.cloud_cover[i] ?? 0,
    pop: (data.hourly.precipitation_probability[i] ?? 0) / 100,
    uvi: data.hourly.uv_index[i] ?? 0,
    rain: data.hourly.rain?.[i] ?? 0,
  }));

  let dailyEnriched = enrichDailyFromHourly(daily, hourly, tzOffsetSeconds);

  const resolved = await reverseGeocode(lat, lon);

  return {
    lat,
    lon,
    timezone: data.timezone,
    timezoneOffset: tzOffsetSeconds,
    locationName: locationName ?? resolved.displayName,
    place: resolved.place,
    daily: dailyEnriched,
    extendedDaily,
    hourly,
    forecastDayCount: dailyEnriched.length,
    weatherSource: 'open-meteo',
  };
}

/**
 * Lightweight forecast for nearby-town scans: 2 days, no climate fill, no reverse geocode.
 * Caller supplies display name + place (same-state scan).
 */
export async function fetchWeatherLite(
  lat: number,
  lon: number,
  meta: { locationName: string; place: WeatherPlace },
): Promise<WeatherData> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', lat.toString());
  url.searchParams.set('longitude', lon.toString());
  url.searchParams.set(
    'hourly',
    [
      'temperature_2m',
      'relative_humidity_2m',
      'dew_point_2m',
      'pressure_msl',
      'cloud_cover',
      'precipitation_probability',
      'rain',
      'wind_speed_10m',
      'wind_gusts_10m',
      'uv_index',
    ].join(','),
  );
  url.searchParams.set(
    'daily',
    [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'temperature_2m_mean',
      'relative_humidity_2m_mean',
      'dew_point_2m_mean',
      'pressure_msl_mean',
      'cloud_cover_mean',
      'precipitation_probability_max',
      'precipitation_sum',
      'wind_speed_10m_max',
      'wind_gusts_10m_max',
      'uv_index_max',
      'sunrise',
      'sunset',
    ].join(','),
  );
  url.searchParams.set('wind_speed_unit', 'ms');
  url.searchParams.set('forecast_days', '2');
  url.searchParams.set('timezone', 'auto');

  const res = await fetch(url);
  if (!res.ok) throw new Error('Nearby forecast fetch failed');

  const data = await res.json();
  const tzOffsetSeconds = data.utc_offset_seconds ?? 0;

  const daily: DailyWeather[] = data.daily.time.map((dateStr: string, i: number) => {
    const dt = parseOpenMeteoLocalTime(`${dateStr}T12:00:00`, tzOffsetSeconds);
    const sunrise = data.daily.sunrise?.[i]
      ? parseOpenMeteoLocalTime(data.daily.sunrise[i], tzOffsetSeconds)
      : undefined;
    const sunset = data.daily.sunset?.[i]
      ? parseOpenMeteoLocalTime(data.daily.sunset[i], tzOffsetSeconds)
      : undefined;
    const max = data.daily.temperature_2m_max[i];
    const min = data.daily.temperature_2m_min[i];
    const mean = data.daily.temperature_2m_mean[i];
    return {
      dt,
      sunrise,
      sunset,
      temp: { day: owmStyleDayTemp(max, min, mean), min, max },
      humidity: data.daily.relative_humidity_2m_mean[i] ?? 70,
      dewPoint: data.daily.dew_point_2m_mean[i] ?? 10,
      pressure: data.daily.pressure_msl_mean[i] ?? 1013,
      windSpeed: data.daily.wind_speed_10m_max[i] ?? 0,
      windGust: data.daily.wind_gusts_10m_max[i] ?? data.daily.wind_speed_10m_max[i] ?? 0,
      clouds: data.daily.cloud_cover_mean[i] ?? 50,
      pop: (data.daily.precipitation_probability_max[i] ?? 0) / 100,
      uvi: data.daily.uv_index_max[i] ?? 0,
      rain: data.daily.precipitation_sum[i] ?? 0,
      moonPhase: moonPhaseFromDate(new Date(dt * 1000)),
      description: weatherDescription(data.daily.weather_code[i]),
      isEstimate: false,
    };
  });

  const hourly: HourlyWeather[] = data.hourly.time.map((timeStr: string, i: number) => ({
    dt: parseOpenMeteoLocalTime(timeStr, tzOffsetSeconds),
    temp: data.hourly.temperature_2m[i],
    humidity: data.hourly.relative_humidity_2m[i],
    dewPoint: data.hourly.dew_point_2m[i],
    pressure: data.hourly.pressure_msl[i] ?? 1013,
    windSpeed: data.hourly.wind_speed_10m[i],
    windGust: data.hourly.wind_gusts_10m[i] ?? data.hourly.wind_speed_10m[i],
    clouds: data.hourly.cloud_cover[i] ?? 0,
    pop: (data.hourly.precipitation_probability[i] ?? 0) / 100,
    uvi: data.hourly.uv_index[i] ?? 0,
    rain: data.hourly.rain?.[i] ?? 0,
  }));

  const dailyEnriched = enrichDailyFromHourly(daily, hourly, tzOffsetSeconds);

  return {
    lat,
    lon,
    timezone: data.timezone,
    timezoneOffset: tzOffsetSeconds,
    locationName: meta.locationName,
    place: { ...meta.place, lat, lon },
    daily: dailyEnriched,
    extendedDaily: [],
    hourly,
    forecastDayCount: dailyEnriched.length,
    weatherSource: 'open-meteo',
  };
}

export function getHourlyForDay(
  weather: WeatherData,
  dayIndex: number,
): { hourly: HourlyWeather[]; indices: number[] } {
  const day = weather.daily[dayIndex];
  if (!day) return { hourly: [], indices: [] };

  const dayKey = localDateKeyFromDt(day.dt, weather.timezoneOffset);
  const hourly: HourlyWeather[] = [];
  const indices: number[] = [];
  weather.hourly.forEach((h, i) => {
    if (localDateKeyFromDt(h.dt, weather.timezoneOffset) === dayKey) {
      hourly.push(h);
      indices.push(i);
    }
  });
  return { hourly, indices };
}

/** Unix time of the start of the current local hour at the forecast location. */
export function localHourStartUnix(nowUnix: number, tzOffsetSeconds: number): number {
  const local = new Date((nowUnix + tzOffsetSeconds) * 1000);
  const localHourMs = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    local.getUTCHours(),
    0,
    0,
  );
  return Math.floor(localHourMs / 1000) - tzOffsetSeconds;
}

export type HourlyWindowAnchor = 'midnight' | 'now';

/**
 * Hourly slots for charts and the 24h strip.
 * - midnight: full calendar day (dayIndex)
 * - now: up to 24 consecutive hours from the current local hour (nuptialflight mobile)
 */
export function getHourlyWindow(
  weather: WeatherData,
  anchor: HourlyWindowAnchor,
  options: { dayIndex?: number; limit?: number } = {},
): { hourly: HourlyWeather[]; indices: number[] } {
  const dayIndex = options.dayIndex ?? 0;
  const limit = options.limit ?? (anchor === 'now' ? 24 : Infinity);

  if (anchor === 'now') {
    const startDt = localHourStartUnix(Math.floor(Date.now() / 1000), weather.timezoneOffset);
    const hourly: HourlyWeather[] = [];
    const indices: number[] = [];
    for (let i = 0; i < weather.hourly.length; i++) {
      if (weather.hourly[i].dt < startDt) continue;
      hourly.push(weather.hourly[i]);
      indices.push(i);
      if (hourly.length >= limit) break;
    }
    return { hourly, indices };
  }

  const day = getHourlyForDay(weather, dayIndex);
  if (!Number.isFinite(limit)) return day;
  return {
    hourly: day.hourly.slice(0, limit),
    indices: day.indices.slice(0, limit),
  };
}

export interface ApproximateLocation {
  lat: number;
  lon: number;
  name: string;
}

/** Rough location from IP when GPS is unavailable or denied. */
export async function fetchApproximateLocation(): Promise<ApproximateLocation | null> {
  try {
    const res = await fetch('https://ipwho.is/');
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.success || data.latitude == null || data.longitude == null) return null;
    const name = [data.city, data.region, data.country].filter(Boolean).join(', ');
    return {
      lat: data.latitude,
      lon: data.longitude,
      name: name || 'Your area',
    };
  } catch {
    return null;
  }
}

export async function geolocationPermissionState(): Promise<PermissionState | 'unsupported'> {
  if (!navigator.permissions?.query) return 'unsupported';
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    return status.state;
  } catch {
    return 'unsupported';
  }
}

function requestPosition(options: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

/**
 * Browser geolocation with retry. Call synchronously from a click handler
 * (before await/showLoading) so the permission prompt keeps user activation.
 */
export function getCurrentPosition(): Promise<GeolocationPosition> {
  if (!navigator.geolocation) {
    return Promise.reject(new Error('Geolocation is not supported by your browser'));
  }

  if (!window.isSecureContext) {
    return Promise.reject(
      new Error('Precise location requires HTTPS. Search for a city or use approximate location.'),
    );
  }

  const accurate: PositionOptions = {
    enableHighAccuracy: true,
    timeout: 12000,
    maximumAge: 0,
  };
  const coarse: PositionOptions = {
    enableHighAccuracy: false,
    timeout: 15000,
    maximumAge: 300000,
  };

  return requestPosition(accurate).catch((err) => {
    if (err instanceof GeolocationPositionError && err.code === GeolocationPositionError.PERMISSION_DENIED) {
      throw err;
    }
    return requestPosition(coarse);
  });
}

export function geolocationHint(): string {
  return 'Search for your city below, or use approximate location from your network.';
}

function formatYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function pickHourIndex(times: string[], target: Date): number {
  const targetMs = target.getTime();
  let best = 0;
  let bestDiff = Infinity;
  times.forEach((t, i) => {
    const diff = Math.abs(new Date(t).getTime() - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  });
  return best;
}

/** Weather at a specific time/place for sighting records (archive or forecast API). */
export async function fetchWeatherSnapshot(
  lat: number,
  lon: number,
  at: Date,
): Promise<WeatherSnapshot> {
  const now = Date.now();
  const dayMs = 86400000;
  const isRecent = at.getTime() > now - dayMs && at.getTime() < now + dayMs * 2;

  if (isRecent) {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', lat.toString());
    url.searchParams.set('longitude', lon.toString());
    url.searchParams.set(
      'hourly',
      'temperature_2m,relative_humidity_2m,dew_point_2m,surface_pressure,cloud_cover,precipitation_probability,wind_speed_10m',
    );
    url.searchParams.set('wind_speed_unit', 'ms');
    url.searchParams.set('forecast_days', '3');
    url.searchParams.set('timezone', 'UTC');

    const res = await fetch(url);
    if (!res.ok) throw new Error('Could not fetch weather for sighting time');
    const data = await res.json();
    const i = pickHourIndex(data.hourly.time as string[], at);
    return {
      tempC: data.hourly.temperature_2m[i],
      humidityPct: data.hourly.relative_humidity_2m[i],
      windMs: data.hourly.wind_speed_10m[i],
      pop: (data.hourly.precipitation_probability[i] ?? 0) / 100,
      cloudPct: data.hourly.cloud_cover[i] ?? 50,
      pressureHpa: data.hourly.surface_pressure[i] ?? 1013,
      dewPointC: data.hourly.dew_point_2m[i] ?? 10,
    };
  }

  const ymd = formatYmd(at);
  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.searchParams.set('latitude', lat.toString());
  url.searchParams.set('longitude', lon.toString());
  url.searchParams.set('start_date', ymd);
  url.searchParams.set('end_date', ymd);
  url.searchParams.set(
    'hourly',
    'temperature_2m,relative_humidity_2m,dew_point_2m,surface_pressure,cloud_cover,precipitation_probability,wind_speed_10m',
  );
  url.searchParams.set('wind_speed_unit', 'ms');
  url.searchParams.set('timezone', 'UTC');

  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not fetch historical weather for sighting time');
  const data = await res.json();
  const i = pickHourIndex(data.hourly.time as string[], at);
  return {
    tempC: data.hourly.temperature_2m[i],
    humidityPct: data.hourly.relative_humidity_2m[i],
    windMs: data.hourly.wind_speed_10m[i],
    pop: (data.hourly.precipitation_probability[i] ?? 0) / 100,
    cloudPct: data.hourly.cloud_cover[i] ?? 50,
    pressureHpa: data.hourly.surface_pressure[i] ?? 1013,
    dewPointC: data.hourly.dew_point_2m[i] ?? 10,
  };
}

export function snapshotFromHourly(h: HourlyWeather): WeatherSnapshot {
  return {
    tempC: h.temp,
    humidityPct: h.humidity,
    windMs: h.windSpeed,
    pop: h.pop,
    cloudPct: h.clouds,
    pressureHpa: h.pressure,
    dewPointC: h.dewPoint,
  };
}

export function snapshotFromDaily(d: DailyWeather): WeatherSnapshot {
  return {
    tempC: d.temp.day,
    humidityPct: d.humidity,
    windMs: d.windSpeed,
    pop: d.pop,
    cloudPct: d.clouds,
    pressureHpa: d.pressure,
    dewPointC: d.dewPoint,
  };
}
