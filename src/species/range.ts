/**
 * Geographic presence for catalog genera (native or established invasive).
 * Country codes are ISO-3166-1 alpha-2. US state filters use 2-letter codes.
 */

export type PresenceKind = 'native' | 'invasive' | 'established';

export interface SpeciesRange {
  /** Countries where the genus is present (native or invasive). */
  countryCodes: string[];
  /**
   * When country is US and this is set, only these states qualify.
   * Omit for all US states (still requires US in countryCodes).
   */
  usStates?: string[];
  /** Optional lat band (degrees) as a safety net when geocode is incomplete. */
  latMin?: number;
  latMax?: number;
  lonMin?: number;
  lonMax?: number;
  presence: PresenceKind;
  presenceNote?: string;
}

/** Contiguous US + AK/HI shorthand regions for range definitions. */
export const US_SOUTH = [
  'AL', 'AR', 'FL', 'GA', 'KY', 'LA', 'MS', 'NC', 'OK', 'SC', 'TN', 'TX', 'VA', 'WV',
] as const;

export const US_SOUTHEAST = [
  'AL', 'AR', 'FL', 'GA', 'LA', 'MS', 'NC', 'OK', 'SC', 'TN', 'TX', 'VA',
] as const;

export const US_GULF_CARIBBEAN_STATES = [
  'AL', 'FL', 'GA', 'LA', 'MS', 'SC', 'TX',
] as const;

export const US_SOUTHWEST = [
  'AZ', 'CA', 'CO', 'NM', 'NV', 'OK', 'TX', 'UT',
] as const;

export const US_WEST = [
  'AZ', 'CA', 'CO', 'ID', 'MT', 'NM', 'NV', 'OR', 'UT', 'WA', 'WY',
] as const;

export const US_NORTH = [
  'CT', 'DE', 'IA', 'ID', 'IL', 'IN', 'MA', 'MD', 'ME', 'MI', 'MN', 'MT', 'ND',
  'NE', 'NH', 'NJ', 'NY', 'OH', 'OR', 'PA', 'RI', 'SD', 'VT', 'WA', 'WI', 'WY',
  'AK',
] as const;

export const US_TEMPERATE = [
  ...US_NORTH,
  'CO', 'KS', 'MO', 'VA', 'WV', 'KY', 'DC', 'CA', 'NV', 'UT', 'OR', 'WA',
] as const;

/** Caribbean / Atlantic island territories commonly used with Open-Meteo. */
export const CARIBBEAN = [
  'VI', 'PR', 'VG', 'AI', 'AG', 'BB', 'BQ', 'BS', 'CU', 'CW', 'DM', 'DO', 'GD',
  'GP', 'HT', 'JM', 'KN', 'KY', 'LC', 'MF', 'MQ', 'MS', 'SX', 'TC', 'TT', 'VC',
] as const;

export const NORTH_AMERICA = ['US', 'CA', 'MX', ...CARIBBEAN] as const;

/** Open-Meteo / GeoNames admin1 → US state code. */
const ADMIN1_TO_US_STATE: Record<string, string> = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  'district of columbia': 'DC',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
  // USVI / Puerto Rico sometimes reverse-geocode under US with island admin1
  'saint thomas island': 'VI',
  'saint croix island': 'VI',
  'saint john island': 'VI',
  'san juan': 'PR',
};

export interface LocationPlace {
  lat: number;
  lon: number;
  countryCode: string | null;
  country: string | null;
  admin1: string | null;
  /** Resolved US state / territory code when applicable. */
  usState: string | null;
}

export function usStateFromAdmin1(admin1: string | null | undefined): string | null {
  if (!admin1) return null;
  const key = admin1.trim().toLowerCase();
  if (/^[a-z]{2}$/i.test(admin1.trim())) return admin1.trim().toUpperCase();
  return ADMIN1_TO_US_STATE[key] ?? null;
}

/** US territories that should match Caribbean/Pacific country codes, not US state lists. */
const US_TERRITORY_COUNTRY = new Set(['PR', 'VI', 'GU', 'AS', 'MP']);

/** Normalize Open-Meteo / geocode fields into a LocationPlace for range checks. */
export function buildLocationPlace(input: {
  lat: number;
  lon: number;
  countryCode?: string | null;
  country?: string | null;
  admin1?: string | null;
}): LocationPlace {
  let countryCode = input.countryCode?.trim().toUpperCase() || null;
  const admin1 = input.admin1?.trim() || null;
  const fromAdmin = usStateFromAdmin1(admin1);

  if (countryCode && US_TERRITORY_COUNTRY.has(countryCode)) {
    return {
      lat: input.lat,
      lon: input.lon,
      countryCode,
      country: input.country ?? null,
      admin1,
      usState: null,
    };
  }

  if (countryCode === 'US' && fromAdmin && US_TERRITORY_COUNTRY.has(fromAdmin)) {
    return {
      lat: input.lat,
      lon: input.lon,
      countryCode: fromAdmin,
      country: input.country ?? null,
      admin1,
      usState: null,
    };
  }

  return {
    lat: input.lat,
    lon: input.lon,
    countryCode,
    country: input.country ?? null,
    admin1,
    usState: countryCode === 'US' ? fromAdmin : null,
  };
}

export function placePresentInRange(place: LocationPlace, range: SpeciesRange): boolean {
  const cc = place.countryCode?.toUpperCase() ?? null;

  if (range.latMin != null && place.lat < range.latMin) return false;
  if (range.latMax != null && place.lat > range.latMax) return false;
  if (range.lonMin != null && place.lon < range.lonMin) return false;
  if (range.lonMax != null && place.lon > range.lonMax) return false;

  if (cc) {
    if (!range.countryCodes.map((c) => c.toUpperCase()).includes(cc)) return false;

    if (cc === 'US' && range.usStates && range.usStates.length > 0) {
      const st = place.usState;
      // If we know the state, enforce it; if unknown, keep US-wide allow for that genus
      if (st && !range.usStates.map((s) => s.toUpperCase()).includes(st)) return false;
    }
    return true;
  }

  // No country from geocode — fall back to lat/lon box only when defined
  if (
    range.latMin != null ||
    range.latMax != null ||
    range.lonMin != null ||
    range.lonMax != null
  ) {
    return true; // already passed lat/lon checks above
  }

  // Unknown place and no bounds — hide rather than show irrelevant genera
  return false;
}
