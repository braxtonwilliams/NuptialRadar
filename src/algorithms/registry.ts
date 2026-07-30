/**
 * Flight algorithm registry — switched via the header algorithm button.
 */
import { forestV1Algorithm } from './nuptials-forest-v1';
import { hybridLiteratureV2Algorithm } from './nuptials-hybrid-v2';
import type { FlightAlgorithm } from './types';

export const ALGORITHM_REGISTRY: FlightAlgorithm[] = [
  forestV1Algorithm,
  hybridLiteratureV2Algorithm,
];

export const DEFAULT_ALGORITHM_ID = forestV1Algorithm.id;

const STORAGE_KEY = 'nuptial-radar-algorithm';

let activeId = DEFAULT_ALGORITHM_ID;

export function cycleAlgorithm(): FlightAlgorithm {
  const idx = ALGORITHM_REGISTRY.findIndex((a) => a.id === activeId);
  const next = ALGORITHM_REGISTRY[(idx + 1) % ALGORITHM_REGISTRY.length];
  setActiveAlgorithmId(next.id);
  return next;
}

export function getAlgorithmIcon(id: string): string {
  switch (id) {
    case hybridLiteratureV2Algorithm.id:
      return '📖';
    case forestV1Algorithm.id:
    default:
      return '🌲';
  }
}

export function getAlgorithmById(id: string): FlightAlgorithm | undefined {
  return ALGORITHM_REGISTRY.find((a) => a.id === id);
}

export function getActiveAlgorithm(): FlightAlgorithm {
  return getAlgorithmById(activeId) ?? forestV1Algorithm;
}

export function getActiveAlgorithmId(): string {
  return activeId;
}

export function setActiveAlgorithmId(id: string): boolean {
  const algo = getAlgorithmById(id);
  if (!algo) return false;
  activeId = id;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
  return true;
}

export function loadSavedAlgorithmId(): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && getAlgorithmById(saved)) activeId = saved;
    else if (saved === 'biology-v3') activeId = DEFAULT_ALGORITHM_ID;
  } catch {
    /* ignore */
  }
}

export function listAlgorithms(): ReadonlyArray<{
  id: string;
  name: string;
  description: string;
  version: string;
}> {
  return ALGORITHM_REGISTRY.map(({ id, name, description, version }) => ({
    id,
    name,
    description,
    version,
  }));
}

export { forestV1Algorithm, hybridLiteratureV2Algorithm };
export { LITERATURE_STUDIES, LITERATURE_PARAMS } from './references';
