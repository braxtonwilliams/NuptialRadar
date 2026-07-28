export type SightingKind = 'sighting' | 'queen_capture';

export interface WeatherSnapshot {
  tempC: number;
  humidityPct: number;
  windMs: number;
  pop: number;
  cloudPct: number;
  pressureHpa: number;
  dewPointC: number;
}

export interface SightingRecord {
  id: number;
  kind: SightingKind;
  latitude: number;
  longitude: number;
  observedAt: string;
  species: string | null;
  sizeMm: number | null;
  tempC: number | null;
  humidityPct: number | null;
  windMs: number | null;
  pop: number | null;
  cloudPct: number | null;
  pressureHpa: number | null;
  dewPointC: number | null;
  notes: string | null;
  createdAt: string;
}

export interface NewSightingInput {
  kind: SightingKind;
  latitude: number;
  longitude: number;
  observedAt: Date;
  species?: string | null;
  sizeMm?: number | null;
  weather?: WeatherSnapshot | null;
  notes?: string | null;
}

export interface CalibrationContext {
  tempC: number;
  humidityPct: number;
  windMs: number;
  pop: number;
  month: number;
  hour?: number;
}
