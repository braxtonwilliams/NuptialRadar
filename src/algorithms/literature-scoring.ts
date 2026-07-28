/**
 * Literature-derived suitability functions for nuptial flight weather.
 *
 * Each function returns 0..1 where 1 = conditions closest to published flight
 * observations. Shapes are trapezoidal or Gaussian to avoid over-sharp peaks
 * when synthesising multiple species' requirements.
 */
import { LITERATURE_PARAMS as P } from './references';

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function trapezoid(x: number, a: number, b: number, c: number, d: number): number {
  if (x <= a || x >= d) return 0;
  if (x >= b && x <= c) return 1;
  if (x < b) return (x - a) / (b - a);
  return (d - x) / (d - c);
}

function gaussian(x: number, mean: number, sd: number): number {
  const z = (x - mean) / sd;
  return Math.exp(-0.5 * z * z);
}

/** Temperature suitability — Boomsma 1981, Sobczak 2017, temperate meta-range 15–28 °C. */
export function temperatureSuitability(tempC: number): number {
  const trap = trapezoid(tempC, P.temp.min, P.temp.softMin, P.temp.softMax, P.temp.hardMax);
  const peak = gaussian(tempC, P.temp.optimal, 4);
  const highBoost = tempC >= P.highTempBoost ? 0.15 : 0;
  return clamp01(0.55 * trap + 0.45 * peak + highBoost);
}

/** Relative humidity — Boomsma 1981, Depa 2006: flights on humid days. */
export function humiditySuitability(humidityPct: number): number {
  const trap = trapezoid(humidityPct, P.humidity.min, 60, 92, P.humidity.max);
  const peak = gaussian(humidityPct, P.humidity.optimal, 12);
  return clamp01(0.5 * trap + 0.5 * peak);
}

/** Wind speed — Sobczak 2017 (<6.3 m/s); hard cap matches nuptialflight model gates. */
export function windSuitability(windMs: number, gustMs?: number): number {
  const gust = gustMs ?? windMs;
  if (windMs >= P.wind.hardMax || gust >= P.gust.hardMax) return 0;
  const windScore = trapezoid(windMs, 0, 0, P.wind.optimal, P.wind.softMax);
  const gustPenalty = gust > P.gust.softMax ? 0.6 : 1;
  return clamp01(windScore * gustPenalty);
}

/** Dew-point depression (°C) — low values = moist air favourable for flight. */
export function dewDepressionSuitability(tempC: number, dewPointC: number): number {
  const dep = tempC - dewPointC;
  return clamp01(trapezoid(dep, 0, 1, P.dewDepression.optimal, P.dewDepression.softMax + 4));
}

/** Rain during flight hour — active rain strongly suppresses flight. */
export function rainDuringFlightSuitability(pop: number): number {
  if (pop >= P.rainPopFlight.hardMax) return 0.05;
  return clamp01(1 - pop / P.rainPopFlight.softMax);
}

/**
 * Antecedent rain boost — Wilson 1955, Messor barbarus 2009, Boomsma 1981.
 * Moderate recent rain followed by clearing weather increases probability.
 */
export function antecedentRainBoost(rainMm: number, popNext1 = 0, popNext2 = 0): number {
  const rainScore = trapezoid(
    rainMm,
    0,
    P.antecedentRainMm.softMin,
    P.antecedentRainMm.optimal,
    P.antecedentRainMm.softMax,
  );
  const clearing = 1 - popNext1 * 0.5 - popNext2 * 0.25;
  return clamp01(rainScore * clearing);
}

/** Diurnal hour multiplier — late-morning and late-afternoon peaks (European field guides). */
export function diurnalHourMultiplier(localHour: number): number {
  for (const w of P.diurnalHours) {
    if (localHour >= w.start && localHour <= w.end) return 1;
  }
  if (localHour >= 8 && localHour <= 22) return 0.55;
  return 0.2;
}

/** Cloud cover — partly cloudy to overcast often reported (Depa 2006); clear also OK. */
export function cloudSuitability(cloudPct: number): number {
  return clamp01(0.7 + 0.3 * gaussian(cloudPct, 55, 30));
}

/** Barometric pressure — weak effect; avoid extreme lows during active storms. */
export function pressureSuitability(pressureHpa: number): number {
  return clamp01(trapezoid(pressureHpa, 990, 1005, 1025, 1040));
}

function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor((date.getTime() - start) / 86400000);
}

/** Seasonal gate from cyclical DOY — aligns with Dunn 2007 phenology + nuptialflight hemispheres. */
export function seasonalGate(lat: number, dateUtc: Date): number {
  const doy = dayOfYear(dateUtc);
  const sinDoy = Math.sin((2 * Math.PI * doy) / 365.25);
  const hemisphere = lat > 0 ? 1 : -1;
  const season = hemisphere * sinDoy;
  return clamp01(0.45 + 0.55 * ((season + 1) / 2));
}

export interface LiteratureDailyInput {
  tempC: number;
  humidityPct: number;
  windMs: number;
  gustMs: number;
  dewPointC: number;
  cloudPct: number;
  pressureHpa: number;
  pop: number;
  rainMm: number;
  popNext1?: number;
  popNext2?: number;
}

export interface LiteratureHourlyInput extends LiteratureDailyInput {
  localHour: number;
}

/** Composite daily literature score in 0..1. */
export function literatureDailyScore(input: LiteratureDailyInput, lat: number, dateUtc: Date): number {
  const weights = {
    temp: 2.2,
    humid: 2.0,
    wind: 2.5,
    dewDep: 1.5,
    rainFlight: 1.2,
    antecedent: 1.3,
    cloud: 0.6,
    press: 0.4,
  };

  const terms: Record<keyof typeof weights, number> = {
    temp: temperatureSuitability(input.tempC),
    humid: humiditySuitability(input.humidityPct),
    wind: windSuitability(input.windMs, input.gustMs),
    dewDep: dewDepressionSuitability(input.tempC, input.dewPointC),
    rainFlight: rainDuringFlightSuitability(input.pop),
    antecedent: antecedentRainBoost(input.rainMm, input.popNext1, input.popNext2),
    cloud: cloudSuitability(input.cloudPct),
    press: pressureSuitability(input.pressureHpa),
  };

  let sum = 0;
  let wSum = 0;
  for (const [k, w] of Object.entries(weights) as [keyof typeof weights, number][]) {
    sum += terms[k] * w;
    wSum += w;
  }

  const base = sum / wSum;
  const season = seasonalGate(lat, dateUtc);
  return clamp01(base * (0.65 + 0.35 * season));
}

/** Composite hourly literature score in 0..1. */
export function literatureHourlyScore(input: LiteratureHourlyInput, lat: number, dateUtc: Date): number {
  const daily = literatureDailyScore(input, lat, dateUtc);
  const hour = diurnalHourMultiplier(input.localHour);
  const rain = rainDuringFlightSuitability(input.pop);
  return clamp01(daily * (0.55 + 0.45 * hour) * (0.7 + 0.3 * rain));
}
