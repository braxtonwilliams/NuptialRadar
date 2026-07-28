import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js/dist/sql-wasm.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

const STORAGE_KEY = 'nuptial-radar-sqlite-v1';

let sqlModule: SqlJsStatic | null = null;
let db: Database | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sightings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('sighting', 'queen_capture')),
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  observed_at TEXT NOT NULL,
  species TEXT,
  size_mm REAL,
  temp_c REAL,
  humidity_pct REAL,
  wind_ms REAL,
  pop REAL,
  cloud_pct REAL,
  pressure_hpa REAL,
  dew_point_c REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sightings_observed ON sightings(observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_sightings_geo ON sightings(latitude, longitude);
`;

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function initDatabase(): Promise<void> {
  if (db) return;

  sqlModule = await initSqlJs({
    locateFile: () => wasmUrl,
  });

  const saved = localStorage.getItem(STORAGE_KEY);
  db = saved ? new sqlModule.Database(base64ToUint8(saved)) : new sqlModule.Database();
  db.run(SCHEMA);
  persistDatabase();
}

export function persistDatabase(): void {
  if (!db) return;
  const binary = db.export();
  localStorage.setItem(STORAGE_KEY, uint8ToBase64(binary));
}

export function getDatabase(): Database {
  if (!db) throw new Error('Database not initialized — call initDatabase() first');
  return db;
}

export function isDatabaseReady(): boolean {
  return db != null;
}
