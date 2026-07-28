import type { DailyWeather, GeocodeResult, HourlyWeather, WeatherData } from './types';
import { FORECAST_DAY_LIMIT } from './types';

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

function moonPhaseFromDate(date: Date): number {
  const synodic = 29.53058867;
  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14);
  const days = (date.getTime() - knownNewMoon) / 86400000;
  return ((days % synodic) + synodic) % synodic / synodic;
}

export async function searchLocations(query: string): Promise<GeocodeResult[]> {
  if (!query.trim()) return [];
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', query.trim());
  url.searchParams.set('count', '8');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  const res = await fetch(url);
  if (!res.ok) throw new Error('Location search failed');
  const data = await res.json();
  return (data.results ?? []).map(
    (r: { name: string; latitude: number; longitude: number; country: string; admin1?: string }) => ({
      name: r.name,
      lat: r.latitude,
      lon: r.longitude,
      country: r.country,
      admin1: r.admin1,
    }),
  );
}

export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/reverse');
  url.searchParams.set('latitude', lat.toFixed(4));
  url.searchParams.set('longitude', lon.toFixed(4));
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  const res = await fetch(url);
  if (!res.ok) return `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
  const data = await res.json();
  const place = data.results?.[0];
  if (!place) return `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
  return [place.name, place.admin1, place.country].filter(Boolean).join(', ');
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
    const dt = Math.floor(new Date(`${dateStr}T12:00:00Z`).getTime() / 1000);
    return {
      dt,
      temp: {
        day: data.daily.temperature_2m_mean[i] ?? data.daily.temperature_2m_max[i],
        min: data.daily.temperature_2m_min[i],
        max: data.daily.temperature_2m_max[i],
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
      moonPhase: moonPhaseFromDate(new Date(dateStr)),
      description: 'Climate average',
      isEstimate: true,
    };
  });
}

export async function fetchWeather(lat: number, lon: number, locationName?: string): Promise<WeatherData> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', lat.toString());
  url.searchParams.set('longitude', lon.toString());
  url.searchParams.set(
    'hourly',
    [
      'temperature_2m',
      'relative_humidity_2m',
      'dew_point_2m',
      'surface_pressure',
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
      'surface_pressure_mean',
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
    const dt = Math.floor(new Date(`${dateStr}T12:00:00`).getTime() / 1000);
    const sunrise = data.daily.sunrise?.[i]
      ? Math.floor(new Date(data.daily.sunrise[i]).getTime() / 1000)
      : undefined;
    const sunset = data.daily.sunset?.[i]
      ? Math.floor(new Date(data.daily.sunset[i]).getTime() / 1000)
      : undefined;

    return {
      dt,
      sunrise,
      sunset,
      temp: {
        day: data.daily.temperature_2m_mean[i] ?? data.daily.temperature_2m_max[i],
        min: data.daily.temperature_2m_min[i],
        max: data.daily.temperature_2m_max[i],
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
      moonPhase: moonPhaseFromDate(new Date(dateStr)),
      description: weatherDescription(data.daily.weather_code[i]),
      isEstimate: false,
    };
  });

  const lastForecastDate = data.daily.time[data.daily.time.length - 1] as string;
  const monthEnd = endOfMonthYmd(tzOffsetSeconds);
  let extendedDaily: DailyWeather[] = [];

  if (lastForecastDate < monthEnd) {
    const climateStart = addDaysYmd(lastForecastDate, 1);
    extendedDaily = await fetchClimateDaily(lat, lon, climateStart, monthEnd);
  }

  const hourly: HourlyWeather[] = data.hourly.time.map((timeStr: string, i: number) => ({
    dt: Math.floor(new Date(timeStr).getTime() / 1000),
    temp: data.hourly.temperature_2m[i],
    humidity: data.hourly.relative_humidity_2m[i],
    dewPoint: data.hourly.dew_point_2m[i],
    pressure: data.hourly.surface_pressure[i],
    windSpeed: data.hourly.wind_speed_10m[i],
    windGust: data.hourly.wind_gusts_10m[i] ?? data.hourly.wind_speed_10m[i],
    clouds: data.hourly.cloud_cover[i] ?? 0,
    pop: (data.hourly.precipitation_probability[i] ?? 0) / 100,
    uvi: data.hourly.uv_index[i] ?? 0,
  }));

  const name = locationName ?? (await reverseGeocode(lat, lon));

  return {
    lat,
    lon,
    timezone: data.timezone,
    timezoneOffset: tzOffsetSeconds,
    locationName: name,
    daily,
    extendedDaily,
    hourly,
    forecastDayCount: daily.length,
  };
}

export function getHourlyForDay(
  weather: WeatherData,
  dayIndex: number,
): { hourly: HourlyWeather[]; scores: number[] } {
  const day = weather.daily[dayIndex];
  if (!day) return { hourly: [], scores: [] };

  const dayStart = day.dt - 43200;
  const dayEnd = dayStart + 86400;

  const hourly = weather.hourly.filter((h) => h.dt >= dayStart && h.dt < dayEnd);
  return { hourly, scores: [] };
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

export function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by your browser'));
      return;
    }

    const timer = window.setTimeout(() => {
      reject(new Error('Location request timed out'));
    }, 12000);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        window.clearTimeout(timer);
        resolve(pos);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 300000,
      },
    );
  });
}

export function geolocationHint(): string {
  if (!window.isSecureContext) {
    return 'Precise location needs HTTPS. Search for a city below, or we can estimate from your network.';
  }
  return 'Allow location in your browser, search for a city, or use approximate location from your IP.';
}
