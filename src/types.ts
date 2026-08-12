export const FORECAST_DAY_LIMIT = 16;

export interface DailyWeather {
  dt: number;
  sunrise?: number;
  sunset?: number;
  temp: { day: number; min: number; max: number };
  humidity: number;
  dewPoint: number;
  pressure: number;
  windSpeed: number;
  windGust: number;
  clouds: number;
  pop: number;
  uvi: number;
  rain?: number;
  moonPhase?: number;
  description: string;
  /** Climate-average fill for dates beyond the live forecast horizon. */
  isEstimate?: boolean;
}

export interface HourlyWeather {
  dt: number;
  temp: number;
  humidity: number;
  dewPoint: number;
  pressure: number;
  windSpeed: number;
  windGust: number;
  clouds: number;
  pop: number;
  uvi: number;
  /** Hourly rain mm when available from Open-Meteo. */
  rain?: number;
}

export type WeatherSource = 'open-meteo';

/** Structured place for species range filtering (from reverse geocode). */
export interface WeatherPlace {
  lat: number;
  lon: number;
  countryCode: string | null;
  country: string | null;
  admin1: string | null;
  usState: string | null;
}

export interface WeatherData {
  lat: number;
  lon: number;
  timezone: string;
  timezoneOffset: number;
  locationName: string;
  /** Country / region for native–invasive species filtering. */
  place: WeatherPlace;
  /** Live forecast days (hourly + daily model). */
  daily: DailyWeather[];
  /** Climate-average daily fill for the rest of the calendar month. */
  extendedDaily: DailyWeather[];
  hourly: HourlyWeather[];
  forecastDayCount: number;
  weatherSource: WeatherSource;
}

export interface DayForecast {
  index: number;
  date: Date;
  label: string;
  weekday: string;
  /** Card/summary display — daily RF score (matches nuptialflight week cards). */
  percentage: number;
  /** Daily RF model score (matches nuptialflight “day overall” and week cards). */
  dailyModelPercentage?: number;
  /** Best hourly score that day — for badges / month peak coloring. */
  peakHourlyPercentage?: number;
  weather: DailyWeather;
  sizePercentages: Record<'small' | 'medium' | 'large', number>;
  flightText: string;
  /** Any hourly window that day scored ≥ green threshold (55%). */
  hasGreenSlot: boolean;
  isEstimate?: boolean;
}

export interface GeocodeResult {
  name: string;
  lat: number;
  lon: number;
  country: string;
  countryCode?: string;
  admin1?: string;
}
