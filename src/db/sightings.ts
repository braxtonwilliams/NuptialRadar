import type { SqlValue } from 'sql.js';
import { getDatabase, persistDatabase } from './database';
import type { NewSightingInput, SightingKind, SightingRecord, WeatherSnapshot } from './types';

function rowToRecord(row: Record<string, SqlValue>): SightingRecord {
  return {
    id: row.id as number,
    kind: row.kind as SightingKind,
    latitude: row.latitude as number,
    longitude: row.longitude as number,
    observedAt: row.observed_at as string,
    species: (row.species as string | null) ?? null,
    sizeMm: (row.size_mm as number | null) ?? null,
    tempC: (row.temp_c as number | null) ?? null,
    humidityPct: (row.humidity_pct as number | null) ?? null,
    windMs: (row.wind_ms as number | null) ?? null,
    pop: (row.pop as number | null) ?? null,
    cloudPct: (row.cloud_pct as number | null) ?? null,
    pressureHpa: (row.pressure_hpa as number | null) ?? null,
    dewPointC: (row.dew_point_c as number | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

export function insertSighting(input: NewSightingInput): SightingRecord {
  const db = getDatabase();
  const w = input.weather;

  db.run(
    `INSERT INTO sightings (
      kind, latitude, longitude, observed_at, species, size_mm,
      temp_c, humidity_pct, wind_ms, pop, cloud_pct, pressure_hpa, dew_point_c, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.kind,
      input.latitude,
      input.longitude,
      input.observedAt.toISOString(),
      input.species?.trim() || null,
      input.sizeMm ?? null,
      w?.tempC ?? null,
      w?.humidityPct ?? null,
      w?.windMs ?? null,
      w?.pop ?? null,
      w?.cloudPct ?? null,
      w?.pressureHpa ?? null,
      w?.dewPointC ?? null,
      input.notes?.trim() || null,
    ],
  );

  persistDatabase();

  const idResult = db.exec('SELECT last_insert_rowid() AS id');
  const id = idResult[0]?.values[0]?.[0] as number;
  return getSightingById(id)!;
}

export function getSightingById(id: number): SightingRecord | null {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM sightings WHERE id = ?');
  stmt.bind([id]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const record = rowToRecord(stmt.getAsObject() as Record<string, SqlValue>);
  stmt.free();
  return record;
}

export function listSightings(limit = 100): SightingRecord[] {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM sightings ORDER BY observed_at DESC LIMIT ?');
  stmt.bind([limit]);
  const rows: SightingRecord[] = [];
  while (stmt.step()) {
    rows.push(rowToRecord(stmt.getAsObject() as Record<string, SqlValue>));
  }
  stmt.free();
  return rows;
}

export function deleteSighting(id: number): void {
  const db = getDatabase();
  db.run('DELETE FROM sightings WHERE id = ?', [id]);
  persistDatabase();
}

export function getSightingsCount(): number {
  const db = getDatabase();
  const result = db.exec('SELECT COUNT(*) AS c FROM sightings');
  return (result[0]?.values[0]?.[0] as number) ?? 0;
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

export function getSightingsForCalibration(): SightingRecord[] {
  return listSightings(500);
}
