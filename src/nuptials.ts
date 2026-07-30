import { getDailyModel, getHourlyModel } from './forest-model';
import type { DailyWeather, HourlyWeather } from './types';

export const GREEN_THRESHOLD = 60;
export const AMBER_THRESHOLD = 50;

const SIZE_SEASONAL_N: Record<string, number[]> = {
  small: [0.1129, 0.1667, 0.2505, 0.4015, 0.6841, 0.9962, 1.0, 0.7401, 0.3809, 0.2304, 0.1539, 0.1171],
  medium: [0.1449, 0.2049, 0.346, 0.5357, 0.8247, 1.0, 0.9378, 0.6571, 0.3839, 0.2625, 0.1942, 0.151],
  large: [0.2362, 0.3106, 0.4904, 0.7266, 0.9448, 1.0, 0.8945, 0.6391, 0.4568, 0.3321, 0.295, 0.2422],
};

const SIZE_SEASONAL_S: Record<string, number[]> = {
  small: [0.8522, 0.7581, 0.5618, 0.5323, 0.4301, 0.3253, 0.2903, 0.4973, 0.6801, 0.8925, 0.8817, 1.0],
  medium: [0.9702, 0.8214, 0.7262, 0.5952, 0.5119, 0.4048, 0.4345, 0.4643, 0.5536, 0.6845, 0.8869, 1.0],
  large: [0.9159, 0.9626, 1.0, 0.785, 0.5981, 0.3738, 0.4206, 0.5607, 0.757, 0.9907, 0.9907, 0.9813],
};

function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const diff = date.getTime() - start;
  return Math.floor(diff / 86400000);
}

export function sizeSeasonalMultiplier(size: string, lat: number, dateUtc: Date): number {
  const table = lat > 0 ? SIZE_SEASONAL_N : SIZE_SEASONAL_S;
  const row = table[size];
  if (!row) return 1;
  return row[dateUtc.getUTCMonth()];
}

export function sizeSeasonalPercentages(
  basePercentage: number,
  lat: number,
  dateUtc: Date,
): Record<'small' | 'medium' | 'large', number> {
  return {
    small: Math.round(basePercentage * sizeSeasonalMultiplier('small', lat, dateUtc)),
    medium: Math.round(basePercentage * sizeSeasonalMultiplier('medium', lat, dateUtc)),
    large: Math.round(basePercentage * sizeSeasonalMultiplier('large', lat, dateUtc)),
  };
}

export function flightLikelihoodText(pct: number, lat: number, dateUtc: Date): string {
  if (pct < AMBER_THRESHOLD) return 'Flight unlikely';
  const qualifier = pct >= GREEN_THRESHOLD ? 'likely' : 'possible';
  const sizes = sizeSeasonalPercentages(pct, lat, dateUtc);
  let bestSize: 'small' | 'medium' | 'large' = 'small';
  let best = -1;
  for (const [size, value] of Object.entries(sizes) as [typeof bestSize, number][]) {
    if (value > best) {
      best = value;
      bestSize = size;
    }
  }
  return `Flight ${qualifier} — probably ${bestSize} species`;
}

function hourlyFeatureVector(lat: number, lon: number, hourly: HourlyWeather): number[] {
  const temp = hourly.temp;
  const wind = hourly.windSpeed;
  const gust = hourly.windGust;
  const humid = hourly.humidity;
  const press = hourly.pressure;
  const dewPoint = hourly.dewPoint;
  const uvi = hourly.uvi ?? 0;

  const date = new Date(hourly.dt * 1000);
  const doy = dayOfYear(date);
  const hour = date.getUTCHours();
  const hemisphere = lat > 0 ? 1 : 0;
  const sinDoy = Math.sin((2 * Math.PI * doy) / 365.25);
  const cosDoy = Math.cos((2 * Math.PI * doy) / 365.25);
  const dewDep = temp - dewPoint;

  return [lat, lon, hemisphere, sinDoy, cosDoy, hour, temp, wind, humid, press, dewPoint, dewDep, uvi, gust];
}

function dailyFeatureVector(
  lat: number,
  lon: number,
  daily: DailyWeather,
  pop1?: number,
  pop2?: number,
): number[] {
  const temp = daily.temp.day;
  const wind = daily.windSpeed;
  const gust = daily.windGust;
  const rain = daily.pop;
  const humid = daily.humidity;
  const cloud = daily.clouds;
  const press = daily.pressure;
  const dewPoint = daily.dewPoint;
  const uvi = daily.uvi ?? 0;
  const rainMm = daily.rain ?? 0;

  const date = new Date(daily.dt * 1000);
  const doy = dayOfYear(date);
  const hemisphere = lat > 0 ? 1 : 0;
  const sinDoy = Math.sin((2 * Math.PI * doy) / 365.25);
  const cosDoy = Math.cos((2 * Math.PI * doy) / 365.25);
  const dewDep = temp - dewPoint;
  const popNext1 = pop1 ?? 0;
  const popNext2 = pop2 ?? 0;
  const daylength =
    daily.sunrise != null && daily.sunset != null
      ? Math.min(24, Math.max(0, (daily.sunset - daily.sunrise) / 3600))
      : 12;
  const moon = daily.moonPhase ?? 0.5;
  const moonSin = Math.sin(2 * Math.PI * moon);
  const moonCos = Math.cos(2 * Math.PI * moon);

  return [
    lat,
    lon,
    hemisphere,
    sinDoy,
    cosDoy,
    temp,
    wind,
    rain,
    humid,
    cloud,
    press,
    dewPoint,
    dewDep,
    popNext1,
    popNext2,
    uvi,
    gust,
    rainMm,
    daylength,
    moonSin,
    moonCos,
  ];
}

function clampRfProb(prob: number): number {
  return Math.min(0.99, Math.max(0.01, prob));
}

/** RF hourly score without hard weather gates (Biology v3). */
export function nuptialHourlyRfRaw(lat: number, lon: number, hourly: HourlyWeather): number {
  return clampRfProb(getHourlyModel().scorePositive(hourlyFeatureVector(lat, lon, hourly)));
}

/** RF daily score without hard weather gates (Biology v3). */
export function nuptialDailyRfRaw(
  lat: number,
  lon: number,
  daily: DailyWeather,
  pop1?: number,
  pop2?: number,
): number {
  return clampRfProb(getDailyModel().scorePositive(dailyFeatureVector(lat, lon, daily, pop1, pop2)));
}

export function nuptialHourlyRfWithConfidence(lat: number, lon: number, hourly: HourlyWeather) {
  return getHourlyModel().scorePositiveWithConfidence(hourlyFeatureVector(lat, lon, hourly));
}

export function nuptialDailyRfWithConfidence(
  lat: number,
  lon: number,
  daily: DailyWeather,
  pop1?: number,
  pop2?: number,
) {
  return getDailyModel().scorePositiveWithConfidence(dailyFeatureVector(lat, lon, daily, pop1, pop2));
}

export function nuptialHourlyPercentageModel(lat: number, lon: number, hourly: HourlyWeather): number {
  const temp = hourly.temp;
  const wind = hourly.windSpeed;
  const gust = hourly.windGust;

  if (temp < 5 || wind > 15 || gust > 20) return 0.01;

  return nuptialHourlyRfRaw(lat, lon, hourly);
}

export function nuptialDailyPercentageModel(
  lat: number,
  lon: number,
  daily: DailyWeather,
  pop1?: number,
  pop2?: number,
): number {
  const temp = daily.temp.day;
  const wind = daily.windSpeed;
  const gust = daily.windGust;

  if (temp < 5 || wind > 15 || gust > 20) return 0.01;

  return nuptialDailyRfRaw(lat, lon, daily, pop1, pop2);
}

export function percentageToInt(prob: number): number {
  return Math.trunc(prob * 100);
}

export function getEmoji(percentage: number): string {
  if (percentage < 45) return '👎';
  if (percentage < 50) return '🤏';
  if (percentage < 55) return '🤞';
  if (percentage < 60) return '🐜👌';
  if (percentage < 65) return '🐜👍';
  if (percentage < 70) return '🐜💪';
  return '🐜🫶';
}

export function getColor(percentage: number): string {
  if (percentage < AMBER_THRESHOLD) return '#b71c1c';
  if (percentage < GREEN_THRESHOLD) return '#e65100';
  return '#2e7d32';
}

export function getBgColor(percentage: number): string {
  if (percentage < AMBER_THRESHOLD) return 'rgba(183, 28, 28, 0.12)';
  if (percentage < GREEN_THRESHOLD) return 'rgba(230, 81, 0, 0.12)';
  return 'rgba(46, 125, 50, 0.12)';
}

export function scoreAllDays(lat: number, lon: number, daily: DailyWeather[]): number[] {
  return daily.map((day, i) =>
    percentageToInt(
      nuptialDailyPercentageModel(
        lat,
        lon,
        day,
        i + 1 < daily.length ? daily[i + 1].pop : undefined,
        i + 2 < daily.length ? daily[i + 2].pop : undefined,
      ),
    ),
  );
}

export function scoreHourly(lat: number, lon: number, hourly: HourlyWeather[]): number[] {
  return hourly.map((h) => percentageToInt(nuptialHourlyPercentageModel(lat, lon, h)));
}

export function findHourAtLocalTime(
  hourly: HourlyWeather[],
  timezoneOffset: number,
  hourLabel: string,
): HourlyWeather | null {
  for (const h of hourly) {
    const local = new Date((h.dt + timezoneOffset) * 1000);
    const label = local.toLocaleTimeString('en-US', {
      hour: 'numeric',
      hour12: true,
      timeZone: 'UTC',
    });
    if (label.replace(/\s/g, '').toLowerCase() === hourLabel.replace(/\s/g, '').toLowerCase()) {
      return h;
    }
  }
  return hourly.find((h) => {
    const local = new Date((h.dt + timezoneOffset) * 1000);
    return local.getUTCHours() === (hourLabel === '11AM' ? 11 : 19);
  }) ?? null;
}
