/** Midnight = full calendar day; now = 24 slots from current hour (nuptialflight mobile style). */
export type HourlyAnchor = 'midnight' | 'now';

const THEME_KEY = 'nuptial-radar-theme';
const SIMPLE_KEY = 'nuptial-radar-simple';
const HOURLY_ANCHOR_KEY = 'nuptial-radar-hourly-anchor';

let simpleMode = true;
let hourlyAnchor: HourlyAnchor = 'now';

function applyToDocument(): void {
  document.documentElement.dataset.theme = 'dark';
  document.documentElement.dataset.simple = simpleMode ? 'true' : 'false';
  document.documentElement.dataset.hourlyAnchor = hourlyAnchor;
}

export function loadDisplayPreferences(): void {
  // Eternal dark mode — clear any legacy light / biology-toggle preference
  try {
    localStorage.setItem(THEME_KEY, 'dark');
    localStorage.removeItem('nuptial-radar-biology-insights');
  } catch {
    /* ignore */
  }

  const savedSimple = localStorage.getItem(SIMPLE_KEY);
  if (savedSimple === 'true' || savedSimple === 'false') {
    simpleMode = savedSimple === 'true';
  }

  const savedAnchor = localStorage.getItem(HOURLY_ANCHOR_KEY);
  if (savedAnchor === 'midnight' || savedAnchor === 'now') {
    hourlyAnchor = savedAnchor;
  }

  applyToDocument();
}

export function getSimpleMode(): boolean {
  return simpleMode;
}

export function toggleSimpleMode(): boolean {
  simpleMode = !simpleMode;
  localStorage.setItem(SIMPLE_KEY, simpleMode ? 'true' : 'false');
  applyToDocument();
  return simpleMode;
}

export function getHourlyAnchor(): HourlyAnchor {
  return hourlyAnchor;
}

export function toggleHourlyAnchor(): HourlyAnchor {
  hourlyAnchor = hourlyAnchor === 'midnight' ? 'now' : 'midnight';
  localStorage.setItem(HOURLY_ANCHOR_KEY, hourlyAnchor);
  applyToDocument();
  return hourlyAnchor;
}

export function hourlyAnchorLabel(anchor: HourlyAnchor = hourlyAnchor): string {
  return anchor === 'midnight' ? 'Full day (midnight)' : 'From now (24h)';
}

/** Call once at module load so loading screens respect theme. */
loadDisplayPreferences();
