import { getSupabase, isSupabaseConfigured, isSupabaseReady } from './supabase';
import type { NewSightingInput, SightingKind, SightingRecord, WeatherSnapshot } from './types';

interface SightingRow {
  id: number;
  kind: SightingKind;
  latitude: number;
  longitude: number;
  observed_at: string;
  species: string | null;
  size_mm: number | null;
  temp_c: number | null;
  humidity_pct: number | null;
  wind_ms: number | null;
  pop: number | null;
  cloud_pct: number | null;
  pressure_hpa: number | null;
  dew_point_c: number | null;
  notes: string | null;
  created_at: string;
}

let calibrationCache: SightingRecord[] = [];

function rowToRecord(row: SightingRow): SightingRecord {
  return {
    id: row.id,
    kind: row.kind,
    latitude: row.latitude,
    longitude: row.longitude,
    observedAt: row.observed_at,
    species: row.species,
    sizeMm: row.size_mm,
    tempC: row.temp_c,
    humidityPct: row.humidity_pct,
    windMs: row.wind_ms,
    pop: row.pop,
    cloudPct: row.cloud_pct,
    pressureHpa: row.pressure_hpa,
    dewPointC: row.dew_point_c,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

async function fetchSightingsFromRemote(limit: number): Promise<SightingRecord[]> {
  if (!isSupabaseConfigured() || !isSupabaseReady()) return [];

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('sightings')
    .select('*')
    .order('observed_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data as SightingRow[]).map(rowToRecord);
}

export async function refreshSightingsCache(): Promise<void> {
  calibrationCache = await fetchSightingsFromRemote(500);
}

export function getSightingsForCalibration(): SightingRecord[] {
  return calibrationCache;
}

export function listSightings(limit = 100): SightingRecord[] {
  return calibrationCache.slice(0, limit);
}

export async function insertSighting(input: NewSightingInput): Promise<SightingRecord> {
  if (!isSupabaseConfigured() || !isSupabaseReady()) {
    throw new Error('Sightings storage is not configured.');
  }

  const supabase = getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in — reload and try again.');

  const w = input.weather;
  const { data, error } = await supabase
    .from('sightings')
    .insert({
      user_id: user.id,
      kind: input.kind,
      latitude: input.latitude,
      longitude: input.longitude,
      observed_at: input.observedAt.toISOString(),
      species: input.species?.trim() || null,
      size_mm: input.sizeMm ?? null,
      temp_c: w?.tempC ?? null,
      humidity_pct: w?.humidityPct ?? null,
      wind_ms: w?.windMs ?? null,
      pop: w?.pop ?? null,
      cloud_pct: w?.cloudPct ?? null,
      pressure_hpa: w?.pressureHpa ?? null,
      dew_point_c: w?.dewPointC ?? null,
      notes: input.notes?.trim() || null,
    })
    .select('*')
    .single();

  if (error) throw new Error(error.message);

  const record = rowToRecord(data as SightingRow);
  calibrationCache = [record, ...calibrationCache.filter((s) => s.id !== record.id)].slice(
    0,
    500,
  );
  return record;
}

export async function deleteSighting(id: number): Promise<void> {
  if (!isSupabaseConfigured() || !isSupabaseReady()) {
    throw new Error('Sightings storage is not configured.');
  }

  const supabase = getSupabase();
  const { error } = await supabase.from('sightings').delete().eq('id', id);
  if (error) throw new Error(error.message);

  calibrationCache = calibrationCache.filter((s) => s.id !== id);
}

export function getSightingsCount(): number {
  return calibrationCache.length;
}

export function sightingWeatherSnapshot(record: SightingRecord): WeatherSnapshot | null {
  if (record.tempC == null || record.humidityPct == null || record.windMs == null) return null;
  return {
    tempC: record.tempC,
    humidityPct: record.humidityPct,
    windMs: record.windMs,
    pop: record.pop ?? 0,
    cloudPct: record.cloudPct ?? 50,
    pressureHpa: record.pressureHpa ?? 1013,
    dewPointC: record.dewPointC ?? record.tempC - 5,
  };
}

export function formatSightingLabel(record: SightingRecord): string {
  const when = new Date(record.observedAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const taxon = record.species || (record.sizeMm != null ? `${record.sizeMm} mm queen` : 'Unknown species');
  const kind = record.kind === 'queen_capture' ? 'Queen' : 'Flight';
  return `${kind} · ${taxon} · ${when}`;
}
