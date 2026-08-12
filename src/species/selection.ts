/**
 * Persist selected genus for species-aware scoring (null = All species).
 */
import { getSpeciesById, speciesPresentAt, type SpeciesProfile } from './catalog';
import type { LocationPlace } from './range';

const STORAGE_KEY = 'nuptial-radar-species';

let selectedId: string | null = null;
let loaded = false;

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && getSpeciesById(raw)) selectedId = raw;
    else if (raw === '' || raw === 'all') selectedId = null;
  } catch {
    selectedId = null;
  }
}

export function loadSavedSpeciesId(): void {
  loaded = false;
  ensureLoaded();
}

export function getSelectedSpeciesId(): string | null {
  ensureLoaded();
  return selectedId;
}

export function getSelectedSpecies(): SpeciesProfile | null {
  return getSpeciesById(getSelectedSpeciesId());
}

export function setSelectedSpeciesId(id: string | null): void {
  ensureLoaded();
  if (id && !getSpeciesById(id)) return;
  selectedId = id;
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function clearSelectedSpecies(): void {
  setSelectedSpeciesId(null);
}

/** Clear selection when the genus is not present at the current place. Returns true if cleared. */
export function clearSelectedSpeciesIfOutOfRange(place: LocationPlace | null | undefined): boolean {
  const selected = getSelectedSpecies();
  if (!selected || !place) return false;
  if (speciesPresentAt(selected, place)) return false;
  clearSelectedSpecies();
  return true;
}
