export type ThemeMode = 'light' | 'dark';

const THEME_KEY = 'nuptial-radar-theme';
const SIMPLE_KEY = 'nuptial-radar-simple';

let theme: ThemeMode = 'dark';
let simpleMode = false;

function applyToDocument(): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.simple = simpleMode ? 'true' : 'false';
}

export function loadDisplayPreferences(): void {
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme === 'light' || savedTheme === 'dark') {
    theme = savedTheme;
  } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
    theme = 'light';
  }

  simpleMode = localStorage.getItem(SIMPLE_KEY) === 'true';
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

/** Call once at module load so loading screens respect theme. */
loadDisplayPreferences();
