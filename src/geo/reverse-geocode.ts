/**
 * Client-side reverse geocoding via BigDataCloud (no API key).
 * Open-Meteo has no public reverse endpoint (geocoding search only).
 */
import { buildLocationPlace, usStateFromAdmin1, type LocationPlace } from '../species/range';

export interface ReverseGeocodeHit {
  displayName: string;
  place: LocationPlace;
  /** Best effort place/city label for nearby lists. */
  localityName: string | null;
}

interface BigDataCloudResponse {
  latitude?: number;
  longitude?: number;
  countryCode?: string;
  countryName?: string;
  principalSubdivision?: string;
  principalSubdivisionCode?: string;
  city?: string;
  locality?: string;
  localityInfo?: {
    administrative?: Array<{ name?: string; adminLevel?: number; description?: string }>;
    informative?: Array<{ name?: string; description?: string }>;
  };
}

function stateFromSubdivisionCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const m = /^US-([A-Z]{2})$/i.exec(code.trim());
  return m ? m[1].toUpperCase() : null;
}

function pickLocalityName(data: BigDataCloudResponse): string | null {
  const city = data.city?.trim();
  if (city) return city;
  const locality = data.locality?.trim();
  if (locality) return locality;

  const informative = data.localityInfo?.informative ?? [];
  for (const row of informative) {
    const n = row.name?.trim();
    if (n) return n;
  }

  const admin = data.localityInfo?.administrative ?? [];
  const cityAdmin = admin.find((a) => a.adminLevel === 8 || a.adminLevel === 7);
  const n = cityAdmin?.name?.trim();
  return n || null;
}

export async function reverseGeocodeCoords(lat: number, lon: number): Promise<ReverseGeocodeHit | null> {
  const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
  url.searchParams.set('latitude', lat.toFixed(5));
  url.searchParams.set('longitude', lon.toFixed(5));
  url.searchParams.set('localityLanguage', 'en');

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = (await res.json()) as BigDataCloudResponse;

    const countryCode = data.countryCode?.trim().toUpperCase() || null;
    const subdivisionName = data.principalSubdivision?.trim() || null;
    const usState =
      stateFromSubdivisionCode(data.principalSubdivisionCode) ??
      usStateFromAdmin1(subdivisionName);

    const place = buildLocationPlace({
      lat: data.latitude ?? lat,
      lon: data.longitude ?? lon,
      countryCode,
      country: data.countryName ?? null,
      // Prefer US state code so buildLocationPlace resolves usState
      admin1: usState ?? subdivisionName,
    });

    const localityName = pickLocalityName(data);
    const displayName = [localityName, usState ?? subdivisionName, countryCode === 'US' ? 'US' : data.countryName]
      .filter(Boolean)
      .join(', ');

    return {
      displayName: displayName || `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`,
      place,
      localityName,
    };
  } catch {
    return null;
  }
}
