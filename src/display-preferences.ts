export type ThemeMode = 'light' | 'dark';
/** Midnight = full calendar day; now = 24 slots from current hour (nuptialflight mobile style). */
export type HourlyAnchor = 'midnight' | 'now';

const THEME_KEY = 'nuptial-radar-theme';
const SIMPLE_KEY = 'nuptial-radar-simple';
const HOURLY_ANCHOR_KEY = 'nuptial-radar-hourly-anchor';
const BIOLOGY_INSIGHTS_KEY = 'nuptial-radar-biology-insights';

let theme: ThemeMode = 'dark';
let simpleMode = true;
let hourlyAnchor: HourlyAnchor = 'now';
let biologyInsights = false;

function applyToDocument(): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.simple = simpleMode ? 'true' : 'false';
  document.documentElement.dataset.hourlyAnchor = hourlyAnchor;
}

export function loadDisplayPreferences(): void {
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme === 'light' || savedTheme === 'dark') {
    theme = savedTheme;
  }

  const savedSimple = localStorage.getItem(SIMPLE_KEY);
  if (savedSimple === 'true' || savedSimple === 'false') {
    simpleMode = savedSimple === 'true';
  }

  const savedAnchor = localStorage.getItem(HOURLY_ANCHOR_KEY);
  if (savedAnchor === 'midnight' || savedAnchor === 'now') {
    hourlyAnchor = savedAnchor;
  }

  biologyInsights = localStorage.getItem(BIOLOGY_INSIGHTS_KEY) === 'true';

  applyToDocument();
}

export function getTheme(): ThemeMode {
  return theme;
}

export function getSimpleMode(): boolean {
  return simpleMode;
}

export function toggleTheme(): ThemeMode {
  theme = theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, theme);
  applyToDocument();
  return theme;
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

export function getBiologyInsights(): boolean {
  return biologyInsights;
}

export function toggleBiologyInsights(): boolean {
  biologyInsights = !biologyInsights;
  localStorage.setItem(BIOLOGY_INSIGHTS_KEY, biologyInsights ? 'true' : 'false');
  return biologyInsights;
}

/** Call once at module load so loading screens respect theme. */
loadDisplayPreferences();
